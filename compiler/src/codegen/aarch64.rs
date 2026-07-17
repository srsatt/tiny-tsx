use std::fmt;

use crate::hir::ValueExpression;

use super::assembly::{Assembly, asm_line};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum Dialect {
    Apple,
    Elf,
}

/// AArch64 assembly writer with object-format-specific spelling at its edge.
///
/// Instruction emitters use this type so Mach-O and ELF differences cannot
/// leak into value or response lowering.
pub(super) struct Emitter {
    assembly: Assembly,
    dialect: Dialect,
}

impl Emitter {
    pub(super) fn new(dialect: Dialect) -> Self {
        Self {
            assembly: Assembly::new(),
            dialect,
        }
    }

    pub(super) fn line(&mut self, arguments: fmt::Arguments<'_>) {
        self.assembly.line(arguments);
    }

    pub(super) fn write(&mut self, arguments: fmt::Arguments<'_>) {
        self.assembly.write(arguments);
    }

    pub(super) fn finish(self) -> String {
        self.assembly.finish()
    }

    pub(super) fn text_section(&mut self) {
        match self.dialect {
            Dialect::Apple => {
                asm_line!(self, ".section __TEXT,__text,regular,pure_instructions");
                asm_line!(self, ".p2align 2");
            }
            Dialect::Elf => {
                asm_line!(self, ".text");
                asm_line!(self, ".p2align 2");
            }
        }
    }

    pub(super) fn const_section(&mut self) {
        match self.dialect {
            Dialect::Apple => asm_line!(self, "\n.section __TEXT,__const"),
            Dialect::Elf => asm_line!(self, "\n.section .rodata"),
        }
    }

    pub(super) fn global_function(&mut self, name: fmt::Arguments<'_>) {
        let symbol = self.symbol(name);
        asm_line!(self, "\n.globl {symbol}");
        if self.dialect == Dialect::Elf {
            asm_line!(self, ".type {symbol}, %function");
        }
        asm_line!(self, "{symbol}:");
    }

    pub(super) fn private_function(&mut self, name: fmt::Arguments<'_>) -> String {
        let symbol = self.symbol(name);
        match self.dialect {
            Dialect::Apple => asm_line!(self, "\n.private_extern {symbol}"),
            Dialect::Elf => asm_line!(self, "\n.type {symbol}, %function"),
        }
        asm_line!(self, "{symbol}:");
        symbol
    }

    pub(super) fn call(&mut self, name: fmt::Arguments<'_>) {
        let symbol = self.symbol(name);
        asm_line!(self, "    bl {symbol}");
    }

    pub(super) fn address(&mut self, register: &str, label: fmt::Arguments<'_>) {
        match self.dialect {
            Dialect::Apple => {
                asm_line!(self, "    adrp {register}, {label}@PAGE");
                asm_line!(self, "    add {register}, {register}, {label}@PAGEOFF");
            }
            Dialect::Elf => {
                asm_line!(self, "    adrp {register}, {label}");
                asm_line!(self, "    add {register}, {register}, :lo12:{label}");
            }
        }
    }

    fn symbol(&self, name: fmt::Arguments<'_>) -> String {
        match self.dialect {
            Dialect::Apple => format!("_{name}"),
            Dialect::Elf => name.to_string(),
        }
    }
}

pub(super) const HANDLER_SCRATCH_BASE: usize = 48;

pub(super) fn emit_immediate(assembly: &mut Emitter, register: &str, value: u64) {
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

pub(super) fn emit_prologue(assembly: &mut Emitter, frame_size: usize) {
    asm_line!(assembly, "    stp x29, x30, [sp, #-{frame_size}]!");
    asm_line!(assembly, "    mov x29, sp");
}

pub(super) fn preserve_request_context(assembly: &mut Emitter) {
    asm_line!(assembly, "    str x1, [sp, #16]");
    asm_line!(assembly, "    str x0, [sp, #24]");
}

pub(super) fn emit_epilogue(assembly: &mut Emitter, frame_size: usize) {
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
        ValueExpression::StringEqualConditional {
            left,
            right,
            when_equal,
            when_not_equal,
            ..
        } => {
            2 + [left, right, when_equal, when_not_equal]
                .into_iter()
                .map(|value| scratch_slots(value))
                .max()
                .unwrap_or(0)
        }
        ValueExpression::NumericBinary { left, right, .. } => {
            1 + scratch_slots(left).max(scratch_slots(right))
        }
        ValueExpression::NumericEqualConditional {
            left,
            right,
            when_equal,
            when_not_equal,
            ..
        } => {
            1 + [left, right, when_equal, when_not_equal]
                .into_iter()
                .map(|value| scratch_slots(value))
                .max()
                .unwrap_or(0)
        }
        ValueExpression::BooleanEqualConditional {
            left,
            right,
            when_equal,
            when_not_equal,
            ..
        } => {
            1 + [left, right, when_equal, when_not_equal]
                .into_iter()
                .map(|value| scratch_slots(value))
                .max()
                .unwrap_or(0)
        }
        ValueExpression::ThrowValue { value, .. } => scratch_slots(value),
        ValueExpression::TryCatch {
            try_value,
            catch_value,
            ..
        } => 1 + scratch_slots(try_value).max(scratch_slots(catch_value)),
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
