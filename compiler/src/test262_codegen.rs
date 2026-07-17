use std::fmt::Write;

use crate::target::Target;
use crate::test262_hir::{
    ArrayUnshiftOperation, NumericOperand, NumericSubtractionOperation, Test262Assertion,
    Test262Program,
};

const ARRAY_STACK_BYTES: usize = 144;
const ARRAY_DATA_OFFSET: usize = 16;
const SPREAD_SOURCE_OFFSET: usize = 16;
const SPREAD_ARGUMENTS_OFFSET: usize = 80;
const NUMERIC_STACK_BYTES: usize = 128;

pub fn emit(program: &Test262Program, target: Target) -> Result<String, String> {
    program.validate()?;
    if program.target != target.triple() {
        return Err(format!(
            "Test262 HIR target `{}` does not match codegen target `{target}`",
            program.target
        ));
    }
    let mut assembly = String::new();
    emit_header(&mut assembly, target);

    for (index, assertion) in program.assertions.iter().enumerate() {
        match assertion {
            Test262Assertion::SameValueString {
                actual, expected, ..
            } => emit_same_value(&mut assembly, target, index, actual, expected),
            Test262Assertion::ForThrowCounter {
                initial,
                threshold,
                thrown,
                catch_expected,
                final_expected,
                ..
            } => emit_for_throw_counter(
                &mut assembly,
                index,
                *initial,
                *threshold,
                *thrown,
                *catch_expected,
                *final_expected,
            ),
            Test262Assertion::ArrayUnshiftProgram { operations, .. } => {
                emit_array_unshift_program(&mut assembly, index, operations)
            }
            Test262Assertion::ArraySpreadApplyProgram {
                values,
                expected_arguments,
                expected_calls,
                ..
            } => emit_array_spread_apply_program(
                &mut assembly,
                index,
                values,
                expected_arguments,
                *expected_calls,
            ),
            Test262Assertion::NumericSubtractionProgram { operations, .. } => {
                emit_numeric_subtraction_program(&mut assembly, index, operations)
            }
            Test262Assertion::RecordMembershipProgram {
                fields,
                property,
                expected,
                ..
            } => emit_record_membership_program(
                &mut assembly,
                target,
                index,
                fields,
                property,
                *expected,
            ),
        }
    }
    writeln!(assembly, "    mov w0, #0").unwrap();
    writeln!(assembly, "    ret").unwrap();
    writeln!(assembly, "Ltinytsx_test262_fail:").unwrap();
    writeln!(assembly, "    mov w0, #1").unwrap();
    writeln!(assembly, "    ret").unwrap();

    emit_data_header(&mut assembly, target);
    for (index, assertion) in program.assertions.iter().enumerate() {
        let Test262Assertion::SameValueString {
            actual, expected, ..
        } = assertion else {
            if let Test262Assertion::RecordMembershipProgram {
                fields, property, ..
            } = assertion
            {
                writeln!(assembly, ".p2align 3").unwrap();
                writeln!(assembly, "Ltinytsx_test262_membership_property_{index}:").unwrap();
                emit_bytes(&mut assembly, property.as_bytes());
                for (field_index, field) in fields.iter().enumerate() {
                    writeln!(assembly, ".p2align 3").unwrap();
                    writeln!(
                        assembly,
                        "Ltinytsx_test262_membership_field_{index}_{field_index}:"
                    )
                    .unwrap();
                    emit_bytes(&mut assembly, field.as_bytes());
                }
            }
            continue;
        };
        writeln!(assembly, ".p2align 3").unwrap();
        writeln!(assembly, "Ltinytsx_test262_actual_{index}:").unwrap();
        emit_bytes(&mut assembly, actual.as_bytes());
        writeln!(assembly, ".p2align 3").unwrap();
        writeln!(assembly, "Ltinytsx_test262_expected_{index}:").unwrap();
        emit_bytes(&mut assembly, expected.as_bytes());
    }
    Ok(assembly)
}

fn emit_record_membership_program(
    assembly: &mut String,
    target: Target,
    assertion_index: usize,
    fields: &[String],
    property: &str,
    expected: bool,
) {
    let done = format!("Ltinytsx_test262_membership_{assertion_index}_done");
    emit_immediate(assembly, "x9", 0);
    for (field_index, field) in fields.iter().enumerate() {
        if field.len() != property.len() {
            continue;
        }
        let next = format!("Ltinytsx_test262_membership_{assertion_index}_{field_index}_next");
        let matched = format!("Ltinytsx_test262_membership_{assertion_index}_{field_index}_matched");
        emit_address(
            assembly,
            target,
            "x0",
            &format!("Ltinytsx_test262_membership_property_{assertion_index}"),
        );
        emit_address(
            assembly,
            target,
            "x1",
            &format!("Ltinytsx_test262_membership_field_{assertion_index}_{field_index}"),
        );
        emit_immediate(assembly, "x2", property.len() as u64);
        writeln!(assembly, "{matched}:").unwrap();
        writeln!(assembly, "    cbz x2, {done}").unwrap();
        writeln!(assembly, "    ldrb w3, [x0], #1").unwrap();
        writeln!(assembly, "    ldrb w4, [x1], #1").unwrap();
        writeln!(assembly, "    cmp w3, w4").unwrap();
        writeln!(assembly, "    b.ne {next}").unwrap();
        writeln!(assembly, "    sub x2, x2, #1").unwrap();
        writeln!(assembly, "    b {matched}").unwrap();
        writeln!(assembly, "{next}:").unwrap();
    }
    writeln!(assembly, "    b Ltinytsx_test262_membership_{assertion_index}_checked").unwrap();
    writeln!(assembly, "{done}:").unwrap();
    emit_immediate(assembly, "x9", 1);
    writeln!(assembly, "Ltinytsx_test262_membership_{assertion_index}_checked:").unwrap();
    emit_immediate(assembly, "x10", u64::from(expected));
    writeln!(assembly, "    cmp x9, x10").unwrap();
    writeln!(assembly, "    b.ne Ltinytsx_test262_fail").unwrap();
}

fn emit_numeric_subtraction_program(
    assembly: &mut String,
    assertion_index: usize,
    operations: &[NumericSubtractionOperation],
) {
    let fail = format!("Ltinytsx_test262_subtraction_{assertion_index}_fail");
    let pass = format!("Ltinytsx_test262_subtraction_{assertion_index}_pass");
    writeln!(assembly, "    sub sp, sp, #{NUMERIC_STACK_BYTES}").unwrap();
    for operation in operations {
        match operation {
            NumericSubtractionOperation::Set { slot, value, .. } => {
                emit_immediate(assembly, "x9", *value as u64);
                writeln!(assembly, "    str x9, [sp, #{}]", slot * 8).unwrap();
            }
            NumericSubtractionOperation::AssertSubtract {
                left,
                right,
                expected,
                ..
            } => {
                emit_numeric_operand(assembly, "x9", left);
                emit_numeric_operand(assembly, "x10", right);
                writeln!(assembly, "    sub x9, x9, x10").unwrap();
                emit_immediate(assembly, "x10", *expected as u64);
                writeln!(assembly, "    cmp x9, x10").unwrap();
                writeln!(assembly, "    b.ne {fail}").unwrap();
            }
        }
    }
    writeln!(assembly, "    add sp, sp, #{NUMERIC_STACK_BYTES}").unwrap();
    writeln!(assembly, "    b {pass}").unwrap();
    writeln!(assembly, "{fail}:").unwrap();
    writeln!(assembly, "    add sp, sp, #{NUMERIC_STACK_BYTES}").unwrap();
    writeln!(assembly, "    b Ltinytsx_test262_fail").unwrap();
    writeln!(assembly, "{pass}:").unwrap();
}

fn emit_numeric_operand(assembly: &mut String, register: &str, operand: &NumericOperand) {
    match operand {
        NumericOperand::Literal { value } => emit_immediate(assembly, register, *value as u64),
        NumericOperand::Slot { slot } => {
            writeln!(assembly, "    ldr {register}, [sp, #{}]", slot * 8).unwrap();
        }
    }
}

fn emit_array_spread_apply_program(
    assembly: &mut String,
    assertion_index: usize,
    values: &[i64],
    expected_arguments: &[i64],
    expected_calls: usize,
) {
    writeln!(assembly, "    sub sp, sp, #{ARRAY_STACK_BYTES}").unwrap();
    emit_immediate(assembly, "x9", values.len() as u64);
    writeln!(assembly, "    str x9, [sp]").unwrap();
    for (index, value) in values.iter().enumerate() {
        emit_immediate(assembly, "x10", *value as u64);
        writeln!(
            assembly,
            "    str x10, [sp, #{}]",
            SPREAD_SOURCE_OFFSET + index * 8
        )
        .unwrap();
    }

    for index in 0..values.len() {
        writeln!(
            assembly,
            "    ldr x10, [sp, #{}]",
            SPREAD_SOURCE_OFFSET + index * 8
        )
        .unwrap();
        writeln!(
            assembly,
            "    str x10, [sp, #{}]",
            SPREAD_ARGUMENTS_OFFSET + index * 8
        )
        .unwrap();
    }
    writeln!(assembly, "    str x9, [sp, #8]").unwrap();

    emit_immediate(assembly, "x10", expected_arguments.len() as u64);
    writeln!(assembly, "    ldr x9, [sp, #8]").unwrap();
    writeln!(assembly, "    cmp x9, x10").unwrap();
    writeln!(
        assembly,
        "    b.ne Ltinytsx_test262_spread_{assertion_index}_fail"
    )
    .unwrap();
    for (index, expected) in expected_arguments.iter().enumerate() {
        writeln!(
            assembly,
            "    ldr x9, [sp, #{}]",
            SPREAD_ARGUMENTS_OFFSET + index * 8
        )
        .unwrap();
        emit_immediate(assembly, "x10", *expected as u64);
        writeln!(assembly, "    cmp x9, x10").unwrap();
        writeln!(
            assembly,
            "    b.ne Ltinytsx_test262_spread_{assertion_index}_fail"
        )
        .unwrap();
    }
    emit_immediate(assembly, "x9", 1);
    emit_immediate(assembly, "x10", expected_calls as u64);
    writeln!(assembly, "    cmp x9, x10").unwrap();
    writeln!(
        assembly,
        "    b.ne Ltinytsx_test262_spread_{assertion_index}_fail"
    )
    .unwrap();
    writeln!(assembly, "    add sp, sp, #{ARRAY_STACK_BYTES}").unwrap();
    writeln!(
        assembly,
        "    b Ltinytsx_test262_spread_{assertion_index}_pass"
    )
    .unwrap();
    writeln!(
        assembly,
        "Ltinytsx_test262_spread_{assertion_index}_fail:"
    )
    .unwrap();
    writeln!(assembly, "    add sp, sp, #{ARRAY_STACK_BYTES}").unwrap();
    writeln!(assembly, "    b Ltinytsx_test262_fail").unwrap();
    writeln!(
        assembly,
        "Ltinytsx_test262_spread_{assertion_index}_pass:"
    )
    .unwrap();
}

fn emit_header(assembly: &mut String, target: Target) {
    match target {
        Target::MacosArm64 => {
            writeln!(assembly, ".section __TEXT,__text,regular,pure_instructions").unwrap();
            writeln!(assembly, ".p2align 2").unwrap();
            writeln!(assembly, ".globl _main").unwrap();
            writeln!(assembly, "_main:").unwrap();
        }
        Target::LinuxArm64 => {
            writeln!(assembly, ".section .text").unwrap();
            writeln!(assembly, ".p2align 2").unwrap();
            writeln!(assembly, ".globl main").unwrap();
            writeln!(assembly, ".type main, %function").unwrap();
            writeln!(assembly, "main:").unwrap();
        }
    }
}

fn emit_data_header(assembly: &mut String, target: Target) {
    match target {
        Target::MacosArm64 => writeln!(assembly, "\n.section __TEXT,__const").unwrap(),
        Target::LinuxArm64 => {
            writeln!(assembly, ".size main, .-main").unwrap();
            writeln!(assembly, "\n.section .rodata").unwrap();
        }
    }
}

fn emit_array_unshift_program(
    assembly: &mut String,
    assertion_index: usize,
    operations: &[ArrayUnshiftOperation],
) {
    writeln!(assembly, "    sub sp, sp, #{ARRAY_STACK_BYTES}").unwrap();
    writeln!(assembly, "    str xzr, [sp]").unwrap();
    writeln!(assembly, "    str xzr, [sp, #8]").unwrap();

    for (operation_index, operation) in operations.iter().enumerate() {
        let fail = format!("Ltinytsx_test262_array_fail_{assertion_index}");
        match operation {
            ArrayUnshiftOperation::Unshift { values, .. } => {
                emit_array_unshift(assembly, assertion_index, operation_index, values)
            }
            ArrayUnshiftOperation::AssertResult { expected, .. } => {
                writeln!(assembly, "    ldr x9, [sp, #8]").unwrap();
                emit_immediate(assembly, "x10", *expected as u64);
                writeln!(assembly, "    cmp x9, x10").unwrap();
                writeln!(assembly, "    b.ne {fail}").unwrap();
            }
            ArrayUnshiftOperation::AssertElement {
                index, expected, ..
            } => {
                writeln!(assembly, "    ldr x9, [sp]").unwrap();
                emit_immediate(assembly, "x10", *index as u64);
                writeln!(assembly, "    cmp x9, x10").unwrap();
                if let Some(expected) = expected {
                    writeln!(assembly, "    b.ls {fail}").unwrap();
                    writeln!(assembly, "    add x11, sp, #{ARRAY_DATA_OFFSET}").unwrap();
                    writeln!(assembly, "    ldr x9, [x11, x10, lsl #3]").unwrap();
                    emit_immediate(assembly, "x10", *expected as u64);
                    writeln!(assembly, "    cmp x9, x10").unwrap();
                    writeln!(assembly, "    b.ne {fail}").unwrap();
                } else {
                    writeln!(assembly, "    b.hi {fail}").unwrap();
                }
            }
            ArrayUnshiftOperation::AssertLength { expected, .. } => {
                writeln!(assembly, "    ldr x9, [sp]").unwrap();
                emit_immediate(assembly, "x10", *expected as u64);
                writeln!(assembly, "    cmp x9, x10").unwrap();
                writeln!(assembly, "    b.ne {fail}").unwrap();
            }
        }
    }

    writeln!(assembly, "    add sp, sp, #{ARRAY_STACK_BYTES}").unwrap();
    writeln!(
        assembly,
        "    b Ltinytsx_test262_array_pass_{assertion_index}"
    )
    .unwrap();
    writeln!(assembly, "Ltinytsx_test262_array_fail_{assertion_index}:").unwrap();
    writeln!(assembly, "    add sp, sp, #{ARRAY_STACK_BYTES}").unwrap();
    writeln!(assembly, "    b Ltinytsx_test262_fail").unwrap();
    writeln!(assembly, "Ltinytsx_test262_array_pass_{assertion_index}:").unwrap();
}

fn emit_array_unshift(
    assembly: &mut String,
    assertion_index: usize,
    operation_index: usize,
    values: &[i64],
) {
    writeln!(assembly, "    ldr x9, [sp]").unwrap();
    if !values.is_empty() {
        writeln!(assembly, "    mov x10, x9").unwrap();
        writeln!(
            assembly,
            "Ltinytsx_test262_array_shift_{assertion_index}_{operation_index}:"
        )
        .unwrap();
        writeln!(
            assembly,
            "    cbz x10, Ltinytsx_test262_array_shifted_{assertion_index}_{operation_index}"
        )
        .unwrap();
        writeln!(assembly, "    sub x10, x10, #1").unwrap();
        writeln!(assembly, "    add x11, x10, #{}", values.len()).unwrap();
        writeln!(assembly, "    add x12, sp, #{ARRAY_DATA_OFFSET}").unwrap();
        writeln!(assembly, "    ldr x13, [x12, x10, lsl #3]").unwrap();
        writeln!(assembly, "    str x13, [x12, x11, lsl #3]").unwrap();
        writeln!(
            assembly,
            "    b Ltinytsx_test262_array_shift_{assertion_index}_{operation_index}"
        )
        .unwrap();
        writeln!(
            assembly,
            "Ltinytsx_test262_array_shifted_{assertion_index}_{operation_index}:"
        )
        .unwrap();
        for (index, value) in values.iter().enumerate() {
            emit_immediate(assembly, "x10", *value as u64);
            writeln!(
                assembly,
                "    str x10, [sp, #{}]",
                ARRAY_DATA_OFFSET + index * 8
            )
            .unwrap();
        }
        writeln!(assembly, "    add x9, x9, #{}", values.len()).unwrap();
        writeln!(assembly, "    str x9, [sp]").unwrap();
    }
    writeln!(assembly, "    str x9, [sp, #8]").unwrap();
}

fn emit_same_value(
    assembly: &mut String,
    target: Target,
    index: usize,
    actual: &str,
    expected: &str,
) {
    if actual.len() != expected.len() {
        writeln!(assembly, "    b Ltinytsx_test262_fail").unwrap();
        return;
    }
    emit_address(
        assembly,
        target,
        "x0",
        &format!("Ltinytsx_test262_actual_{index}"),
    );
    emit_address(
        assembly,
        target,
        "x1",
        &format!("Ltinytsx_test262_expected_{index}"),
    );
    emit_immediate(assembly, "x2", actual.len() as u64);
    writeln!(assembly, "Ltinytsx_test262_compare_{index}:").unwrap();
    writeln!(assembly, "    cbz x2, Ltinytsx_test262_pass_{index}").unwrap();
    writeln!(assembly, "    ldrb w3, [x0], #1").unwrap();
    writeln!(assembly, "    ldrb w4, [x1], #1").unwrap();
    writeln!(assembly, "    cmp w3, w4").unwrap();
    writeln!(assembly, "    b.ne Ltinytsx_test262_fail").unwrap();
    writeln!(assembly, "    sub x2, x2, #1").unwrap();
    writeln!(assembly, "    b Ltinytsx_test262_compare_{index}").unwrap();
    writeln!(assembly, "Ltinytsx_test262_pass_{index}:").unwrap();
}

fn emit_address(assembly: &mut String, target: Target, register: &str, label: &str) {
    match target {
        Target::MacosArm64 => {
            writeln!(assembly, "    adrp {register}, {label}@PAGE").unwrap();
            writeln!(assembly, "    add {register}, {register}, {label}@PAGEOFF").unwrap();
        }
        Target::LinuxArm64 => {
            writeln!(assembly, "    adrp {register}, {label}").unwrap();
            writeln!(assembly, "    add {register}, {register}, :lo12:{label}").unwrap();
        }
    }
}

fn emit_for_throw_counter(
    assembly: &mut String,
    index: usize,
    initial: i64,
    threshold: i64,
    thrown: i64,
    catch_expected: i64,
    final_expected: i64,
) {
    emit_immediate(assembly, "x9", initial as u64);
    writeln!(assembly, "Ltinytsx_test262_for_{index}:").unwrap();
    writeln!(assembly, "    add x9, x9, #1").unwrap();
    emit_immediate(assembly, "x10", threshold as u64);
    writeln!(assembly, "    cmp x9, x10").unwrap();
    writeln!(assembly, "    b.le Ltinytsx_test262_for_{index}").unwrap();

    emit_immediate(assembly, "x10", thrown as u64);
    emit_immediate(assembly, "x11", catch_expected as u64);
    writeln!(assembly, "    cmp x10, x11").unwrap();
    writeln!(assembly, "    b.ne Ltinytsx_test262_fail").unwrap();

    emit_immediate(assembly, "x11", final_expected as u64);
    writeln!(assembly, "    cmp x9, x11").unwrap();
    writeln!(assembly, "    b.ne Ltinytsx_test262_fail").unwrap();
}

fn emit_immediate(assembly: &mut String, register: &str, value: u64) {
    writeln!(assembly, "    movz {register}, #{}", value & 0xffff).unwrap();
    for shift in [16, 32, 48] {
        let part = (value >> shift) & 0xffff;
        if part != 0 {
            writeln!(assembly, "    movk {register}, #{part}, lsl #{shift}").unwrap();
        }
    }
}

fn emit_bytes(assembly: &mut String, bytes: &[u8]) {
    if bytes.is_empty() {
        writeln!(assembly, "    .byte 0").unwrap();
        return;
    }
    for chunk in bytes.chunks(16) {
        write!(assembly, "    .byte ").unwrap();
        for (index, byte) in chunk.iter().enumerate() {
            if index > 0 {
                write!(assembly, ", ").unwrap();
            }
            write!(assembly, "{byte}").unwrap();
        }
        writeln!(assembly).unwrap();
    }
}

#[cfg(test)]
#[path = "test262_codegen_tests.rs"]
mod tests;
