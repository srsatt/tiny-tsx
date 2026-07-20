use std::{
    collections::BTreeMap,
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant, SystemTime},
};

use crate::{build, frontend};

const POLL_INTERVAL: Duration = Duration::from_millis(75);

static SHUTDOWN_REQUESTED: AtomicBool = AtomicBool::new(false);

#[derive(Clone, Copy, Eq, PartialEq)]
struct FileVersion {
    modified: Option<SystemTime>,
    len: u64,
}

struct RunningGeneration {
    child: Child,
    executable: PathBuf,
    port: u16,
    number: u64,
    startup: Duration,
}

pub fn execute(
    options: build::Options,
    restart_timeout: Duration,
    runtime_bindings: Vec<String>,
) -> Result<(), String> {
    install_signal_handlers()?;
    let base_output = absolute(&options.output)?;
    let mut options = options;
    options.runtime_target_directory = Some(absolute(Path::new(".tinytsx/cache/runtime"))?);
    let mut generation = 1_u64;
    let mut frontend = frontend::Session::start(
        &options.entry,
        &options.aliases,
        &options.api_aliases,
        &options.bindings,
        &options.allowed_environment,
        &options.allowed_read_roots,
        &options.allowed_write_roots,
    )?;
    let (mut running, mut watched) = build_and_start(
        &options,
        &base_output,
        generation,
        frontend.compile()?,
        &runtime_bindings,
    )?;
    println!("TinyTSX dev: watching {} source file(s)", watched.len());

    while !SHUTDOWN_REQUESTED.load(Ordering::Acquire) {
        thread::sleep(POLL_INTERVAL);
        if !changed(&watched) {
            if let Some(status) = running
                .child
                .try_wait()
                .map_err(|error| error.to_string())?
            {
                return Err(format!("development server exited with {status}"));
            }
            continue;
        }

        println!("TinyTSX dev: change detected; rebuilding");
        let reload_started = Instant::now();
        refresh(&mut watched);
        generation += 1;
        let mut candidate_options = options.clone();
        candidate_options.output = generation_output(&base_output, generation);
        let frontend_started = Instant::now();
        let compilation = frontend.compile();
        let frontend_duration = frontend_started.elapsed();
        match compilation
            .and_then(|compilation| build::execute_compilation(&candidate_options, compilation))
        {
            Ok(output) => {
                let fallback_executable = running.executable.clone();
                let fallback_port = running.port;
                let fallback_number = running.number;
                let shutdown_started = Instant::now();
                terminate(&mut running.child, restart_timeout)?;
                let shutdown_duration = shutdown_started.elapsed();
                running = match start_ready(
                    &output.executable,
                    output.port,
                    generation,
                    &runtime_bindings,
                ) {
                    Ok(candidate) => candidate,
                    Err(error) => {
                        eprintln!("TinyTSX dev: candidate generation {generation} failed: {error}");
                        let restored = start_ready(
                            &fallback_executable,
                            fallback_port,
                            fallback_number,
                            &runtime_bindings,
                        )?;
                        eprintln!(
                            "TinyTSX dev: candidate failed; restored generation {fallback_number}"
                        );
                        restored
                    }
                };
                watched = versions(&output.dependencies);
                if running.number == generation {
                    println!("TinyTSX dev: generation {generation} started");
                    println!(
                        "TinyTSX dev: reload timings: frontend={}ms codegen={}ms assembly={}ms link={}ms shutdown={}ms startup={}ms total={}ms",
                        frontend_duration.as_millis(),
                        output.timings.codegen.as_millis(),
                        output.timings.assembly.as_millis(),
                        output.timings.link.as_millis(),
                        shutdown_duration.as_millis(),
                        running.startup.as_millis(),
                        reload_started.elapsed().as_millis(),
                    );
                }
            }
            Err(error) => {
                eprintln!("{error}");
                eprintln!(
                    "TinyTSX dev: build failed; generation {} is still running",
                    generation - 1
                );
            }
        }
    }

    terminate(&mut running.child, restart_timeout)
}

fn build_and_start(
    options: &build::Options,
    base_output: &Path,
    generation: u64,
    compilation: frontend::Compilation,
    runtime_bindings: &[String],
) -> Result<(RunningGeneration, BTreeMap<PathBuf, FileVersion>), String> {
    let mut candidate_options = options.clone();
    candidate_options.output = generation_output(base_output, generation);
    let output = build::execute_compilation(&candidate_options, compilation)?;
    let running = start_ready(
        &output.executable,
        output.port,
        generation,
        runtime_bindings,
    )?;
    Ok((running, versions(&output.dependencies)))
}

fn start_ready(
    executable: &Path,
    port: u16,
    generation: u64,
    runtime_bindings: &[String],
) -> Result<RunningGeneration, String> {
    let startup_started = Instant::now();
    let mut command = Command::new(executable);
    for binding in runtime_bindings {
        command.arg("--bind").arg(binding);
    }
    let mut child = command
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|error| format!("could not start {}: {error}", executable.display()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "development server has no stdout pipe".to_owned())?;
    let (ready_sender, ready_receiver) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let mut ready_sender = Some(ready_sender);
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            println!("[dev:{generation}] {line}");
            if line.starts_with("TinyTSX listening on ") {
                if let Some(sender) = ready_sender.take() {
                    let _ = sender.send(());
                }
            }
        }
    });

    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    while std::time::Instant::now() < deadline {
        if ready_receiver.try_recv().is_ok() {
            return Ok(RunningGeneration {
                child,
                executable: executable.to_owned(),
                port,
                number: generation,
                startup: startup_started.elapsed(),
            });
        }
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            return Err(format!("{} exited with {status}", executable.display()));
        }
        thread::sleep(Duration::from_millis(10));
    }
    let _ = child.kill();
    let _ = child.wait();
    Err(format!(
        "{} did not report listener readiness within 2000ms",
        executable.display()
    ))
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
    let mut watched = BTreeMap::new();
    for path in paths {
        watched.insert(path.clone(), version(path));
        if let Some(parent) = path.parent() {
            watched
                .entry(parent.to_owned())
                .or_insert_with(|| version(parent));
        }
    }
    watched
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
        let previous =
            unsafe { libc::signal(signal, handle_signal as *const () as libc::sighandler_t) };
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
