use std::fmt::Write;

use crate::hir::{HandlerResponse, HtmlOp, Program, ValueExpression};

use super::Options;

pub(super) fn emit(program: &Program, options: &Options) -> Result<String, String> {
    program.validate()?;
    let mut source = String::from(
        "typedef unsigned char tiny_u8;\n\
         typedef unsigned short tiny_u16;\n\
         typedef unsigned int tiny_u32;\n\
         typedef unsigned long long tiny_u64;\n\
         typedef long long tiny_i64;\n\
         typedef __SIZE_TYPE__ tiny_usize;\n\
         extern tiny_u32 tinytsx_request_method_equals(const void *, const tiny_u8 *, tiny_usize);\n\
         extern tiny_u32 tinytsx_request_path_matches(const void *, const tiny_u8 *, tiny_usize);\n\
         extern tiny_u32 tinytsx_response_begin(void *, tiny_u16, tiny_u16);\n\
         extern tiny_u32 tinytsx_response_stream_begin(void *);\n\
         extern tiny_u32 tinytsx_response_stream_chunk_static(void *, const tiny_u8 *, tiny_usize);\n\
         extern tiny_u32 tinytsx_response_stream_chunk_begin(void *);\n\
         extern tiny_u32 tinytsx_response_stream_chunk_end(void *);\n\
         extern tiny_u32 tinytsx_html_write_static(void *, const tiny_u8 *, tiny_usize);\n\
         extern tiny_u32 tinytsx_html_write_path_segment(void *, const void *, tiny_usize);\n\
         extern tiny_u32 tinytsx_html_write_path_tail(void *, const void *, tiny_usize);\n\
         extern tiny_u32 tinytsx_html_write_request_header(void *, const void *, const tiny_u8 *, tiny_usize);\n\
         extern tiny_u32 tinytsx_html_write_request_json_field(void *, const void *, const tiny_u8 *, tiny_usize);\n\
         extern tiny_u32 tinytsx_html_write_response_header(void *, const tiny_u8 *, tiny_usize);\n\
         extern tiny_u32 tinytsx_html_write_request_cookie(void *, const void *, const tiny_u8 *, tiny_usize, const tiny_u8 *, tiny_usize);\n\
         extern tiny_u32 tinytsx_html_write_environment_variable(void *, const tiny_u8 *, tiny_usize, const tiny_u8 *, tiny_usize, tiny_u32);\n\
         extern tiny_u32 tinytsx_html_write_file_text(void *, const tiny_u8 *, tiny_usize, tiny_usize);\n\
         extern tiny_u32 tinytsx_html_write_fetch_status(void *, const tiny_u8 *, tiny_usize);\n\
         extern tiny_u32 tinytsx_html_write_query_parameter(void *, const void *, const tiny_u8 *, tiny_usize, const tiny_u8 *, tiny_usize, tiny_u32);\n\
         extern tiny_u32 tinytsx_request_query_has(const void *, const tiny_u8 *, tiny_usize);\n\
         extern tiny_u32 tinytsx_html_write_openai_chat_text(void *, const tiny_u8 *, tiny_usize, const tiny_u8 *, tiny_usize, const tiny_u8 *, tiny_usize);\n",
    );
    source.push_str(
        "extern tiny_usize tinytsx_request_body_length(const void *);\n\
         extern tiny_u32 tinytsx_response_header_static(void *, const tiny_u8 *, tiny_usize, const tiny_u8 *, tiny_usize);\n\
         extern tiny_u32 tinytsx_response_header_request_id(void *, const void *, const tiny_u8 *, tiny_usize, tiny_usize);\n",
    );

    emit_data(&mut source, program);
    emit_config(&mut source, program, options);
    emit_components(&mut source, program);
    emit_handler(&mut source, program)?;
    Ok(source)
}

fn emit_components(source: &mut String, program: &Program) {
    for component in &program.components {
        writeln!(
            source,
            "static tiny_u32 tinytsx_component_{}(const void *request, void *writer);",
            component.id,
        )
        .unwrap();
    }
    for component in &program.components {
        writeln!(
            source,
            "static tiny_u32 tinytsx_component_{}(const void *request, void *writer) {{",
            component.id,
        )
        .unwrap();
        source.push_str("  tiny_u32 status = 0;\n");
        for operation in &component.html {
            match operation {
                HtmlOp::WriteStatic { string, .. } => {
                    writeln!(
                        source,
                        "  status = tinytsx_html_write_static(writer, tinytsx_string_{string}, {});",
                        program.static_strings[*string].value.len(),
                    )
                    .unwrap();
                }
                HtmlOp::CallComponent { component, .. } => {
                    writeln!(
                        source,
                        "  status = tinytsx_component_{component}(request, writer);",
                    )
                    .unwrap();
                }
            }
            source.push_str("  if (status != 0) return status;\n");
        }
        source.push_str("  (void)request;\n  return status;\n}\n");
    }
}

fn emit_data(source: &mut String, program: &Program) {
    for string in &program.static_strings {
        emit_bytes(
            source,
            &format!("tinytsx_string_{}", string.id),
            string.value.as_bytes(),
        );
    }
    for (index, handler) in program.handlers.iter().enumerate() {
        emit_bytes(
            source,
            &format!("tinytsx_method_{index}"),
            handler.method.as_bytes(),
        );
        emit_bytes(
            source,
            &format!("tinytsx_path_{index}"),
            handler.path.as_bytes(),
        );
        for (header_index, header) in handler.headers.iter().enumerate() {
            emit_bytes(
                source,
                &format!("tinytsx_handler_{index}_header_{header_index}_name"),
                header.name.as_bytes(),
            );
            emit_bytes(
                source,
                &format!("tinytsx_handler_{index}_header_{header_index}_value"),
                header.value.as_bytes(),
            );
        }
    }
}

fn emit_config(source: &mut String, program: &Program, options: &Options) {
    writeln!(
        source,
        "tiny_u16 tinytsx_config_port(void) {{ return {}; }}",
        options.port
    )
    .unwrap();
    writeln!(
        source,
        "tiny_usize tinytsx_config_workers(void) {{ return {}; }}",
        options.workers
    )
    .unwrap();
    writeln!(
        source,
        "tiny_usize tinytsx_config_request_memory(void) {{ return {}; }}",
        options.request_memory
    )
    .unwrap();
    writeln!(
        source,
        "tiny_usize tinytsx_config_worker_modules(void) {{ return {}; }}",
        program.workers.len()
    )
    .unwrap();
    writeln!(
        source,
        "tiny_usize tinytsx_config_provider_transport(void) {{ return {}; }}",
        usize::from(program.uses_openai_transport())
    )
    .unwrap();
    source.push_str(
        "tiny_usize tinytsx_config_environment_variables(void) { return 0; }\n\
         tiny_u32 tinytsx_config_environment_variable(tiny_usize index, const tiny_u8 **pointer, tiny_usize *length) { (void)index; (void)pointer; (void)length; return 4; }\n\
         tiny_usize tinytsx_config_read_roots(void) { return 0; }\n\
         tiny_u32 tinytsx_config_read_root(tiny_usize index, const tiny_u8 **pointer, tiny_usize *length) { (void)index; (void)pointer; (void)length; return 4; }\n",
    );
    writeln!(
        source,
        "tiny_usize tinytsx_config_actors(void) {{ return {}; }}",
        program.actors.len()
    )
    .unwrap();
    writeln!(
        source,
        "tiny_usize tinytsx_config_supervisors(void) {{ return {}; }}",
        program.supervisors.len()
    )
    .unwrap();
    writeln!(
        source,
        "tiny_usize tinytsx_config_sqlite_databases(void) {{ return {}; }}",
        program.sqlite_databases.len()
    )
    .unwrap();
    source.push_str(
        "tiny_usize tinytsx_supervisor_restart_max(tiny_usize value) { (void)value; return 0; }\n\
         tiny_u64 tinytsx_supervisor_restart_within_ms(tiny_usize value) { (void)value; return 0; }\n\
         tiny_u32 tinytsx_config_sqlite_database_path(tiny_usize index, const tiny_u8 **pointer, tiny_usize *length) { (void)index; (void)pointer; (void)length; return 4; }\n\
         tiny_u32 tinytsx_actor_operation(tiny_usize actor) { (void)actor; return 0; }\n\
         tiny_i64 tinytsx_actor_initial_state(tiny_usize actor) { (void)actor; return 0; }\n\
         tiny_i64 tinytsx_actor_failure_message(tiny_usize actor) { (void)actor; return 0; }\n\
         tiny_usize tinytsx_actor_restart_max(tiny_usize actor) { (void)actor; return 0; }\n\
         tiny_u64 tinytsx_actor_restart_within_ms(tiny_usize actor) { (void)actor; return 0; }\n\
         tiny_usize tinytsx_actor_supervisor(tiny_usize actor) { (void)actor; return 0; }\n\
         tiny_u32 tinytsx_actor_initial_json(tiny_usize actor, const tiny_u8 **pointer, tiny_usize *length) { (void)actor; (void)pointer; (void)length; return 4; }\n\
         tiny_usize tinytsx_actor_mailbox_capacity(tiny_usize actor) { (void)actor; return 0; }\n\
         tiny_usize tinytsx_actor_persistence_database(tiny_usize actor) { (void)actor; return 0; }\n\
         tiny_u32 tinytsx_actor_persistence_key(tiny_usize actor, const tiny_u8 **pointer, tiny_usize *length) { (void)actor; (void)pointer; (void)length; return 4; }\n\
         tiny_u32 tinytsx_worker_operation(tiny_usize worker) { (void)worker; return 0; }\n",
    );
}

fn emit_handler(source: &mut String, program: &Program) -> Result<(), String> {
    source.push_str("tiny_u32 tinytsx_handle_get(const void *request, void *writer) {\n");
    for (index, handler) in program.handlers.iter().enumerate() {
        writeln!(
            source,
            "  if (tinytsx_request_method_equals(request, tinytsx_method_{index}, {}) && tinytsx_request_path_matches(request, tinytsx_path_{index}, {})) {{",
            handler.method.len(),
            handler.path.len(),
        )
        .unwrap();
        if let Some(limit) = &handler.body_limit {
            writeln!(
                source,
                "    if (tinytsx_request_body_length(request) > {}) {{",
                limit.max_bytes
            )
            .unwrap();
            emit_response(source, &limit.rejected.response, program, "      ")?;
            source.push_str("    }\n");
        }
        if let Some(request_id) = &handler.request_id {
            writeln!(
                source,
                "    tiny_u32 header_status = tinytsx_response_header_request_id(writer, request, tinytsx_string_{}, {}, {});",
                request_id.header,
                program.static_strings[request_id.header].value.len(),
                request_id.max_length,
            )
            .unwrap();
            source.push_str("    if (header_status != 0) return header_status;\n");
        }
        for (header_index, header) in handler.headers.iter().enumerate() {
            writeln!(
                source,
                "    tiny_u32 header_status_{header_index} = tinytsx_response_header_static(writer, tinytsx_handler_{index}_header_{header_index}_name, {}, tinytsx_handler_{index}_header_{header_index}_value, {});",
                header.name.len(),
                header.value.len(),
            )
            .unwrap();
            writeln!(
                source,
                "    if (header_status_{header_index} != 0) return header_status_{header_index};"
            )
            .unwrap();
        }
        emit_response(source, &handler.response, program, "    ")?;
        source.push_str("  }\n");
    }
    source.push_str("  return 5;\n}\n");
    Ok(())
}

fn emit_response(
    source: &mut String,
    response: &HandlerResponse,
    program: &Program,
    indent: &str,
) -> Result<(), String> {
    match response {
        HandlerResponse::Html { component } => {
            writeln!(
                source,
                "{indent}tiny_u32 status = tinytsx_response_begin(writer, 200, 1);"
            )
            .unwrap();
            writeln!(source, "{indent}if (status != 0) return status;").unwrap();
            writeln!(
                source,
                "{indent}return tinytsx_component_{component}(request, writer);"
            )
            .unwrap();
        }
        HandlerResponse::Text {
            value,
            status,
            content_type,
        } => {
            let content_type = content_type_id(content_type.as_deref());
            writeln!(source, "{indent}tiny_u32 status = tinytsx_response_begin(writer, {status}, {content_type});").unwrap();
            writeln!(source, "{indent}if (status != 0) return status;").unwrap();
            emit_text_expression(source, value, program, indent)?;
            writeln!(source, "{indent}return status;").unwrap();
        }
        HandlerResponse::Stream {
            chunks,
            status,
            content_type,
        } => {
            let content_type = content_type_id(content_type.as_deref());
            writeln!(source, "{indent}tiny_u32 status = tinytsx_response_begin(writer, {status}, {content_type});").unwrap();
            writeln!(source, "{indent}if (status != 0) return status;").unwrap();
            writeln!(
                source,
                "{indent}status = tinytsx_response_stream_begin(writer);"
            )
            .unwrap();
            writeln!(source, "{indent}if (status != 0) return status;").unwrap();
            for chunk in chunks {
                if let ValueExpression::StringLiteral { string, .. } = chunk {
                    writeln!(
                        source,
                        "{indent}status = tinytsx_response_stream_chunk_static(writer, tinytsx_string_{string}, {});",
                        program.static_strings[*string].value.len(),
                    )
                    .unwrap();
                    writeln!(source, "{indent}if (status != 0) return status;").unwrap();
                } else {
                    writeln!(
                        source,
                        "{indent}status = tinytsx_response_stream_chunk_begin(writer);"
                    )
                    .unwrap();
                    writeln!(source, "{indent}if (status != 0) return status;").unwrap();
                    emit_text_expression(source, chunk, program, indent)?;
                    writeln!(
                        source,
                        "{indent}status = tinytsx_response_stream_chunk_end(writer);"
                    )
                    .unwrap();
                    writeln!(source, "{indent}if (status != 0) return status;").unwrap();
                }
            }
            writeln!(source, "{indent}return status;").unwrap();
        }
    }
    Ok(())
}

fn emit_text_expression(
    source: &mut String,
    expression: &ValueExpression,
    program: &Program,
    indent: &str,
) -> Result<(), String> {
    match expression {
        ValueExpression::StringLiteral { string, .. } => {
            emit_write_call(
                source,
                indent,
                &format!(
                    "tinytsx_html_write_static(writer, tinytsx_string_{string}, {})",
                    program.static_strings[*string].value.len()
                ),
            );
        }
        ValueExpression::Concat { values, .. } => {
            for value in values {
                emit_text_expression(source, value, program, indent)?;
            }
        }
        ValueExpression::RouteParameter { segment, tail, .. } => {
            let function = if *tail {
                "tinytsx_html_write_path_tail"
            } else {
                "tinytsx_html_write_path_segment"
            };
            emit_write_call(
                source,
                indent,
                &format!("{function}(writer, request, {segment})"),
            );
        }
        ValueExpression::RequestHeader { header, .. } => {
            emit_write_call(
                source,
                indent,
                &format!(
                    "tinytsx_html_write_request_header(writer, request, tinytsx_string_{header}, {})",
                    program.static_strings[*header].value.len()
                ),
            );
        }
        ValueExpression::RequestJsonField { field, .. } => {
            emit_write_call(
                source,
                indent,
                &format!(
                    "tinytsx_html_write_request_json_field(writer, request, tinytsx_string_{field}, {})",
                    program.static_strings[*field].value.len()
                ),
            );
        }
        ValueExpression::RequestId { header, .. } => {
            emit_write_call(
                source,
                indent,
                &format!(
                    "tinytsx_html_write_response_header(writer, tinytsx_string_{header}, {})",
                    program.static_strings[*header].value.len()
                ),
            );
        }
        ValueExpression::RequestCookie {
            cookie, fallback, ..
        } => {
            let (fallback, fallback_len) = optional_string(program, *fallback);
            emit_write_call(
                source,
                indent,
                &format!(
                    "tinytsx_html_write_request_cookie(writer, request, tinytsx_string_{cookie}, {}, {fallback}, {fallback_len})",
                    program.static_strings[*cookie].value.len()
                ),
            );
        }
        ValueExpression::EnvironmentVariable {
            name,
            required,
            fallback,
            ..
        } => {
            let (fallback, fallback_len) = optional_string(program, *fallback);
            emit_write_call(
                source,
                indent,
                &format!(
                    "tinytsx_html_write_environment_variable(writer, tinytsx_string_{name}, {}, {fallback}, {fallback_len}, {})",
                    program.static_strings[*name].value.len(),
                    u32::from(*required)
                ),
            );
        }
        ValueExpression::FileText {
            path, max_bytes, ..
        } => {
            emit_write_call(
                source,
                indent,
                &format!(
                    "tinytsx_html_write_file_text(writer, tinytsx_string_{path}, {}, {max_bytes})",
                    program.static_strings[*path].value.len()
                ),
            );
        }
        ValueExpression::FetchStatus { url, .. } => {
            emit_write_call(
                source,
                indent,
                &format!(
                    "tinytsx_html_write_fetch_status(writer, tinytsx_string_{url}, {})",
                    program.static_strings[*url].value.len()
                ),
            );
        }
        ValueExpression::QueryParameter {
            query,
            fallback,
            escape_html,
            ..
        } => {
            let (fallback, fallback_len) = optional_string(program, *fallback);
            emit_write_call(
                source,
                indent,
                &format!(
                    "tinytsx_html_write_query_parameter(writer, request, tinytsx_string_{query}, {}, {fallback}, {fallback_len}, {})",
                    program.static_strings[*query].value.len(),
                    u32::from(*escape_html)
                ),
            );
        }
        ValueExpression::QueryConditional {
            query,
            when_present,
            when_absent,
            ..
        } => {
            writeln!(
                source,
                "{indent}if (tinytsx_request_query_has(request, tinytsx_string_{query}, {})) {{",
                program.static_strings[*query].value.len()
            )
            .unwrap();
            emit_text_expression(source, when_present, program, &format!("{indent}  "))?;
            writeln!(source, "{indent}}} else {{").unwrap();
            emit_text_expression(source, when_absent, program, &format!("{indent}  "))?;
            writeln!(source, "{indent}}}").unwrap();
        }
        ValueExpression::OpenAiChatText {
            url,
            authorization,
            body,
            ..
        } => {
            emit_write_call(
                source,
                indent,
                &format!(
                    "tinytsx_html_write_openai_chat_text(writer, tinytsx_string_{url}, {}, tinytsx_string_{authorization}, {}, tinytsx_string_{body}, {})",
                    program.static_strings[*url].value.len(),
                    program.static_strings[*authorization].value.len(),
                    program.static_strings[*body].value.len()
                ),
            );
        }
        _ => return Err("portable x86 backend does not yet support this text expression".to_owned()),
    }
    Ok(())
}

fn emit_write_call(source: &mut String, indent: &str, call: &str) {
    writeln!(source, "{indent}status = {call};").unwrap();
    writeln!(source, "{indent}if (status != 0) return status;").unwrap();
}

fn optional_string(program: &Program, string: Option<usize>) -> (String, usize) {
    string.map_or_else(
        || ("(const tiny_u8 *)0".to_owned(), 0),
        |string| {
            (
                format!("tinytsx_string_{string}"),
                program.static_strings[string].value.len(),
            )
        },
    )
}

fn content_type_id(content_type: Option<&str>) -> u16 {
    match content_type {
        Some("") => 0,
        Some("text/html; charset=UTF-8") => 1,
        Some("text/plain;charset=UTF-8") => 4,
        Some("text/plain; charset=utf-8") => 5,
        Some("application/json") => 3,
        _ => 2,
    }
}

fn emit_bytes(source: &mut String, name: &str, bytes: &[u8]) {
    write!(
        source,
        "static const tiny_u8 {name}[{}] = {{",
        bytes.len().max(1)
    )
    .unwrap();
    if bytes.is_empty() {
        source.push('0');
    } else {
        for (index, byte) in bytes.iter().enumerate() {
            if index != 0 {
                source.push_str(", ");
            }
            write!(source, "{byte}").unwrap();
        }
    }
    source.push_str("};\n");
}
