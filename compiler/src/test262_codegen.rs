use std::fmt::Write;

use crate::test262_hir::{Test262Assertion, Test262Program};

pub fn emit_macos_arm64(program: &Test262Program) -> Result<String, String> {
    program.validate()?;
    let mut assembly = String::new();
    writeln!(assembly, ".section __TEXT,__text,regular,pure_instructions").unwrap();
    writeln!(assembly, ".p2align 2").unwrap();
    writeln!(assembly, ".globl _main").unwrap();
    writeln!(assembly, "_main:").unwrap();

    for (index, assertion) in program.assertions.iter().enumerate() {
        match assertion {
            Test262Assertion::SameValueString {
                actual, expected, ..
            } => emit_same_value(&mut assembly, index, actual, expected),
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
        }
    }
    writeln!(assembly, "    mov w0, #0").unwrap();
    writeln!(assembly, "    ret").unwrap();
    writeln!(assembly, "Ltinytsx_test262_fail:").unwrap();
    writeln!(assembly, "    mov w0, #1").unwrap();
    writeln!(assembly, "    ret").unwrap();

    writeln!(assembly, "\n.section __TEXT,__const").unwrap();
    for (index, assertion) in program.assertions.iter().enumerate() {
        let Test262Assertion::SameValueString {
            actual, expected, ..
        } = assertion
        else {
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

fn emit_same_value(assembly: &mut String, index: usize, actual: &str, expected: &str) {
    if actual.len() != expected.len() {
        writeln!(assembly, "    b Ltinytsx_test262_fail").unwrap();
        return;
    }
    writeln!(
        assembly,
        "    adrp x0, Ltinytsx_test262_actual_{index}@PAGE"
    )
    .unwrap();
    writeln!(
        assembly,
        "    add x0, x0, Ltinytsx_test262_actual_{index}@PAGEOFF"
    )
    .unwrap();
    writeln!(
        assembly,
        "    adrp x1, Ltinytsx_test262_expected_{index}@PAGE"
    )
    .unwrap();
    writeln!(
        assembly,
        "    add x1, x1, Ltinytsx_test262_expected_{index}@PAGEOFF"
    )
    .unwrap();
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
