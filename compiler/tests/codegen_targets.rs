use std::{
    fs,
    path::PathBuf,
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

#[test]
fn emits_assemblable_static_linux_arm64_elf() {
    let assembly = compile_linux("examples/static-page/server.tsx", &[]);

    assert!(assembly.starts_with(".text\n.p2align 2\n"));
    assert!(assembly.contains(".globl tinytsx_handle_get"));
    assert!(assembly.contains("bl tinytsx_response_begin"));
    assert!(assembly.contains(":lo12:Ltinytsx_string_0"));
    assert!(!assembly.contains("@PAGE"));
    assert!(!assembly.contains("_tinytsx_handle_get"));
    assert_assembles_as_elf(&assembly, "static");
}

#[test]
fn emits_assemblable_dynamic_hono_linux_arm64_elf() {
    let assembly = compile_linux(
        "tests/compat/hono/dynamic-jsx-smoke.tsx",
        &[
            "--alias",
            "hono=vendor/hono/src/index.ts",
            "--api",
            "hono=tests/compat/hono/api.d.ts",
        ],
    );

    assert!(assembly.contains("bl tinytsx_html_write_query_parameter"));
    assert!(assembly.contains(":lo12:Ltinytsx_string_"));
    assert_assembles_as_elf(&assembly, "dynamic-hono");
}

#[test]
fn emits_linux_target_in_retargeted_hir() {
    let compiler = env!("CARGO_BIN_EXE_tinytsx");
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let output = Command::new(compiler)
        .current_dir(&root)
        .args([
            "check",
            "examples/static-page/server.tsx",
            "--target",
            "aarch64-unknown-linux-gnu",
            "--emit-hir",
        ])
        .output()
        .expect("run TinyTSX compiler");
    assert!(output.status.success());
    let hir: serde_json::Value = serde_json::from_slice(&output.stdout).expect("valid HIR JSON");
    assert_eq!(hir["target"], "aarch64-unknown-linux-gnu");
}

#[test]
fn emits_assemblable_function_control_flow_for_linux_arm64() {
    let assembly = compile_linux("examples/function-control-flow/server.ts", &[]);

    assert!(assembly.contains("bl memcmp"));
    assert!(assembly.contains("string_0_not_equal"));
    assert_assembles_as_elf(&assembly, "function-control-flow");
}

#[test]
fn emits_assemblable_numeric_function_for_linux_arm64() {
    let assembly = compile_linux("examples/function-numbers/server.ts", &[]);

    assert!(assembly.contains("fadd d0, d0, d1"));
    assert!(assembly.contains("fsub d0, d0, d1"));
    assert!(assembly.contains("fcmp d0, d1"));
    assert_assembles_as_elf(&assembly, "function-numbers");
}

#[test]
fn emits_assemblable_boolean_function_for_linux_arm64() {
    let assembly = compile_linux("examples/function-booleans/server.ts", &[]);

    assert!(assembly.contains("boolean_0_not_equal"));
    assert!(assembly.contains("cmp x3, x0"));
    assert_assembles_as_elf(&assembly, "function-booleans");
}

#[test]
fn emits_assemblable_bounded_function_loop_for_linux_arm64() {
    let assembly = compile_linux("examples/function-loop/server.ts", &[]);

    assert!(assembly.contains("numeric_for_"));
    assert!(assembly.contains("b.lt"));
    assert_assembles_as_elf(&assembly, "function-loop");
}

#[test]
fn emits_assemblable_lambda_lifted_closure_for_linux_arm64() {
    let assembly = compile_linux("examples/function-closures/server.ts", &[]);

    assert!(assembly.contains("tinytsx_function_1"));
    assert!(assembly.contains("bl memcmp"));
    assert_assembles_as_elf(&assembly, "function-closure");
}

#[test]
fn emits_assemblable_string_exceptions_for_linux_arm64() {
    let assembly = compile_linux("examples/function-exceptions/server.ts", &[]);

    assert!(assembly.contains("catch_"));
    assert!(assembly.contains("mov x2, #1"));
    assert_assembles_as_elf(&assembly, "function-exceptions");
}

#[test]
fn emits_assemblable_hono_sqlite_for_linux_x86_64() {
    let assembly = compile_linux_x86(
        "examples/hono-sqlite/server.ts",
        &["--allow-env", "TINYTSX_BLOG_NAME"],
    );

    assert!(assembly.contains("tinytsx_sqlite_query_json_params"));
    assert!(assembly.contains("tinytsx_sqlite_execute_result"));
    assert_assembles_as_x86_elf(&assembly, "hono-sqlite");
}

#[test]
fn emits_assemblable_hono_actors_for_linux_x86_64() {
    let assembly = compile_linux_x86("examples/hono-actors/server.ts", &[]);

    assert!(assembly.contains("tinytsx_actor_ask_counter"));
    assert!(assembly.contains("tinytsx_actor_tell_counter"));
    assert_assembles_as_x86_elf(&assembly, "hono-actors");
}

fn compile_linux(entry: &str, extra_arguments: &[&str]) -> String {
    let compiler = env!("CARGO_BIN_EXE_tinytsx");
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let output = Command::new(compiler)
        .current_dir(&root)
        .arg("check")
        .arg(entry)
        .args(extra_arguments)
        .args(["--target", "aarch64-unknown-linux-gnu", "--emit-asm"])
        .output()
        .expect("run TinyTSX compiler");
    assert!(
        output.status.success(),
        "compiler failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).expect("assembly is UTF-8")
}

fn compile_linux_x86(entry: &str, extra_arguments: &[&str]) -> String {
    let compiler = env!("CARGO_BIN_EXE_tinytsx");
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..");
    let output = Command::new(compiler)
        .current_dir(&root)
        .arg("check")
        .arg(entry)
        .args(extra_arguments)
        .args(["--target", "x86_64-unknown-linux-gnu", "--emit-asm"])
        .output()
        .expect("run TinyTSX compiler");
    assert!(
        output.status.success(),
        "compiler failed: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).expect("assembly is UTF-8")
}

fn assert_assembles_as_elf(assembly: &str, name: &str) {
    let temporary = temporary_directory(name);
    let assembly_path = temporary.join("generated.s");
    let object_path = temporary.join("generated.o");
    fs::write(&assembly_path, assembly).expect("write generated assembly");

    let clang = Command::new("clang")
        .arg("--target=aarch64-unknown-linux-gnu")
        .arg("-c")
        .arg(&assembly_path)
        .arg("-o")
        .arg(&object_path)
        .output()
        .expect("start clang");
    assert!(
        clang.status.success(),
        "clang failed: {}",
        String::from_utf8_lossy(&clang.stderr)
    );
    let object = fs::read(&object_path).expect("read ELF object");
    assert_eq!(&object[..4], b"\x7fELF");

    fs::remove_dir_all(temporary).expect("remove temporary directory");
}

fn assert_assembles_as_x86_elf(assembly: &str, name: &str) {
    let temporary = temporary_directory(name);
    let assembly_path = temporary.join("generated.s");
    let object_path = temporary.join("generated.o");
    fs::write(&assembly_path, assembly).expect("write generated assembly");

    let clang = Command::new("clang")
        .arg("--target=x86_64-unknown-linux-gnu")
        .arg("-c")
        .arg(&assembly_path)
        .arg("-o")
        .arg(&object_path)
        .output()
        .expect("start clang");
    assert!(
        clang.status.success(),
        "clang failed: {}",
        String::from_utf8_lossy(&clang.stderr)
    );
    let object = fs::read(&object_path).expect("read ELF object");
    assert_eq!(&object[..4], b"\x7fELF");

    fs::remove_dir_all(temporary).expect("remove temporary directory");
}

fn temporary_directory(name: &str) -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock after epoch")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("tinytsx-linux-codegen-{name}-{unique}"));
    fs::create_dir_all(&path).expect("create temporary directory");
    path
}
