use crate::hir::{Program, SqliteParameter, ValueExpression};

use super::super::{
    aarch64::{Emitter, HANDLER_SCRATCH_BASE, emit_immediate},
    assembly::asm_line,
};

const PARAMETER_BYTES: usize = 24;

pub(super) fn parameter_frame_size(count: usize) -> usize {
    (HANDLER_SCRATCH_BASE + count * PARAMETER_BYTES).div_ceil(16) * 16
}

pub(super) fn expression_parameter_count(expression: &ValueExpression) -> usize {
    match expression {
        ValueExpression::SqliteQuery { parameters, .. } => parameters.len(),
        ValueExpression::Concat { values, .. } => values
            .iter()
            .map(expression_parameter_count)
            .max()
            .unwrap_or(0),
        ValueExpression::QueryConditional {
            when_present,
            when_absent,
            ..
        } => expression_parameter_count(when_present).max(expression_parameter_count(when_absent)),
        _ => 0,
    }
}

pub(super) fn emit_parameters(
    assembly: &mut Emitter,
    program: &Program,
    parameters: &[SqliteParameter],
) {
    for (index, parameter) in parameters.iter().enumerate() {
        let offset = HANDLER_SCRATCH_BASE + index * PARAMETER_BYTES;
        match parameter {
            SqliteParameter::RouteParameter { segment } => {
                emit_immediate(assembly, "x9", 1);
                asm_line!(assembly, "    str x9, [sp, #{offset}]");
                emit_immediate(assembly, "x9", *segment as u64);
                asm_line!(assembly, "    str x9, [sp, #{}]", offset + 8);
                asm_line!(assembly, "    str xzr, [sp, #{}]", offset + 16);
            }
            SqliteParameter::RequestJsonField { field } => {
                emit_immediate(assembly, "x9", 2);
                asm_line!(assembly, "    str x9, [sp, #{offset}]");
                emit_immediate(
                    assembly,
                    "x9",
                    program.static_strings[*field].value.len() as u64,
                );
                asm_line!(assembly, "    str x9, [sp, #{}]", offset + 8);
                assembly.address("x9", format_args!("Ltinytsx_string_{field}"));
                asm_line!(assembly, "    str x9, [sp, #{}]", offset + 16);
            }
        }
    }
}

pub(super) fn address_parameters(assembly: &mut Emitter, register: &str) {
    asm_line!(assembly, "    add {register}, sp, #{HANDLER_SCRATCH_BASE}");
}
