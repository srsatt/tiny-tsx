use crate::hir::{
    ActorAction, ActorOperation, GuardedResponse, HandlerResponse, Program, SqliteAction,
};

use super::super::{
    aarch64::{
        Emitter, HANDLER_SCRATCH_BASE, emit_epilogue, emit_immediate, emit_prologue,
        preserve_request_context, value_frame_size,
    },
    assembly::asm_line,
};
use super::response::emit_handler_response;
use super::sqlite::{
    address_parameters, emit_parameters, expression_parameter_count, parameter_frame_size,
};

pub(super) fn emit_handlers(assembly: &mut Emitter, program: &Program) -> Result<(), String> {
    assembly.global_function(format_args!("tinytsx_handle_get"));
    let value_frame_size = program
        .handlers
        .iter()
        .map(|handler| {
            let response = handler_response_frame_size(&handler.response)?;
            let missing = handler
                .sqlite_existence
                .as_ref()
                .map(|guard| handler_response_frame_size(&guard.missing.response))
                .transpose()?
                .unwrap_or(HANDLER_SCRATCH_BASE);
            let body_limit = handler
                .body_limit
                .as_ref()
                .map(|guard| handler_response_frame_size(&guard.rejected.response))
                .transpose()?
                .unwrap_or(HANDLER_SCRATCH_BASE);
            Ok::<usize, String>(response.max(missing).max(body_limit))
        })
        .collect::<Result<Vec<_>, _>>()?
        .into_iter()
        .max()
        .unwrap_or(32);
    let sqlite_parameter_count = program
        .handlers
        .iter()
        .map(|handler| {
            let actions = handler
                .sqlite_actions
                .iter()
                .map(|action| match action {
                    SqliteAction::Exec { parameters, .. } => parameters.len(),
                    SqliteAction::Transaction { .. } | SqliteAction::Close { .. } => 0,
                })
                .max()
                .unwrap_or(0);
            let response = match &handler.response {
                HandlerResponse::Text { value, .. } => expression_parameter_count(value),
                HandlerResponse::Stream { chunks, .. } => chunks
                    .iter()
                    .map(expression_parameter_count)
                    .max()
                    .unwrap_or(0),
                HandlerResponse::Html { .. } => 0,
            };
            let existence = handler
                .sqlite_existence
                .as_ref()
                .map(|guard| {
                    guard.parameters.len().max(match &guard.missing.response {
                        HandlerResponse::Text { value, .. } => expression_parameter_count(value),
                        HandlerResponse::Stream { chunks, .. } => chunks
                            .iter()
                            .map(expression_parameter_count)
                            .max()
                            .unwrap_or(0),
                        HandlerResponse::Html { .. } => 0,
                    })
                })
                .unwrap_or(0);
            actions.max(response).max(existence)
        })
        .max()
        .unwrap_or(0);
    let frame_size = value_frame_size.max(parameter_frame_size(sqlite_parameter_count));
    emit_prologue(assembly, frame_size);
    preserve_request_context(assembly);
    let return_label = "Ltinytsx_handle_get_return";
    for (index, handler) in program.handlers.iter().enumerate() {
        asm_line!(assembly, "    ldr x0, [sp, #24]");
        assembly.address("x1", format_args!("Ltinytsx_handler_method_{index}"));
        emit_immediate(assembly, "x2", handler.method.len() as u64);
        assembly.call(format_args!("tinytsx_request_method_equals"));
        asm_line!(assembly, "    cbz w0, Ltinytsx_handle_get_next_{index}");
        asm_line!(assembly, "    ldr x0, [sp, #24]");
        assembly.address("x1", format_args!("Ltinytsx_handler_path_{index}"));
        emit_immediate(assembly, "x2", handler.path.len() as u64);
        assembly.call(format_args!("tinytsx_request_path_matches"));
        asm_line!(assembly, "    cbnz w0, Ltinytsx_handle_get_match_{index}");
        asm_line!(assembly, "Ltinytsx_handle_get_next_{index}:");
    }
    emit_immediate(assembly, "x0", 5);
    asm_line!(assembly, "    b {return_label}");
    for (index, handler) in program.handlers.iter().enumerate() {
        asm_line!(assembly, "Ltinytsx_handle_get_match_{index}:");
        if let Some(limit) = &handler.body_limit {
            let accepted_label = format!("Ltinytsx_handler_{index}_body_limit_accepted");
            asm_line!(assembly, "    ldr x0, [sp, #24]");
            assembly.call(format_args!("tinytsx_request_body_length"));
            emit_immediate(assembly, "x1", limit.max_bytes as u64);
            asm_line!(assembly, "    cmp x0, x1");
            asm_line!(assembly, "    b.ls {accepted_label}");
            for string in &limit.rejected.stderr {
                assembly.address("x0", format_args!("Ltinytsx_string_{string}"));
                emit_immediate(
                    assembly,
                    "x1",
                    program.static_strings[*string].value.len() as u64,
                );
                assembly.call(format_args!("tinytsx_console_error_static"));
            }
            for (header_index, header) in limit.rejected.headers.iter().enumerate() {
                asm_line!(assembly, "    ldr x0, [sp, #16]");
                assembly.address(
                    "x1",
                    format_args!("Ltinytsx_handler_{index}_body_limit_header_{header_index}_name"),
                );
                emit_immediate(assembly, "x2", header.name.len() as u64);
                assembly.address(
                    "x3",
                    format_args!("Ltinytsx_handler_{index}_body_limit_header_{header_index}_value"),
                );
                emit_immediate(assembly, "x4", header.value.len() as u64);
                assembly.call(format_args!("tinytsx_response_header_static"));
                asm_line!(assembly, "    cbnz w0, {return_label}");
            }
            emit_handler_response(
                assembly,
                &limit.rejected.response,
                program,
                return_label,
                index,
            )?;
            asm_line!(assembly, "    b {return_label}");
            asm_line!(assembly, "{accepted_label}:");
        }
        for (validation_index, validation) in handler.parameter_validations.iter().enumerate() {
            let valid_label =
                format!("Ltinytsx_handler_{index}_validation_{validation_index}_valid");
            asm_line!(assembly, "    ldr x0, [sp, #24]");
            emit_immediate(assembly, "x1", validation.segment as u64);
            emit_immediate(assembly, "x2", validation.min_length as u64);
            assembly.call(format_args!("tinytsx_request_path_segment_min_length"));
            asm_line!(assembly, "    cbnz w0, {valid_label}");
            for string in &validation.rejected.stderr {
                assembly.address("x0", format_args!("Ltinytsx_string_{string}"));
                emit_immediate(
                    assembly,
                    "x1",
                    program.static_strings[*string].value.len() as u64,
                );
                assembly.call(format_args!("tinytsx_console_error_static"));
            }
            for (header_index, header) in validation.rejected.headers.iter().enumerate() {
                asm_line!(assembly, "    ldr x0, [sp, #16]");
                assembly.address(
                    "x1",
                    format_args!(
                        "Ltinytsx_handler_{index}_validation_{validation_index}_header_{header_index}_name"
                    ),
                );
                emit_immediate(assembly, "x2", header.name.len() as u64);
                assembly.address(
                    "x3",
                    format_args!(
                        "Ltinytsx_handler_{index}_validation_{validation_index}_header_{header_index}_value"
                    ),
                );
                emit_immediate(assembly, "x4", header.value.len() as u64);
                assembly.call(format_args!("tinytsx_response_header_static"));
                asm_line!(assembly, "    cbnz w0, {return_label}");
            }
            emit_handler_response(
                assembly,
                &validation.rejected.response,
                program,
                return_label,
                index,
            )?;
            asm_line!(assembly, "    b {return_label}");
            asm_line!(assembly, "{valid_label}:");
        }
        if let Some(entity_tag) = &handler.entity_tag {
            let normal_label = format!("Ltinytsx_handler_{index}_etag_normal");
            asm_line!(assembly, "    ldr x0, [sp, #24]");
            assembly.address("x1", format_args!("Ltinytsx_handler_{index}_etag"));
            emit_immediate(assembly, "x2", entity_tag.value.len() as u64);
            assembly.call(format_args!("tinytsx_request_if_none_match"));
            asm_line!(assembly, "    cbz w0, {normal_label}");
            for (header_index, header) in entity_tag.not_modified.headers.iter().enumerate() {
                asm_line!(assembly, "    ldr x0, [sp, #16]");
                assembly.address(
                    "x1",
                    format_args!(
                        "Ltinytsx_handler_{index}_not_modified_header_{header_index}_name"
                    ),
                );
                emit_immediate(assembly, "x2", header.name.len() as u64);
                assembly.address(
                    "x3",
                    format_args!(
                        "Ltinytsx_handler_{index}_not_modified_header_{header_index}_value"
                    ),
                );
                emit_immediate(assembly, "x4", header.value.len() as u64);
                assembly.call(format_args!("tinytsx_response_header_static"));
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
                assembly.address(
                    "x1",
                    format_args!("Ltinytsx_handler_{index}_credential_{credential_index}_username"),
                );
                emit_immediate(assembly, "x2", credential.username.len() as u64);
                assembly.address(
                    "x3",
                    format_args!("Ltinytsx_handler_{index}_credential_{credential_index}_password"),
                );
                emit_immediate(assembly, "x4", credential.password.len() as u64);
                assembly.call(format_args!("tinytsx_request_basic_auth_equals"));
                asm_line!(assembly, "    cbnz w0, {authorized_label}");
            }
            for string in &authorization.rejected.stderr {
                assembly.address("x0", format_args!("Ltinytsx_string_{string}"));
                emit_immediate(
                    assembly,
                    "x1",
                    program.static_strings[*string].value.len() as u64,
                );
                assembly.call(format_args!("tinytsx_console_error_static"));
            }
            for (header_index, header) in authorization.rejected.headers.iter().enumerate() {
                asm_line!(assembly, "    ldr x0, [sp, #16]");
                assembly.address(
                    "x1",
                    format_args!("Ltinytsx_handler_{index}_rejected_header_{header_index}_name"),
                );
                emit_immediate(assembly, "x2", header.name.len() as u64);
                assembly.address(
                    "x3",
                    format_args!("Ltinytsx_handler_{index}_rejected_header_{header_index}_value"),
                );
                emit_immediate(assembly, "x4", header.value.len() as u64);
                assembly.call(format_args!("tinytsx_response_header_static"));
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
        if let Some(existence) = &handler.sqlite_existence {
            let present_label = format!("Ltinytsx_handler_{index}_sqlite_present");
            emit_parameters(assembly, program, &existence.parameters);
            emit_immediate(assembly, "x0", existence.database as u64);
            asm_line!(assembly, "    ldr x1, [sp, #24]");
            assembly.address("x2", format_args!("Ltinytsx_string_{}", existence.sql));
            emit_immediate(
                assembly,
                "x3",
                program.static_strings[existence.sql].value.len() as u64,
            );
            address_parameters(assembly, "x4");
            emit_immediate(assembly, "x5", existence.parameters.len() as u64);
            asm_line!(assembly, "    add x6, sp, #40");
            assembly.call(format_args!("tinytsx_sqlite_query_exists_params"));
            asm_line!(assembly, "    cbnz w0, {return_label}");
            asm_line!(assembly, "    ldr w9, [sp, #40]");
            asm_line!(assembly, "    cbnz w9, {present_label}");
            emit_guarded_response(
                assembly,
                &existence.missing,
                program,
                return_label,
                index,
                "sqlite_missing",
            )?;
            asm_line!(assembly, "    b {return_label}");
            asm_line!(assembly, "{present_label}:");
        }
        if !handler.elapsed_headers.is_empty() {
            assembly.call(format_args!("tinytsx_date_now_millis"));
            asm_line!(assembly, "    str x0, [sp, #32]");
        }
        for string in &handler.stderr {
            assembly.address("x0", format_args!("Ltinytsx_string_{string}"));
            emit_immediate(
                assembly,
                "x1",
                program.static_strings[*string].value.len() as u64,
            );
            assembly.call(format_args!("tinytsx_console_error_static"));
        }
        for action in &handler.actor_actions {
            match action {
                ActorAction::Tell {
                    actor,
                    message,
                    json_message,
                } => {
                    emit_immediate(assembly, "x0", *actor as u64);
                    match program.actors[*actor].operation {
                        ActorOperation::Counter | ActorOperation::FallibleCounter => {
                            emit_immediate(
                                assembly,
                                "x1",
                                message.expect("validated counter message") as u64,
                            );
                            assembly.call(format_args!("tinytsx_actor_tell_counter"));
                        }
                        ActorOperation::JsonMailbox => {
                            let message = json_message.expect("validated JSON message");
                            assembly.address("x1", format_args!("Ltinytsx_string_{message}"));
                            emit_immediate(
                                assembly,
                                "x2",
                                program.static_strings[message].value.len() as u64,
                            );
                            assembly.call(format_args!("tinytsx_actor_tell_json"));
                        }
                    }
                }
                ActorAction::Stop { actor } => {
                    emit_immediate(assembly, "x0", *actor as u64);
                    assembly.call(format_args!("tinytsx_actor_stop"));
                }
            }
            asm_line!(assembly, "    cbnz w0, {return_label}");
        }
        for action in &handler.sqlite_actions {
            match action {
                SqliteAction::Exec {
                    database,
                    sql,
                    parameters,
                    result,
                } => {
                    if let Some(result) = result {
                        emit_parameters(assembly, program, parameters);
                        asm_line!(assembly, "    ldr x0, [sp, #16]");
                        emit_immediate(assembly, "x1", *result as u64);
                        emit_immediate(assembly, "x2", *database as u64);
                        asm_line!(assembly, "    ldr x3, [sp, #24]");
                        assembly.address("x4", format_args!("Ltinytsx_string_{sql}"));
                        emit_immediate(
                            assembly,
                            "x5",
                            program.static_strings[*sql].value.len() as u64,
                        );
                        address_parameters(assembly, "x6");
                        emit_immediate(assembly, "x7", parameters.len() as u64);
                        assembly.call(format_args!("tinytsx_sqlite_execute_result"));
                    } else if parameters.is_empty() {
                        emit_immediate(assembly, "x0", *database as u64);
                        assembly.address("x1", format_args!("Ltinytsx_string_{sql}"));
                        emit_immediate(
                            assembly,
                            "x2",
                            program.static_strings[*sql].value.len() as u64,
                        );
                        assembly.call(format_args!("tinytsx_sqlite_execute_batch"));
                    } else {
                        emit_parameters(assembly, program, parameters);
                        emit_immediate(assembly, "x0", *database as u64);
                        asm_line!(assembly, "    ldr x1, [sp, #24]");
                        assembly.address("x2", format_args!("Ltinytsx_string_{sql}"));
                        emit_immediate(
                            assembly,
                            "x3",
                            program.static_strings[*sql].value.len() as u64,
                        );
                        address_parameters(assembly, "x4");
                        emit_immediate(assembly, "x5", parameters.len() as u64);
                        assembly.call(format_args!("tinytsx_sqlite_execute_params"));
                    }
                }
                SqliteAction::Close { database } => {
                    emit_immediate(assembly, "x0", *database as u64);
                    assembly.call(format_args!("tinytsx_sqlite_close"));
                }
                SqliteAction::Transaction { database, sql } => {
                    emit_immediate(assembly, "x0", *database as u64);
                    assembly.address("x1", format_args!("Ltinytsx_string_{sql}"));
                    emit_immediate(
                        assembly,
                        "x2",
                        program.static_strings[*sql].value.len() as u64,
                    );
                    assembly.call(format_args!("tinytsx_sqlite_transaction"));
                }
            }
            asm_line!(assembly, "    cbnz w0, {return_label}");
        }
        if let Some(request_id) = &handler.request_id {
            asm_line!(assembly, "    ldr x0, [sp, #16]");
            asm_line!(assembly, "    ldr x1, [sp, #24]");
            assembly.address("x2", format_args!("Ltinytsx_string_{}", request_id.header));
            emit_immediate(
                assembly,
                "x3",
                program.static_strings[request_id.header].value.len() as u64,
            );
            emit_immediate(assembly, "x4", request_id.max_length as u64);
            assembly.call(format_args!("tinytsx_response_header_request_id"));
            asm_line!(assembly, "    cbnz w0, {return_label}");
        }
        for (header_index, header) in handler.headers.iter().enumerate() {
            asm_line!(assembly, "    ldr x0, [sp, #16]");
            assembly.address(
                "x1",
                format_args!("Ltinytsx_handler_{index}_header_{header_index}_name"),
            );
            emit_immediate(assembly, "x2", header.name.len() as u64);
            assembly.address(
                "x3",
                format_args!("Ltinytsx_handler_{index}_header_{header_index}_value"),
            );
            emit_immediate(assembly, "x4", header.value.len() as u64);
            assembly.call(format_args!("tinytsx_response_header_static"));
            asm_line!(assembly, "    cbnz w0, {return_label}");
        }
        emit_handler_response(assembly, &handler.response, program, return_label, index)?;
        if !handler.elapsed_headers.is_empty() {
            asm_line!(assembly, "    cbnz w0, {return_label}");
            assembly.call(format_args!("tinytsx_date_now_millis"));
            asm_line!(assembly, "    str x0, [sp, #40]");
        }
        for (header_index, header) in handler.elapsed_headers.iter().enumerate() {
            asm_line!(assembly, "    ldr x0, [sp, #16]");
            assembly.address(
                "x1",
                format_args!("Ltinytsx_handler_{index}_elapsed_{header_index}_name"),
            );
            emit_immediate(assembly, "x2", header.name.len() as u64);
            asm_line!(assembly, "    ldr x3, [sp, #32]");
            asm_line!(assembly, "    ldr x4, [sp, #40]");
            assembly.address(
                "x5",
                format_args!("Ltinytsx_handler_{index}_elapsed_{header_index}_suffix"),
            );
            emit_immediate(assembly, "x6", header.suffix.len() as u64);
            assembly.call(format_args!("tinytsx_response_header_elapsed_millis"));
            asm_line!(assembly, "    cbnz w0, {return_label}");
        }
        asm_line!(assembly, "    b {return_label}");
    }
    asm_line!(assembly, "{return_label}:");
    emit_epilogue(assembly, frame_size);
    Ok(())
}

fn handler_response_frame_size(response: &HandlerResponse) -> Result<usize, String> {
    match response {
        HandlerResponse::Text { value, .. } => value_frame_size(HANDLER_SCRATCH_BASE, value),
        HandlerResponse::Stream { chunks, .. } => chunks
            .iter()
            .map(|chunk| value_frame_size(HANDLER_SCRATCH_BASE, chunk))
            .collect::<Result<Vec<_>, _>>()
            .map(|sizes| sizes.into_iter().max().unwrap_or(HANDLER_SCRATCH_BASE)),
        HandlerResponse::Html { .. } => Ok(HANDLER_SCRATCH_BASE),
    }
}

fn emit_guarded_response(
    assembly: &mut Emitter,
    guarded: &GuardedResponse,
    program: &Program,
    return_label: &str,
    handler_index: usize,
    label: &str,
) -> Result<(), String> {
    for string in &guarded.stderr {
        assembly.address("x0", format_args!("Ltinytsx_string_{string}"));
        emit_immediate(
            assembly,
            "x1",
            program.static_strings[*string].value.len() as u64,
        );
        assembly.call(format_args!("tinytsx_console_error_static"));
    }
    for (header_index, header) in guarded.headers.iter().enumerate() {
        asm_line!(assembly, "    ldr x0, [sp, #16]");
        assembly.address(
            "x1",
            format_args!("Ltinytsx_handler_{handler_index}_{label}_header_{header_index}_name"),
        );
        emit_immediate(assembly, "x2", header.name.len() as u64);
        assembly.address(
            "x3",
            format_args!("Ltinytsx_handler_{handler_index}_{label}_header_{header_index}_value"),
        );
        emit_immediate(assembly, "x4", header.value.len() as u64);
        assembly.call(format_args!("tinytsx_response_header_static"));
        asm_line!(assembly, "    cbnz w0, {return_label}");
    }
    emit_handler_response(
        assembly,
        &guarded.response,
        program,
        return_label,
        handler_index,
    )
}
