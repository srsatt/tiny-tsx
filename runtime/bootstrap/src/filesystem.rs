use std::{
    ffi::CString,
    fs::File,
    io::{self, Read},
    path::{Component, Path, PathBuf},
    sync::{
        OnceLock,
        atomic::{AtomicUsize, Ordering},
    },
};

#[cfg(unix)]
use std::{
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::ffi::OsStrExt,
    },
};

use tinytsx_runtime_worker::{ApplicationPool, LogicalWorker};

use crate::abi::{
    APPLICATION_OVERLOAD, RENDER_ERROR, configured_read_root, configured_read_roots,
};

pub const MAX_FILE_BYTES: usize = 1_048_576;

static ROOTS: OnceLock<Vec<ReadRoot>> = OnceLock::new();
const FILE_QUEUE_PER_EXECUTOR: usize = 64;

struct FileRequest {
    path: Vec<u8>,
    max_bytes: usize,
}

type FileResult = Result<Vec<u8>, u32>;
type Pool = ApplicationPool<(), FileRequest, FileResult>;
type Worker = LogicalWorker<(), FileRequest, FileResult>;

struct FileRuntime {
    _pool: Pool,
    workers: Vec<Worker>,
    next_worker: AtomicUsize,
}

static FILES: OnceLock<FileRuntime> = OnceLock::new();

struct ReadRoot {
    #[cfg(unix)]
    directory: File,
    #[cfg(not(unix))]
    path: PathBuf,
}

impl ReadRoot {
    fn open(path: PathBuf) -> io::Result<Self> {
        let canonical = path.canonicalize()?;
        if !canonical.is_dir() {
            return Err(io::Error::other(format!(
                "configured read root is not a directory: {}",
                canonical.display()
            )));
        }
        #[cfg(unix)]
        {
            Ok(Self {
                directory: File::open(canonical)?,
            })
        }
        #[cfg(not(unix))]
        {
            Ok(Self { path: canonical })
        }
    }

    #[cfg(unix)]
    fn open_file(&self, relative: &Path) -> io::Result<File> {
        let components = relative.components().collect::<Vec<_>>();
        let mut directory = None;
        for (index, component) in components.iter().enumerate() {
            let Component::Normal(name) = component else {
                return Err(io::Error::other("invalid relative file path"));
            };
            let name = CString::new(name.as_bytes())
                .map_err(|_| io::Error::other("file path contains a null byte"))?;
            let parent = directory
                .as_ref()
                .map_or(self.directory.as_raw_fd(), AsRawFd::as_raw_fd);
            let last = index + 1 == components.len();
            let flags = libc::O_RDONLY
                | libc::O_CLOEXEC
                | libc::O_NOFOLLOW
                | if last { 0 } else { libc::O_DIRECTORY };
            // SAFETY: `parent` remains open for the call and `name` is null-terminated.
            let descriptor = unsafe { libc::openat(parent, name.as_ptr(), flags) };
            if descriptor < 0 {
                return Err(io::Error::last_os_error());
            }
            // SAFETY: successful `openat` returns a new owned descriptor.
            let opened = unsafe { File::from_raw_fd(descriptor) };
            if last {
                return Ok(opened);
            }
            directory = Some(opened);
        }
        Err(io::Error::other("empty relative file path"))
    }

    #[cfg(not(unix))]
    fn open_file(&self, relative: &Path) -> io::Result<File> {
        let candidate = self.path.join(relative).canonicalize()?;
        if !candidate.starts_with(&self.path) || !candidate.is_file() {
            return Err(io::Error::other("file escapes configured root"));
        }
        File::open(candidate)
    }
}

pub fn initialize(worker_count: usize) -> io::Result<usize> {
    let count = configured_read_roots();
    let mut roots = Vec::with_capacity(count);
    for index in 0..count {
        let root = configured_read_root(index)
            .map_err(|status| io::Error::other(format!("read root config status {status}")))?;
        let root = PathBuf::from(
            String::from_utf8(root)
                .map_err(|_| io::Error::other("generated read root is not UTF-8"))?,
        );
        roots.push(ReadRoot::open(root)?);
    }
    ROOTS
        .set(roots)
        .map_err(|_| io::Error::other("filesystem roots were already initialized"))?;
    if count == 0 {
        return Ok(0);
    }
    let queue_capacity = worker_count
        .checked_mul(FILE_QUEUE_PER_EXECUTOR)
        .ok_or_else(|| io::Error::other("file queue capacity overflow"))?;
    let pool = ApplicationPool::new(
        worker_count,
        queue_capacity,
        FILE_QUEUE_PER_EXECUTOR,
        |_| (),
        |_, request: FileRequest| {
            let roots = ROOTS.get().ok_or(RENDER_ERROR)?;
            read_from_roots(roots, &request.path, request.max_bytes)
        },
    )?;
    let workers = (0..worker_count).map(|_| pool.spawn()).collect();
    FILES
        .set(FileRuntime {
            _pool: pool,
            workers,
            next_worker: AtomicUsize::new(0),
        })
        .map_err(|_| io::Error::other("file workers were already initialized"))?;
    Ok(count)
}

pub fn read_text(path: &[u8], max_bytes: usize) -> Result<Vec<u8>, u32> {
    let runtime = FILES.get().ok_or(RENDER_ERROR)?;
    let index = runtime.next_worker.fetch_add(1, Ordering::Relaxed) % runtime.workers.len();
    runtime.workers[index]
        .call(FileRequest {
            path: path.to_vec(),
            max_bytes,
        })
        .map_err(|_| APPLICATION_OVERLOAD)?
}

fn read_from_roots(roots: &[ReadRoot], path: &[u8], max_bytes: usize) -> Result<Vec<u8>, u32> {
    if path.is_empty() || path.len() > 4096 || max_bytes == 0 || max_bytes > MAX_FILE_BYTES {
        return Err(RENDER_ERROR);
    }
    let relative = std::str::from_utf8(path).map_err(|_| RENDER_ERROR)?;
    let relative = Path::new(relative);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(RENDER_ERROR);
    }
    for root in roots {
        let file = match root.open_file(relative) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(_) => return Err(RENDER_ERROR),
        };
        let mut output = Vec::with_capacity(max_bytes.min(8192));
        file.take(max_bytes as u64 + 1)
            .read_to_end(&mut output)
            .map_err(|_| RENDER_ERROR)?;
        if output.len() > max_bytes || std::str::from_utf8(&output).is_err() {
            return Err(RENDER_ERROR);
        }
        return Ok(output);
    }
    Err(RENDER_ERROR)
}

#[cfg(test)]
mod tests {
    use super::{MAX_FILE_BYTES, ReadRoot, read_from_roots};
    use std::fs;

    #[test]
    fn reads_utf8_and_rejects_traversal_or_overflow() {
        let root = std::env::temp_dir().join(format!("tinytsx-fs-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        let root = root.canonicalize().unwrap();
        fs::write(root.join("asset.txt"), "hello").unwrap();
        let roots = [ReadRoot::open(root.clone()).unwrap()];

        assert_eq!(read_from_roots(&roots, b"asset.txt", 5).unwrap(), b"hello");
        assert!(read_from_roots(&roots, b"../asset.txt", MAX_FILE_BYTES).is_err());
        assert!(read_from_roots(&roots, b"asset.txt", 4).is_err());
        assert!(read_from_roots(&roots, b"missing.txt", 32).is_err());
        fs::create_dir(root.join("directory")).unwrap();
        assert!(read_from_roots(&roots, b"directory", 32).is_err());
        fs::write(root.join("invalid.txt"), [0xff]).unwrap();
        assert!(read_from_roots(&roots, b"invalid.txt", 32).is_err());
        fs::write(root.join("asset.txt"), "updated").unwrap();
        assert_eq!(
            read_from_roots(&roots, b"asset.txt", 7).unwrap(),
            b"updated"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() {
        use std::os::unix::fs::symlink;

        let base = std::env::temp_dir().join(format!("tinytsx-fs-link-{}", std::process::id()));
        let root = base.join("root");
        let outside = base.join("outside.txt");
        let _ = fs::remove_dir_all(&base);
        fs::create_dir_all(&root).unwrap();
        fs::write(&outside, "secret").unwrap();
        symlink(&outside, root.join("escape.txt")).unwrap();

        assert!(
            read_from_roots(
                &[ReadRoot::open(root.clone()).unwrap()],
                b"escape.txt",
                32,
            )
            .is_err()
        );
        fs::remove_dir_all(base).unwrap();
    }
}
