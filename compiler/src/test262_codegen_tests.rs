use crate::{
    hir::SourceSpan,
    target::Target,
    test262_hir::{NumericOperand, NumericSubtractionOperation, Test262Assertion, Test262Program},
};

use super::emit;

fn span() -> SourceSpan {
    SourceSpan {
        file: "case.js".to_owned(),
        line: 1,
        column: 1,
        end_line: 1,
        end_column: 2,
    }
}

fn program(target: Target) -> Test262Program {
    Test262Program {
        version: 3,
        target: target.triple().to_owned(),
        entry: "case.js".to_owned(),
        assertions: vec![Test262Assertion::SameValueString {
            actual: "ok".to_owned(),
            expected: "ok".to_owned(),
            message: None,
            span: span(),
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

#[test]
fn emits_native_array_spread_copy_and_assertions() {
    let mut program = program(Target::LinuxArm64);
    program.assertions = vec![Test262Assertion::ArraySpreadApplyProgram {
        values: vec![3, 4, 5],
        expected_arguments: vec![3, 4, 5],
        expected_calls: 1,
        span: span(),
    }];

    let assembly = emit(&program, Target::LinuxArm64).unwrap();

    assert!(assembly.contains("ldr x10, [sp, #16]"));
    assert!(assembly.contains("str x10, [sp, #80]"));
    assert!(assembly.contains("Ltinytsx_test262_spread_0_fail:"));
}

#[test]
fn emits_closed_class_constructor_identity_and_descriptor_checks() {
    let mut program = program(Target::LinuxArm64);
    program.assertions = vec![Test262Assertion::ClassConstructorProgram {
        initial_count: 0,
        expected_count: 1,
        configurable: true,
        enumerable: false,
        writable: true,
        span: span(),
    }];

    let assembly = emit(&program, Target::LinuxArm64).unwrap();

    assert!(assembly.contains("sub sp, sp, #64"));
    assert!(assembly.contains("str x9, [sp, #24]"));
    assert!(assembly.contains("str x10, [sp, #56]"));
    assert!(assembly.contains("add x9, x9, #1"));
    assert!(assembly.contains("Ltinytsx_test262_class_0_fail:"));
    assert!(assembly.contains("add sp, sp, #64"));
}

#[test]
fn emits_owned_error_message_and_descriptor_checks() {
    let mut program = program(Target::LinuxArm64);
    program.assertions = vec![Test262Assertion::ErrorMessageProgram {
        message: "my-message".to_owned(),
        writable: true,
        enumerable: false,
        configurable: true,
        span: span(),
    }];

    let assembly = emit(&program, Target::LinuxArm64).unwrap();

    assert!(assembly.contains("Ltinytsx_test262_error_message_0:"));
    assert!(assembly.contains("strb w3, [x1], #1"));
    assert!(assembly.contains("ldrb w3, [x0], #1"));
    assert!(assembly.contains("Ltinytsx_test262_error_0_fail:"));
    assert!(assembly.contains("add sp, sp, #288"));
}

#[test]
fn emits_runtime_numeric_binding_loads_and_subtraction() {
    let mut program = program(Target::LinuxArm64);
    program.assertions = vec![Test262Assertion::NumericSubtractionProgram {
        slots: 1,
        operations: vec![
            NumericSubtractionOperation::Set {
                slot: 0,
                value: 7,
                span: span(),
            },
            NumericSubtractionOperation::AssertSubtract {
                left: NumericOperand::Slot { slot: 0 },
                right: NumericOperand::Literal { value: 2 },
                expected: 5,
                span: span(),
            },
        ],
        span: span(),
    }];

    let assembly = emit(&program, Target::LinuxArm64).unwrap();

    assert!(assembly.contains("str x9, [sp, #0]"));
    assert!(assembly.contains("ldr x9, [sp, #0]"));
    assert!(assembly.contains("sub x9, x9, x10"));
}

#[test]
fn emits_runtime_record_field_name_membership() {
    let mut program = program(Target::LinuxArm64);
    program.assertions = vec![Test262Assertion::RecordMembershipProgram {
        fields: vec!["fooProp".to_owned()],
        property: "fooProp".to_owned(),
        expected: true,
        span: span(),
    }];

    let assembly = emit(&program, Target::LinuxArm64).unwrap();

    assert!(assembly.contains("Ltinytsx_test262_membership_property_0:"));
    assert!(assembly.contains("Ltinytsx_test262_membership_field_0_0:"));
    assert!(assembly.contains("ldrb w3, [x0], #1"));
}

#[test]
fn emits_runtime_string_throw_catch_assertions() {
    let mut program = program(Target::LinuxArm64);
    program.assertions = vec![Test262Assertion::ThrowCatchProgram {
        initial_caught: false,
        thrown: "expected".to_owned(),
        expected: "expected".to_owned(),
        final_expected: true,
        span: span(),
    }];

    let assembly = emit(&program, Target::LinuxArm64).unwrap();

    assert!(assembly.contains("Ltinytsx_test262_compare_0:"));
    assert!(assembly.contains("Ltinytsx_test262_actual_0:"));
    assert!(assembly.contains("Ltinytsx_test262_expected_0:"));
}

#[test]
fn emits_portable_host_clock_calls_for_date_now() {
    let mut apple = program(Target::MacosArm64);
    apple.assertions = vec![Test262Assertion::DateNowTypeProgram {
        expected_type: "number".to_owned(),
        span: span(),
    }];
    let mut linux = program(Target::LinuxArm64);
    linux.assertions = vec![Test262Assertion::DateNowTypeProgram {
        expected_type: "number".to_owned(),
        span: span(),
    }];

    let apple_assembly = emit(&apple, Target::MacosArm64).unwrap();
    assert!(apple_assembly.contains("bl _clock_gettime"));
    assert!(apple_assembly.contains("stp x29, x30, [sp, #-16]!"));
    assert!(apple_assembly.contains("ldp x29, x30, [sp], #16"));
    assert!(
        emit(&linux, Target::LinuxArm64)
            .unwrap()
            .contains("bl clock_gettime")
    );
}
