use crate::hir::{ActorOperation, HandlerResponse, Program, SqliteQueryMode, ValueExpression};

use super::super::{
    aarch64::{Emitter, HANDLER_SCRATCH_BASE, emit_immediate},
    assembly::asm_line,
};
use super::sqlite::{address_parameters, emit_parameters};
use super::values::emit_value_expression;

pub(super) fn emit_handler_response(
    assembly: &mut Emitter,
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
            assembly.call(format_args!("tinytsx_component_{component}"));
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
            assembly.call(format_args!("tinytsx_response_stream_begin"));
            asm_line!(assembly, "    cbnz w0, {return_label}");
            let mut conditional_index = 0;
            for chunk in chunks {
                if let ValueExpression::StringLiteral { string, .. } = chunk {
                    asm_line!(assembly, "    ldr x0, [sp, #16]");
                    assembly.address("x1", format_args!("Ltinytsx_string_{string}"));
                    emit_immediate(
                        assembly,
                        "x2",
                        program.static_strings[*string].value.len() as u64,
                    );
                    assembly.call(format_args!("tinytsx_response_stream_chunk_static"));
                    asm_line!(assembly, "    cbnz w0, {return_label}");
                    continue;
                }
                asm_line!(assembly, "    ldr x0, [sp, #16]");
                assembly.call(format_args!("tinytsx_response_stream_chunk_begin"));
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
                assembly.call(format_args!("tinytsx_response_stream_chunk_end"));
                asm_line!(assembly, "    cbnz w0, {return_label}");
            }
        }
    }
    Ok(())
}

fn emit_handler_text_expression(
    assembly: &mut Emitter,
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
        ValueExpression::RouteParameter { segment, tail, .. } => {
            asm_line!(assembly, "    ldr x0, [sp, #16]");
            asm_line!(assembly, "    ldr x1, [sp, #24]");
            emit_immediate(assembly, "x2", *segment as u64);
            if *tail {
                assembly.call(format_args!("tinytsx_html_write_path_tail"));
            } else {
                assembly.call(format_args!("tinytsx_html_write_path_segment"));
            }
        }
        ValueExpression::RequestHeader { header, .. } => {
            asm_line!(assembly, "    ldr x0, [sp, #16]");
            asm_line!(assembly, "    ldr x1, [sp, #24]");
            assembly.address("x2", format_args!("Ltinytsx_string_{header}"));
            emit_immediate(
                assembly,
                "x3",
                program.static_strings[*header].value.len() as u64,
            );
            assembly.call(format_args!("tinytsx_html_write_request_header"));
        }
        ValueExpression::RequestCookie {
            cookie, fallback, ..
        } => {
            asm_line!(assembly, "    ldr x0, [sp, #16]");
            asm_line!(assembly, "    ldr x1, [sp, #24]");
            assembly.address("x2", format_args!("Ltinytsx_string_{cookie}"));
            emit_immediate(
                assembly,
                "x3",
                program.static_strings[*cookie].value.len() as u64,
            );
            if let Some(fallback) = fallback {
                assembly.address("x4", format_args!("Ltinytsx_string_{fallback}"));
                emit_immediate(
                    assembly,
                    "x5",
                    program.static_strings[*fallback].value.len() as u64,
                );
            } else {
                asm_line!(assembly, "    mov x4, #0");
                asm_line!(assembly, "    mov x5, #0");
            }
            assembly.call(format_args!("tinytsx_html_write_request_cookie"));
        }
        ValueExpression::EnvironmentVariable {
            name,
            required,
            fallback,
            ..
        } => {
            asm_line!(assembly, "    ldr x0, [sp, #16]");
            assembly.address("x1", format_args!("Ltinytsx_string_{name}"));
            emit_immediate(
                assembly,
                "x2",
                program.static_strings[*name].value.len() as u64,
            );
            if let Some(fallback) = fallback {
                assembly.address("x3", format_args!("Ltinytsx_string_{fallback}"));
                emit_immediate(
                    assembly,
                    "x4",
                    program.static_strings[*fallback].value.len() as u64,
                );
            } else {
                asm_line!(assembly, "    mov x3, #0");
                asm_line!(assembly, "    mov x4, #0");
            }
            emit_immediate(assembly, "x5", u64::from(*required));
            assembly.call(format_args!("tinytsx_html_write_environment_variable"));
        }
        ValueExpression::FileText {
            path, max_bytes, ..
        } => {
            asm_line!(assembly, "    ldr x0, [sp, #16]");
            assembly.address("x1", format_args!("Ltinytsx_string_{path}"));
            emit_immediate(
                assembly,
                "x2",
                program.static_strings[*path].value.len() as u64,
            );
            emit_immediate(assembly, "x3", *max_bytes as u64);
            assembly.call(format_args!("tinytsx_html_write_file_text"));
        }
        ValueExpression::ActorCall {
            actor,
            message,
            json_message,
            timeout_ms,
            ..
        } => {
            asm_line!(assembly, "    ldr x0, [sp, #16]");
            emit_immediate(assembly, "x1", *actor as u64);
            match program.actors[*actor].operation {
                ActorOperation::Counter => {
                    emit_immediate(
                        assembly,
                        "x2",
                        message.expect("validated counter message") as u64,
                    );
                    emit_immediate(assembly, "x3", timeout_ms.unwrap_or(0));
                    assembly.call(format_args!("tinytsx_actor_ask_counter"));
                }
                ActorOperation::JsonMailbox => {
                    let message = json_message.expect("validated JSON message");
                    assembly.address("x2", format_args!("Ltinytsx_string_{message}"));
                    emit_immediate(
                        assembly,
                        "x3",
                        program.static_strings[message].value.len() as u64,
                    );
                    emit_immediate(assembly, "x4", timeout_ms.unwrap_or(0));
                    assembly.call(format_args!("tinytsx_actor_ask_json"));
                }
            }
        }
        ValueExpression::SqliteQuery {
            database,
            sql,
            mode,
            parameters,
            ..
        } => {
            if parameters.is_empty() {
                asm_line!(assembly, "    ldr x0, [sp, #16]");
                emit_immediate(assembly, "x1", *database as u64);
                assembly.address("x2", format_args!("Ltinytsx_string_{sql}"));
                emit_immediate(
                    assembly,
                    "x3",
                    program.static_strings[*sql].value.len() as u64,
                );
                emit_immediate(
                    assembly,
                    "x4",
                    u64::from(matches!(mode, SqliteQueryMode::First)),
                );
                assembly.call(format_args!("tinytsx_sqlite_query_json"));
            } else {
                emit_parameters(assembly, program, parameters);
                asm_line!(assembly, "    ldr x0, [sp, #16]");
                asm_line!(assembly, "    ldr x1, [sp, #24]");
                emit_immediate(assembly, "x2", *database as u64);
                assembly.address("x3", format_args!("Ltinytsx_string_{sql}"));
                emit_immediate(
                    assembly,
                    "x4",
                    program.static_strings[*sql].value.len() as u64,
                );
                emit_immediate(
                    assembly,
                    "x5",
                    u64::from(matches!(mode, SqliteQueryMode::First)),
                );
                address_parameters(assembly, "x6");
                emit_immediate(assembly, "x7", parameters.len() as u64);
                assembly.call(format_args!("tinytsx_sqlite_query_json_params"));
            }
        }
        ValueExpression::FetchStatus { url, .. } => {
            asm_line!(assembly, "    ldr x0, [sp, #16]");
            assembly.address("x1", format_args!("Ltinytsx_string_{url}"));
            emit_immediate(
                assembly,
                "x2",
                program.static_strings[*url].value.len() as u64,
            );
            assembly.call(format_args!("tinytsx_html_write_fetch_status"));
        }
        ValueExpression::QueryParameter {
            query,
            fallback,
            escape_html,
            ..
        } => {
            asm_line!(assembly, "    ldr x0, [sp, #16]");
            asm_line!(assembly, "    ldr x1, [sp, #24]");
            assembly.address("x2", format_args!("Ltinytsx_string_{query}"));
            emit_immediate(
                assembly,
                "x3",
                program.static_strings[*query].value.len() as u64,
            );
            if let Some(fallback) = fallback {
                assembly.address("x4", format_args!("Ltinytsx_string_{fallback}"));
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
            assembly.call(format_args!("tinytsx_html_write_query_parameter"));
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
            assembly.address("x1", format_args!("Ltinytsx_string_{query}"));
            emit_immediate(
                assembly,
                "x2",
                program.static_strings[*query].value.len() as u64,
            );
            assembly.call(format_args!("tinytsx_request_query_has"));
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
                assembly.address("x2", format_args!("Ltinytsx_string_{string}"));
                emit_immediate(
                    assembly,
                    "x3",
                    program.static_strings[*string].value.len() as u64,
                );
                assembly.call(format_args!("tinytsx_worker_call_static"));
            }
            ValueExpression::QueryParameter {
                query, fallback, ..
            } => {
                asm_line!(assembly, "    ldr x0, [sp, #16]");
                asm_line!(assembly, "    ldr x1, [sp, #24]");
                emit_immediate(assembly, "x2", *worker as u64);
                assembly.address("x3", format_args!("Ltinytsx_string_{query}"));
                emit_immediate(
                    assembly,
                    "x4",
                    program.static_strings[*query].value.len() as u64,
                );
                if let Some(fallback) = fallback {
                    assembly.address("x5", format_args!("Ltinytsx_string_{fallback}"));
                    emit_immediate(
                        assembly,
                        "x6",
                        program.static_strings[*fallback].value.len() as u64,
                    );
                } else {
                    asm_line!(assembly, "    mov x5, #0");
                    asm_line!(assembly, "    mov x6, #0");
                }
                assembly.call(format_args!("tinytsx_worker_call_query"));
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
            assembly.address("x1", format_args!("Ltinytsx_string_{url}"));
            emit_immediate(
                assembly,
                "x2",
                program.static_strings[*url].value.len() as u64,
            );
            assembly.address("x3", format_args!("Ltinytsx_string_{authorization}"));
            emit_immediate(
                assembly,
                "x4",
                program.static_strings[*authorization].value.len() as u64,
            );
            assembly.address("x5", format_args!("Ltinytsx_string_{body}"));
            emit_immediate(
                assembly,
                "x6",
                program.static_strings[*body].value.len() as u64,
            );
            assembly.call(format_args!("tinytsx_html_write_openai_chat_text"));
        }
        _ => {
            emit_value_expression(
                assembly,
                expression,
                program,
                HANDLER_SCRATCH_BASE,
                &format!("handler_{handler_index}"),
                conditional_index,
                None,
            )?;
            asm_line!(assembly, "    mov x2, x1");
            asm_line!(assembly, "    mov x1, x0");
            asm_line!(assembly, "    ldr x0, [sp, #16]");
            assembly.call(format_args!("tinytsx_html_write_static"));
        }
    }
    Ok(())
}

fn emit_response_begin(assembly: &mut Emitter, status: u16, content_type: u16, return_label: &str) {
    asm_line!(assembly, "    ldr x0, [sp, #16]");
    emit_immediate(assembly, "x1", u64::from(status));
    emit_immediate(assembly, "x2", u64::from(content_type));
    assembly.call(format_args!("tinytsx_response_begin"));
    asm_line!(assembly, "    cbnz w0, {return_label}");
}
