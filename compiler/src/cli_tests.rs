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
fn rejects_non_portable_environment_capabilities_before_compilation() {
    let error = run(["build", "app.tsx", "--allow-env", "9INVALID"]
        .into_iter()
        .map(Into::into))
    .unwrap_err();
    assert!(error.contains("invalid environment capability `9INVALID`"));
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
    let error = run(["build", "app.tsx", "--allow-write", "/tinytsx/not-present"]
        .into_iter()
        .map(Into::into))
    .unwrap_err();
    assert!(error.contains("TINY1511"));
}
