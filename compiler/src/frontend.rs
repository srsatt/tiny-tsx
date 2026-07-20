use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
};

use serde::Deserialize;

use crate::hir::Program;
use crate::target::Target;
use crate::test262_hir::Test262Program;
use crate::wpt_hir::WptProgram;

pub struct Compilation {
    pub program: Program,
    pub json: String,
}

pub struct Test262Compilation {
    pub program: Test262Program,
}

pub struct WptCompilation {
    pub program: WptProgram,
}

pub struct Session {
    child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
}

#[derive(Deserialize)]
struct SessionResponse {
    ok: bool,
    hir: Option<Program>,
    error: Option<String>,
}

impl Compilation {
    pub fn retarget(&mut self, target: Target) -> Result<(), String> {
        if self.program.target == target.triple() {
            return Ok(());
        }
        self.program.target = target.triple().to_owned();
        self.program.validate()?;
        self.json = serde_json::to_string_pretty(&self.program)
            .map_err(|error| format!("could not serialize retargeted HIR: {error}"))?;
        Ok(())
    }
}

impl Session {
    pub fn start(
        entry: &str,
        aliases: &[String],
        api_aliases: &[String],
        bindings: &[String],
        allowed_environment: &[String],
        allowed_read_roots: &[String],
        allowed_write_roots: &[String],
    ) -> Result<Self, String> {
        let root = resource_root()?;
        let script = frontend_script(&root)?;
        let mut command = Command::new("node");
        command
            .arg(script)
            .arg("--session")
            .arg(entry)
            .arg("--sdk")
            .arg(root.join("sdk/index.d.ts"));
        append_options(
            &mut command,
            aliases,
            api_aliases,
            bindings,
            allowed_environment,
            allowed_read_roots,
            allowed_write_roots,
        );
        let mut child = command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .map_err(|error| format!("failed to start the TypeScript frontend session: {error}"))?;
        let input = child
            .stdin
            .take()
            .ok_or_else(|| "TypeScript frontend session has no input pipe".to_owned())?;
        let output = child
            .stdout
            .take()
            .ok_or_else(|| "TypeScript frontend session has no output pipe".to_owned())?;
        Ok(Self {
            child,
            input,
            output: BufReader::new(output),
        })
    }

    pub fn compile(&mut self) -> Result<Compilation, String> {
        self.input
            .write_all(b"{\"command\":\"compile\"}\n")
            .and_then(|_| self.input.flush())
            .map_err(|error| format!("could not request incremental compilation: {error}"))?;
        let mut line = String::new();
        let bytes = self
            .output
            .read_line(&mut line)
            .map_err(|error| format!("could not read incremental compilation: {error}"))?;
        if bytes == 0 {
            let status = self.child.try_wait().ok().flatten();
            return Err(format!(
                "TypeScript frontend session ended{}",
                status.map_or_else(String::new, |status| format!(" with {status}"))
            ));
        }
        let response: SessionResponse = serde_json::from_str(&line).map_err(|error| {
            format!("TypeScript frontend session returned invalid JSON: {error}")
        })?;
        if !response.ok {
            return Err(response
                .error
                .unwrap_or_else(|| "TypeScript frontend session failed".to_owned()));
        }
        let program = response
            .hir
            .ok_or_else(|| "TypeScript frontend session omitted HIR".to_owned())?;
        program.validate()?;
        let json = serde_json::to_string_pretty(&program)
            .map_err(|error| format!("could not serialize incremental HIR: {error}"))?;
        Ok(Compilation { program, json })
    }
}

impl Drop for Session {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

pub fn compile(
    entry: &str,
    aliases: &[String],
    api_aliases: &[String],
    bindings: &[String],
    allowed_environment: &[String],
    allowed_read_roots: &[String],
    allowed_write_roots: &[String],
) -> Result<Compilation, String> {
    let root = resource_root()?;
    let script = frontend_script(&root)?;

    let mut command = Command::new("node");
    command
        .arg(&script)
        .arg(entry)
        .arg("--sdk")
        .arg(root.join("sdk/index.d.ts"));
    append_options(
        &mut command,
        aliases,
        api_aliases,
        bindings,
        allowed_environment,
        allowed_read_roots,
        allowed_write_roots,
    );
    let output = command
        .output()
        .map_err(|error| format!("failed to start the TypeScript frontend: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(stderr.trim_end().to_owned());
    }

    let json = String::from_utf8(output.stdout)
        .map_err(|_| "TypeScript frontend returned non-UTF-8 HIR".to_owned())?;
    let program: Program = serde_json::from_str(&json)
        .map_err(|error| format!("TypeScript frontend returned invalid HIR: {error}"))?;
    program.validate()?;

    Ok(Compilation {
        program,
        json: json.trim_end().to_owned(),
    })
}

fn frontend_script(root: &Path) -> Result<PathBuf, String> {
    let script = root.join("frontend/dist/src/cli.js");
    if !script.is_file() {
        return Err(format!(
            "TinyTSX frontend is not built: {}\nrun `npm install --prefix frontend && npm run build --prefix frontend`",
            script.display(),
        ));
    }
    Ok(script)
}

fn append_options(
    command: &mut Command,
    aliases: &[String],
    api_aliases: &[String],
    bindings: &[String],
    allowed_environment: &[String],
    allowed_read_roots: &[String],
    allowed_write_roots: &[String],
) {
    for alias in aliases {
        command.arg("--alias").arg(alias);
    }
    for alias in api_aliases {
        command.arg("--api").arg(alias);
    }
    for binding in bindings {
        command.arg("--binding").arg(binding);
    }
    for name in allowed_environment {
        command.arg("--allow-env").arg(name);
    }
    for root in allowed_read_roots {
        command.arg("--allow-read").arg(root);
    }
    for root in allowed_write_roots {
        command.arg("--allow-write").arg(root);
    }
}

pub fn compile_test262(entry: &str) -> Result<Test262Compilation, String> {
    let root = resource_root()?;
    let script = root.join("frontend/dist/src/cli.js");
    if !script.is_file() {
        return Err(format!(
            "TinyTSX frontend is not built: {}\nrun `npm install --prefix frontend && npm run build --prefix frontend`",
            script.display(),
        ));
    }
    let output = Command::new("node")
        .arg(&script)
        .arg("--test262")
        .arg(entry)
        .output()
        .map_err(|error| format!("failed to start the TypeScript frontend: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr)
            .trim_end()
            .to_owned());
    }
    let json = String::from_utf8(output.stdout)
        .map_err(|_| "TypeScript frontend returned non-UTF-8 Test262 HIR".to_owned())?;
    let program: Test262Program = serde_json::from_str(&json)
        .map_err(|error| format!("TypeScript frontend returned invalid Test262 HIR: {error}"))?;
    program.validate()?;
    Ok(Test262Compilation { program })
}

pub fn compile_wpt(entry: &str) -> Result<WptCompilation, String> {
    let root = resource_root()?;
    let script = root.join("frontend/dist/src/cli.js");
    if !script.is_file() {
        return Err(format!(
            "TinyTSX frontend is not built: {}\nrun `npm install --prefix frontend && npm run build --prefix frontend`",
            script.display(),
        ));
    }
    let output = Command::new("node")
        .arg(&script)
        .arg("--wpt")
        .arg(entry)
        .output()
        .map_err(|error| format!("failed to start the TypeScript frontend: {error}"))?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr)
            .trim_end()
            .to_owned());
    }
    let json = String::from_utf8(output.stdout)
        .map_err(|_| "TypeScript frontend returned non-UTF-8 WPT HIR".to_owned())?;
    let program: WptProgram = serde_json::from_str(&json)
        .map_err(|error| format!("TypeScript frontend returned invalid WPT HIR: {error}"))?;
    program.validate()?;
    Ok(WptCompilation { program })
}

pub fn repository_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("compiler crate must be inside the repository")
        .to_owned()
}

pub fn resource_root() -> Result<PathBuf, String> {
    if let Some(root) = std::env::var_os("TINYTSX_HOME") {
        return validate_resource_root(PathBuf::from(root));
    }
    if let Ok(executable) = std::env::current_exe()
        && let Some(prefix) = executable.parent().and_then(Path::parent)
    {
        let installed = prefix.join("lib/tinytsx");
        if installed.is_dir() {
            return validate_resource_root(installed);
        }
    }
    if cfg!(debug_assertions) {
        return validate_resource_root(repository_root());
    }
    Err("TinyTSX resources were not found; install `lib/tinytsx` beside the binary or set TINYTSX_HOME".to_owned())
}

fn validate_resource_root(root: PathBuf) -> Result<PathBuf, String> {
    for required in [
        "Cargo.toml",
        "Cargo.lock",
        "frontend/dist/src/cli.js",
        "sdk/index.d.ts",
    ] {
        if !root.join(required).is_file() {
            return Err(format!(
                "TinyTSX resource root `{}` is incomplete: missing `{required}`",
                root.display(),
            ));
        }
    }
    Ok(root)
}
