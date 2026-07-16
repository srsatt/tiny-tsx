use crate::{
    codegen::Options,
    hir::{ConstantValue, HandlerResponse, HtmlOp, Program, ValueExpression},
};

use super::{
    aarch64::{
        HANDLER_SCRATCH_BASE, emit_epilogue, emit_immediate, emit_prologue,
        preserve_request_context, value_frame_size,
    },
    assembly::{Assembly, asm_line, asm_write},
    constant_data,
};

pub fn emit(program: &Program, options: Options) -> Result<String, String> {
    program.validate()?;
    let mut assembly = Assembly::new();
    asm_line!(assembly, ".section __TEXT,__text,regular,pure_instructions");
    asm_line!(assembly, ".p2align 2");

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
    emit_config(&mut assembly, options, program);
    emit_static_data(&mut assembly, program)?;
    Ok(assembly.finish())
}

fn emit_config(assembly: &mut Assembly, options: Options, program: &Program) {
    asm_line!(assembly, "\n.globl _tinytsx_config_port");
    asm_line!(assembly, "_tinytsx_config_port:");
    emit_immediate(assembly, "x0", u64::from(options.port));
    asm_line!(assembly, "    ret");

    asm_line!(assembly, "\n.globl _tinytsx_config_workers");
    asm_line!(assembly, "_tinytsx_config_workers:");
    emit_immediate(assembly, "x0", options.workers as u64);
    asm_line!(assembly, "    ret");

    asm_line!(assembly, "\n.globl _tinytsx_config_request_memory");
    asm_line!(assembly, "_tinytsx_config_request_memory:");
    emit_immediate(assembly, "x0", options.request_memory as u64);
    asm_line!(assembly, "    ret");

    asm_line!(assembly, "\n.globl _tinytsx_config_worker_modules");
    asm_line!(assembly, "_tinytsx_config_worker_modules:");
    emit_immediate(assembly, "x0", program.workers.len() as u64);
    asm_line!(assembly, "    ret");

    asm_line!(assembly, "\n.globl _tinytsx_config_provider_transport");
    asm_line!(assembly, "_tinytsx_config_provider_transport:");
    emit_immediate(assembly, "x0", u64::from(program.uses_openai_transport()));
    asm_line!(assembly, "    ret");

    asm_line!(assembly, "\n.globl _tinytsx_worker_operation");
    asm_line!(assembly, "_tinytsx_worker_operation:");
    emit_immediate(assembly, "x1", program.workers.len() as u64);
    asm_line!(assembly, "    cmp x0, x1");
    asm_line!(assembly, "    b.hs Ltinytsx_worker_operation_invalid");
    emit_immediate(assembly, "x0", 1);
    asm_line!(assembly, "    ret");
    asm_line!(assembly, "Ltinytsx_worker_operation_invalid:");
    asm_line!(assembly, "    mov x0, #0");
    asm_line!(assembly, "    ret");
}

fn emit_function(assembly: &mut Assembly, symbol: &str, operations: &[HtmlOp], program: &Program) {
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

fn emit_value_function(
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

fn emit_handlers(assembly: &mut Assembly, program: &Program) -> Result<(), String> {
    asm_line!(assembly, "\n.globl _tinytsx_handle_get");
    asm_line!(assembly, "_tinytsx_handle_get:");
    let frame_size = program
        .handlers
        .iter()
        .map(|handler| match &handler.response {
            HandlerResponse::Text { value, .. } => value_frame_size(HANDLER_SCRATCH_BASE, value),
            HandlerResponse::Stream { chunks, .. } => chunks
                .iter()
                .map(|chunk| value_frame_size(HANDLER_SCRATCH_BASE, chunk))
                .collect::<Result<Vec<_>, _>>()
                .map(|sizes| sizes.into_iter().max().unwrap_or(HANDLER_SCRATCH_BASE)),
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
        asm_line!(assembly, "    ldr x0, [sp, #24]");
        asm_line!(
            assembly,
            "    adrp x1, Ltinytsx_handler_method_{index}@PAGE"
        );
        asm_line!(
            assembly,
            "    add x1, x1, Ltinytsx_handler_method_{index}@PAGEOFF"
        );
        emit_immediate(assembly, "x2", handler.method.len() as u64);
        asm_line!(assembly, "    bl _tinytsx_request_method_equals");
        asm_line!(assembly, "    cbz w0, Ltinytsx_handle_get_next_{index}");
        asm_line!(assembly, "    ldr x0, [sp, #24]");
        asm_line!(assembly, "    adrp x1, Ltinytsx_handler_path_{index}@PAGE");
        asm_line!(
            assembly,
            "    add x1, x1, Ltinytsx_handler_path_{index}@PAGEOFF"
        );
        emit_immediate(assembly, "x2", handler.path.len() as u64);
        asm_line!(assembly, "    bl _tinytsx_request_path_matches");
        asm_line!(assembly, "    cbnz w0, Ltinytsx_handle_get_match_{index}");
        asm_line!(assembly, "Ltinytsx_handle_get_next_{index}:");
    }
    emit_immediate(assembly, "x0", 5);
    asm_line!(assembly, "    b {return_label}");
    for (index, handler) in program.handlers.iter().enumerate() {
        asm_line!(assembly, "Ltinytsx_handle_get_match_{index}:");
        if let Some(entity_tag) = &handler.entity_tag {
            let normal_label = format!("Ltinytsx_handler_{index}_etag_normal");
            asm_line!(assembly, "    ldr x0, [sp, #24]");
            asm_line!(assembly, "    adrp x1, Ltinytsx_handler_{index}_etag@PAGE");
            asm_line!(
                assembly,
                "    add x1, x1, Ltinytsx_handler_{index}_etag@PAGEOFF"
            );
            emit_immediate(assembly, "x2", entity_tag.value.len() as u64);
            asm_line!(assembly, "    bl _tinytsx_request_if_none_match");
            asm_line!(assembly, "    cbz w0, {normal_label}");
            for (header_index, header) in entity_tag.not_modified.headers.iter().enumerate() {
                asm_line!(assembly, "    ldr x0, [sp, #16]");
                asm_line!(
                    assembly,
                    "    adrp x1, Ltinytsx_handler_{index}_not_modified_header_{header_index}_name@PAGE"
                );
                asm_line!(
                    assembly,
                    "    add x1, x1, Ltinytsx_handler_{index}_not_modified_header_{header_index}_name@PAGEOFF"
                );
                emit_immediate(assembly, "x2", header.name.len() as u64);
                asm_line!(
                    assembly,
                    "    adrp x3, Ltinytsx_handler_{index}_not_modified_header_{header_index}_value@PAGE"
                );
                asm_line!(
                    assembly,
                    "    add x3, x3, Ltinytsx_handler_{index}_not_modified_header_{header_index}_value@PAGEOFF"
                );
                emit_immediate(assembly, "x4", header.value.len() as u64);
                asm_line!(assembly, "    bl _tinytsx_response_header_static");
                asm_line!(assembly, "    cbnz w0, {return_label}");
            }
            emit_handler_response(
                assembly,
                &entity_tag.not_modified.response,
                program,
                return_label,
                index,
            )?;
            asm_line!(assembly, "    b {return_label}");
            asm_line!(assembly, "{normal_label}:");
        }
        if let Some(authorization) = &handler.basic_authorization {
            let authorized_label = format!("Ltinytsx_handler_{index}_basic_auth_authorized");
            for (credential_index, credential) in authorization.credentials.iter().enumerate() {
                asm_line!(assembly, "    ldr x0, [sp, #24]");
                asm_line!(
                    assembly,
                    "    adrp x1, Ltinytsx_handler_{index}_credential_{credential_index}_username@PAGE"
                );
                asm_line!(
                    assembly,
                    "    add x1, x1, Ltinytsx_handler_{index}_credential_{credential_index}_username@PAGEOFF"
                );
                emit_immediate(assembly, "x2", credential.username.len() as u64);
                asm_line!(
                    assembly,
                    "    adrp x3, Ltinytsx_handler_{index}_credential_{credential_index}_password@PAGE"
                );
                asm_line!(
                    assembly,
                    "    add x3, x3, Ltinytsx_handler_{index}_credential_{credential_index}_password@PAGEOFF"
                );
                emit_immediate(assembly, "x4", credential.password.len() as u64);
                asm_line!(assembly, "    bl _tinytsx_request_basic_auth_equals");
                asm_line!(assembly, "    cbnz w0, {authorized_label}");
            }
            for string in &authorization.rejected.stderr {
                asm_line!(assembly, "    adrp x0, Ltinytsx_string_{string}@PAGE");
                asm_line!(assembly, "    add x0, x0, Ltinytsx_string_{string}@PAGEOFF");
                emit_immediate(
                    assembly,
                    "x1",
                    program.static_strings[*string].value.len() as u64,
                );
                asm_line!(assembly, "    bl _tinytsx_console_error_static");
            }
            for (header_index, header) in authorization.rejected.headers.iter().enumerate() {
                asm_line!(assembly, "    ldr x0, [sp, #16]");
                asm_line!(
                    assembly,
                    "    adrp x1, Ltinytsx_handler_{index}_rejected_header_{header_index}_name@PAGE"
                );
                asm_line!(
                    assembly,
                    "    add x1, x1, Ltinytsx_handler_{index}_rejected_header_{header_index}_name@PAGEOFF"
                );
                emit_immediate(assembly, "x2", header.name.len() as u64);
                asm_line!(
                    assembly,
                    "    adrp x3, Ltinytsx_handler_{index}_rejected_header_{header_index}_value@PAGE"
                );
                asm_line!(
                    assembly,
                    "    add x3, x3, Ltinytsx_handler_{index}_rejected_header_{header_index}_value@PAGEOFF"
                );
                emit_immediate(assembly, "x4", header.value.len() as u64);
                asm_line!(assembly, "    bl _tinytsx_response_header_static");
                asm_line!(assembly, "    cbnz w0, {return_label}");
            }
            emit_handler_response(
                assembly,
                &authorization.rejected.response,
                program,
                return_label,
                index,
            )?;
            asm_line!(assembly, "    b {return_label}");
            asm_line!(assembly, "{authorized_label}:");
        }
        if !handler.elapsed_headers.is_empty() {
            asm_line!(assembly, "    bl _tinytsx_date_now_millis");
            asm_line!(assembly, "    str x0, [sp, #32]");
        }
        for string in &handler.stderr {
            asm_line!(assembly, "    adrp x0, Ltinytsx_string_{string}@PAGE");
            asm_line!(assembly, "    add x0, x0, Ltinytsx_string_{string}@PAGEOFF");
            emit_immediate(
                assembly,
                "x1",
                program.static_strings[*string].value.len() as u64,
            );
            asm_line!(assembly, "    bl _tinytsx_console_error_static");
        }
        for (header_index, header) in handler.headers.iter().enumerate() {
            asm_line!(assembly, "    ldr x0, [sp, #16]");
            asm_line!(
                assembly,
                "    adrp x1, Ltinytsx_handler_{index}_header_{header_index}_name@PAGE"
            );
            asm_line!(
                assembly,
                "    add x1, x1, Ltinytsx_handler_{index}_header_{header_index}_name@PAGEOFF"
            );
            emit_immediate(assembly, "x2", header.name.len() as u64);
            asm_line!(
                assembly,
                "    adrp x3, Ltinytsx_handler_{index}_header_{header_index}_value@PAGE"
            );
            asm_line!(
                assembly,
                "    add x3, x3, Ltinytsx_handler_{index}_header_{header_index}_value@PAGEOFF"
            );
            emit_immediate(assembly, "x4", header.value.len() as u64);
            asm_line!(assembly, "    bl _tinytsx_response_header_static");
            asm_line!(assembly, "    cbnz w0, {return_label}");
        }
        emit_handler_response(assembly, &handler.response, program, return_label, index)?;
        if !handler.elapsed_headers.is_empty() {
            asm_line!(assembly, "    cbnz w0, {return_label}");
            asm_line!(assembly, "    bl _tinytsx_date_now_millis");
            asm_line!(assembly, "    str x0, [sp, #40]");
        }
        for (header_index, header) in handler.elapsed_headers.iter().enumerate() {
            asm_line!(assembly, "    ldr x0, [sp, #16]");
            asm_line!(
                assembly,
                "    adrp x1, Ltinytsx_handler_{index}_elapsed_{header_index}_name@PAGE"
            );
            asm_line!(
                assembly,
                "    add x1, x1, Ltinytsx_handler_{index}_elapsed_{header_index}_name@PAGEOFF"
            );
            emit_immediate(assembly, "x2", header.name.len() as u64);
            asm_line!(assembly, "    ldr x3, [sp, #32]");
            asm_line!(assembly, "    ldr x4, [sp, #40]");
            asm_line!(
                assembly,
                "    adrp x5, Ltinytsx_handler_{index}_elapsed_{header_index}_suffix@PAGE"
            );
            asm_line!(
                assembly,
                "    add x5, x5, Ltinytsx_handler_{index}_elapsed_{header_index}_suffix@PAGEOFF"
            );
            emit_immediate(assembly, "x6", header.suffix.len() as u64);
            asm_line!(assembly, "    bl _tinytsx_response_header_elapsed_millis");
            asm_line!(assembly, "    cbnz w0, {return_label}");
        }
        asm_line!(assembly, "    b {return_label}");
    }
    asm_line!(assembly, "{return_label}:");
    emit_epilogue(assembly, frame_size);
    Ok(())
}

fn emit_handler_response(
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

fn emit_value_expression(
    assembly: &mut Assembly,
    expression: &ValueExpression,
    program: &Program,
    scratch_base: usize,
) -> Result<(), String> {
    match expression {
        ValueExpression::StringLiteral { string, .. } => {
            asm_line!(assembly, "    adrp x0, Ltinytsx_string_{string}@PAGE");
            asm_line!(assembly, "    add x0, x0, Ltinytsx_string_{string}@PAGEOFF");
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
            asm_line!(assembly, "    adrp x0, Ltinytsx_constant_{constant}@PAGE");
            asm_line!(
                assembly,
                "    add x0, x0, Ltinytsx_constant_{constant}@PAGEOFF"
            );
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
            asm_line!(assembly, "    bl _tinytsx_function_{function}");
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

fn emit_static_data(assembly: &mut Assembly, program: &Program) -> Result<(), String> {
    asm_line!(assembly, "\n.section __TEXT,__const");
    for (index, handler) in program.handlers.iter().enumerate() {
        asm_line!(assembly, ".p2align 3");
        asm_line!(assembly, "Ltinytsx_handler_method_{index}:");
        emit_bytes(assembly, handler.method.as_bytes());
        asm_line!(assembly, ".p2align 3");
        asm_line!(assembly, "Ltinytsx_handler_path_{index}:");
        emit_bytes(assembly, handler.path.as_bytes());
        for (header_index, header) in handler.headers.iter().enumerate() {
            asm_line!(assembly, ".p2align 3");
            asm_line!(
                assembly,
                "Ltinytsx_handler_{index}_header_{header_index}_name:"
            );
            emit_bytes(assembly, header.name.as_bytes());
            asm_line!(assembly, ".p2align 3");
            asm_line!(
                assembly,
                "Ltinytsx_handler_{index}_header_{header_index}_value:"
            );
            emit_bytes(assembly, header.value.as_bytes());
        }
        for (header_index, header) in handler.elapsed_headers.iter().enumerate() {
            asm_line!(assembly, ".p2align 3");
            asm_line!(
                assembly,
                "Ltinytsx_handler_{index}_elapsed_{header_index}_name:"
            );
            emit_bytes(assembly, header.name.as_bytes());
            asm_line!(assembly, ".p2align 3");
            asm_line!(
                assembly,
                "Ltinytsx_handler_{index}_elapsed_{header_index}_suffix:"
            );
            emit_bytes(assembly, header.suffix.as_bytes());
        }
        if let Some(authorization) = &handler.basic_authorization {
            for (credential_index, credential) in authorization.credentials.iter().enumerate() {
                asm_line!(assembly, ".p2align 3");
                asm_line!(
                    assembly,
                    "Ltinytsx_handler_{index}_credential_{credential_index}_username:"
                );
                emit_bytes(assembly, credential.username.as_bytes());
                asm_line!(assembly, ".p2align 3");
                asm_line!(
                    assembly,
                    "Ltinytsx_handler_{index}_credential_{credential_index}_password:"
                );
                emit_bytes(assembly, credential.password.as_bytes());
            }
            for (header_index, header) in authorization.rejected.headers.iter().enumerate() {
                asm_line!(assembly, ".p2align 3");
                asm_line!(
                    assembly,
                    "Ltinytsx_handler_{index}_rejected_header_{header_index}_name:"
                );
                emit_bytes(assembly, header.name.as_bytes());
                asm_line!(assembly, ".p2align 3");
                asm_line!(
                    assembly,
                    "Ltinytsx_handler_{index}_rejected_header_{header_index}_value:"
                );
                emit_bytes(assembly, header.value.as_bytes());
            }
        }
        if let Some(entity_tag) = &handler.entity_tag {
            asm_line!(assembly, ".p2align 3");
            asm_line!(assembly, "Ltinytsx_handler_{index}_etag:");
            emit_bytes(assembly, entity_tag.value.as_bytes());
            for (header_index, header) in entity_tag.not_modified.headers.iter().enumerate() {
                asm_line!(assembly, ".p2align 3");
                asm_line!(
                    assembly,
                    "Ltinytsx_handler_{index}_not_modified_header_{header_index}_name:"
                );
                emit_bytes(assembly, header.name.as_bytes());
                asm_line!(assembly, ".p2align 3");
                asm_line!(
                    assembly,
                    "Ltinytsx_handler_{index}_not_modified_header_{header_index}_value:"
                );
                emit_bytes(assembly, header.value.as_bytes());
            }
        }
    }
    for string in &program.static_strings {
        asm_line!(assembly, ".p2align 3");
        asm_line!(assembly, "Ltinytsx_string_{}:", string.id);
        emit_bytes(assembly, string.value.as_bytes());
    }
    for constant in &program.constants {
        asm_line!(assembly, ".p2align 3");
        asm_line!(assembly, "Ltinytsx_constant_{}:", constant.id);
        emit_bytes(assembly, &constant_data::encode(&constant.value)?);
    }
    Ok(())
}

fn emit_bytes(assembly: &mut Assembly, bytes: &[u8]) {
    if bytes.is_empty() {
        asm_line!(assembly, "    .byte 0");
        return;
    }
    for chunk in bytes.chunks(16) {
        asm_write!(assembly, "    .byte ");
        for (index, byte) in chunk.iter().enumerate() {
            if index > 0 {
                asm_write!(assembly, ", ");
            }
            asm_write!(assembly, "{byte}");
        }
        asm_line!(assembly);
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
