use std::fmt::Write;

use crate::test262_hir::{SameValueStringAssertion, Test262Program};

pub fn emit_macos_arm64(program: &Test262Program) -> Result<String, String> {
    program.validate()?;
    let mut assembly = String::new();
    writeln!(assembly, ".section __TEXT,__text,regular,pure_instructions").unwrap();
    writeln!(assembly, ".p2align 2").unwrap();
    writeln!(assembly, ".globl _main").unwrap();
    writeln!(assembly, "_main:").unwrap();

    for (index, assertion) in program.assertions.iter().enumerate() {
        let SameValueStringAssertion::SameValueString {
            actual, expected, ..
        } = assertion;
        if actual.len() != expected.len() {
            writeln!(assembly, "    b Ltinytsx_test262_fail").unwrap();
            continue;
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
        emit_immediate(&mut assembly, "x2", actual.len() as u64);
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
    writeln!(assembly, "    mov w0, #0").unwrap();
    writeln!(assembly, "    ret").unwrap();
    writeln!(assembly, "Ltinytsx_test262_fail:").unwrap();
    writeln!(assembly, "    mov w0, #1").unwrap();
    writeln!(assembly, "    ret").unwrap();

    writeln!(assembly, "\n.section __TEXT,__const").unwrap();
    for (index, assertion) in program.assertions.iter().enumerate() {
        let SameValueStringAssertion::SameValueString {
            actual, expected, ..
        } = assertion;
        writeln!(assembly, ".p2align 3").unwrap();
        writeln!(assembly, "Ltinytsx_test262_actual_{index}:").unwrap();
        emit_bytes(&mut assembly, actual.as_bytes());
        writeln!(assembly, ".p2align 3").unwrap();
        writeln!(assembly, "Ltinytsx_test262_expected_{index}:").unwrap();
        emit_bytes(&mut assembly, expected.as_bytes());
    }
    Ok(assembly)
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
