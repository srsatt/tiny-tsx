use std::fmt::Write;

use crate::hir::{ActorAction, ActorOperation, Program, ValueExpression};

pub(super) fn emit_declarations(source: &mut String) {
    source.push_str(
        "extern tiny_u32 tinytsx_actor_ask_counter(void *, tiny_usize, tiny_i64, tiny_u64);\n\
         extern tiny_u32 tinytsx_actor_tell_counter(tiny_usize, tiny_i64);\n\
         extern tiny_u32 tinytsx_actor_ask_json(void *, tiny_usize, const tiny_u8 *, tiny_usize, tiny_u64);\n\
         extern tiny_u32 tinytsx_actor_tell_json(tiny_usize, const tiny_u8 *, tiny_usize);\n\
         extern tiny_u32 tinytsx_actor_stop(tiny_usize);\n\
         extern tiny_u32 tinytsx_worker_call_static(void *, tiny_usize, const tiny_u8 *, tiny_usize);\n\
         extern tiny_u32 tinytsx_worker_call_query(void *, const void *, tiny_usize, const tiny_u8 *, tiny_usize, const tiny_u8 *, tiny_usize);\n",
    );
}

pub(super) fn emit_config(source: &mut String, program: &Program) {
    writeln!(
        source,
        "tiny_usize tinytsx_config_worker_modules(void) {{ return {}; }}",
        program.workers.len()
    )
    .unwrap();
    emit_selector(
        source,
        "tinytsx_worker_operation",
        "tiny_u32",
        &vec![1_u64; program.workers.len()],
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
    emit_selector(
        source,
        "tinytsx_supervisor_restart_max",
        "tiny_usize",
        &program
            .supervisors
            .iter()
            .map(|supervisor| supervisor.max_restarts as u64)
            .collect::<Vec<_>>(),
    );
    emit_selector(
        source,
        "tinytsx_supervisor_restart_within_ms",
        "tiny_u64",
        &program
            .supervisors
            .iter()
            .map(|supervisor| supervisor.within_ms)
            .collect::<Vec<_>>(),
    );
    emit_actor_selectors(source, program);
    emit_actor_views(source, program);
}

fn emit_actor_selectors(source: &mut String, program: &Program) {
    emit_selector(
        source,
        "tinytsx_actor_operation",
        "tiny_u32",
        &program
            .actors
            .iter()
            .map(|actor| match actor.operation {
                ActorOperation::Counter => 1,
                ActorOperation::JsonMailbox => 2,
                ActorOperation::FallibleCounter => 3,
            })
            .collect::<Vec<_>>(),
    );
    emit_selector(
        source,
        "tinytsx_actor_initial_state",
        "tiny_i64",
        &program
            .actors
            .iter()
            .map(|actor| actor.initial_state as u64)
            .collect::<Vec<_>>(),
    );
    emit_selector(
        source,
        "tinytsx_actor_failure_message",
        "tiny_i64",
        &program
            .actors
            .iter()
            .map(|actor| actor.failure_message.unwrap_or_default() as u64)
            .collect::<Vec<_>>(),
    );
    emit_selector(
        source,
        "tinytsx_actor_mailbox_capacity",
        "tiny_usize",
        &program
            .actors
            .iter()
            .map(|actor| actor.mailbox_capacity as u64)
            .collect::<Vec<_>>(),
    );
    emit_selector(
        source,
        "tinytsx_actor_restart_max",
        "tiny_usize",
        &program
            .actors
            .iter()
            .map(|actor| {
                actor
                    .restart
                    .as_ref()
                    .map_or(0, |restart| restart.max_restarts) as u64
            })
            .collect::<Vec<_>>(),
    );
    emit_selector(
        source,
        "tinytsx_actor_restart_within_ms",
        "tiny_u64",
        &program
            .actors
            .iter()
            .map(|actor| {
                actor
                    .restart
                    .as_ref()
                    .map_or(0, |restart| restart.within_ms)
            })
            .collect::<Vec<_>>(),
    );
    emit_selector(
        source,
        "tinytsx_actor_supervisor",
        "tiny_usize",
        &program
            .actors
            .iter()
            .map(|actor| {
                actor
                    .supervisor
                    .map_or(0, |supervisor| supervisor as u64 + 1)
            })
            .collect::<Vec<_>>(),
    );
    emit_selector(
        source,
        "tinytsx_actor_persistence_database",
        "tiny_usize",
        &program
            .actors
            .iter()
            .map(|actor| {
                actor
                    .persistence
                    .as_ref()
                    .map_or(0, |persistence| persistence.database as u64 + 1)
            })
            .collect::<Vec<_>>(),
    );
}

pub(super) fn emit_actor_actions(
    source: &mut String,
    actions: &[ActorAction],
    program: &Program,
    indent: &str,
) {
    for (index, action) in actions.iter().enumerate() {
        let call = match action {
            ActorAction::Tell {
                actor,
                message,
                json_message,
            } => match program.actors[*actor].operation {
                ActorOperation::Counter | ActorOperation::FallibleCounter => format!(
                    "tinytsx_actor_tell_counter({actor}, {})",
                    message.expect("validated counter message")
                ),
                ActorOperation::JsonMailbox => {
                    let message = json_message.expect("validated JSON message");
                    format!(
                        "tinytsx_actor_tell_json({actor}, tinytsx_string_{message}, {})",
                        program.static_strings[message].value.len()
                    )
                }
            },
            ActorAction::Stop { actor } => format!("tinytsx_actor_stop({actor})"),
        };
        writeln!(source, "{indent}tiny_u32 actor_status_{index} = {call};").unwrap();
        writeln!(
            source,
            "{indent}if (actor_status_{index} != 0) return actor_status_{index};"
        )
        .unwrap();
    }
}

pub(super) fn emit_actor_call(
    source: &mut String,
    indent: &str,
    actor: usize,
    message: Option<i64>,
    json_message: Option<usize>,
    timeout_ms: Option<u64>,
    program: &Program,
) {
    let call = match program.actors[actor].operation {
        ActorOperation::Counter | ActorOperation::FallibleCounter => format!(
            "tinytsx_actor_ask_counter(writer, {actor}, {}, {})",
            message.expect("validated counter message"),
            timeout_ms.unwrap_or(0)
        ),
        ActorOperation::JsonMailbox => {
            let message = json_message.expect("validated JSON message");
            format!(
                "tinytsx_actor_ask_json(writer, {actor}, tinytsx_string_{message}, {}, {})",
                program.static_strings[message].value.len(),
                timeout_ms.unwrap_or(0)
            )
        }
    };
    writeln!(source, "{indent}status = {call};").unwrap();
    writeln!(source, "{indent}if (status != 0) return status;").unwrap();
}

pub(super) fn emit_worker_call(
    source: &mut String,
    indent: &str,
    worker: usize,
    input: &ValueExpression,
    program: &Program,
) -> Result<(), String> {
    let call = match input {
        ValueExpression::StringLiteral { string, .. } => format!(
            "tinytsx_worker_call_static(writer, {worker}, tinytsx_string_{string}, {})",
            program.static_strings[*string].value.len()
        ),
        ValueExpression::QueryParameter {
            query, fallback, ..
        } => {
            let (fallback, fallback_len) = fallback.map_or_else(
                || ("(const tiny_u8 *)0".to_owned(), 0),
                |fallback| {
                    (
                        format!("tinytsx_string_{fallback}"),
                        program.static_strings[fallback].value.len(),
                    )
                },
            );
            format!(
                "tinytsx_worker_call_query(writer, request, {worker}, tinytsx_string_{query}, {}, {fallback}, {fallback_len})",
                program.static_strings[*query].value.len()
            )
        }
        _ => return Err("unsupported portable worker call input".to_owned()),
    };
    writeln!(source, "{indent}status = {call};").unwrap();
    writeln!(source, "{indent}if (status != 0) return status;").unwrap();
    Ok(())
}

fn emit_actor_views(source: &mut String, program: &Program) {
    for (index, actor) in program.actors.iter().enumerate() {
        if let Some(persistence) = &actor.persistence {
            emit_bytes(
                source,
                &format!("tinytsx_actor_persistence_key_{index}"),
                persistence.key.as_bytes(),
            );
        }
    }
    source.push_str("tiny_u32 tinytsx_actor_initial_json(tiny_usize actor, const tiny_u8 **pointer, tiny_usize *length) {\n  if (!pointer || !length) return 4;\n  switch (actor) {\n");
    for (index, actor) in program.actors.iter().enumerate() {
        if let Some(initial) = actor.initial_json {
            writeln!(
                source,
                "    case {index}: *pointer = tinytsx_string_{initial}; *length = {}; return 0;",
                program.static_strings[initial].value.len()
            )
            .unwrap();
        }
    }
    source.push_str("    default: return 4;\n  }\n}\n");
    source.push_str("tiny_u32 tinytsx_actor_persistence_key(tiny_usize actor, const tiny_u8 **pointer, tiny_usize *length) {\n  if (!pointer || !length) return 4;\n  switch (actor) {\n");
    for (index, actor) in program.actors.iter().enumerate() {
        if let Some(persistence) = &actor.persistence {
            writeln!(
                source,
                "    case {index}: *pointer = tinytsx_actor_persistence_key_{index}; *length = {}; return 0;",
                persistence.key.len()
            )
            .unwrap();
        }
    }
    source.push_str("    default: return 4;\n  }\n}\n");
}

fn emit_selector(source: &mut String, name: &str, result: &str, values: &[u64]) {
    writeln!(source, "{result} {name}(tiny_usize index) {{").unwrap();
    source.push_str("  switch (index) {\n");
    for (index, value) in values.iter().enumerate() {
        writeln!(source, "    case {index}: return {value}ULL;").unwrap();
    }
    source.push_str("    default: return 0;\n  }\n}\n");
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
