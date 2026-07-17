use crate::{
    hir::SourceSpan,
    target::Target,
    test262_hir::{Test262Assertion, Test262Program},
};

use super::emit;

fn program(target: Target) -> Test262Program {
    Test262Program {
        version: 3,
        target: target.triple().to_owned(),
        entry: "case.js".to_owned(),
        assertions: vec![Test262Assertion::SameValueString {
            actual: "ok".to_owned(),
            expected: "ok".to_owned(),
            message: None,
            span: SourceSpan {
                file: "case.js".to_owned(),
                line: 1,
                column: 1,
                end_line: 1,
                end_column: 2,
            },
        }],
    }
}

#[test]
fn emits_macho_symbols_and_page_relocations_for_apple() {
    let assembly = emit(&program(Target::MacosArm64), Target::MacosArm64).unwrap();

    assert!(assembly.contains(".section __TEXT,__text,regular,pure_instructions"));
    assert!(assembly.contains(".globl _main\n_main:"));
    assert!(assembly.contains("Ltinytsx_test262_actual_0@PAGE"));
    assert!(assembly.contains("Ltinytsx_test262_actual_0@PAGEOFF"));
    assert!(assembly.contains(".section __TEXT,__const"));
}

#[test]
fn emits_elf_symbols_and_low_relocations_for_linux() {
    let assembly = emit(&program(Target::LinuxArm64), Target::LinuxArm64).unwrap();

    assert!(assembly.contains(".section .text"));
    assert!(assembly.contains(".globl main\n.type main, %function\nmain:"));
    assert!(assembly.contains("adrp x0, Ltinytsx_test262_actual_0"));
    assert!(assembly.contains("add x0, x0, :lo12:Ltinytsx_test262_actual_0"));
    assert!(assembly.contains(".size main, .-main"));
    assert!(assembly.contains(".section .rodata"));
    assert!(!assembly.contains("@PAGE"));
    assert!(!assembly.contains("__TEXT"));
}

#[test]
fn rejects_a_hir_target_that_does_not_match_codegen() {
    let error = emit(&program(Target::MacosArm64), Target::LinuxArm64).unwrap_err();

    assert!(error.contains("does not match codegen target"));
}
