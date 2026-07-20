use crate::hir::{Program, SqliteParameter, SqliteTransactionStep, ValueExpression};

use super::super::{
    aarch64::{Emitter, HANDLER_SCRATCH_BASE, emit_immediate},
    assembly::asm_line,
};

const PARAMETER_BYTES: usize = 24;
const TRANSACTION_STEP_BYTES: usize = 32;

pub(super) fn parameter_frame_size(count: usize) -> usize {
    (HANDLER_SCRATCH_BASE + count * PARAMETER_BYTES).div_ceil(16) * 16
}

pub(super) fn transaction_frame_size(steps: &[SqliteTransactionStep]) -> usize {
    let parameters = steps
        .iter()
        .map(|step| step.parameters.len())
        .sum::<usize>();
    (HANDLER_SCRATCH_BASE + parameters * PARAMETER_BYTES + steps.len() * TRANSACTION_STEP_BYTES)
        .div_ceil(16)
        * 16
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
    emit_parameters_at(assembly, program, parameters, HANDLER_SCRATCH_BASE);
}

fn emit_parameters_at(
    assembly: &mut Emitter,
    program: &Program,
    parameters: &[SqliteParameter],
    base: usize,
) {
    for (index, parameter) in parameters.iter().enumerate() {
        let offset = base + index * PARAMETER_BYTES;
        match parameter {
            SqliteParameter::RouteParameter { segment } => {
                emit_immediate(assembly, "x9", 1);
                asm_line!(assembly, "    str x9, [sp, #{offset}]");
                emit_immediate(assembly, "x9", *segment as u64);
                asm_line!(assembly, "    str x9, [sp, #{}]", offset + 8);
                asm_line!(assembly, "    str xzr, [sp, #{}]", offset + 16);
            }
            SqliteParameter::QueryParameter {
                string,
                query_length,
                fallback_length,
            } => {
                emit_immediate(assembly, "x9", 10);
                asm_line!(assembly, "    str x9, [sp, #{offset}]");
                emit_immediate(
                    assembly,
                    "x9",
                    ((*fallback_length as u64) << 32) | *query_length as u64,
                );
                asm_line!(assembly, "    str x9, [sp, #{}]", offset + 8);
                assembly.address("x9", format_args!("Ltinytsx_string_{string}"));
                asm_line!(assembly, "    str x9, [sp, #{}]", offset + 16);
            }
            SqliteParameter::QueryInteger { query, fallback } => {
                emit_immediate(assembly, "x9", 11);
                asm_line!(assembly, "    str x9, [sp, #{offset}]");
                emit_immediate(
                    assembly,
                    "x9",
                    ((*fallback as u64) << 8) | program.static_strings[*query].value.len() as u64,
                );
                asm_line!(assembly, "    str x9, [sp, #{}]", offset + 8);
                assembly.address("x9", format_args!("Ltinytsx_string_{query}"));
                asm_line!(assembly, "    str x9, [sp, #{}]", offset + 16);
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
            SqliteParameter::RequestHeader { header } => {
                emit_immediate(assembly, "x9", 9);
                asm_line!(assembly, "    str x9, [sp, #{offset}]");
                emit_immediate(
                    assembly,
                    "x9",
                    program.static_strings[*header].value.len() as u64,
                );
                asm_line!(assembly, "    str x9, [sp, #{}]", offset + 8);
                assembly.address("x9", format_args!("Ltinytsx_string_{header}"));
                asm_line!(assembly, "    str x9, [sp, #{}]", offset + 16);
            }
            SqliteParameter::RandomUuid => {
                emit_immediate(assembly, "x9", 3);
                asm_line!(assembly, "    str x9, [sp, #{offset}]");
                asm_line!(assembly, "    str xzr, [sp, #{}]", offset + 8);
                asm_line!(assembly, "    str xzr, [sp, #{}]", offset + 16);
            }
            SqliteParameter::StaticString { string } => {
                emit_immediate(assembly, "x9", 4);
                asm_line!(assembly, "    str x9, [sp, #{offset}]");
                emit_immediate(
                    assembly,
                    "x9",
                    program.static_strings[*string].value.len() as u64,
                );
                asm_line!(assembly, "    str x9, [sp, #{}]", offset + 8);
                assembly.address("x9", format_args!("Ltinytsx_string_{string}"));
                asm_line!(assembly, "    str x9, [sp, #{}]", offset + 16);
            }
            SqliteParameter::StaticInteger { value } => {
                emit_immediate(assembly, "x9", 5);
                asm_line!(assembly, "    str x9, [sp, #{offset}]");
                emit_immediate(assembly, "x9", *value as u64);
                asm_line!(assembly, "    str x9, [sp, #{}]", offset + 8);
                asm_line!(assembly, "    str xzr, [sp, #{}]", offset + 16);
            }
            SqliteParameter::StaticReal { value } => {
                emit_immediate(assembly, "x9", 6);
                asm_line!(assembly, "    str x9, [sp, #{offset}]");
                emit_immediate(assembly, "x9", value.to_bits());
                asm_line!(assembly, "    str x9, [sp, #{}]", offset + 8);
                asm_line!(assembly, "    str xzr, [sp, #{}]", offset + 16);
            }
            SqliteParameter::StaticBoolean { value } => {
                emit_immediate(assembly, "x9", 7);
                asm_line!(assembly, "    str x9, [sp, #{offset}]");
                emit_immediate(assembly, "x9", u64::from(*value));
                asm_line!(assembly, "    str x9, [sp, #{}]", offset + 8);
                asm_line!(assembly, "    str xzr, [sp, #{}]", offset + 16);
            }
            SqliteParameter::Null => {
                emit_immediate(assembly, "x9", 8);
                asm_line!(assembly, "    str x9, [sp, #{offset}]");
                asm_line!(assembly, "    str xzr, [sp, #{}]", offset + 8);
                asm_line!(assembly, "    str xzr, [sp, #{}]", offset + 16);
            }
        }
    }
}

pub(super) fn emit_transaction_steps(
    assembly: &mut Emitter,
    program: &Program,
    steps: &[SqliteTransactionStep],
) {
    let parameter_count = steps
        .iter()
        .map(|step| step.parameters.len())
        .sum::<usize>();
    let steps_base = HANDLER_SCRATCH_BASE + parameter_count * PARAMETER_BYTES;
    let mut parameter_index = 0usize;
    for (index, step) in steps.iter().enumerate() {
        let parameter_base = HANDLER_SCRATCH_BASE + parameter_index * PARAMETER_BYTES;
        emit_parameters_at(assembly, program, &step.parameters, parameter_base);
        let step_offset = steps_base + index * TRANSACTION_STEP_BYTES;
        assembly.address("x9", format_args!("Ltinytsx_string_{}", step.sql));
        asm_line!(assembly, "    str x9, [sp, #{step_offset}]");
        emit_immediate(
            assembly,
            "x9",
            program.static_strings[step.sql].value.len() as u64,
        );
        asm_line!(assembly, "    str x9, [sp, #{}]", step_offset + 8);
        if step.parameters.is_empty() {
            asm_line!(assembly, "    str xzr, [sp, #{}]", step_offset + 16);
        } else {
            asm_line!(assembly, "    add x9, sp, #{parameter_base}");
            asm_line!(assembly, "    str x9, [sp, #{}]", step_offset + 16);
        }
        emit_immediate(assembly, "x9", step.parameters.len() as u64);
        asm_line!(assembly, "    str x9, [sp, #{}]", step_offset + 24);
        parameter_index += step.parameters.len();
    }
}

pub(super) fn address_parameters(assembly: &mut Emitter, register: &str) {
    asm_line!(assembly, "    add {register}, sp, #{HANDLER_SCRATCH_BASE}");
}

pub(super) fn address_transaction_steps(
    assembly: &mut Emitter,
    register: &str,
    steps: &[SqliteTransactionStep],
) {
    let parameter_count = steps
        .iter()
        .map(|step| step.parameters.len())
        .sum::<usize>();
    let offset = HANDLER_SCRATCH_BASE + parameter_count * PARAMETER_BYTES;
    asm_line!(assembly, "    add {register}, sp, #{offset}");
}
