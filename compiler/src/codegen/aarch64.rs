use crate::hir::ValueExpression;

use super::assembly::{Assembly, asm_line};

pub(super) const HANDLER_SCRATCH_BASE: usize = 48;

pub(super) fn emit_immediate(assembly: &mut Assembly, register: &str, value: u64) {
    let chunks = [
        (value & 0xffff) as u16,
        ((value >> 16) & 0xffff) as u16,
        ((value >> 32) & 0xffff) as u16,
        ((value >> 48) & 0xffff) as u16,
    ];
    asm_line!(assembly, "    movz {register}, #{}", chunks[0]);
    for (index, chunk) in chunks.into_iter().enumerate().skip(1) {
        if chunk != 0 {
            asm_line!(
                assembly,
                "    movk {register}, #{chunk}, lsl #{}",
                index * 16
            );
        }
    }
}

pub(super) fn emit_prologue(assembly: &mut Assembly, frame_size: usize) {
    asm_line!(assembly, "    stp x29, x30, [sp, #-{frame_size}]!");
    asm_line!(assembly, "    mov x29, sp");
}

pub(super) fn preserve_request_context(assembly: &mut Assembly) {
    asm_line!(assembly, "    str x1, [sp, #16]");
    asm_line!(assembly, "    str x0, [sp, #24]");
}

pub(super) fn emit_epilogue(assembly: &mut Assembly, frame_size: usize) {
    asm_line!(assembly, "    ldp x29, x30, [sp], #{frame_size}");
    asm_line!(assembly, "    ret");
}

pub(super) fn value_frame_size(base: usize, expression: &ValueExpression) -> Result<usize, String> {
    let required = base + scratch_slots(expression) * 16;
    let frame_size = required.max(16).div_ceil(16) * 16;
    if frame_size > 496 {
        return Err("function call expression requires more than 496 bytes of stack".to_owned());
    }
    Ok(frame_size)
}

fn scratch_slots(expression: &ValueExpression) -> usize {
    match expression {
        ValueExpression::DirectCall { arguments, .. } => {
            arguments.len() + arguments.iter().map(scratch_slots).max().unwrap_or(0)
        }
        ValueExpression::Concat { values, .. } => {
            values.iter().map(scratch_slots).max().unwrap_or(0)
        }
        ValueExpression::QueryConditional {
            when_present,
            when_absent,
            ..
        } => scratch_slots(when_present).max(scratch_slots(when_absent)),
        ValueExpression::WorkerCall { input, .. } => scratch_slots(input),
        _ => 0,
    }
}

#[cfg(test)]
#[path = "aarch64_tests.rs"]
mod tests;
