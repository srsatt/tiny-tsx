use std::{
    fs::File,
    io::{self, Read},
    path::{Component, Path, PathBuf},
    sync::OnceLock,
};

use crate::abi::{RENDER_ERROR, configured_read_root, configured_read_roots};

pub const MAX_FILE_BYTES: usize = 1_048_576;

static ROOTS: OnceLock<Vec<PathBuf>> = OnceLock::new();

pub fn initialize() -> io::Result<usize> {
    let count = configured_read_roots();
    let mut roots = Vec::with_capacity(count);
    for index in 0..count {
        let root = configured_read_root(index)
            .map_err(|status| io::Error::other(format!("read root config status {status}")))?;
        let root = PathBuf::from(
            String::from_utf8(root)
                .map_err(|_| io::Error::other("generated read root is not UTF-8"))?,
        );
        let canonical = root.canonicalize()?;
        if !canonical.is_dir() {
            return Err(io::Error::other(format!(
                "configured read root is not a directory: {}",
                canonical.display()
            )));
        }
        roots.push(canonical);
    }
    ROOTS
        .set(roots)
        .map_err(|_| io::Error::other("filesystem roots were already initialized"))?;
    Ok(count)
}

pub fn enabled() -> bool {
    ROOTS.get().is_some_and(|roots| !roots.is_empty())
}

pub fn read_text(path: &[u8], max_bytes: usize) -> Result<Vec<u8>, u32> {
    let roots = ROOTS.get().ok_or(RENDER_ERROR)?;
    read_from_roots(roots, path, max_bytes)
}

fn read_from_roots(roots: &[PathBuf], path: &[u8], max_bytes: usize) -> Result<Vec<u8>, u32> {
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
        let candidate = match root.join(relative).canonicalize() {
            Ok(candidate) => candidate,
            Err(error) if error.kind() == io::ErrorKind::NotFound => continue,
            Err(_) => return Err(RENDER_ERROR),
        };
        if !candidate.starts_with(root) || !candidate.is_file() {
            return Err(RENDER_ERROR);
        }
        let file = File::open(candidate).map_err(|_| RENDER_ERROR)?;
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
    use super::{MAX_FILE_BYTES, read_from_roots};
    use std::{fs, path::PathBuf};

    #[test]
    fn reads_utf8_and_rejects_traversal_or_overflow() {
        let root = std::env::temp_dir().join(format!("tinytsx-fs-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("asset.txt"), "hello").unwrap();
        let roots = [root.clone()];

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

        assert!(read_from_roots(&[PathBuf::from(&root)], b"escape.txt", 32).is_err());
        fs::remove_dir_all(base).unwrap();
    }
}
