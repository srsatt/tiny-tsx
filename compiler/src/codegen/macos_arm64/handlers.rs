use crate::hir::{HandlerResponse, Program};

use super::super::{
    aarch64::{
        HANDLER_SCRATCH_BASE, emit_epilogue, emit_immediate, emit_prologue,
        preserve_request_context, value_frame_size,
    },
    assembly::{Assembly, asm_line},
};
use super::response::emit_handler_response;

pub(super) fn emit_handlers(assembly: &mut Assembly, program: &Program) -> Result<(), String> {
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
