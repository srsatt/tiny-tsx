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
) -> Result<(), String> {
    match expression {
        ValueExpression::StringLiteral { string, .. } => {
            assembly.address("x0", format_args!("Ltinytsx_string_{string}"));
            emit_immediate(
                assembly,
                "x1",
                program.static_strings[*string].value.len() as u64,
            );
        }
        ValueExpression::Constant { constant, .. } => {
            let ConstantValue::String { value } = &program.constants[*constant].value else {
                return Err("string expression references a non-string constant".to_owned());
            };
            assembly.address("x0", format_args!("Ltinytsx_constant_{constant}"));
            asm_line!(assembly, "    add x0, x0, #5");
            emit_immediate(assembly, "x1", value.len() as u64);
        }
        ValueExpression::Parameter { parameter, .. } => {
            asm_line!(assembly, "    ldp x0, x1, [sp, #{}]", 16 + parameter * 16);
        }
        ValueExpression::DirectCall {
            function,
            arguments,
            ..
        } => {
            let nested_scratch = scratch_base + arguments.len() * 16;
            for (index, argument) in arguments.iter().enumerate() {
                emit_value_expression(assembly, argument, program, nested_scratch)?;
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
        }
        ValueExpression::Concat { .. }
        | ValueExpression::RouteParameter { .. }
        | ValueExpression::RequestHeader { .. }
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
