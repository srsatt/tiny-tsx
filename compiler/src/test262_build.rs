use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{frontend, target::Target, test262_codegen};

pub struct Options {
    pub entry: String,
    pub output: PathBuf,
}

pub fn execute(options: &Options) -> Result<PathBuf, String> {
    let target = Target::host()?;
    let mut compilation = frontend::compile_test262(&options.entry)?;
    compilation.program.target = target.triple().to_owned();
    let assembly = test262_codegen::emit(&compilation.program, target)?;
    let temporary = temporary_directory(&frontend::repository_root())?;
    let assembly_path = temporary.join("test262.s");
    let object_path = temporary.join("test262.o");
    fs::write(&assembly_path, assembly)
        .map_err(|error| format!("could not write {}: {error}", assembly_path.display()))?;
    command_result(
        "clang Test262 assembly",
        Command::new("clang")
            .args(["-c"])
            .arg(&assembly_path)
            .arg("-o")
            .arg(&object_path)
            .output()
            .map_err(|error| format!("failed to start clang: {error}"))?,
    )?;

    let output = absolute_output(&options.output)?;
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("could not create {}: {error}", parent.display()))?;
    }
    command_result(
        "clang Test262 link",
        Command::new("clang")
            .arg(&object_path)
            .arg("-o")
            .arg(&output)
            .output()
            .map_err(|error| format!("failed to start clang: {error}"))?,
    )?;
    fs::remove_dir_all(&temporary)
        .map_err(|error| format!("could not remove {}: {error}", temporary.display()))?;
    println!(
        "compiled Test262 case {} -> {}",
        compilation.program.entry,
        output.display()
    );
    Ok(output)
}

fn temporary_directory(root: &Path) -> Result<PathBuf, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("system clock error: {error}"))?
        .as_nanos();
    let path = root
        .join(".tinytsx")
        .join(format!("test262-{}-{timestamp}", std::process::id()));
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
