use std::{path::PathBuf, process::Command};

use crate::hir::Program;

pub struct Compilation {
    pub program: Program,
    pub json: String,
}

pub fn compile(entry: &str) -> Result<Compilation, String> {
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
        .arg(entry)
        .arg("--sdk")
        .arg(root.join("sdk/index.d.ts"))
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

pub fn repository_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("compiler crate must be inside the repository")
        .to_owned()
}
