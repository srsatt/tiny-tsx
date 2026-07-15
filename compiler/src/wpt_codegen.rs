use std::fmt::Write;

use crate::wpt_hir::{WptOperation, WptProgram, WptTest};

const RUNTIME: &str = include_str!("wpt_url_runtime.c");

pub fn emit_c(program: &WptProgram) -> Result<String, String> {
    program.validate()?;
    let mut source = String::from(RUNTIME);
    emit_static_data(&mut source, program);
    writeln!(source, "\nint main(void) {{").unwrap();
    for (test_index, test) in program.tests.iter().enumerate() {
        emit_test(&mut source, test_index, test);
    }
    writeln!(source, "    return 0;\n}}").unwrap();
    Ok(source)
}

fn emit_test(source: &mut String, test_index: usize, test: &WptTest) {
    writeln!(source, "    {{").unwrap();
    writeln!(
        source,
        "        tiny_url_search_params params[{}] = {{0}};",
        test.slots
    )
    .unwrap();
    if test.url_slots > 0 {
        writeln!(source, "        tiny_url urls[{}] = {{0}};", test.url_slots).unwrap();
    }
    if test.operations.iter().any(needs_output_buffer) {
        writeln!(
            source,
            "        unsigned char output[TINY_URL_OUTPUT_CAPACITY];"
        )
        .unwrap();
        writeln!(source, "        size_t output_len = 0;").unwrap();
    }
    for (operation_index, operation) in test.operations.iter().enumerate() {
        emit_operation(source, test_index, operation_index, operation);
    }
    writeln!(source, "    }}").unwrap();
}

fn needs_output_buffer(operation: &WptOperation) -> bool {
    matches!(
        operation,
        WptOperation::AssertStringified { .. } | WptOperation::UrlAssertStringified { .. }
    )
}

fn emit_static_data(source: &mut String, program: &WptProgram) {
    for (test_index, test) in program.tests.iter().enumerate() {
        for (operation_index, operation) in test.operations.iter().enumerate() {
            let prefix = format!("tiny_t{test_index}_o{operation_index}");
            match operation {
                WptOperation::Construct { input, .. }
                | WptOperation::UrlConstruct { input, .. } => {
                    emit_bytes(source, &format!("{prefix}_input"), input.as_bytes());
                }
                WptOperation::Append { name, value, .. } => {
                    emit_bytes(source, &format!("{prefix}_name"), name.as_bytes());
                    emit_bytes(source, &format!("{prefix}_value"), value.as_bytes());
                }
                WptOperation::Delete { name, value, .. }
                | WptOperation::AssertHas { name, value, .. } => {
                    emit_bytes(source, &format!("{prefix}_name"), name.as_bytes());
                    if let Some(value) = value {
                        emit_bytes(source, &format!("{prefix}_value"), value.as_bytes());
                    }
                }
                WptOperation::AssertGet { name, expected, .. } => {
                    emit_bytes(source, &format!("{prefix}_name"), name.as_bytes());
                    if let Some(expected) = expected {
                        emit_bytes(source, &format!("{prefix}_expected"), expected.as_bytes());
                    }
                }
                WptOperation::AssertStringified { expected, .. }
                | WptOperation::UrlAssertStringified { expected, .. } => {
                    emit_bytes(source, &format!("{prefix}_expected"), expected.as_bytes());
                }
                WptOperation::AssertConstructed { .. } => {}
            }
        }
    }
}

fn emit_operation(
    source: &mut String,
    test_index: usize,
    operation_index: usize,
    operation: &WptOperation,
) {
    let prefix = format!("tiny_t{test_index}_o{operation_index}");
    match operation {
        WptOperation::Construct { slot, .. } => {
            writeln!(
                source,
                "        if (!tiny_url_search_params_construct(&params[{slot}], {prefix}_input, {prefix}_input_len)) return 1;"
            )
            .unwrap();
        }
        WptOperation::Append { slot, .. } => {
            writeln!(
                source,
                "        if (!tiny_url_search_params_append(&params[{slot}], {prefix}_name, {prefix}_name_len, {prefix}_value, {prefix}_value_len)) return 1;"
            )
            .unwrap();
        }
        WptOperation::Delete { slot, value, .. } => {
            let (value_pointer, value_length, has_value) = optional_value(&prefix, value);
            writeln!(
                source,
                "        tiny_url_search_params_delete(&params[{slot}], {prefix}_name, {prefix}_name_len, {value_pointer}, {value_length}, {has_value});"
            )
            .unwrap();
        }
        WptOperation::AssertConstructed { slot, .. } => {
            writeln!(source, "        if (!params[{slot}].constructed) return 1;").unwrap();
        }
        WptOperation::AssertGet { slot, expected, .. } => {
            writeln!(
                source,
                "        const tiny_url_search_param *found_{operation_index} = tiny_url_search_params_find(&params[{slot}], {prefix}_name, {prefix}_name_len, NULL, 0, 0);"
            )
            .unwrap();
            if expected.is_some() {
                writeln!(
                    source,
                    "        if (found_{operation_index} == NULL || !tiny_owned_equal(&found_{operation_index}->value, {prefix}_expected, {prefix}_expected_len)) return 1;"
                )
                .unwrap();
            } else {
                writeln!(
                    source,
                    "        if (found_{operation_index} != NULL) return 1;"
                )
                .unwrap();
            }
        }
        WptOperation::AssertHas {
            slot,
            value,
            expected,
            ..
        } => {
            let (value_pointer, value_length, has_value) = optional_value(&prefix, value);
            writeln!(
                source,
                "        int found_{operation_index} = tiny_url_search_params_find(&params[{slot}], {prefix}_name, {prefix}_name_len, {value_pointer}, {value_length}, {has_value}) != NULL;"
            )
            .unwrap();
            writeln!(
                source,
                "        if (found_{operation_index} != {}) return 1;",
                i32::from(*expected)
            )
            .unwrap();
        }
        WptOperation::AssertStringified { slot, .. } => {
            writeln!(
                source,
                "        if (!tiny_url_search_params_stringify(&params[{slot}], output, sizeof(output), &output_len)) return 1;"
            )
            .unwrap();
            emit_output_assertion(source, &prefix);
        }
        WptOperation::UrlConstruct {
            url_slot,
            params_slot,
            ..
        } => {
            writeln!(
                source,
                "        if (!tiny_url_construct(&urls[{url_slot}], &params[{params_slot}], {prefix}_input, {prefix}_input_len)) return 1;"
            )
            .unwrap();
        }
        WptOperation::UrlAssertStringified { url_slot, .. } => {
            writeln!(
                source,
                "        if (!tiny_url_stringify(&urls[{url_slot}], output, sizeof(output), &output_len)) return 1;"
            )
            .unwrap();
            emit_output_assertion(source, &prefix);
        }
    }
}

fn emit_output_assertion(source: &mut String, prefix: &str) {
    writeln!(
        source,
        "        if (!tiny_bytes_equal(output, output_len, {prefix}_expected, {prefix}_expected_len)) return 1;"
    )
    .unwrap();
}

fn optional_value(prefix: &str, value: &Option<String>) -> (String, String, i32) {
    if value.is_some() {
        (format!("{prefix}_value"), format!("{prefix}_value_len"), 1)
    } else {
        ("NULL".to_owned(), "0".to_owned(), 0)
    }
}

fn emit_bytes(source: &mut String, name: &str, bytes: &[u8]) {
    write!(source, "static const unsigned char {name}[] = {{").unwrap();
    if bytes.is_empty() {
        write!(source, "0").unwrap();
    } else {
        for (index, byte) in bytes.iter().enumerate() {
            if index > 0 {
                write!(source, ", ").unwrap();
            }
            write!(source, "{byte}").unwrap();
        }
    }
    writeln!(source, "}};").unwrap();
    writeln!(source, "static const size_t {name}_len = {};", bytes.len()).unwrap();
}
