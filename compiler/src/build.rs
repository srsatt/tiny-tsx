use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Serialize;

use crate::{
    codegen::{self, Options as CodegenOptions},
    frontend::{self, Compilation},
};

pub struct Options {
    pub entry: String,
    pub output: PathBuf,
    pub port: u16,
    pub workers: usize,
    pub request_memory: usize,
    pub release: bool,
    pub emit_hir: bool,
    pub emit_asm: bool,
    pub keep_temps: bool,
    pub aliases: Vec<String>,
    pub api_aliases: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BuildReport<'a> {
    target: &'a str,
    runtime: &'a str,
    binary_bytes: u64,
    port: u16,
    workers: usize,
    request_memory_bytes: usize,
    gc: &'a str,
    modules: usize,
    components: usize,
    constants: usize,
    static_html_bytes: usize,
    dynamic_html_expressions: usize,
    runtime_features: [&'a str; 4],
}

pub fn execute(options: &Options) -> Result<PathBuf, String> {
    ensure_supported_host()?;
    let compilation = frontend::compile(&options.entry, &options.aliases, &options.api_aliases)?;
    let assembly = codegen::emit_macos_arm64(
        &compilation.program,
        CodegenOptions {
            port: options.port,
            workers: options.workers,
            request_memory: options.request_memory,
        },
    )?;

    let root = frontend::repository_root();
    let temporary = temporary_directory(&root)?;
    let assembly_path = temporary.join("generated.s");
    let object_path = temporary.join("generated.o");
    fs::write(&assembly_path, &assembly)
        .map_err(|error| format!("could not write {}: {error}", assembly_path.display()))?;

    assemble(&assembly_path, &object_path)?;
    let runtime_binary = link_runtime(&root, &temporary, &object_path, options.release)?;
    let output = absolute_output(&options.output)?;
    if let Some(parent) = output.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("could not create {}: {error}", parent.display()))?;
    }
    fs::copy(&runtime_binary, &output)
        .map_err(|error| format!("could not create {}: {error}", output.display()))?;
    if options.release {
        strip_binary(&output)?;
    }

    if options.emit_hir {
        fs::write(with_suffix(&output, ".hir.json"), &compilation.json)
            .map_err(|error| format!("could not preserve emitted HIR: {error}"))?;
    }
    if options.emit_asm {
        fs::write(with_suffix(&output, ".s"), &assembly)
            .map_err(|error| format!("could not preserve emitted assembly: {error}"))?;
    }

    write_report(&output, &compilation, options)?;
    if !options.keep_temps {
        fs::remove_dir_all(&temporary)
            .map_err(|error| format!("could not remove {}: {error}", temporary.display()))?;
    }

    print_summary(&output, &compilation, options)?;
    Ok(output)
}

fn ensure_supported_host() -> Result<(), String> {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        Ok(())
    } else {
        Err("native builds currently require Apple Silicon macOS".to_owned())
    }
}

fn temporary_directory(root: &Path) -> Result<PathBuf, String> {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| format!("system clock error: {error}"))?
        .as_nanos();
    let path = root
        .join(".tinytsx")
        .join(format!("build-{}-{timestamp}", std::process::id()));
    fs::create_dir_all(&path)
        .map_err(|error| format!("could not create {}: {error}", path.display()))?;
    Ok(path)
}

fn assemble(assembly: &Path, object: &Path) -> Result<(), String> {
    let output = Command::new("clang")
        .args(["-c"])
        .arg(assembly)
        .arg("-o")
        .arg(object)
        .output()
        .map_err(|error| format!("failed to start clang: {error}"))?;
    command_result("clang assembly", output)
}

fn link_runtime(
    root: &Path,
    temporary: &Path,
    object: &Path,
    release: bool,
) -> Result<PathBuf, String> {
    let target_directory = temporary.join("target");
    let mut command = Command::new("cargo");
    command
        .arg("rustc")
        .arg("--manifest-path")
        .arg(root.join("Cargo.toml"))
        .args([
            "-p",
            "tinytsx-runtime-bootstrap",
            "--bin",
            "tinytsx-runtime-bootstrap",
            "--features",
            "generated",
        ])
        .arg("--target-dir")
        .arg(&target_directory);
    if release {
        command.arg("--release");
    }
    command
        .arg("--")
        .arg("-C")
        .arg(format!("link-arg={}", object.display()));
    let output = command
        .output()
        .map_err(|error| format!("failed to start Cargo for runtime link: {error}"))?;
    command_result("bootstrap runtime link", output)?;

    Ok(target_directory
        .join(if release { "release" } else { "debug" })
        .join("tinytsx-runtime-bootstrap"))
}

fn strip_binary(binary: &Path) -> Result<(), String> {
    let output = Command::new("strip")
        .arg("-x")
        .arg(binary)
        .output()
        .map_err(|error| format!("failed to start strip: {error}"))?;
    command_result("binary strip", output)
}

fn command_result(action: &str, output: std::process::Output) -> Result<(), String> {
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr);
    Err(format!("{action} failed:\n{}", stderr.trim_end()))
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

fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut value = path.as_os_str().to_owned();
    value.push(suffix);
    PathBuf::from(value)
}

fn write_report(output: &Path, compilation: &Compilation, options: &Options) -> Result<(), String> {
    let binary_bytes = fs::metadata(output)
        .map_err(|error| format!("could not inspect {}: {error}", output.display()))?
        .len();
    let report = BuildReport {
        target: "aarch64-apple-darwin",
        runtime: "bootstrap",
        binary_bytes,
        port: options.port,
        workers: options.workers,
        request_memory_bytes: options.request_memory,
        gc: "disabled",
        modules: compilation.program.statistics.modules,
        components: compilation.program.statistics.components,
        constants: compilation.program.statistics.constants,
        static_html_bytes: compilation.program.statistics.static_html_bytes,
        dynamic_html_expressions: compilation.program.statistics.dynamic_html_expressions,
        runtime_features: [
            "http1",
            "bounded-writer",
            "bounded-worker-pool",
            "connection-close",
        ],
    };
    let json = serde_json::to_string_pretty(&report)
        .map_err(|error| format!("could not serialize build report: {error}"))?;
    fs::write(with_suffix(output, ".build.json"), format!("{json}\n"))
        .map_err(|error| format!("could not write build report: {error}"))
}

fn print_summary(
    output: &Path,
    compilation: &Compilation,
    options: &Options,
) -> Result<(), String> {
    let binary_bytes = fs::metadata(output)
        .map_err(|error| format!("could not inspect {}: {error}", output.display()))?
        .len();
    println!("TinyTSX build\n");
    println!("Entry:               {}", compilation.program.entry);
    println!("Target:              aarch64-apple-darwin");
    println!("Runtime:             bootstrap");
    println!("Workers:             {}", options.workers);
    println!("Request memory:      {} bytes", options.request_memory);
    println!(
        "TypeScript modules:  {}",
        compilation.program.statistics.modules
    );
    println!(
        "Components:          {}",
        compilation.program.statistics.components
    );
    println!(
        "Staged constants:    {}",
        compilation.program.statistics.constants
    );
    println!(
        "Static HTML bytes:   {}",
        compilation.program.statistics.static_html_bytes
    );
    println!("GC:                  disabled");
    println!("JavaScript engine:   none\n");
    println!("Output:              {}", output.display());
    println!("Binary size:         {binary_bytes} bytes");
    if options.keep_temps {
        println!("Temporary files:     preserved under .tinytsx/");
    }
    Ok(())
}
