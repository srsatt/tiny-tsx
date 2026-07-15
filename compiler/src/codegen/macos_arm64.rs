use std::fmt::Write;

use crate::{
    codegen::Options,
    hir::{ConstantValue, HandlerResponse, HtmlOp, Program, ValueExpression},
};

use super::constant_data;

const HANDLER_SCRATCH_BASE: usize = 48;

pub fn emit(program: &Program, options: Options) -> Result<String, String> {
    program.validate()?;
    let mut assembly = String::new();
    writeln!(assembly, ".section __TEXT,__text,regular,pure_instructions").unwrap();
    writeln!(assembly, ".p2align 2").unwrap();

    for function in &program.functions {
        emit_value_function(&mut assembly, function.id, &function.body, program)?;
    }

    for component in &program.components {
        emit_function(
            &mut assembly,
            &format!("_tinytsx_component_{}", component.id),
            &component.html,
            program,
        );
    }

    emit_handlers(&mut assembly, program)?;
    emit_config(&mut assembly, options);
    emit_static_data(&mut assembly, program)?;
    Ok(assembly)
}

fn emit_config(assembly: &mut String, options: Options) {
    writeln!(assembly, "\n.globl _tinytsx_config_port").unwrap();
    writeln!(assembly, "_tinytsx_config_port:").unwrap();
    emit_immediate(assembly, "x0", u64::from(options.port));
    writeln!(assembly, "    ret").unwrap();

    writeln!(assembly, "\n.globl _tinytsx_config_workers").unwrap();
    writeln!(assembly, "_tinytsx_config_workers:").unwrap();
    emit_immediate(assembly, "x0", options.workers as u64);
    writeln!(assembly, "    ret").unwrap();

    writeln!(assembly, "\n.globl _tinytsx_config_request_memory").unwrap();
    writeln!(assembly, "_tinytsx_config_request_memory:").unwrap();
    emit_immediate(assembly, "x0", options.request_memory as u64);
    writeln!(assembly, "    ret").unwrap();
}

fn emit_function(assembly: &mut String, symbol: &str, operations: &[HtmlOp], program: &Program) {
    writeln!(assembly, "\n.private_extern {symbol}").unwrap();
    writeln!(assembly, "{symbol}:").unwrap();
    emit_prologue(assembly, 32);
    preserve_request_context(assembly);
    let return_label = format!("L{}_return", symbol.trim_start_matches('_'));

    if operations.is_empty() {
        writeln!(assembly, "    mov w0, #0").unwrap();
    }
    for operation in operations {
        match operation {
            HtmlOp::WriteStatic { string, .. } => {
                writeln!(assembly, "    ldr x0, [sp, #16]").unwrap();
                writeln!(assembly, "    adrp x1, Ltinytsx_string_{string}@PAGE").unwrap();
                writeln!(assembly, "    add x1, x1, Ltinytsx_string_{string}@PAGEOFF").unwrap();
                emit_immediate(
                    assembly,
                    "x2",
                    program.static_strings[*string].value.len() as u64,
                );
                writeln!(assembly, "    bl _tinytsx_html_write_static").unwrap();
                writeln!(assembly, "    cbnz w0, {return_label}").unwrap();
            }
            HtmlOp::CallComponent { component, .. } => {
                writeln!(assembly, "    ldr x0, [sp, #24]").unwrap();
                writeln!(assembly, "    ldr x1, [sp, #16]").unwrap();
                writeln!(assembly, "    bl _tinytsx_component_{component}").unwrap();
                writeln!(assembly, "    cbnz w0, {return_label}").unwrap();
            }
        }
    }
    writeln!(assembly, "    mov w0, #0").unwrap();
    writeln!(assembly, "{return_label}:").unwrap();
    emit_epilogue(assembly, 32);
}

fn emit_value_function(
    assembly: &mut String,
    id: usize,
    body: &ValueExpression,
    program: &Program,
) -> Result<(), String> {
    let function = &program.functions[id];
    let scratch_base = 16 + function.parameters.len() * 16;
    let frame_size = value_frame_size(scratch_base, body)?;
    writeln!(assembly, "\n.private_extern _tinytsx_function_{id}").unwrap();
    writeln!(assembly, "_tinytsx_function_{id}:").unwrap();
    emit_prologue(assembly, frame_size);
    for (index, (first, second)) in [("x0", "x1"), ("x2", "x3"), ("x4", "x5"), ("x6", "x7")]
        .into_iter()
        .take(function.parameters.len())
        .enumerate()
    {
        writeln!(
            assembly,
            "    stp {}, {}, [sp, #{}]",
            first,
            second,
            16 + index * 16
        )
        .unwrap();
    }
    emit_value_expression(assembly, body, program, scratch_base)?;
    emit_epilogue(assembly, frame_size);
    Ok(())
}

fn emit_handlers(assembly: &mut String, program: &Program) -> Result<(), String> {
    writeln!(assembly, "\n.globl _tinytsx_handle_get").unwrap();
    writeln!(assembly, "_tinytsx_handle_get:").unwrap();
    let frame_size = program
        .handlers
        .iter()
        .map(|handler| match &handler.response {
            HandlerResponse::Text { value, .. } => value_frame_size(HANDLER_SCRATCH_BASE, value),
            HandlerResponse::Html { .. } => Ok(HANDLER_SCRATCH_BASE),
        })
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .max()
        .unwrap_or(32);
    emit_prologue(assembly, frame_size);
    preserve_request_context(assembly);
    let return_label = "Ltinytsx_handle_get_return";
    for (index, handler) in program.handlers.iter().enumerate() {
        writeln!(assembly, "    ldr x0, [sp, #24]").unwrap();
        writeln!(
            assembly,
            "    adrp x1, Ltinytsx_handler_method_{index}@PAGE"
        )
        .unwrap();
        writeln!(
            assembly,
            "    add x1, x1, Ltinytsx_handler_method_{index}@PAGEOFF"
        )
        .unwrap();
        emit_immediate(assembly, "x2", handler.method.len() as u64);
        writeln!(assembly, "    bl _tinytsx_request_method_equals").unwrap();
        writeln!(assembly, "    cbz w0, Ltinytsx_handle_get_next_{index}").unwrap();
        writeln!(assembly, "    ldr x0, [sp, #24]").unwrap();
        writeln!(assembly, "    adrp x1, Ltinytsx_handler_path_{index}@PAGE").unwrap();
        writeln!(
            assembly,
            "    add x1, x1, Ltinytsx_handler_path_{index}@PAGEOFF"
        )
        .unwrap();
        emit_immediate(assembly, "x2", handler.path.len() as u64);
        writeln!(assembly, "    bl _tinytsx_request_path_matches").unwrap();
        writeln!(assembly, "    cbnz w0, Ltinytsx_handle_get_match_{index}").unwrap();
        writeln!(assembly, "Ltinytsx_handle_get_next_{index}:").unwrap();
    }
    emit_immediate(assembly, "x0", 5);
    writeln!(assembly, "    b {return_label}").unwrap();
    for (index, handler) in program.handlers.iter().enumerate() {
        writeln!(assembly, "Ltinytsx_handle_get_match_{index}:").unwrap();
        if let Some(entity_tag) = &handler.entity_tag {
            let normal_label = format!("Ltinytsx_handler_{index}_etag_normal");
            writeln!(assembly, "    ldr x0, [sp, #24]").unwrap();
            writeln!(assembly, "    adrp x1, Ltinytsx_handler_{index}_etag@PAGE").unwrap();
            writeln!(
                assembly,
                "    add x1, x1, Ltinytsx_handler_{index}_etag@PAGEOFF"
            )
            .unwrap();
            emit_immediate(assembly, "x2", entity_tag.value.len() as u64);
            writeln!(assembly, "    bl _tinytsx_request_if_none_match").unwrap();
            writeln!(assembly, "    cbz w0, {normal_label}").unwrap();
            for (header_index, header) in entity_tag.not_modified.headers.iter().enumerate() {
                writeln!(assembly, "    ldr x0, [sp, #16]").unwrap();
                writeln!(assembly, "    adrp x1, Ltinytsx_handler_{index}_not_modified_header_{header_index}_name@PAGE").unwrap();
                writeln!(assembly, "    add x1, x1, Ltinytsx_handler_{index}_not_modified_header_{header_index}_name@PAGEOFF").unwrap();
                emit_immediate(assembly, "x2", header.name.len() as u64);
                writeln!(assembly, "    adrp x3, Ltinytsx_handler_{index}_not_modified_header_{header_index}_value@PAGE").unwrap();
                writeln!(assembly, "    add x3, x3, Ltinytsx_handler_{index}_not_modified_header_{header_index}_value@PAGEOFF").unwrap();
                emit_immediate(assembly, "x4", header.value.len() as u64);
                writeln!(assembly, "    bl _tinytsx_response_header_static").unwrap();
                writeln!(assembly, "    cbnz w0, {return_label}").unwrap();
            }
            emit_handler_response(
                assembly,
                &entity_tag.not_modified.response,
                program,
                return_label,
                index,
            )?;
            writeln!(assembly, "    b {return_label}").unwrap();
            writeln!(assembly, "{normal_label}:").unwrap();
        }
        if let Some(authorization) = &handler.basic_authorization {
            let authorized_label = format!("Ltinytsx_handler_{index}_basic_auth_authorized");
            for (credential_index, credential) in authorization.credentials.iter().enumerate() {
                writeln!(assembly, "    ldr x0, [sp, #24]").unwrap();
                writeln!(
                    assembly,
                    "    adrp x1, Ltinytsx_handler_{index}_credential_{credential_index}_username@PAGE"
                )
                .unwrap();
                writeln!(
                    assembly,
                    "    add x1, x1, Ltinytsx_handler_{index}_credential_{credential_index}_username@PAGEOFF"
                )
                .unwrap();
                emit_immediate(assembly, "x2", credential.username.len() as u64);
                writeln!(
                    assembly,
                    "    adrp x3, Ltinytsx_handler_{index}_credential_{credential_index}_password@PAGE"
                )
                .unwrap();
                writeln!(
                    assembly,
                    "    add x3, x3, Ltinytsx_handler_{index}_credential_{credential_index}_password@PAGEOFF"
                )
                .unwrap();
                emit_immediate(assembly, "x4", credential.password.len() as u64);
                writeln!(assembly, "    bl _tinytsx_request_basic_auth_equals").unwrap();
                writeln!(assembly, "    cbnz w0, {authorized_label}").unwrap();
            }
            for string in &authorization.rejected.stderr {
                writeln!(assembly, "    adrp x0, Ltinytsx_string_{string}@PAGE").unwrap();
                writeln!(assembly, "    add x0, x0, Ltinytsx_string_{string}@PAGEOFF").unwrap();
                emit_immediate(
                    assembly,
                    "x1",
                    program.static_strings[*string].value.len() as u64,
                );
                writeln!(assembly, "    bl _tinytsx_console_error_static").unwrap();
            }
            for (header_index, header) in authorization.rejected.headers.iter().enumerate() {
                writeln!(assembly, "    ldr x0, [sp, #16]").unwrap();
                writeln!(
                    assembly,
                    "    adrp x1, Ltinytsx_handler_{index}_rejected_header_{header_index}_name@PAGE"
                )
                .unwrap();
                writeln!(
                    assembly,
                    "    add x1, x1, Ltinytsx_handler_{index}_rejected_header_{header_index}_name@PAGEOFF"
                )
                .unwrap();
                emit_immediate(assembly, "x2", header.name.len() as u64);
                writeln!(
                    assembly,
                    "    adrp x3, Ltinytsx_handler_{index}_rejected_header_{header_index}_value@PAGE"
                )
                .unwrap();
                writeln!(
                    assembly,
                    "    add x3, x3, Ltinytsx_handler_{index}_rejected_header_{header_index}_value@PAGEOFF"
                )
                .unwrap();
                emit_immediate(assembly, "x4", header.value.len() as u64);
                writeln!(assembly, "    bl _tinytsx_response_header_static").unwrap();
                writeln!(assembly, "    cbnz w0, {return_label}").unwrap();
            }
            emit_handler_response(
                assembly,
                &authorization.rejected.response,
                program,
                return_label,
                index,
            )?;
            writeln!(assembly, "    b {return_label}").unwrap();
            writeln!(assembly, "{authorized_label}:").unwrap();
        }
        if !handler.elapsed_headers.is_empty() {
            writeln!(assembly, "    bl _tinytsx_date_now_millis").unwrap();
            writeln!(assembly, "    str x0, [sp, #32]").unwrap();
        }
        for string in &handler.stderr {
            writeln!(assembly, "    adrp x0, Ltinytsx_string_{string}@PAGE").unwrap();
            writeln!(assembly, "    add x0, x0, Ltinytsx_string_{string}@PAGEOFF").unwrap();
            emit_immediate(
                assembly,
                "x1",
                program.static_strings[*string].value.len() as u64,
            );
            writeln!(assembly, "    bl _tinytsx_console_error_static").unwrap();
        }
        for (header_index, header) in handler.headers.iter().enumerate() {
            writeln!(assembly, "    ldr x0, [sp, #16]").unwrap();
            writeln!(
                assembly,
                "    adrp x1, Ltinytsx_handler_{index}_header_{header_index}_name@PAGE"
            )
            .unwrap();
            writeln!(
                assembly,
                "    add x1, x1, Ltinytsx_handler_{index}_header_{header_index}_name@PAGEOFF"
            )
            .unwrap();
            emit_immediate(assembly, "x2", header.name.len() as u64);
            writeln!(
                assembly,
                "    adrp x3, Ltinytsx_handler_{index}_header_{header_index}_value@PAGE"
            )
            .unwrap();
            writeln!(
                assembly,
                "    add x3, x3, Ltinytsx_handler_{index}_header_{header_index}_value@PAGEOFF"
            )
            .unwrap();
            emit_immediate(assembly, "x4", header.value.len() as u64);
            writeln!(assembly, "    bl _tinytsx_response_header_static").unwrap();
            writeln!(assembly, "    cbnz w0, {return_label}").unwrap();
        }
        emit_handler_response(assembly, &handler.response, program, return_label, index)?;
        if !handler.elapsed_headers.is_empty() {
            writeln!(assembly, "    cbnz w0, {return_label}").unwrap();
            writeln!(assembly, "    bl _tinytsx_date_now_millis").unwrap();
            writeln!(assembly, "    str x0, [sp, #40]").unwrap();
        }
        for (header_index, header) in handler.elapsed_headers.iter().enumerate() {
            writeln!(assembly, "    ldr x0, [sp, #16]").unwrap();
            writeln!(
                assembly,
                "    adrp x1, Ltinytsx_handler_{index}_elapsed_{header_index}_name@PAGE"
            )
            .unwrap();
            writeln!(
                assembly,
                "    add x1, x1, Ltinytsx_handler_{index}_elapsed_{header_index}_name@PAGEOFF"
            )
            .unwrap();
            emit_immediate(assembly, "x2", header.name.len() as u64);
            writeln!(assembly, "    ldr x3, [sp, #32]").unwrap();
            writeln!(assembly, "    ldr x4, [sp, #40]").unwrap();
            writeln!(
                assembly,
                "    adrp x5, Ltinytsx_handler_{index}_elapsed_{header_index}_suffix@PAGE"
            )
            .unwrap();
            writeln!(
                assembly,
                "    add x5, x5, Ltinytsx_handler_{index}_elapsed_{header_index}_suffix@PAGEOFF"
            )
            .unwrap();
            emit_immediate(assembly, "x6", header.suffix.len() as u64);
            writeln!(assembly, "    bl _tinytsx_response_header_elapsed_millis").unwrap();
            writeln!(assembly, "    cbnz w0, {return_label}").unwrap();
        }
        writeln!(assembly, "    b {return_label}").unwrap();
    }
    writeln!(assembly, "{return_label}:").unwrap();
    emit_epilogue(assembly, frame_size);
    Ok(())
}

fn emit_handler_response(
    assembly: &mut String,
    response: &HandlerResponse,
    program: &Program,
    return_label: &str,
    handler_index: usize,
) -> Result<(), String> {
    match response {
        HandlerResponse::Html { component } => {
            emit_response_begin(assembly, 200, 1, return_label);
            writeln!(assembly, "    ldr x0, [sp, #24]").unwrap();
            writeln!(assembly, "    ldr x1, [sp, #16]").unwrap();
            writeln!(assembly, "    bl _tinytsx_component_{component}").unwrap();
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
    }
    Ok(())
}

fn emit_handler_text_expression(
    assembly: &mut String,
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
                writeln!(assembly, "    cbnz w0, {return_label}").unwrap();
            }
        }
        ValueExpression::RouteParameter { segment, .. } => {
            writeln!(assembly, "    ldr x0, [sp, #16]").unwrap();
            writeln!(assembly, "    ldr x1, [sp, #24]").unwrap();
            emit_immediate(assembly, "x2", *segment as u64);
            writeln!(assembly, "    bl _tinytsx_html_write_path_segment").unwrap();
        }
        ValueExpression::RequestHeader { header, .. } => {
            writeln!(assembly, "    ldr x0, [sp, #16]").unwrap();
            writeln!(assembly, "    ldr x1, [sp, #24]").unwrap();
            writeln!(assembly, "    adrp x2, Ltinytsx_string_{header}@PAGE").unwrap();
            writeln!(assembly, "    add x2, x2, Ltinytsx_string_{header}@PAGEOFF").unwrap();
            emit_immediate(
                assembly,
                "x3",
                program.static_strings[*header].value.len() as u64,
            );
            writeln!(assembly, "    bl _tinytsx_html_write_request_header").unwrap();
        }
        ValueExpression::FetchStatus { url, .. } => {
            writeln!(assembly, "    ldr x0, [sp, #16]").unwrap();
            writeln!(assembly, "    adrp x1, Ltinytsx_string_{url}@PAGE").unwrap();
            writeln!(assembly, "    add x1, x1, Ltinytsx_string_{url}@PAGEOFF").unwrap();
            emit_immediate(
                assembly,
                "x2",
                program.static_strings[*url].value.len() as u64,
            );
            writeln!(assembly, "    bl _tinytsx_html_write_fetch_status").unwrap();
        }
        ValueExpression::QueryParameter {
            query,
            fallback,
            escape_html,
            ..
        } => {
            writeln!(assembly, "    ldr x0, [sp, #16]").unwrap();
            writeln!(assembly, "    ldr x1, [sp, #24]").unwrap();
            writeln!(assembly, "    adrp x2, Ltinytsx_string_{query}@PAGE").unwrap();
            writeln!(assembly, "    add x2, x2, Ltinytsx_string_{query}@PAGEOFF").unwrap();
            emit_immediate(
                assembly,
                "x3",
                program.static_strings[*query].value.len() as u64,
            );
            if let Some(fallback) = fallback {
                writeln!(assembly, "    adrp x4, Ltinytsx_string_{fallback}@PAGE").unwrap();
                writeln!(
                    assembly,
                    "    add x4, x4, Ltinytsx_string_{fallback}@PAGEOFF"
                )
                .unwrap();
                emit_immediate(
                    assembly,
                    "x5",
                    program.static_strings[*fallback].value.len() as u64,
                );
            } else {
                writeln!(assembly, "    mov x4, #0").unwrap();
                writeln!(assembly, "    mov x5, #0").unwrap();
            }
            emit_immediate(assembly, "x6", u64::from(*escape_html));
            writeln!(assembly, "    bl _tinytsx_html_write_query_parameter").unwrap();
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
            writeln!(assembly, "    ldr x0, [sp, #24]").unwrap();
            writeln!(assembly, "    adrp x1, Ltinytsx_string_{query}@PAGE").unwrap();
            writeln!(assembly, "    add x1, x1, Ltinytsx_string_{query}@PAGEOFF").unwrap();
            emit_immediate(
                assembly,
                "x2",
                program.static_strings[*query].value.len() as u64,
            );
            writeln!(assembly, "    bl _tinytsx_request_query_has").unwrap();
            writeln!(assembly, "    cbz w0, {absent_label}").unwrap();
            emit_handler_text_expression(
                assembly,
                when_present,
                program,
                return_label,
                handler_index,
                conditional_index,
            )?;
            writeln!(assembly, "    cbnz w0, {return_label}").unwrap();
            writeln!(assembly, "    b {end_label}").unwrap();
            writeln!(assembly, "{absent_label}:").unwrap();
            emit_handler_text_expression(
                assembly,
                when_absent,
                program,
                return_label,
                handler_index,
                conditional_index,
            )?;
            writeln!(assembly, "{end_label}:").unwrap();
        }
        _ => {
            emit_value_expression(assembly, expression, program, HANDLER_SCRATCH_BASE)?;
            writeln!(assembly, "    mov x2, x1").unwrap();
            writeln!(assembly, "    mov x1, x0").unwrap();
            writeln!(assembly, "    ldr x0, [sp, #16]").unwrap();
            writeln!(assembly, "    bl _tinytsx_html_write_static").unwrap();
        }
    }
    Ok(())
}

fn emit_response_begin(assembly: &mut String, status: u16, content_type: u16, return_label: &str) {
    writeln!(assembly, "    ldr x0, [sp, #16]").unwrap();
    emit_immediate(assembly, "x1", u64::from(status));
    emit_immediate(assembly, "x2", u64::from(content_type));
    writeln!(assembly, "    bl _tinytsx_response_begin").unwrap();
    writeln!(assembly, "    cbnz w0, {return_label}").unwrap();
}

fn emit_value_expression(
    assembly: &mut String,
    expression: &ValueExpression,
    program: &Program,
    scratch_base: usize,
) -> Result<(), String> {
    match expression {
        ValueExpression::StringLiteral { string, .. } => {
            writeln!(assembly, "    adrp x0, Ltinytsx_string_{string}@PAGE").unwrap();
            writeln!(assembly, "    add x0, x0, Ltinytsx_string_{string}@PAGEOFF").unwrap();
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
            writeln!(assembly, "    adrp x0, Ltinytsx_constant_{constant}@PAGE").unwrap();
            writeln!(
                assembly,
                "    add x0, x0, Ltinytsx_constant_{constant}@PAGEOFF"
            )
            .unwrap();
            writeln!(assembly, "    add x0, x0, #5").unwrap();
            emit_immediate(assembly, "x1", value.len() as u64);
        }
        ValueExpression::Parameter { parameter, .. } => {
            writeln!(assembly, "    ldp x0, x1, [sp, #{}]", 16 + parameter * 16).unwrap();
        }
        ValueExpression::DirectCall {
            function,
            arguments,
            ..
        } => {
            let nested_scratch = scratch_base + arguments.len() * 16;
            for (index, argument) in arguments.iter().enumerate() {
                emit_value_expression(assembly, argument, program, nested_scratch)?;
                writeln!(
                    assembly,
                    "    stp x0, x1, [sp, #{}]",
                    scratch_base + index * 16
                )
                .unwrap();
            }
            for (index, (first, second)) in [("x0", "x1"), ("x2", "x3"), ("x4", "x5"), ("x6", "x7")]
                .into_iter()
                .take(arguments.len())
                .enumerate()
            {
                writeln!(
                    assembly,
                    "    ldp {first}, {second}, [sp, #{}]",
                    scratch_base + index * 16
                )
                .unwrap();
            }
            writeln!(assembly, "    bl _tinytsx_function_{function}").unwrap();
        }
        ValueExpression::Concat { .. }
        | ValueExpression::RouteParameter { .. }
        | ValueExpression::RequestHeader { .. }
        | ValueExpression::FetchStatus { .. }
        | ValueExpression::QueryParameter { .. }
        | ValueExpression::QueryConditional { .. } => {
            return Err("request-time expression used outside a handler response".to_owned());
        }
    }
    Ok(())
}

fn emit_prologue(assembly: &mut String, frame_size: usize) {
    writeln!(assembly, "    stp x29, x30, [sp, #-{frame_size}]!").unwrap();
    writeln!(assembly, "    mov x29, sp").unwrap();
}

fn preserve_request_context(assembly: &mut String) {
    writeln!(assembly, "    str x1, [sp, #16]").unwrap();
    writeln!(assembly, "    str x0, [sp, #24]").unwrap();
}

fn emit_epilogue(assembly: &mut String, frame_size: usize) {
    writeln!(assembly, "    ldp x29, x30, [sp], #{frame_size}").unwrap();
    writeln!(assembly, "    ret").unwrap();
}

fn value_frame_size(base: usize, expression: &ValueExpression) -> Result<usize, String> {
    let required = base + scratch_slots(expression) * 16;
    let frame_size = required.max(16).div_ceil(16) * 16;
    if frame_size > 496 {
        return Err("function call expression requires more than 496 bytes of stack".to_owned());
    }
    Ok(frame_size)
}

fn scratch_slots(expression: &ValueExpression) -> usize {
    match expression {
        ValueExpression::DirectCall { arguments, .. } => {
            arguments.len() + arguments.iter().map(scratch_slots).max().unwrap_or(0)
        }
        ValueExpression::Concat { values, .. } => {
            values.iter().map(scratch_slots).max().unwrap_or(0)
        }
        ValueExpression::QueryConditional {
            when_present,
            when_absent,
            ..
        } => scratch_slots(when_present).max(scratch_slots(when_absent)),
        _ => 0,
    }
}

fn emit_static_data(assembly: &mut String, program: &Program) -> Result<(), String> {
    writeln!(assembly, "\n.section __TEXT,__const").unwrap();
    for (index, handler) in program.handlers.iter().enumerate() {
        writeln!(assembly, ".p2align 3").unwrap();
        writeln!(assembly, "Ltinytsx_handler_method_{index}:").unwrap();
        emit_bytes(assembly, handler.method.as_bytes());
        writeln!(assembly, ".p2align 3").unwrap();
        writeln!(assembly, "Ltinytsx_handler_path_{index}:").unwrap();
        emit_bytes(assembly, handler.path.as_bytes());
        for (header_index, header) in handler.headers.iter().enumerate() {
            writeln!(assembly, ".p2align 3").unwrap();
            writeln!(
                assembly,
                "Ltinytsx_handler_{index}_header_{header_index}_name:"
            )
            .unwrap();
            emit_bytes(assembly, header.name.as_bytes());
            writeln!(assembly, ".p2align 3").unwrap();
            writeln!(
                assembly,
                "Ltinytsx_handler_{index}_header_{header_index}_value:"
            )
            .unwrap();
            emit_bytes(assembly, header.value.as_bytes());
        }
        for (header_index, header) in handler.elapsed_headers.iter().enumerate() {
            writeln!(assembly, ".p2align 3").unwrap();
            writeln!(
                assembly,
                "Ltinytsx_handler_{index}_elapsed_{header_index}_name:"
            )
            .unwrap();
            emit_bytes(assembly, header.name.as_bytes());
            writeln!(assembly, ".p2align 3").unwrap();
            writeln!(
                assembly,
                "Ltinytsx_handler_{index}_elapsed_{header_index}_suffix:"
            )
            .unwrap();
            emit_bytes(assembly, header.suffix.as_bytes());
        }
        if let Some(authorization) = &handler.basic_authorization {
            for (credential_index, credential) in authorization.credentials.iter().enumerate() {
                writeln!(assembly, ".p2align 3").unwrap();
                writeln!(
                    assembly,
                    "Ltinytsx_handler_{index}_credential_{credential_index}_username:"
                )
                .unwrap();
                emit_bytes(assembly, credential.username.as_bytes());
                writeln!(assembly, ".p2align 3").unwrap();
                writeln!(
                    assembly,
                    "Ltinytsx_handler_{index}_credential_{credential_index}_password:"
                )
                .unwrap();
                emit_bytes(assembly, credential.password.as_bytes());
            }
            for (header_index, header) in authorization.rejected.headers.iter().enumerate() {
                writeln!(assembly, ".p2align 3").unwrap();
                writeln!(
                    assembly,
                    "Ltinytsx_handler_{index}_rejected_header_{header_index}_name:"
                )
                .unwrap();
                emit_bytes(assembly, header.name.as_bytes());
                writeln!(assembly, ".p2align 3").unwrap();
                writeln!(
                    assembly,
                    "Ltinytsx_handler_{index}_rejected_header_{header_index}_value:"
                )
                .unwrap();
                emit_bytes(assembly, header.value.as_bytes());
            }
        }
        if let Some(entity_tag) = &handler.entity_tag {
            writeln!(assembly, ".p2align 3").unwrap();
            writeln!(assembly, "Ltinytsx_handler_{index}_etag:").unwrap();
            emit_bytes(assembly, entity_tag.value.as_bytes());
            for (header_index, header) in entity_tag.not_modified.headers.iter().enumerate() {
                writeln!(assembly, ".p2align 3").unwrap();
                writeln!(
                    assembly,
                    "Ltinytsx_handler_{index}_not_modified_header_{header_index}_name:"
                )
                .unwrap();
                emit_bytes(assembly, header.name.as_bytes());
                writeln!(assembly, ".p2align 3").unwrap();
                writeln!(
                    assembly,
                    "Ltinytsx_handler_{index}_not_modified_header_{header_index}_value:"
                )
                .unwrap();
                emit_bytes(assembly, header.value.as_bytes());
            }
        }
    }
    for string in &program.static_strings {
        writeln!(assembly, ".p2align 3").unwrap();
        writeln!(assembly, "Ltinytsx_string_{}:", string.id).unwrap();
        emit_bytes(assembly, string.value.as_bytes());
    }
    for constant in &program.constants {
        writeln!(assembly, ".p2align 3").unwrap();
        writeln!(assembly, "Ltinytsx_constant_{}:", constant.id).unwrap();
        emit_bytes(assembly, &constant_data::encode(&constant.value)?);
    }
    Ok(())
}

fn emit_bytes(assembly: &mut String, bytes: &[u8]) {
    if bytes.is_empty() {
        writeln!(assembly, "    .byte 0").unwrap();
        return;
    }
    for chunk in bytes.chunks(16) {
        write!(assembly, "    .byte ").unwrap();
        for (index, byte) in chunk.iter().enumerate() {
            if index > 0 {
                write!(assembly, ", ").unwrap();
            }
            write!(assembly, "{byte}").unwrap();
        }
        writeln!(assembly).unwrap();
    }
}

fn emit_immediate(assembly: &mut String, register: &str, value: u64) {
    let chunks = [
        (value & 0xffff) as u16,
        ((value >> 16) & 0xffff) as u16,
        ((value >> 32) & 0xffff) as u16,
        ((value >> 48) & 0xffff) as u16,
    ];
    writeln!(assembly, "    movz {register}, #{}", chunks[0]).unwrap();
    for (index, chunk) in chunks.into_iter().enumerate().skip(1) {
        if chunk != 0 {
            writeln!(
                assembly,
                "    movk {register}, #{chunk}, lsl #{}",
                index * 16
            )
            .unwrap();
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::hir::Program;

    use crate::codegen::Options;

    use super::emit;

    #[test]
    fn emits_deterministic_handler_and_static_data() {
        let program: Program = serde_json::from_str(
            r#"{
              "version": 2,
              "target": "aarch64-apple-darwin",
              "entry": "server.tsx",
              "modules": [{"path": "server.tsx"}],
              "functions": [{
                "id": 0,
                "module": "server.tsx",
                "name": "greeting",
                "parameters": [{
                  "name": "value",
                  "type": "string",
                  "span": {"file":"server.tsx","line":1,"column":1,"endLine":1,"endColumn":2}
                }],
                "result": "string",
                "body": {
                  "kind": "directCall",
                  "function": 1,
                  "arguments": [],
                  "span": {"file":"server.tsx","line":1,"column":1,"endLine":1,"endColumn":2}
                },
                "span": {"file":"server.tsx","line":1,"column":1,"endLine":1,"endColumn":2}
              }, {
                "id": 1,
                "module": "server.tsx",
                "name": "message",
                "parameters": [],
                "result": "string",
                "body": {
                  "kind": "constant",
                  "constant": 0,
                  "span": {"file":"server.tsx","line":2,"column":1,"endLine":2,"endColumn":2}
                },
                "span": {"file":"server.tsx","line":2,"column":1,"endLine":2,"endColumn":2}
              }],
              "components": [{
                "id": 0,
                "name": "Page",
                "span": {"file":"server.tsx","line":1,"column":1,"endLine":1,"endColumn":2},
                "html": [{
                  "kind": "writeStatic",
                  "string": 0,
                  "span": {"file":"server.tsx","line":1,"column":1,"endLine":1,"endColumn":2}
                }]
              }],
              "handlers": [{
                "method": "GET",
                "headers": [{"name":"X-Test","value":"yes"}],
                "elapsedHeaders": [{"name":"X-Response-Time","suffix":"ms"}],
                "response": {
                  "kind": "text",
                  "value": {
                    "kind": "directCall",
                    "function": 0,
                    "arguments": [{
                      "kind": "constant",
                      "constant": 0,
                      "span": {"file":"server.tsx","line":2,"column":1,"endLine":2,"endColumn":2}
                    }],
                    "span": {"file":"server.tsx","line":2,"column":1,"endLine":2,"endColumn":2}
                  }
                },
                "span": {"file":"server.tsx","line":2,"column":1,"endLine":2,"endColumn":2}
              }],
              "staticStrings": [{"id":0,"value":"<h1>Hello</h1>"}],
              "constants": [{
                "id": 0,
                "module": "server.tsx",
                "name": "message",
                "span": {"file":"server.tsx","line":1,"column":1,"endLine":1,"endColumn":2},
                "value": {"kind":"string","value":"Hello"}
              }],
              "statistics": {"modules":1,"functions":2,"components":1,"constants":1,"staticHtmlBytes":14,"dynamicHtmlExpressions":0}
            }"#,
        )
        .unwrap();

        let options = Options::default();
        let first = emit(&program, options).unwrap();
        let second = emit(&program, options).unwrap();
        assert_eq!(first, second);
        assert!(first.contains(".globl _tinytsx_handle_get"));
        assert!(first.contains("bl _tinytsx_html_write_static"));
        assert!(first.contains("bl _tinytsx_response_begin"));
        assert!(first.contains("bl _tinytsx_request_path_matches"));
        assert!(first.contains("bl _tinytsx_response_header_static"));
        assert!(first.contains("bl _tinytsx_date_now_millis"));
        assert!(first.contains("bl _tinytsx_response_header_elapsed_millis"));
        assert!(first.contains("Ltinytsx_handler_0_header_0_name:"));
        assert!(first.contains("Ltinytsx_handler_0_elapsed_0_name:"));
        assert!(first.contains("Ltinytsx_handler_0_elapsed_0_suffix:"));
        assert!(first.contains("Ltinytsx_handler_path_0:"));
        assert!(first.contains("bl _tinytsx_function_0"));
        assert!(first.contains("_tinytsx_function_0:"));
        assert!(first.contains("stp x0, x1, [sp, #16]"));
        assert!(first.contains("ldp x0, x1, [sp, #48]"));
        assert!(first.contains("bl _tinytsx_function_1"));
        assert!(first.contains(
            "_tinytsx_function_1:\n    stp x29, x30, [sp, #-16]!\n    mov x29, sp\n    adrp"
        ));
        assert!(first.contains("Ltinytsx_string_0:"));
        assert!(first.contains("Ltinytsx_constant_0:"));
        assert!(first.contains(".byte 60, 104, 49"));
        assert!(first.contains(".byte 4, 5, 0, 0, 0, 72, 101, 108, 108, 111"));
        assert!(first.contains("_tinytsx_config_port:\n    movz x0, #3000"));
        assert!(first.contains("_tinytsx_config_workers:\n    movz x0, #1"));
    }

    #[test]
    fn emits_named_route_matching_and_parameter_writes() {
        let program: Program = serde_json::from_str(
            r#"{
              "version": 2,
              "target": "aarch64-apple-darwin",
              "entry": "server.ts",
              "modules": [{"path": "server.ts"}],
              "functions": [],
              "components": [],
              "handlers": [{
                "method": "POST",
                "path": "/entry/:id",
                "response": {
                  "kind": "text",
                  "status": 201,
                  "value": {
                    "kind": "concat",
                    "values": [{
                      "kind": "stringLiteral",
                      "string": 0,
                      "span": {"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}
                    }, {
                      "kind": "routeParameter",
                      "name": "id",
                      "segment": 1,
                      "span": {"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}
                    }, {
                      "kind": "fetchStatus",
                      "url": 1,
                      "span": {"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}
                    }],
                    "span": {"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}
                  }
                },
                "span": {"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}
              }],
              "staticStrings": [
                {"id":0,"value":"Your ID is "},
                {"id":1,"value":"https://example.com/"}
              ],
              "constants": [],
              "statistics": {"modules":1,"functions":0,"components":0,"constants":0,"staticHtmlBytes":11,"dynamicHtmlExpressions":2}
            }"#,
        )
        .unwrap();

        let assembly = emit(&program, Options::default()).unwrap();

        assert!(assembly.contains("bl _tinytsx_request_path_matches"));
        assert!(assembly.contains("bl _tinytsx_request_method_equals"));
        assert!(assembly.contains("movz x1, #201"));
        assert!(assembly.contains("Ltinytsx_handler_method_0:\n    .byte 80, 79, 83, 84"));
        assert!(assembly.contains("movz x2, #1\n    bl _tinytsx_html_write_path_segment"));
        assert!(assembly.contains("bl _tinytsx_html_write_fetch_status"));
    }

    #[test]
    fn emits_query_conditional_handler_bodies() {
        let program: Program = serde_json::from_str(
            r#"{
              "version": 2,
              "target": "aarch64-apple-darwin",
              "entry": "server.ts",
              "modules": [{"path": "server.ts"}],
              "functions": [],
              "components": [],
              "handlers": [{
                "method": "GET",
                "path": "/posts",
                "response": {
                  "kind": "text",
                  "contentType": "application/json",
                  "value": {
                    "kind": "queryConditional",
                    "query": 0,
                    "whenPresent": {
                      "kind": "stringLiteral",
                      "string": 1,
                      "span": {"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}
                    },
                    "whenAbsent": {
                      "kind": "stringLiteral",
                      "string": 2,
                      "span": {"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}
                    },
                    "span": {"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}
                  }
                },
                "span": {"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}
              }],
              "staticStrings": [
                {"id":0,"value":"pretty"},
                {"id":1,"value":"{\n  \"ok\": true\n}"},
                {"id":2,"value":"{\"ok\":true}"}
              ],
              "constants": [],
              "statistics": {"modules":1,"functions":0,"components":0,"constants":0,"staticHtmlBytes":35,"dynamicHtmlExpressions":1}
            }"#,
        )
        .unwrap();

        let assembly = emit(&program, Options::default()).unwrap();

        assert!(assembly.contains("bl _tinytsx_request_query_has"));
        assert!(assembly.contains("cbz w0, Ltinytsx_handler_0_query_0_absent"));
        assert!(assembly.contains("Ltinytsx_handler_0_query_0_end:"));
    }
}
