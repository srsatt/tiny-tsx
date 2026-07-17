#![cfg(all(target_os = "macos", target_arch = "aarch64"))]

use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

#[test]
fn compiles_and_runs_native_test262_programs() {
    let root = repository_root();
    build_frontend(&root);
    let directory = temporary_directory();
    for (name, case) in [
        (
            "class-constructor",
            "vendor/test262/test/language/statements/class/definition/constructor.js",
        ),
        (
            "typeof-undefined",
            "vendor/test262/test/language/expressions/typeof/undefined.js",
        ),
        (
            "for-throw-counter",
            "vendor/test262/test/language/statements/for/S12.6.3_A1.js",
        ),
        (
            "array-unshift",
            "vendor/test262/test/built-ins/Array/prototype/unshift/S15.4.4.13_A1_T1.js",
        ),
        (
            "array-spread-apply",
            "vendor/test262/test/language/expressions/array/spread-sngl-literal.js",
        ),
        (
            "numeric-subtraction",
            "vendor/test262/test/language/expressions/subtraction/S11.6.2_A2.1_T1.js",
        ),
        (
            "record-membership",
            "vendor/test262/test/language/expressions/in/S8.12.6_A1.js",
        ),
        (
            "string-throw-catch",
            "vendor/test262/test/language/statements/throw/S12.13_A1.js",
        ),
        (
            "date-now-type",
            "vendor/test262/test/built-ins/Date/now/15.9.4.4-0-4.js",
        ),
        (
            "error-message",
            "vendor/test262/test/built-ins/Error/message_property.js",
        ),
        (
            "regexp-test-exec",
            "vendor/test262/test/built-ins/RegExp/prototype/test/S15.10.6.3_A1_T1.js",
        ),
        (
            "module-function-binding",
            "vendor/test262/test/language/module-code/instn-local-bndng-fun.js",
        ),
        (
            "async-promise-brand",
            "vendor/test262/test/language/expressions/async-function/expression-returns-promise.js",
        ),
    ] {
        compile_and_run(&root, &directory.join(name), case);
    }
    fs::remove_dir_all(directory).expect("remove Test262 artifacts");
}

fn compile_and_run(root: &Path, binary: &Path, case: &str) {
    let compilation = Command::new(env!("CARGO_BIN_EXE_tinytsx"))
        .current_dir(root)
        .args(["test262", case, "--output"])
        .arg(binary)
        .output()
        .expect("start Test262 compilation");

    assert!(
        compilation.status.success(),
        "Test262 compilation failed:\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&compilation.stdout),
        String::from_utf8_lossy(&compilation.stderr),
    );
    let bytes = fs::read(binary).expect("read native Test262 executable");
    assert_eq!(&bytes[..4], &[0xcf, 0xfa, 0xed, 0xfe], "Mach-O 64 magic");

    let execution = Command::new(binary)
        .status()
        .expect("run native Test262 executable");
    assert!(execution.success(), "native Test262 assertion failed");
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
