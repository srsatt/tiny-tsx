use crate::hir::{HtmlOp, Program, ValueExpression};

use super::super::{
    aarch64::{
        Emitter, emit_epilogue, emit_immediate, emit_prologue, preserve_request_context,
        value_frame_size,
    },
    assembly::asm_line,
};
use super::values::emit_value_expression;

pub(super) fn emit_function(
    assembly: &mut Emitter,
    symbol: &str,
    operations: &[HtmlOp],
    program: &Program,
) {
    let symbol = assembly.private_function(format_args!("{symbol}"));
    emit_prologue(assembly, 32);
    preserve_request_context(assembly);
    let return_label = format!("L{}_return", symbol.trim_start_matches('_'));

    if operations.is_empty() {
        asm_line!(assembly, "    mov w0, #0");
    }
    for operation in operations {
        match operation {
            HtmlOp::WriteStatic { string, .. } => {
                asm_line!(assembly, "    ldr x0, [sp, #16]");
                assembly.address("x1", format_args!("Ltinytsx_string_{string}"));
                emit_immediate(
                    assembly,
                    "x2",
                    program.static_strings[*string].value.len() as u64,
                );
                assembly.call(format_args!("tinytsx_html_write_static"));
                asm_line!(assembly, "    cbnz w0, {return_label}");
            }
            HtmlOp::CallComponent { component, .. } => {
                asm_line!(assembly, "    ldr x0, [sp, #24]");
                asm_line!(assembly, "    ldr x1, [sp, #16]");
                assembly.call(format_args!("tinytsx_component_{component}"));
                asm_line!(assembly, "    cbnz w0, {return_label}");
            }
        }
    }
    asm_line!(assembly, "    mov w0, #0");
    asm_line!(assembly, "{return_label}:");
    emit_epilogue(assembly, 32);
}

pub(super) fn emit_value_function(
    assembly: &mut Emitter,
    id: usize,
    body: &ValueExpression,
    program: &Program,
) -> Result<(), String> {
    let function = &program.functions[id];
    let scratch_base = 16 + function.parameters.len() * 16;
    let frame_size = value_frame_size(scratch_base, body)?;
    assembly.private_function(format_args!("tinytsx_function_{id}"));
    emit_prologue(assembly, frame_size);
    for (index, (first, second)) in [("x0", "x1"), ("x2", "x3"), ("x4", "x5"), ("x6", "x7")]
        .into_iter()
        .take(function.parameters.len())
        .enumerate()
    {
        asm_line!(
            assembly,
            "    stp {}, {}, [sp, #{}]",
            first,
            second,
            16 + index * 16
        );
    }
    let mut conditional_index = 0;
    emit_value_expression(
        assembly,
        body,
        program,
        scratch_base,
        &format!("function_{id}"),
        &mut conditional_index,
        None,
    )?;
    emit_epilogue(assembly, frame_size);
    Ok(())
}
