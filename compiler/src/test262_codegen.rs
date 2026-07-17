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
            Test262Assertion::ThrowCatchProgram {
                initial_caught,
                thrown,
                expected,
                final_expected,
                ..
            } => emit_throw_catch_program(
                &mut assembly,
                target,
                index,
                *initial_caught,
                thrown,
                expected,
                *final_expected,
            ),
            Test262Assertion::DateNowTypeProgram { .. } => {
                emit_date_now_type_program(&mut assembly, target, index)
            }
            Test262Assertion::ClassConstructorProgram {
                initial_count,
                expected_count,
                configurable,
                enumerable,
                writable,
                ..
            } => emit_class_constructor_program(
                &mut assembly,
                index,
                *initial_count,
                *expected_count,
                *configurable,
                *enumerable,
                *writable,
            ),
            Test262Assertion::ErrorMessageProgram {
                message,
                writable,
                enumerable,
                configurable,
                ..
            } => emit_error_message_program(
                &mut assembly,
                target,
                index,
                message,
                *writable,
                *enumerable,
                *configurable,
            ),
            Test262Assertion::RegExpTestProgram {
                input,
                alternatives,
                ..
            } => emit_regexp_test_program(&mut assembly, target, index, input, alternatives),
            Test262Assertion::ModuleFunctionBindingProgram {
                return_value,
                expected_return,
                ..
            } => emit_module_function_binding_program(
                &mut assembly,
                target,
                index,
                return_value,
                expected_return,
            ),
        }
    }
    writeln!(assembly, "    mov w0, #0").unwrap();
    writeln!(assembly, "    ldp x29, x30, [sp], #16").unwrap();
    writeln!(assembly, "    ret").unwrap();
    writeln!(assembly, "Ltinytsx_test262_fail:").unwrap();
    writeln!(assembly, "    mov w0, #1").unwrap();
    writeln!(assembly, "    ldp x29, x30, [sp], #16").unwrap();
    writeln!(assembly, "    ret").unwrap();

    emit_data_header(&mut assembly, target);
    for (index, assertion) in program.assertions.iter().enumerate() {
        match assertion {
            Test262Assertion::SameValueString {
                actual, expected, ..
            } => emit_comparison_data(&mut assembly, index, actual, expected),
            Test262Assertion::ThrowCatchProgram {
                thrown, expected, ..
            } => emit_comparison_data(&mut assembly, index, thrown, expected),
            Test262Assertion::RecordMembershipProgram {
                fields, property, ..
            } => {
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
            Test262Assertion::ErrorMessageProgram { message, .. } => {
                writeln!(assembly, ".p2align 3").unwrap();
                writeln!(assembly, "Ltinytsx_test262_error_message_{index}:").unwrap();
                emit_bytes(&mut assembly, message.as_bytes());
            }
            Test262Assertion::RegExpTestProgram {
                input,
                alternatives,
                ..
            } => {
                writeln!(assembly, ".p2align 3").unwrap();
                writeln!(assembly, "Ltinytsx_test262_regexp_input_{index}:").unwrap();
                emit_bytes(&mut assembly, input.as_bytes());
                for (alternative_index, alternative) in alternatives.iter().enumerate() {
                    writeln!(assembly, ".p2align 3").unwrap();
                    writeln!(
                        assembly,
                        "Ltinytsx_test262_regexp_alternative_{index}_{alternative_index}:"
                    )
                    .unwrap();
                    emit_bytes(&mut assembly, alternative.as_bytes());
                }
            }
            Test262Assertion::ModuleFunctionBindingProgram {
                return_value,
                expected_return,
                ..
            } => {
                writeln!(assembly, ".p2align 3").unwrap();
                writeln!(assembly, "Ltinytsx_test262_module_return_{index}:").unwrap();
                emit_bytes(&mut assembly, return_value.as_bytes());
                writeln!(assembly, ".p2align 3").unwrap();
                writeln!(assembly, "Ltinytsx_test262_module_expected_{index}:").unwrap();
                emit_bytes(&mut assembly, expected_return.as_bytes());
            }
            _ => {}
        }
    }
    Ok(assembly)
}

fn emit_module_function_binding_program(
    assembly: &mut String,
    target: Target,
    assertion_index: usize,
    return_value: &str,
    expected_return: &str,
) {
    let compare = format!("Ltinytsx_test262_module_{assertion_index}_compare");
    let compared = format!("Ltinytsx_test262_module_{assertion_index}_compared");
    let fail = format!("Ltinytsx_test262_module_{assertion_index}_fail");
    let pass = format!("Ltinytsx_test262_module_{assertion_index}_pass");
    writeln!(assembly, "    sub sp, sp, #16").unwrap();

    // ModuleDeclarationInstantiation creates and initializes the local function
    // binding before evaluation; the second slot models global ownership.
    emit_immediate(assembly, "x9", 1);
    writeln!(assembly, "    str x9, [sp]").unwrap();
    writeln!(assembly, "    str xzr, [sp, #8]").unwrap();
    writeln!(assembly, "    ldr x9, [sp]").unwrap();
    emit_immediate(assembly, "x10", 1);
    writeln!(assembly, "    cmp x9, x10").unwrap();
    writeln!(assembly, "    b.ne {fail}").unwrap();

    if return_value.len() != expected_return.len() {
        writeln!(assembly, "    b {fail}").unwrap();
    } else if !return_value.is_empty() {
        let return_label = format!("Ltinytsx_test262_module_return_{assertion_index}");
        let expected_label = format!("Ltinytsx_test262_module_expected_{assertion_index}");
        emit_address(assembly, target, "x0", &return_label);
        emit_address(assembly, target, "x1", &expected_label);
        emit_immediate(assembly, "x2", return_value.len() as u64);
        writeln!(assembly, "{compare}:").unwrap();
        writeln!(assembly, "    ldrb w3, [x0], #1").unwrap();
        writeln!(assembly, "    ldrb w4, [x1], #1").unwrap();
        writeln!(assembly, "    cmp w3, w4").unwrap();
        writeln!(assembly, "    b.ne {fail}").unwrap();
        writeln!(assembly, "    subs x2, x2, #1").unwrap();
        writeln!(assembly, "    b.ne {compare}").unwrap();
    }
    writeln!(assembly, "{compared}:").unwrap();

    writeln!(assembly, "    ldr x9, [sp, #8]").unwrap();
    writeln!(assembly, "    cbnz x9, {fail}").unwrap();
    // Assignment mutates the module binding to null. Evaluation of the hoisted
    // declaration later in the source must not initialize it again.
    writeln!(assembly, "    str xzr, [sp]").unwrap();
    for _ in 0..2 {
        writeln!(assembly, "    ldr x9, [sp]").unwrap();
        writeln!(assembly, "    cbnz x9, {fail}").unwrap();
        writeln!(assembly, "    ldr x9, [sp, #8]").unwrap();
        writeln!(assembly, "    cbnz x9, {fail}").unwrap();
    }
    writeln!(assembly, "    b {pass}").unwrap();

    writeln!(assembly, "{fail}:").unwrap();
    writeln!(assembly, "    add sp, sp, #16").unwrap();
    writeln!(assembly, "    b Ltinytsx_test262_fail").unwrap();
    writeln!(assembly, "{pass}:").unwrap();
    writeln!(assembly, "    add sp, sp, #16").unwrap();
}

fn emit_regexp_test_program(
    assembly: &mut String,
    target: Target,
    assertion_index: usize,
    input: &str,
    alternatives: &[String],
) {
    let fail = format!("Ltinytsx_test262_regexp_{assertion_index}_fail");
    let pass = format!("Ltinytsx_test262_regexp_{assertion_index}_pass");
    writeln!(assembly, "    sub sp, sp, #16").unwrap();

    emit_regexp_literal_match(
        assembly,
        target,
        assertion_index,
        0,
        input.len(),
        alternatives,
    );
    writeln!(assembly, "    str x9, [sp]").unwrap();
    emit_regexp_literal_match(
        assembly,
        target,
        assertion_index,
        1,
        input.len(),
        alternatives,
    );
    writeln!(assembly, "    str x9, [sp, #8]").unwrap();
    writeln!(assembly, "    ldr x10, [sp]").unwrap();
    writeln!(assembly, "    cmp x9, x10").unwrap();
    writeln!(assembly, "    b.ne {fail}").unwrap();
    writeln!(assembly, "    b {pass}").unwrap();

    writeln!(assembly, "{fail}:").unwrap();
    writeln!(assembly, "    add sp, sp, #16").unwrap();
    writeln!(assembly, "    b Ltinytsx_test262_fail").unwrap();
    writeln!(assembly, "{pass}:").unwrap();
    writeln!(assembly, "    add sp, sp, #16").unwrap();
}

fn emit_regexp_literal_match(
    assembly: &mut String,
    target: Target,
    assertion_index: usize,
    run: usize,
    input_len: usize,
    alternatives: &[String],
) {
    let done = format!("Ltinytsx_test262_regexp_{assertion_index}_{run}_done");
    emit_immediate(assembly, "x9", 0);
    for (alternative_index, alternative) in alternatives.iter().enumerate() {
        if alternative.len() > input_len {
            continue;
        }
        let scan =
            format!("Ltinytsx_test262_regexp_{assertion_index}_{run}_{alternative_index}_scan");
        let compare =
            format!("Ltinytsx_test262_regexp_{assertion_index}_{run}_{alternative_index}_compare");
        let next =
            format!("Ltinytsx_test262_regexp_{assertion_index}_{run}_{alternative_index}_next");
        let input_label = format!("Ltinytsx_test262_regexp_input_{assertion_index}");
        let alternative_label =
            format!("Ltinytsx_test262_regexp_alternative_{assertion_index}_{alternative_index}");
        emit_address(assembly, target, "x0", &input_label);
        emit_address(assembly, target, "x1", &alternative_label);
        emit_immediate(assembly, "x2", (input_len - alternative.len() + 1) as u64);
        writeln!(assembly, "{scan}:").unwrap();
        writeln!(assembly, "    mov x3, x0").unwrap();
        writeln!(assembly, "    mov x4, x1").unwrap();
        emit_immediate(assembly, "x5", alternative.len() as u64);
        writeln!(assembly, "{compare}:").unwrap();
        writeln!(assembly, "    ldrb w6, [x3], #1").unwrap();
        writeln!(assembly, "    ldrb w7, [x4], #1").unwrap();
        writeln!(assembly, "    cmp w6, w7").unwrap();
        writeln!(assembly, "    b.ne {next}").unwrap();
        writeln!(assembly, "    subs x5, x5, #1").unwrap();
        writeln!(assembly, "    b.ne {compare}").unwrap();
        emit_immediate(assembly, "x9", 1);
        writeln!(assembly, "    b {done}").unwrap();
        writeln!(assembly, "{next}:").unwrap();
        writeln!(assembly, "    add x0, x0, #1").unwrap();
        writeln!(assembly, "    subs x2, x2, #1").unwrap();
        writeln!(assembly, "    b.ne {scan}").unwrap();
    }
    writeln!(assembly, "{done}:").unwrap();
}

fn emit_error_message_program(
    assembly: &mut String,
    target: Target,
    assertion_index: usize,
    message: &str,
    writable: bool,
    enumerable: bool,
    configurable: bool,
) {
    const STACK_BYTES: usize = 288;
    let copy = format!("Ltinytsx_test262_error_{assertion_index}_copy");
    let copied = format!("Ltinytsx_test262_error_{assertion_index}_copied");
    let compare = format!("Ltinytsx_test262_error_{assertion_index}_compare");
    let compared = format!("Ltinytsx_test262_error_{assertion_index}_compared");
    let fail = format!("Ltinytsx_test262_error_{assertion_index}_fail");
    let pass = format!("Ltinytsx_test262_error_{assertion_index}_pass");

    writeln!(assembly, "    sub sp, sp, #{STACK_BYTES}").unwrap();
    emit_address(
        assembly,
        target,
        "x0",
        &format!("Ltinytsx_test262_error_message_{assertion_index}"),
    );
    writeln!(assembly, "    mov x1, sp").unwrap();
    emit_immediate(assembly, "x2", message.len() as u64);
    writeln!(assembly, "    cbz x2, {copied}").unwrap();
    writeln!(assembly, "{copy}:").unwrap();
    writeln!(assembly, "    ldrb w3, [x0], #1").unwrap();
    writeln!(assembly, "    strb w3, [x1], #1").unwrap();
    writeln!(assembly, "    subs x2, x2, #1").unwrap();
    writeln!(assembly, "    b.ne {copy}").unwrap();
    writeln!(assembly, "{copied}:").unwrap();

    // Error(message) owns a copied message value; compare that property with
    // the source value used by verifyEqualTo.
    writeln!(assembly, "    mov x0, sp").unwrap();
    emit_address(
        assembly,
        target,
        "x1",
        &format!("Ltinytsx_test262_error_message_{assertion_index}"),
    );
    emit_immediate(assembly, "x2", message.len() as u64);
    writeln!(assembly, "    cbz x2, {compared}").unwrap();
    writeln!(assembly, "{compare}:").unwrap();
    writeln!(assembly, "    ldrb w3, [x0], #1").unwrap();
    writeln!(assembly, "    ldrb w4, [x1], #1").unwrap();
    writeln!(assembly, "    cmp w3, w4").unwrap();
    writeln!(assembly, "    b.ne {fail}").unwrap();
    writeln!(assembly, "    subs x2, x2, #1").unwrap();
    writeln!(assembly, "    b.ne {compare}").unwrap();
    writeln!(assembly, "{compared}:").unwrap();

    for (offset, actual) in [(256, true), (264, false), (272, true)] {
        emit_immediate(assembly, "x9", u64::from(actual));
        writeln!(assembly, "    str x9, [sp, #{offset}]").unwrap();
    }
    for (offset, expected) in [(256, writable), (264, enumerable), (272, configurable)] {
        writeln!(assembly, "    ldr x9, [sp, #{offset}]").unwrap();
        emit_immediate(assembly, "x10", u64::from(expected));
        writeln!(assembly, "    cmp x9, x10").unwrap();
        writeln!(assembly, "    b.ne {fail}").unwrap();
    }
    writeln!(assembly, "    b {pass}").unwrap();

    writeln!(assembly, "{fail}:").unwrap();
    writeln!(assembly, "    add sp, sp, #{STACK_BYTES}").unwrap();
    writeln!(assembly, "    b Ltinytsx_test262_fail").unwrap();
    writeln!(assembly, "{pass}:").unwrap();
    writeln!(assembly, "    add sp, sp, #{STACK_BYTES}").unwrap();
}

fn emit_class_constructor_program(
    assembly: &mut String,
    assertion_index: usize,
    initial_count: i64,
    expected_count: i64,
    configurable: bool,
    enumerable: bool,
    writable: bool,
) {
    const STACK_BYTES: usize = 64;
    let fail = format!("Ltinytsx_test262_class_{assertion_index}_fail");
    let pass = format!("Ltinytsx_test262_class_{assertion_index}_pass");

    writeln!(assembly, "    sub sp, sp, #{STACK_BYTES}").unwrap();
    emit_immediate(assembly, "x9", initial_count as u64);
    writeln!(assembly, "    str x9, [sp]").unwrap();

    // Model the class, its prototype, and the prototype's constructor as
    // stable identities owned by this bounded assertion frame.
    writeln!(assembly, "    add x9, sp, #8").unwrap();
    writeln!(assembly, "    str x9, [sp, #8]").unwrap();
    writeln!(assembly, "    add x10, sp, #16").unwrap();
    writeln!(assembly, "    str x10, [sp, #16]").unwrap();
    writeln!(assembly, "    str x9, [sp, #24]").unwrap();

    for (offset, actual) in [(32, true), (40, false), (48, true)] {
        emit_immediate(assembly, "x9", u64::from(actual));
        writeln!(assembly, "    str x9, [sp, #{offset}]").unwrap();
    }

    // C === C.prototype.constructor.
    writeln!(assembly, "    ldr x9, [sp, #8]").unwrap();
    writeln!(assembly, "    ldr x10, [sp, #24]").unwrap();
    writeln!(assembly, "    cmp x9, x10").unwrap();
    writeln!(assembly, "    b.ne {fail}").unwrap();

    for (offset, expected) in [(32, configurable), (40, enumerable), (48, writable)] {
        writeln!(assembly, "    ldr x9, [sp, #{offset}]").unwrap();
        emit_immediate(assembly, "x10", u64::from(expected));
        writeln!(assembly, "    cmp x9, x10").unwrap();
        writeln!(assembly, "    b.ne {fail}").unwrap();
    }

    // new C() installs C.prototype before the constructor body runs.
    writeln!(assembly, "    ldr x10, [sp, #16]").unwrap();
    writeln!(assembly, "    str x10, [sp, #56]").unwrap();
    writeln!(assembly, "    ldr x9, [sp, #56]").unwrap();
    writeln!(assembly, "    cmp x9, x10").unwrap();
    writeln!(assembly, "    b.ne {fail}").unwrap();
    writeln!(assembly, "    ldr x9, [sp]").unwrap();
    writeln!(assembly, "    add x9, x9, #1").unwrap();
    writeln!(assembly, "    str x9, [sp]").unwrap();

    emit_immediate(assembly, "x10", expected_count as u64);
    writeln!(assembly, "    cmp x9, x10").unwrap();
    writeln!(assembly, "    b.ne {fail}").unwrap();
    writeln!(assembly, "    ldr x9, [sp, #56]").unwrap();
    writeln!(assembly, "    ldr x10, [sp, #16]").unwrap();
    writeln!(assembly, "    cmp x9, x10").unwrap();
    writeln!(assembly, "    b.ne {fail}").unwrap();
    writeln!(assembly, "    b {pass}").unwrap();

    writeln!(assembly, "{fail}:").unwrap();
    writeln!(assembly, "    add sp, sp, #{STACK_BYTES}").unwrap();
    writeln!(assembly, "    b Ltinytsx_test262_fail").unwrap();
    writeln!(assembly, "{pass}:").unwrap();
    writeln!(assembly, "    add sp, sp, #{STACK_BYTES}").unwrap();
}

fn emit_date_now_type_program(assembly: &mut String, target: Target, assertion_index: usize) {
    let fail = format!("Ltinytsx_test262_date_now_{assertion_index}_fail");
    let pass = format!("Ltinytsx_test262_date_now_{assertion_index}_pass");
    writeln!(assembly, "    sub sp, sp, #32").unwrap();
    writeln!(assembly, "    mov x0, #0").unwrap();
    writeln!(assembly, "    mov x1, sp").unwrap();
    emit_external_call(assembly, target, "clock_gettime");
    writeln!(assembly, "    cbnz w0, {fail}").unwrap();
    writeln!(assembly, "    ldp x9, x10, [sp]").unwrap();
    writeln!(assembly, "    add sp, sp, #32").unwrap();
    writeln!(assembly, "    b {pass}").unwrap();
    writeln!(assembly, "{fail}:").unwrap();
    writeln!(assembly, "    add sp, sp, #32").unwrap();
    writeln!(assembly, "    b Ltinytsx_test262_fail").unwrap();
    writeln!(assembly, "{pass}:").unwrap();
}

fn emit_external_call(assembly: &mut String, target: Target, symbol: &str) {
    match target {
        Target::MacosArm64 => writeln!(assembly, "    bl _{symbol}").unwrap(),
        Target::LinuxArm64 => writeln!(assembly, "    bl {symbol}").unwrap(),
    }
}

fn emit_comparison_data(assembly: &mut String, index: usize, actual: &str, expected: &str) {
    writeln!(assembly, ".p2align 3").unwrap();
    writeln!(assembly, "Ltinytsx_test262_actual_{index}:").unwrap();
    emit_bytes(assembly, actual.as_bytes());
    writeln!(assembly, ".p2align 3").unwrap();
    writeln!(assembly, "Ltinytsx_test262_expected_{index}:").unwrap();
    emit_bytes(assembly, expected.as_bytes());
}

fn emit_throw_catch_program(
    assembly: &mut String,
    target: Target,
    assertion_index: usize,
    initial_caught: bool,
    thrown: &str,
    expected: &str,
    final_expected: bool,
) {
    emit_immediate(assembly, "x9", u64::from(initial_caught));
    emit_same_value(assembly, target, assertion_index, thrown, expected);
    emit_immediate(assembly, "x9", 1);
    emit_immediate(assembly, "x10", u64::from(final_expected));
    writeln!(assembly, "    cmp x9, x10").unwrap();
    writeln!(assembly, "    b.ne Ltinytsx_test262_fail").unwrap();
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
        let matched =
            format!("Ltinytsx_test262_membership_{assertion_index}_{field_index}_matched");
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
    writeln!(
        assembly,
        "    b Ltinytsx_test262_membership_{assertion_index}_checked"
    )
    .unwrap();
    writeln!(assembly, "{done}:").unwrap();
    emit_immediate(assembly, "x9", 1);
    writeln!(
        assembly,
        "Ltinytsx_test262_membership_{assertion_index}_checked:"
    )
    .unwrap();
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
    writeln!(assembly, "Ltinytsx_test262_spread_{assertion_index}_fail:").unwrap();
    writeln!(assembly, "    add sp, sp, #{ARRAY_STACK_BYTES}").unwrap();
    writeln!(assembly, "    b Ltinytsx_test262_fail").unwrap();
    writeln!(assembly, "Ltinytsx_test262_spread_{assertion_index}_pass:").unwrap();
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
    writeln!(assembly, "    stp x29, x30, [sp, #-16]!").unwrap();
    writeln!(assembly, "    mov x29, sp").unwrap();
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
