use crate::hir::{ConstantValue, Program, ValueExpression};

use super::super::{
    aarch64::{Emitter, emit_immediate},
    assembly::asm_line,
};

pub(super) fn emit_value_expression(
    assembly: &mut Emitter,
    expression: &ValueExpression,
    program: &Program,
    scratch_base: usize,
    label_scope: &str,
    conditional_index: &mut usize,
    caught_exception_offset: Option<usize>,
) -> Result<(), String> {
    match expression {
        ValueExpression::StringLiteral { string, .. } => {
            assembly.address("x0", format_args!("Ltinytsx_string_{string}"));
            emit_immediate(
                assembly,
                "x1",
                program.static_strings[*string].value.len() as u64,
            );
            asm_line!(assembly, "    mov x2, #0");
        }
        ValueExpression::Constant { constant, .. } => {
            let ConstantValue::String { value } = &program.constants[*constant].value else {
                return Err("string expression references a non-string constant".to_owned());
            };
            assembly.address("x0", format_args!("Ltinytsx_constant_{constant}"));
            asm_line!(assembly, "    add x0, x0, #5");
            emit_immediate(assembly, "x1", value.len() as u64);
            asm_line!(assembly, "    mov x2, #0");
        }
        ValueExpression::Parameter { parameter, .. } => {
            asm_line!(assembly, "    ldp x0, x1, [sp, #{}]", 16 + parameter * 16);
            asm_line!(assembly, "    mov x2, #0");
        }
        ValueExpression::DirectCall {
            function,
            arguments,
            ..
        } => {
            let call_index = *conditional_index;
            *conditional_index += 1;
            let end = format!("Ltinytsx_{label_scope}_call_{call_index}_end");
            let nested_scratch = scratch_base + arguments.len() * 16;
            for (index, argument) in arguments.iter().enumerate() {
                emit_value_expression(
                    assembly,
                    argument,
                    program,
                    nested_scratch,
                    label_scope,
                    conditional_index,
                    caught_exception_offset,
                )?;
                asm_line!(assembly, "    cbnz x2, {end}");
                asm_line!(
                    assembly,
                    "    stp x0, x1, [sp, #{}]",
                    scratch_base + index * 16
                );
            }
            for (index, (first, second)) in [("x0", "x1"), ("x2", "x3"), ("x4", "x5"), ("x6", "x7")]
                .into_iter()
                .take(arguments.len())
                .enumerate()
            {
                asm_line!(
                    assembly,
                    "    ldp {first}, {second}, [sp, #{}]",
                    scratch_base + index * 16
                );
            }
            assembly.call(format_args!("tinytsx_function_{function}"));
            asm_line!(assembly, "{end}:");
        }
        ValueExpression::StringEqualConditional {
            left,
            right,
            when_equal,
            when_not_equal,
            ..
        } => {
            let branch_index = *conditional_index;
            *conditional_index += 1;
            let not_equal = format!("Ltinytsx_{label_scope}_string_{branch_index}_not_equal");
            let end = format!("Ltinytsx_{label_scope}_string_{branch_index}_end");
            let nested_scratch = scratch_base + 32;
            emit_value_expression(
                assembly,
                left,
                program,
                nested_scratch,
                label_scope,
                conditional_index,
                caught_exception_offset,
            )?;
            asm_line!(assembly, "    cbnz x2, {end}");
            asm_line!(assembly, "    stp x0, x1, [sp, #{scratch_base}]");
            emit_value_expression(
                assembly,
                right,
                program,
                nested_scratch,
                label_scope,
                conditional_index,
                caught_exception_offset,
            )?;
            asm_line!(assembly, "    cbnz x2, {end}");
            asm_line!(assembly, "    mov x3, x1");
            asm_line!(assembly, "    mov x2, x0");
            asm_line!(assembly, "    ldp x0, x1, [sp, #{scratch_base}]");
            asm_line!(assembly, "    cmp x1, x3");
            asm_line!(assembly, "    b.ne {not_equal}");
            asm_line!(assembly, "    mov x1, x2");
            asm_line!(assembly, "    mov x2, x3");
            assembly.call(format_args!("memcmp"));
            asm_line!(assembly, "    cbnz w0, {not_equal}");
            emit_value_expression(
                assembly,
                when_equal,
                program,
                scratch_base,
                label_scope,
                conditional_index,
                caught_exception_offset,
            )?;
            asm_line!(assembly, "    b {end}");
            asm_line!(assembly, "{not_equal}:");
            emit_value_expression(
                assembly,
                when_not_equal,
                program,
                scratch_base,
                label_scope,
                conditional_index,
                caught_exception_offset,
            )?;
            asm_line!(assembly, "{end}:");
        }
        ValueExpression::ThrowValue { value, .. } => {
            emit_value_expression(
                assembly,
                value,
                program,
                scratch_base,
                label_scope,
                conditional_index,
                caught_exception_offset,
            )?;
            asm_line!(assembly, "    mov x2, #1");
        }
        ValueExpression::TryCatch {
            try_value,
            catch_value,
            ..
        } => {
            let catch_index = *conditional_index;
            *conditional_index += 1;
            let end = format!("Ltinytsx_{label_scope}_catch_{catch_index}_end");
            let nested_scratch = scratch_base + 16;
            emit_value_expression(
                assembly,
                try_value,
                program,
                nested_scratch,
                label_scope,
                conditional_index,
                caught_exception_offset,
            )?;
            asm_line!(assembly, "    cbz x2, {end}");
            asm_line!(assembly, "    stp x0, x1, [sp, #{scratch_base}]");
            emit_value_expression(
                assembly,
                catch_value,
                program,
                nested_scratch,
                label_scope,
                conditional_index,
                Some(scratch_base),
            )?;
            asm_line!(assembly, "{end}:");
        }
        ValueExpression::CaughtException { .. } => {
            let Some(offset) = caught_exception_offset else {
                return Err("caught exception value has no native catch slot".to_owned());
            };
            asm_line!(assembly, "    ldp x0, x1, [sp, #{offset}]");
            asm_line!(assembly, "    mov x2, #0");
        }
        ValueExpression::Concat { .. }
        | ValueExpression::RouteParameter { .. }
        | ValueExpression::RequestHeader { .. }
        | ValueExpression::EnvironmentVariable { .. }
        | ValueExpression::FileText { .. }
        | ValueExpression::ActorCall { .. }
        | ValueExpression::SqliteQuery { .. }
        | ValueExpression::FetchStatus { .. }
        | ValueExpression::QueryParameter { .. }
        | ValueExpression::QueryConditional { .. }
        | ValueExpression::WorkerCall { .. }
        | ValueExpression::OpenAiChatText { .. } => {
            return Err("request-time expression used outside a handler response".to_owned());
        }
    }
    Ok(())
}
