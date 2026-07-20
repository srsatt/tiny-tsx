use std::fmt::Write;

use crate::hir::{
    Program, SqliteAction, SqliteExistence, SqliteParameter, SqliteQueryMode, SqliteTransactionStep,
};

pub(super) fn emit_declarations(source: &mut String) {
    source.push_str(
        "typedef struct { tiny_usize kind; tiny_usize value; const tiny_u8 *pointer; } tiny_sql_parameter;\n\
         typedef struct { const tiny_u8 *sql; tiny_usize sql_length; const tiny_sql_parameter *parameters; tiny_usize parameter_count; } tiny_sql_transaction_step;\n\
         extern tiny_u32 tinytsx_sqlite_execute_batch(tiny_usize, const tiny_u8 *, tiny_usize);\n\
         extern tiny_u32 tinytsx_sqlite_transaction(tiny_usize, const tiny_u8 *, tiny_usize);\n\
         extern tiny_u32 tinytsx_sqlite_transaction_params(tiny_usize, const void *, const tiny_sql_transaction_step *, tiny_usize);\n\
         extern tiny_u32 tinytsx_sqlite_close(tiny_usize);\n\
         extern tiny_u32 tinytsx_sqlite_execute_params(tiny_usize, const void *, const tiny_u8 *, tiny_usize, const tiny_sql_parameter *, tiny_usize);\n\
         extern tiny_u32 tinytsx_sqlite_execute_result(void *, tiny_usize, tiny_usize, const void *, const tiny_u8 *, tiny_usize, const tiny_sql_parameter *, tiny_usize);\n\
         extern tiny_u32 tinytsx_html_write_sqlite_changes(void *, tiny_usize);\n\
         extern tiny_u32 tinytsx_html_write_sqlite_last_insert_row_id(void *, tiny_usize, tiny_u32);\n\
         extern tiny_u32 tinytsx_sqlite_query_json(void *, tiny_usize, const tiny_u8 *, tiny_usize, tiny_u32);\n\
         extern tiny_u32 tinytsx_sqlite_query_json_params(void *, const void *, tiny_usize, const tiny_u8 *, tiny_usize, tiny_u32, const tiny_sql_parameter *, tiny_usize);\n\
         extern tiny_u32 tinytsx_sqlite_query_exists_params(tiny_usize, const void *, const tiny_u8 *, tiny_usize, const tiny_sql_parameter *, tiny_usize, tiny_u32 *);\n",
    );
}

pub(super) fn emit_actions(
    source: &mut String,
    actions: &[SqliteAction],
    program: &Program,
    indent: &str,
) -> Result<(), String> {
    for (action_index, action) in actions.iter().enumerate() {
        writeln!(source, "{indent}{{").unwrap();
        let nested = format!("{indent}  ");
        match action {
            SqliteAction::Exec {
                database,
                sql,
                parameters,
                result,
            } => {
                let pointer = emit_parameters(
                    source,
                    &nested,
                    &format!("sqlite_action_{action_index}_parameters"),
                    parameters,
                    program,
                );
                let sql_length = program.static_strings[*sql].value.len();
                if let Some(result) = result {
                    writeln!(
                        source,
                        "{nested}tiny_u32 sqlite_status = tinytsx_sqlite_execute_result(writer, {result}, {database}, request, tinytsx_string_{sql}, {sql_length}, {pointer}, {});",
                        parameters.len()
                    )
                    .unwrap();
                } else if parameters.is_empty() {
                    writeln!(
                        source,
                        "{nested}tiny_u32 sqlite_status = tinytsx_sqlite_execute_batch({database}, tinytsx_string_{sql}, {sql_length});"
                    )
                    .unwrap();
                } else {
                    writeln!(
                        source,
                        "{nested}tiny_u32 sqlite_status = tinytsx_sqlite_execute_params({database}, request, tinytsx_string_{sql}, {sql_length}, {pointer}, {});",
                        parameters.len()
                    )
                    .unwrap();
                }
            }
            SqliteAction::Close { database } => {
                writeln!(
                    source,
                    "{nested}tiny_u32 sqlite_status = tinytsx_sqlite_close({database});"
                )
                .unwrap();
            }
            SqliteAction::Transaction { database, sql } => {
                writeln!(
                    source,
                    "{nested}tiny_u32 sqlite_status = tinytsx_sqlite_transaction({database}, tinytsx_string_{sql}, {});",
                    program.static_strings[*sql].value.len()
                )
                .unwrap();
            }
            SqliteAction::TransactionSteps { database, steps } => {
                emit_transaction_steps(source, &nested, action_index, steps, program);
                writeln!(
                    source,
                    "{nested}tiny_u32 sqlite_status = tinytsx_sqlite_transaction_params({database}, request, sqlite_action_{action_index}_steps, {});",
                    steps.len()
                )
                .unwrap();
            }
        }
        writeln!(
            source,
            "{nested}if (sqlite_status != 0) return sqlite_status;"
        )
        .unwrap();
        writeln!(source, "{indent}}}").unwrap();
    }
    Ok(())
}

pub(super) fn emit_existence_check(
    source: &mut String,
    existence: &SqliteExistence,
    program: &Program,
    indent: &str,
) {
    writeln!(source, "{indent}{{").unwrap();
    let nested = format!("{indent}  ");
    let pointer = emit_parameters(
        source,
        &nested,
        "sqlite_existence_parameters",
        &existence.parameters,
        program,
    );
    writeln!(source, "{nested}tiny_u32 sqlite_exists = 0;").unwrap();
    writeln!(
        source,
        "{nested}tiny_u32 sqlite_status = tinytsx_sqlite_query_exists_params({}, request, tinytsx_string_{}, {}, {pointer}, {}, &sqlite_exists);",
        existence.database,
        existence.sql,
        program.static_strings[existence.sql].value.len(),
        existence.parameters.len()
    )
    .unwrap();
    writeln!(
        source,
        "{nested}if (sqlite_status != 0) return sqlite_status;"
    )
    .unwrap();
    writeln!(source, "{nested}if (!sqlite_exists) {{").unwrap();
}

pub(super) fn emit_query(
    source: &mut String,
    indent: &str,
    database: usize,
    sql: usize,
    mode: &SqliteQueryMode,
    parameters: &[SqliteParameter],
    program: &Program,
) {
    let first = u32::from(matches!(mode, SqliteQueryMode::First));
    let sql_length = program.static_strings[sql].value.len();
    if parameters.is_empty() {
        writeln!(
            source,
            "{indent}status = tinytsx_sqlite_query_json(writer, {database}, tinytsx_string_{sql}, {sql_length}, {first});"
        )
        .unwrap();
        writeln!(source, "{indent}if (status != 0) return status;").unwrap();
        return;
    }
    writeln!(source, "{indent}{{").unwrap();
    let nested = format!("{indent}  ");
    let pointer = emit_parameters(
        source,
        &nested,
        "sqlite_query_parameters",
        parameters,
        program,
    );
    writeln!(
        source,
        "{nested}status = tinytsx_sqlite_query_json_params(writer, request, {database}, tinytsx_string_{sql}, {sql_length}, {first}, {pointer}, {});",
        parameters.len()
    )
    .unwrap();
    writeln!(source, "{nested}if (status != 0) return status;").unwrap();
    writeln!(source, "{indent}}}").unwrap();
}

fn emit_parameters(
    source: &mut String,
    indent: &str,
    name: &str,
    parameters: &[SqliteParameter],
    program: &Program,
) -> String {
    if parameters.is_empty() {
        return "(const tiny_sql_parameter *)0".to_owned();
    }
    writeln!(source, "{indent}tiny_sql_parameter {name}[] = {{").unwrap();
    for parameter in parameters {
        let (kind, value, pointer) = match parameter {
            SqliteParameter::RouteParameter { segment } => {
                (1, segment.to_string(), "(const tiny_u8 *)0".to_owned())
            }
            SqliteParameter::QueryParameter {
                string,
                query_length,
                fallback_length,
            } => (
                10,
                format!("((tiny_usize){fallback_length} << 32) | {query_length}"),
                format!("tinytsx_string_{string}"),
            ),
            SqliteParameter::RequestJsonField { field } => (
                2,
                program.static_strings[*field].value.len().to_string(),
                format!("tinytsx_string_{field}"),
            ),
            SqliteParameter::RandomUuid => (3, "0".to_owned(), "(const tiny_u8 *)0".to_owned()),
            SqliteParameter::StaticString { string } => (
                4,
                program.static_strings[*string].value.len().to_string(),
                format!("tinytsx_string_{string}"),
            ),
            SqliteParameter::StaticInteger { value } => (
                5,
                format!("(tiny_usize)(tiny_i64){value}"),
                "(const tiny_u8 *)0".to_owned(),
            ),
            SqliteParameter::StaticReal { value } => (
                6,
                format!("{}ULL", value.to_bits()),
                "(const tiny_u8 *)0".to_owned(),
            ),
            SqliteParameter::StaticBoolean { value } => (
                7,
                u32::from(*value).to_string(),
                "(const tiny_u8 *)0".to_owned(),
            ),
            SqliteParameter::Null => (8, "0".to_owned(), "(const tiny_u8 *)0".to_owned()),
            SqliteParameter::RequestHeader { header } => (
                9,
                program.static_strings[*header].value.len().to_string(),
                format!("tinytsx_string_{header}"),
            ),
        };
        writeln!(source, "{indent}  {{{kind}, {value}, {pointer}}},").unwrap();
    }
    writeln!(source, "{indent}}};").unwrap();
    name.to_owned()
}

fn emit_transaction_steps(
    source: &mut String,
    indent: &str,
    action_index: usize,
    steps: &[SqliteTransactionStep],
    program: &Program,
) {
    for (step_index, step) in steps.iter().enumerate() {
        emit_parameters(
            source,
            indent,
            &format!("sqlite_action_{action_index}_step_{step_index}_parameters"),
            &step.parameters,
            program,
        );
    }
    writeln!(
        source,
        "{indent}tiny_sql_transaction_step sqlite_action_{action_index}_steps[] = {{"
    )
    .unwrap();
    for (step_index, step) in steps.iter().enumerate() {
        let pointer = if step.parameters.is_empty() {
            "(const tiny_sql_parameter *)0".to_owned()
        } else {
            format!("sqlite_action_{action_index}_step_{step_index}_parameters")
        };
        writeln!(
            source,
            "{indent}  {{tinytsx_string_{}, {}, {pointer}, {}}},",
            step.sql,
            program.static_strings[step.sql].value.len(),
            step.parameters.len()
        )
        .unwrap();
    }
    writeln!(source, "{indent}}};").unwrap();
}
