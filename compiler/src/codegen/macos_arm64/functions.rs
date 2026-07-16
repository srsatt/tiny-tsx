use crate::hir::{HtmlOp, Program, ValueExpression};

use super::super::{
    aarch64::{
        emit_epilogue, emit_immediate, emit_prologue, preserve_request_context, value_frame_size,
    },
    assembly::{Assembly, asm_line},
};
use super::values::emit_value_expression;

pub(super) fn emit_function(
    assembly: &mut Assembly,
    symbol: &str,
    operations: &[HtmlOp],
    program: &Program,
) {
    asm_line!(assembly, "\n.private_extern {symbol}");
    asm_line!(assembly, "{symbol}:");
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
                asm_line!(assembly, "    adrp x1, Ltinytsx_string_{string}@PAGE");
                asm_line!(assembly, "    add x1, x1, Ltinytsx_string_{string}@PAGEOFF");
                emit_immediate(
                    assembly,
                    "x2",
                    program.static_strings[*string].value.len() as u64,
                );
                asm_line!(assembly, "    bl _tinytsx_html_write_static");
                asm_line!(assembly, "    cbnz w0, {return_label}");
            }
            HtmlOp::CallComponent { component, .. } => {
                asm_line!(assembly, "    ldr x0, [sp, #24]");
                asm_line!(assembly, "    ldr x1, [sp, #16]");
                asm_line!(assembly, "    bl _tinytsx_component_{component}");
                asm_line!(assembly, "    cbnz w0, {return_label}");
            }
        }
    }
    asm_line!(assembly, "    mov w0, #0");
    asm_line!(assembly, "{return_label}:");
    emit_epilogue(assembly, 32);
}

pub(super) fn emit_value_function(
    assembly: &mut Assembly,
    id: usize,
    body: &ValueExpression,
    program: &Program,
) -> Result<(), String> {
    let function = &program.functions[id];
    let scratch_base = 16 + function.parameters.len() * 16;
    let frame_size = value_frame_size(scratch_base, body)?;
    asm_line!(assembly, "\n.private_extern _tinytsx_function_{id}");
    asm_line!(assembly, "_tinytsx_function_{id}:");
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
    emit_value_expression(assembly, body, program, scratch_base)?;
    emit_epilogue(assembly, frame_size);
    Ok(())
}
