use std::{
    fs,
    path::PathBuf,
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::{hir::Program, target::Target};

use super::{Options, portable_c};

pub(super) fn emit(program: &Program, options: Options, target: Target) -> Result<String, String> {
    let source = portable_c::emit(program, &options)?;
    compile_to_assembly(&source, target)
}

fn compile_to_assembly(source: &str, target: Target) -> Result<String, String> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("system clock error: {error}"))?
        .as_nanos();
    let directory = std::env::temp_dir()
        .join("tinytsx")
        .join(format!("x86-codegen-{}-{nonce}", std::process::id()));
    fs::create_dir_all(&directory)
        .map_err(|error| format!("could not create {}: {error}", directory.display()))?;
    let source_path = directory.join("generated.c");
    let assembly_path = directory.join("generated.s");
    let result = compile(&source_path, &assembly_path, source, target).and_then(|()| {
        fs::read_to_string(&assembly_path)
            .map_err(|error| format!("could not read {}: {error}", assembly_path.display()))
    });
    let _ = fs::remove_dir_all(&directory);
    result
}

fn compile(
    source_path: &PathBuf,
    assembly_path: &PathBuf,
    source: &str,
    target: Target,
) -> Result<(), String> {
    fs::write(source_path, source)
        .map_err(|error| format!("could not write {}: {error}", source_path.display()))?;
    let output = Command::new("clang")
        .arg(format!("--target={}", target.triple()))
        .args(["-std=c11", "-O2", "-fno-stack-protector", "-S"])
        .arg(source_path)
        .arg("-o")
        .arg(assembly_path)
        .output()
        .map_err(|error| format!("failed to start clang for `{target}`: {error}"))?;
    if output.status.success() {
        Ok(())
    } else {
        Err(format!(
            "clang x86-64 code generation failed: {}",
            String::from_utf8_lossy(&output.stderr).trim_end()
        ))
    }
}
