#![cfg(all(target_os = "macos", target_arch = "aarch64"))]

use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

#[test]
fn compiles_and_runs_the_allowlisted_typeof_undefined_case() {
    let root = repository_root();
    build_frontend(&root);
    let directory = temporary_directory();
    let binary = directory.join("typeof-undefined");
    let case = "vendor/test262/test/language/expressions/typeof/undefined.js";

    let compilation = Command::new(env!("CARGO_BIN_EXE_tinytsx"))
        .current_dir(&root)
        .args(["test262", case, "--output"])
        .arg(&binary)
        .output()
        .expect("start Test262 compilation");

    assert!(
        compilation.status.success(),
        "Test262 compilation failed:\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&compilation.stdout),
        String::from_utf8_lossy(&compilation.stderr),
    );
    let bytes = fs::read(&binary).expect("read native Test262 executable");
    assert_eq!(&bytes[..4], &[0xcf, 0xfa, 0xed, 0xfe], "Mach-O 64 magic");

    let execution = Command::new(&binary)
        .status()
        .expect("run native Test262 executable");
    assert!(execution.success(), "native Test262 assertion failed");

    fs::remove_dir_all(directory).expect("remove Test262 artifacts");
}

fn repository_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("compiler is in repository")
        .to_owned()
}

fn build_frontend(root: &Path) {
    let status = Command::new("npm")
        .current_dir(root)
        .args(["run", "build", "--prefix", "frontend"])
        .status()
        .expect("start TypeScript build");
    assert!(status.success(), "TypeScript frontend build failed");
}

fn temporary_directory() -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("valid clock")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("tinytsx-test262-{timestamp}"));
    fs::create_dir_all(&path).expect("create Test262 temporary directory");
    path
}
