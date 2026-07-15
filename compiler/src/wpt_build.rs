use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{frontend, wpt_codegen};

pub struct Options {
    pub entry: String,
    pub output: PathBuf,
}

pub fn execute(options: &Options) -> Result<PathBuf, String> {
    ensure_supported_host()?;
    let compilation = frontend::compile_wpt(&options.entry)?;
    let c_source = wpt_codegen::emit_c(&compilation.program)?;
    let temporary = temporary_directory(&frontend::repository_root())?;
    let source_path = temporary.join("wpt.c");
    fs::write(&source_path, c_source)
        .map_err(|error| format!("could not write {}: {error}", source_path.display()))?;

    let output = absolute_output(&options.output)?;
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("could not create {}: {error}", parent.display()))?;
    }
    command_result(
        "clang WPT executable",
        Command::new("clang")
            .args(["-std=c11", "-Wall", "-Wextra", "-Werror"])
            .arg(&source_path)
            .arg("-o")
            .arg(&output)
            .output()
            .map_err(|error| format!("failed to start clang: {error}"))?,
    )?;
    fs::remove_dir_all(&temporary)
        .map_err(|error| format!("could not remove {}: {error}", temporary.display()))?;
    println!(
        "compiled WPT case {} -> {}",
        compilation.program.entry,
        output.display()
    );
    Ok(output)
}

fn ensure_supported_host() -> Result<(), String> {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Ok(())
    } else {
        Err("native WPT builds currently require Apple Silicon macOS".to_owned())
    }
}

fn temporary_directory(root: &Path) -> Result<PathBuf, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("system clock error: {error}"))?
        .as_nanos();
    let path = root
        .join(".tinytsx")
        .join(format!("wpt-{}-{timestamp}", std::process::id()));
    fs::create_dir_all(&path)
        .map_err(|error| format!("could not create {}: {error}", path.display()))?;
    Ok(path)
}

fn absolute_output(output: &Path) -> Result<PathBuf, String> {
    if output.is_absolute() {
        Ok(output.to_owned())
    } else {
        std::env::current_dir()
            .map(|directory| directory.join(output))
            .map_err(|error| format!("could not read current directory: {error}"))
    }
}

fn command_result(action: &str, output: std::process::Output) -> Result<(), String> {
    if output.status.success() {
        return Ok(());
    }
    Err(format!(
        "{action} failed:\n{}",
        String::from_utf8_lossy(&output.stderr).trim_end()
    ))
}
