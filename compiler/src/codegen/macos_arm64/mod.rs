use crate::{codegen::Options, hir::Program};

use super::{
    aarch64::emit_immediate,
    assembly::{Assembly, asm_line},
};

mod data;
mod functions;
mod handlers;
mod response;
mod values;

#[cfg(test)]
mod tests;

use data::emit_static_data;
use functions::{emit_function, emit_value_function};
use handlers::emit_handlers;

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
