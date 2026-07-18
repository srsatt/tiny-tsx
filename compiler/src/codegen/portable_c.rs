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
         extern tiny_u32 tinytsx_html_write_static(void *, const tiny_u8 *, tiny_usize);\n",
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
        match &handler.response {
            HandlerResponse::Html { component } => {
                source.push_str("    tiny_u32 status = tinytsx_response_begin(writer, 200, 1);\n");
                source.push_str("    if (status != 0) return status;\n");
                writeln!(
                    source,
                    "    return tinytsx_component_{component}(request, writer);"
                )
                .unwrap();
            }
            HandlerResponse::Text {
                value: ValueExpression::StringLiteral { string, .. },
                status,
                content_type,
            } => {
                let content_type = content_type_id(content_type.as_deref());
                writeln!(source, "    tiny_u32 status = tinytsx_response_begin(writer, {status}, {content_type});").unwrap();
                source.push_str("    if (status != 0) return status;\n");
                writeln!(
                    source,
                    "    return tinytsx_html_write_static(writer, tinytsx_string_{string}, {});",
                    program.static_strings[*string].value.len(),
                )
                .unwrap();
            }
            _ => {
                return Err(
                    "portable x86 backend does not yet support this handler response".to_owned(),
                );
            }
        }
        source.push_str("  }\n");
    }
    source.push_str("  return 5;\n}\n");
    Ok(())
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
