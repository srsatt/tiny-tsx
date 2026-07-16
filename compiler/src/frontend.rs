use std::{path::PathBuf, process::Command};

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

pub fn compile(
    entry: &str,
    aliases: &[String],
    api_aliases: &[String],
    allowed_environment: &[String],
) -> Result<Compilation, String> {
    let root = repository_root();
    let script = root.join("frontend/dist/src/cli.js");
    if !script.is_file() {
        return Err(format!(
            "TinyTSX frontend is not built: {}\nrun `npm install --prefix frontend && npm run build --prefix frontend`",
            script.display(),
        ));
    }

    let mut command = Command::new("node");
    command
        .arg(&script)
        .arg(entry)
        .arg("--sdk")
        .arg(root.join("sdk/index.d.ts"));
    for alias in aliases {
        command.arg("--alias").arg(alias);
    }
    for alias in api_aliases {
        command.arg("--api").arg(alias);
    }
    for name in allowed_environment {
        command.arg("--allow-env").arg(name);
    }
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

pub fn compile_test262(entry: &str) -> Result<Test262Compilation, String> {
    let root = repository_root();
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
    let root = repository_root();
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
