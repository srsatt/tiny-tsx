use crate::{codegen::Options, hir::Program};

use super::{
    aarch64::{Dialect, Emitter, emit_immediate},
    assembly::asm_line,
};

mod data;
mod functions;
mod handlers;
mod response;
mod sqlite;
mod values;

#[cfg(test)]
mod tests;

use data::emit_static_data;
use functions::{emit_function, emit_value_function};
use handlers::emit_handlers;

pub(super) fn emit(
    program: &Program,
    options: Options,
    dialect: Dialect,
) -> Result<String, String> {
    program.validate()?;
    let mut assembly = Emitter::new(dialect);
    assembly.text_section();

    for function in &program.functions {
        emit_value_function(&mut assembly, function.id, &function.body, program)?;
    }

    for component in &program.components {
        emit_function(
            &mut assembly,
            &format!("tinytsx_component_{}", component.id),
            &component.html,
            program,
        );
    }

    emit_handlers(&mut assembly, program)?;
    emit_config(&mut assembly, &options, program);
    emit_static_data(&mut assembly, program, &options)?;
    Ok(assembly.finish())
}

fn emit_config(assembly: &mut Emitter, options: &Options, program: &Program) {
    assembly.global_function(format_args!("tinytsx_config_port"));
    emit_immediate(assembly, "x0", u64::from(options.port));
    asm_line!(assembly, "    ret");

    assembly.global_function(format_args!("tinytsx_config_workers"));
    emit_immediate(assembly, "x0", options.workers as u64);
    asm_line!(assembly, "    ret");

    assembly.global_function(format_args!("tinytsx_config_request_memory"));
    emit_immediate(assembly, "x0", options.request_memory as u64);
    asm_line!(assembly, "    ret");

    assembly.global_function(format_args!("tinytsx_config_worker_modules"));
    emit_immediate(assembly, "x0", program.workers.len() as u64);
    asm_line!(assembly, "    ret");

    assembly.global_function(format_args!("tinytsx_config_provider_transport"));
    emit_immediate(assembly, "x0", u64::from(program.uses_openai_transport()));
    asm_line!(assembly, "    ret");

    let environment = program.environment_variable_ids();
    assembly.global_function(format_args!("tinytsx_config_environment_variables"));
    emit_immediate(assembly, "x0", environment.len() as u64);
    asm_line!(assembly, "    ret");

    assembly.global_function(format_args!("tinytsx_config_environment_variable"));
    asm_line!(
        assembly,
        "    cbz x1, Ltinytsx_environment_variable_invalid"
    );
    asm_line!(
        assembly,
        "    cbz x2, Ltinytsx_environment_variable_invalid"
    );
    for (index, _) in environment.iter().enumerate() {
        asm_line!(assembly, "    cmp x0, #{index}");
        asm_line!(assembly, "    b.eq Ltinytsx_environment_variable_{index}");
    }
    asm_line!(assembly, "Ltinytsx_environment_variable_invalid:");
    emit_immediate(assembly, "x0", 4);
    asm_line!(assembly, "    ret");
    for (index, string) in environment.iter().enumerate() {
        asm_line!(assembly, "Ltinytsx_environment_variable_{index}:");
        assembly.address("x3", format_args!("Ltinytsx_string_{string}"));
        asm_line!(assembly, "    str x3, [x1]");
        emit_immediate(
            assembly,
            "x3",
            program.static_strings[*string].value.len() as u64,
        );
        asm_line!(assembly, "    str x3, [x2]");
        asm_line!(assembly, "    mov x0, #0");
        asm_line!(assembly, "    ret");
    }

    let read_roots = if program.uses_filesystem() {
        options.read_roots.as_slice()
    } else {
        &[]
    };
    assembly.global_function(format_args!("tinytsx_config_read_roots"));
    emit_immediate(assembly, "x0", read_roots.len() as u64);
    asm_line!(assembly, "    ret");

    assembly.global_function(format_args!("tinytsx_config_read_root"));
    asm_line!(assembly, "    cbz x1, Ltinytsx_read_root_invalid");
    asm_line!(assembly, "    cbz x2, Ltinytsx_read_root_invalid");
    for (index, _) in read_roots.iter().enumerate() {
        asm_line!(assembly, "    cmp x0, #{index}");
        asm_line!(assembly, "    b.eq Ltinytsx_read_root_{index}");
    }
    asm_line!(assembly, "Ltinytsx_read_root_invalid:");
    emit_immediate(assembly, "x0", 4);
    asm_line!(assembly, "    ret");
    for (index, root) in read_roots.iter().enumerate() {
        asm_line!(assembly, "Ltinytsx_read_root_{index}:");
        assembly.address("x3", format_args!("Ltinytsx_read_root_data_{index}"));
        asm_line!(assembly, "    str x3, [x1]");
        emit_immediate(assembly, "x3", root.len() as u64);
        asm_line!(assembly, "    str x3, [x2]");
        asm_line!(assembly, "    mov x0, #0");
        asm_line!(assembly, "    ret");
    }

    assembly.global_function(format_args!("tinytsx_worker_operation"));
    emit_immediate(assembly, "x1", program.workers.len() as u64);
    asm_line!(assembly, "    cmp x0, x1");
    asm_line!(assembly, "    b.hs Ltinytsx_worker_operation_invalid");
    emit_immediate(assembly, "x0", 1);
    asm_line!(assembly, "    ret");
    asm_line!(assembly, "Ltinytsx_worker_operation_invalid:");
    asm_line!(assembly, "    mov x0, #0");
    asm_line!(assembly, "    ret");

    assembly.global_function(format_args!("tinytsx_config_actors"));
    emit_immediate(assembly, "x0", program.actors.len() as u64);
    asm_line!(assembly, "    ret");

    for (name, selector) in [
        ("tinytsx_actor_operation", 0_u8),
        ("tinytsx_actor_initial_state", 1_u8),
        ("tinytsx_actor_mailbox_capacity", 2_u8),
    ] {
        assembly.global_function(format_args!("{name}"));
        for (index, actor) in program.actors.iter().enumerate() {
            asm_line!(assembly, "    cmp x0, #{index}");
            asm_line!(assembly, "    b.eq L{name}_{index}");
            let _ = actor;
        }
        asm_line!(assembly, "    mov x0, #0");
        asm_line!(assembly, "    ret");
        for (index, actor) in program.actors.iter().enumerate() {
            asm_line!(assembly, "L{name}_{index}:");
            let value = match selector {
                0 => 1,
                1 => actor.initial_state as u64,
                _ => actor.mailbox_capacity as u64,
            };
            emit_immediate(assembly, "x0", value);
            asm_line!(assembly, "    ret");
        }
    }

    assembly.global_function(format_args!("tinytsx_actor_persistence_database"));
    for (index, _actor) in program.actors.iter().enumerate() {
        asm_line!(assembly, "    cmp x0, #{index}");
        asm_line!(assembly, "    b.eq Ltinytsx_actor_persistence_database_{index}");
    }
    asm_line!(assembly, "    mov x0, #0");
    asm_line!(assembly, "    ret");
    for (index, actor) in program.actors.iter().enumerate() {
        asm_line!(assembly, "Ltinytsx_actor_persistence_database_{index}:");
        emit_immediate(
            assembly,
            "x0",
            actor.persistence.as_ref().map_or(0, |value| value.database + 1) as u64,
        );
        asm_line!(assembly, "    ret");
    }

    assembly.global_function(format_args!("tinytsx_actor_persistence_key"));
    asm_line!(assembly, "    cbz x1, Ltinytsx_actor_persistence_key_invalid");
    asm_line!(assembly, "    cbz x2, Ltinytsx_actor_persistence_key_invalid");
    for (index, actor) in program.actors.iter().enumerate() {
        if actor.persistence.is_some() {
            asm_line!(assembly, "    cmp x0, #{index}");
            asm_line!(assembly, "    b.eq Ltinytsx_actor_persistence_key_{index}");
        }
    }
    asm_line!(assembly, "Ltinytsx_actor_persistence_key_invalid:");
    emit_immediate(assembly, "x0", 4);
    asm_line!(assembly, "    ret");
    for (index, actor) in program.actors.iter().enumerate() {
        let Some(persistence) = &actor.persistence else { continue };
        asm_line!(assembly, "Ltinytsx_actor_persistence_key_{index}:");
        assembly.address("x3", format_args!("Ltinytsx_actor_persistence_key_data_{index}"));
        asm_line!(assembly, "    str x3, [x1]");
        emit_immediate(assembly, "x3", persistence.key.len() as u64);
        asm_line!(assembly, "    str x3, [x2]");
        asm_line!(assembly, "    mov x0, #0");
        asm_line!(assembly, "    ret");
    }

    assembly.global_function(format_args!("tinytsx_config_sqlite_databases"));
    emit_immediate(assembly, "x0", program.sqlite_databases.len() as u64);
    asm_line!(assembly, "    ret");

    assembly.global_function(format_args!("tinytsx_config_sqlite_database_path"));
    asm_line!(assembly, "    cbz x1, Ltinytsx_sqlite_database_path_invalid");
    asm_line!(assembly, "    cbz x2, Ltinytsx_sqlite_database_path_invalid");
    for (index, _) in program.sqlite_databases.iter().enumerate() {
        asm_line!(assembly, "    cmp x0, #{index}");
        asm_line!(assembly, "    b.eq Ltinytsx_sqlite_database_path_{index}");
    }
    asm_line!(assembly, "Ltinytsx_sqlite_database_path_invalid:");
    emit_immediate(assembly, "x0", 4);
    asm_line!(assembly, "    ret");
    for (index, database) in program.sqlite_databases.iter().enumerate() {
        asm_line!(assembly, "Ltinytsx_sqlite_database_path_{index}:");
        assembly.address("x3", format_args!("Ltinytsx_sqlite_database_path_data_{index}"));
        asm_line!(assembly, "    str x3, [x1]");
        emit_immediate(assembly, "x3", database.path.len() as u64);
        asm_line!(assembly, "    str x3, [x2]");
        asm_line!(assembly, "    mov x0, #0");
        asm_line!(assembly, "    ret");
    }
}
