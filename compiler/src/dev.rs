use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    process::{Child, Command},
    sync::atomic::{AtomicBool, Ordering},
    thread,
    time::{Duration, SystemTime},
};

use crate::build;

const POLL_INTERVAL: Duration = Duration::from_millis(75);
const RESTART_TIMEOUT: Duration = Duration::from_secs(2);

static SHUTDOWN_REQUESTED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Copy, Eq, PartialEq)]
struct FileVersion {
    modified: Option<SystemTime>,
    len: u64,
}

pub fn execute(options: build::Options) -> Result<(), String> {
    install_signal_handlers()?;
    let base_output = absolute(&options.output)?;
    let mut options = options;
    options.runtime_target_directory = Some(absolute(Path::new(".tinytsx/cache/runtime"))?);
    let mut generation = 1_u64;
    let (mut child, mut watched) = build_and_start(&options, &base_output, generation)?;
    println!("TinyTSX dev: watching {} source file(s)", watched.len());

    while !SHUTDOWN_REQUESTED.load(Ordering::Acquire) {
        thread::sleep(POLL_INTERVAL);
        if !changed(&watched) {
            if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
                return Err(format!("development server exited with {status}"));
            }
            continue;
        }

        println!("TinyTSX dev: change detected; rebuilding");
        generation += 1;
        let mut candidate_options = options.clone();
        candidate_options.output = generation_output(&base_output, generation);
        match build::execute(&candidate_options) {
            Ok(output) => {
                terminate(&mut child, RESTART_TIMEOUT)?;
                child = start(&output.executable)?;
                watched = versions(&output.dependencies);
                println!("TinyTSX dev: generation {generation} started");
            }
            Err(error) => {
                eprintln!("{error}");
                eprintln!(
                    "TinyTSX dev: build failed; generation {} is still running",
                    generation - 1
                );
                refresh(&mut watched);
            }
        }
    }

    terminate(&mut child, RESTART_TIMEOUT)
}

fn build_and_start(
    options: &build::Options,
    base_output: &Path,
    generation: u64,
) -> Result<(Child, BTreeMap<PathBuf, FileVersion>), String> {
    let mut candidate_options = options.clone();
    candidate_options.output = generation_output(base_output, generation);
    let output = build::execute(&candidate_options)?;
    let child = start(&output.executable)?;
    Ok((child, versions(&output.dependencies)))
}

fn start(executable: &Path) -> Result<Child, String> {
    Command::new(executable)
        .spawn()
        .map_err(|error| format!("could not start {}: {error}", executable.display()))
}

fn terminate(child: &mut Child, timeout: Duration) -> Result<(), String> {
    if child
        .try_wait()
        .map_err(|error| error.to_string())?
        .is_some()
    {
        return Ok(());
    }
    let result = unsafe { libc::kill(child.id() as libc::pid_t, libc::SIGTERM) };
    if result != 0 {
        return Err(format!(
            "could not stop development server: {}",
            std::io::Error::last_os_error()
        ));
    }
    let deadline = std::time::Instant::now() + timeout;
    while std::time::Instant::now() < deadline {
        if child
            .try_wait()
            .map_err(|error| error.to_string())?
            .is_some()
        {
            return Ok(());
        }
        thread::sleep(Duration::from_millis(10));
    }
    eprintln!("TinyTSX dev: graceful shutdown timed out; terminating child");
    child.kill().map_err(|error| error.to_string())?;
    child.wait().map_err(|error| error.to_string())?;
    Ok(())
}

fn versions(paths: &[PathBuf]) -> BTreeMap<PathBuf, FileVersion> {
    paths
        .iter()
        .map(|path| (path.clone(), version(path)))
        .collect()
}

fn version(path: &Path) -> FileVersion {
    match fs::metadata(path) {
        Ok(metadata) => FileVersion {
            modified: metadata.modified().ok(),
            len: metadata.len(),
        },
        Err(_) => FileVersion {
            modified: None,
            len: 0,
        },
    }
}

fn changed(watched: &BTreeMap<PathBuf, FileVersion>) -> bool {
    watched
        .iter()
        .any(|(path, previous)| version(path) != *previous)
}

fn refresh(watched: &mut BTreeMap<PathBuf, FileVersion>) {
    for (path, current) in watched {
        *current = version(path);
    }
}

fn generation_output(base: &Path, generation: u64) -> PathBuf {
    let mut value = base.as_os_str().to_owned();
    value.push(format!("-{generation}"));
    PathBuf::from(value)
}

fn absolute(path: &Path) -> Result<PathBuf, String> {
    if path.is_absolute() {
        Ok(path.to_owned())
    } else {
        std::env::current_dir()
            .map(|cwd| cwd.join(path))
            .map_err(|error| format!("could not resolve development output: {error}"))
    }
}

fn install_signal_handlers() -> Result<(), String> {
    for signal in [libc::SIGINT, libc::SIGTERM] {
        let previous = unsafe { libc::signal(signal, handle_signal as libc::sighandler_t) };
        if previous == libc::SIG_ERR {
            return Err(format!(
                "could not install development signal handler: {}",
                std::io::Error::last_os_error()
            ));
        }
    }
    Ok(())
}

extern "C" fn handle_signal(_signal: libc::c_int) {
    SHUTDOWN_REQUESTED.store(true, Ordering::Release);
}
