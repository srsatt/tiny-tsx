use crate::hir::{HandlerResponse, Program, ValueExpression};

use super::super::{
    aarch64::{HANDLER_SCRATCH_BASE, emit_immediate},
    assembly::{Assembly, asm_line},
};
use super::values::emit_value_expression;

pub(super) fn emit_handler_response(
    assembly: &mut Assembly,
    response: &HandlerResponse,
    program: &Program,
    return_label: &str,
    handler_index: usize,
) -> Result<(), String> {
    match response {
        HandlerResponse::Html { component } => {
            emit_response_begin(assembly, 200, 1, return_label);
            asm_line!(assembly, "    ldr x0, [sp, #24]");
            asm_line!(assembly, "    ldr x1, [sp, #16]");
            asm_line!(assembly, "    bl _tinytsx_component_{component}");
        }
        HandlerResponse::Text {
            value,
            status,
            content_type,
        } => {
            let content_type_id = match content_type.as_deref() {
                Some("") => 0,
                Some("text/html; charset=UTF-8") => 1,
                Some("text/plain;charset=UTF-8") => 4,
                Some("text/plain; charset=utf-8") => 5,
                Some("application/json") => 3,
                _ => 2,
            };
            emit_response_begin(assembly, *status, content_type_id, return_label);
            let mut conditional_index = 0;
            emit_handler_text_expression(
                assembly,
                value,
                program,
                return_label,
                handler_index,
                &mut conditional_index,
            )?;
        }
        HandlerResponse::Stream {
            chunks,
            status,
            content_type,
        } => {
            let content_type_id = match content_type.as_deref() {
                Some("") => 0,
                Some("text/html; charset=UTF-8") => 1,
                Some("text/plain;charset=UTF-8") => 4,
                Some("text/plain; charset=utf-8") => 5,
                Some("application/json") => 3,
                _ => 2,
            };
            emit_response_begin(assembly, *status, content_type_id, return_label);
            asm_line!(assembly, "    ldr x0, [sp, #16]");
            asm_line!(assembly, "    bl _tinytsx_response_stream_begin");
            asm_line!(assembly, "    cbnz w0, {return_label}");
            let mut conditional_index = 0;
            for chunk in chunks {
                if let ValueExpression::StringLiteral { string, .. } = chunk {
                    asm_line!(assembly, "    ldr x0, [sp, #16]");
                    asm_line!(assembly, "    adrp x1, Ltinytsx_string_{string}@PAGE");
                    asm_line!(assembly, "    add x1, x1, Ltinytsx_string_{string}@PAGEOFF");
                    emit_immediate(
                        assembly,
                        "x2",
                        program.static_strings[*string].value.len() as u64,
                    );
                    asm_line!(assembly, "    bl _tinytsx_response_stream_chunk_static");
                    asm_line!(assembly, "    cbnz w0, {return_label}");
                    continue;
                }
                asm_line!(assembly, "    ldr x0, [sp, #16]");
                asm_line!(assembly, "    bl _tinytsx_response_stream_chunk_begin");
                asm_line!(assembly, "    cbnz w0, {return_label}");
                emit_handler_text_expression(
                    assembly,
                    chunk,
                    program,
                    return_label,
                    handler_index,
                    &mut conditional_index,
                )?;
                asm_line!(assembly, "    cbnz w0, {return_label}");
                asm_line!(assembly, "    ldr x0, [sp, #16]");
                asm_line!(assembly, "    bl _tinytsx_response_stream_chunk_end");
                asm_line!(assembly, "    cbnz w0, {return_label}");
            }
        }
    }
    Ok(())
}

fn emit_handler_text_expression(
    assembly: &mut Assembly,
    expression: &ValueExpression,
    program: &Program,
    return_label: &str,
    handler_index: usize,
    conditional_index: &mut usize,
) -> Result<(), String> {
    match expression {
        ValueExpression::Concat { values, .. } => {
            for value in values {
                emit_handler_text_expression(
                    assembly,
                    value,
                    program,
                    return_label,
                    handler_index,
                    conditional_index,
                )?;
                asm_line!(assembly, "    cbnz w0, {return_label}");
            }
        }
        ValueExpression::RouteParameter { segment, .. } => {
            asm_line!(assembly, "    ldr x0, [sp, #16]");
            asm_line!(assembly, "    ldr x1, [sp, #24]");
            emit_immediate(assembly, "x2", *segment as u64);
            asm_line!(assembly, "    bl _tinytsx_html_write_path_segment");
        }
        ValueExpression::RequestHeader { header, .. } => {
            asm_line!(assembly, "    ldr x0, [sp, #16]");
            asm_line!(assembly, "    ldr x1, [sp, #24]");
            asm_line!(assembly, "    adrp x2, Ltinytsx_string_{header}@PAGE");
            asm_line!(assembly, "    add x2, x2, Ltinytsx_string_{header}@PAGEOFF");
            emit_immediate(
                assembly,
                "x3",
                program.static_strings[*header].value.len() as u64,
            );
            asm_line!(assembly, "    bl _tinytsx_html_write_request_header");
        }
        ValueExpression::FetchStatus { url, .. } => {
            asm_line!(assembly, "    ldr x0, [sp, #16]");
            asm_line!(assembly, "    adrp x1, Ltinytsx_string_{url}@PAGE");
            asm_line!(assembly, "    add x1, x1, Ltinytsx_string_{url}@PAGEOFF");
            emit_immediate(
                assembly,
                "x2",
                program.static_strings[*url].value.len() as u64,
            );
            asm_line!(assembly, "    bl _tinytsx_html_write_fetch_status");
        }
        ValueExpression::QueryParameter {
            query,
            fallback,
            escape_html,
            ..
        } => {
            asm_line!(assembly, "    ldr x0, [sp, #16]");
            asm_line!(assembly, "    ldr x1, [sp, #24]");
            asm_line!(assembly, "    adrp x2, Ltinytsx_string_{query}@PAGE");
            asm_line!(assembly, "    add x2, x2, Ltinytsx_string_{query}@PAGEOFF");
            emit_immediate(
                assembly,
                "x3",
                program.static_strings[*query].value.len() as u64,
            );
            if let Some(fallback) = fallback {
                asm_line!(assembly, "    adrp x4, Ltinytsx_string_{fallback}@PAGE");
                asm_line!(
                    assembly,
                    "    add x4, x4, Ltinytsx_string_{fallback}@PAGEOFF"
                );
                emit_immediate(
                    assembly,
                    "x5",
                    program.static_strings[*fallback].value.len() as u64,
                );
            } else {
                asm_line!(assembly, "    mov x4, #0");
                asm_line!(assembly, "    mov x5, #0");
            }
            emit_immediate(assembly, "x6", u64::from(*escape_html));
            asm_line!(assembly, "    bl _tinytsx_html_write_query_parameter");
        }
        ValueExpression::QueryConditional {
            query,
            when_present,
            when_absent,
            ..
        } => {
            let branch_index = *conditional_index;
            *conditional_index += 1;
            let absent_label =
                format!("Ltinytsx_handler_{handler_index}_query_{branch_index}_absent");
            let end_label = format!("Ltinytsx_handler_{handler_index}_query_{branch_index}_end");
            asm_line!(assembly, "    ldr x0, [sp, #24]");
            asm_line!(assembly, "    adrp x1, Ltinytsx_string_{query}@PAGE");
            asm_line!(assembly, "    add x1, x1, Ltinytsx_string_{query}@PAGEOFF");
            emit_immediate(
                assembly,
                "x2",
                program.static_strings[*query].value.len() as u64,
            );
            asm_line!(assembly, "    bl _tinytsx_request_query_has");
            asm_line!(assembly, "    cbz w0, {absent_label}");
            emit_handler_text_expression(
                assembly,
                when_present,
                program,
                return_label,
                handler_index,
                conditional_index,
            )?;
            asm_line!(assembly, "    cbnz w0, {return_label}");
            asm_line!(assembly, "    b {end_label}");
            asm_line!(assembly, "{absent_label}:");
            emit_handler_text_expression(
                assembly,
                when_absent,
                program,
                return_label,
                handler_index,
                conditional_index,
            )?;
            asm_line!(assembly, "{end_label}:");
        }
        ValueExpression::WorkerCall { worker, input, .. } => match input.as_ref() {
            ValueExpression::StringLiteral { string, .. } => {
                asm_line!(assembly, "    ldr x0, [sp, #16]");
                emit_immediate(assembly, "x1", *worker as u64);
                asm_line!(assembly, "    adrp x2, Ltinytsx_string_{string}@PAGE");
                asm_line!(assembly, "    add x2, x2, Ltinytsx_string_{string}@PAGEOFF");
                emit_immediate(
                    assembly,
                    "x3",
                    program.static_strings[*string].value.len() as u64,
                );
                asm_line!(assembly, "    bl _tinytsx_worker_call_static");
            }
            ValueExpression::QueryParameter {
                query, fallback, ..
            } => {
                asm_line!(assembly, "    ldr x0, [sp, #16]");
                asm_line!(assembly, "    ldr x1, [sp, #24]");
                emit_immediate(assembly, "x2", *worker as u64);
                asm_line!(assembly, "    adrp x3, Ltinytsx_string_{query}@PAGE");
                asm_line!(assembly, "    add x3, x3, Ltinytsx_string_{query}@PAGEOFF");
                emit_immediate(
                    assembly,
                    "x4",
                    program.static_strings[*query].value.len() as u64,
                );
                if let Some(fallback) = fallback {
                    asm_line!(assembly, "    adrp x5, Ltinytsx_string_{fallback}@PAGE");
                    asm_line!(
                        assembly,
                        "    add x5, x5, Ltinytsx_string_{fallback}@PAGEOFF"
                    );
                    emit_immediate(
                        assembly,
                        "x6",
                        program.static_strings[*fallback].value.len() as u64,
                    );
                } else {
                    asm_line!(assembly, "    mov x5, #0");
                    asm_line!(assembly, "    mov x6, #0");
                }
                asm_line!(assembly, "    bl _tinytsx_worker_call_query");
            }
            _ => return Err("unsupported worker call input".to_owned()),
        },
        ValueExpression::OpenAiChatText {
            url,
            authorization,
            body,
            ..
        } => {
            asm_line!(assembly, "    ldr x0, [sp, #16]");
            asm_line!(assembly, "    adrp x1, Ltinytsx_string_{url}@PAGE");
            asm_line!(assembly, "    add x1, x1, Ltinytsx_string_{url}@PAGEOFF");
            emit_immediate(
                assembly,
                "x2",
                program.static_strings[*url].value.len() as u64,
            );
            asm_line!(
                assembly,
                "    adrp x3, Ltinytsx_string_{authorization}@PAGE"
            );
            asm_line!(
                assembly,
                "    add x3, x3, Ltinytsx_string_{authorization}@PAGEOFF"
            );
            emit_immediate(
                assembly,
                "x4",
                program.static_strings[*authorization].value.len() as u64,
            );
            asm_line!(assembly, "    adrp x5, Ltinytsx_string_{body}@PAGE");
            asm_line!(assembly, "    add x5, x5, Ltinytsx_string_{body}@PAGEOFF");
            emit_immediate(
                assembly,
                "x6",
                program.static_strings[*body].value.len() as u64,
            );
            asm_line!(assembly, "    bl _tinytsx_html_write_openai_chat_text");
        }
        _ => {
            emit_value_expression(assembly, expression, program, HANDLER_SCRATCH_BASE)?;
            asm_line!(assembly, "    mov x2, x1");
            asm_line!(assembly, "    mov x1, x0");
            asm_line!(assembly, "    ldr x0, [sp, #16]");
            asm_line!(assembly, "    bl _tinytsx_html_write_static");
        }
    }
    Ok(())
}

fn emit_response_begin(
    assembly: &mut Assembly,
    status: u16,
    content_type: u16,
    return_label: &str,
) {
    asm_line!(assembly, "    ldr x0, [sp, #16]");
    emit_immediate(assembly, "x1", u64::from(status));
    emit_immediate(assembly, "x2", u64::from(content_type));
    asm_line!(assembly, "    bl _tinytsx_response_begin");
    asm_line!(assembly, "    cbnz w0, {return_label}");
}
