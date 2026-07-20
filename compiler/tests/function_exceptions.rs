use std::{path::PathBuf, process::Command};

#[test]
fn rejects_an_uncaught_native_function_exception() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("compiler is in repository")
        .to_owned();
    if std::env::var_os("TINYTSX_TEST_RUNNER").is_some() {
        assert!(
            root.join("frontend/dist/src/cli.js").is_file(),
            "test runner did not prepare the TypeScript frontend"
        );
    } else {
        let frontend = Command::new("npm")
            .current_dir(&root)
            .args(["run", "build", "--prefix", "frontend"])
            .status()
            .expect("build frontend");
        assert!(frontend.success(), "frontend build failed");
    }

    let output = Command::new(env!("CARGO_BIN_EXE_tinytsx"))
        .current_dir(&root)
        .args([
            "build",
            "tests/compat/functions/uncaught.ts",
            "--output",
            ".tinytsx/uncaught-test",
        ])
        .output()
        .expect("run TinyTSX compiler");

    assert!(!output.status.success(), "uncaught exception unexpectedly built");
    assert!(
        String::from_utf8_lossy(&output.stderr)
            .contains("may complete with an uncaught native exception"),
        "unexpected diagnostic: {}",
        String::from_utf8_lossy(&output.stderr),
    );
}
