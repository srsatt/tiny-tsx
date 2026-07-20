use super::run;

#[test]
fn rejects_unknown_commands() {
    let error = run(["wat"].into_iter().map(Into::into)).unwrap_err();
    assert!(error.contains("unknown command `wat`"));
}

#[test]
fn rejects_conflicting_output_flags() {
    let error = run(["check", "app.tsx", "--emit-hir", "--emit-asm"]
        .into_iter()
        .map(Into::into))
    .unwrap_err();
    assert_eq!(error, "--emit-hir and --emit-asm cannot be used together");
}

#[test]
fn rejects_unknown_build_target_before_compilation() {
    let error = run(
        ["build", "app.tsx", "--target", "powerpc-unknown-linux-gnu"]
            .into_iter()
            .map(Into::into),
    )
    .unwrap_err();
    assert!(error.contains("unsupported target `powerpc-unknown-linux-gnu`"));
}

#[test]
fn rejects_dev_restart_timeout_outside_the_bounded_range() {
    let error = run(["dev", "app.tsx", "--restart-timeout-ms", "0"]
        .into_iter()
        .map(Into::into))
    .unwrap_err();
    assert_eq!(
        error,
        "restart timeout must be between 100 and 30000 milliseconds"
    );
}

#[test]
fn rejects_non_portable_environment_capabilities_before_compilation() {
    let error = run(["build", "app.tsx", "--allow-env", "9INVALID"]
        .into_iter()
        .map(Into::into))
    .unwrap_err();
    assert!(error.contains("invalid environment capability `9INVALID`"));
}

#[test]
fn rejects_invalid_resource_bindings_before_compilation() {
    let error = run(
        ["build", "app.tsx", "--binding", "TODOS=cloudflare:ambient"]
            .into_iter()
            .map(Into::into),
    )
    .unwrap_err();
    assert!(error.contains("expected <name>=sqlite-kv:<path>"));
}

#[test]
fn rejects_duplicate_resource_bindings_before_compilation() {
    let error = run([
        "build",
        "app.tsx",
        "--binding",
        "TODOS=sqlite-kv:first.db",
        "--binding",
        "TODOS=sqlite-kv:second.db",
    ]
    .into_iter()
    .map(Into::into))
    .unwrap_err();
    assert!(error.contains("duplicate resource binding `TODOS`"));
}

#[test]
fn accepts_readonly_sqlite_binding_declarations() {
    let error = run(["build", "missing.ts", "--binding", "AIR_DB=sqlite-ro"]
        .into_iter()
        .map(Into::into))
    .unwrap_err();
    assert!(!error.contains("invalid binding"));
    assert!(!error.contains("expected <name>=sqlite-kv:<path>"));
}

#[test]
fn rejects_a_compile_time_path_for_readonly_sqlite_bindings() {
    let error = run([
        "build",
        "missing.ts",
        "--binding",
        "AIR_DB=sqlite-ro:/tmp/collector.db",
    ]
    .into_iter()
    .map(Into::into))
    .unwrap_err();
    assert!(error.contains("expected <name>=sqlite-kv:<path> or <name>=sqlite-ro"));
}

#[test]
fn forwards_runtime_bindings_for_run_without_treating_them_as_build_options() {
    let error = run([
        "run",
        "missing.ts",
        "--binding",
        "AIR_DB=sqlite-ro",
        "--bind",
        "AIR_DB=/tmp/missing.db",
    ]
    .into_iter()
    .map(Into::into))
    .unwrap_err();
    assert!(!error.contains("unknown build option `--bind`"));
}

#[test]
fn rejects_missing_filesystem_roots_before_compilation() {
    let error = run(["build", "app.tsx", "--allow-read", "/tinytsx/not-present"]
        .into_iter()
        .map(Into::into))
    .unwrap_err();
    assert!(error.contains("TINY1502"));
}

#[test]
fn rejects_missing_filesystem_write_roots_before_compilation() {
    let error = run(
        ["build", "app.tsx", "--allow-write", "/tinytsx/not-present"]
            .into_iter()
            .map(Into::into),
    )
    .unwrap_err();
    assert!(error.contains("TINY1511"));
}
