use crate::hir::Program;

use super::super::{
    aarch64::Emitter,
    assembly::{asm_line, asm_write},
    constant_data,
};

pub(super) fn emit_static_data(assembly: &mut Emitter, program: &Program) -> Result<(), String> {
    assembly.const_section();
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

fn emit_bytes(assembly: &mut Emitter, bytes: &[u8]) {
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
