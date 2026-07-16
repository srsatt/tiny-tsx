use std::str::FromStr;

use super::Target;

#[test]
fn parses_canonical_triples_and_short_aliases() {
    assert_eq!(
        Target::from_str("aarch64-apple-darwin"),
        Ok(Target::MacosArm64)
    );
    assert_eq!(Target::from_str("macos-arm64"), Ok(Target::MacosArm64));
    assert_eq!(
        Target::from_str("aarch64-unknown-linux-gnu"),
        Ok(Target::LinuxArm64)
    );
    assert_eq!(Target::from_str("linux-arm64"), Ok(Target::LinuxArm64));
}

#[test]
fn rejects_unknown_targets_with_supported_values() {
    let error = Target::from_str("wasm32-wasi").unwrap_err();
    assert!(error.contains("unsupported target `wasm32-wasi`"));
    assert!(error.contains("aarch64-unknown-linux-gnu"));
}
