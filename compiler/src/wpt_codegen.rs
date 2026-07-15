use std::fmt::Write;

use crate::wpt_hir::{WptOperation, WptProgram};

const PRELUDE: &str = "#include <stddef.h>\n#include <string.h>\n\n\
#define TINY_URL_SEARCH_PARAMS_CAPACITY 64\n\n\
typedef struct {\n\
    const unsigned char *bytes;\n\
    size_t length;\n\
} tiny_string_view;\n\n\
typedef struct {\n\
    tiny_string_view name;\n\
    tiny_string_view value;\n\
} tiny_url_search_param;\n\n\
typedef struct {\n\
    tiny_url_search_param pairs[TINY_URL_SEARCH_PARAMS_CAPACITY];\n\
    size_t length;\n\
    int constructed;\n\
} tiny_url_search_params;\n\n\
static int tiny_bytes_equal(const unsigned char *left, size_t left_len,\n\
                            const unsigned char *right, size_t right_len) {\n\
    return left_len == right_len && (left_len == 0 || memcmp(left, right, left_len) == 0);\n\
}\n\n\
static int tiny_view_equal(tiny_string_view view,\n\
                           const unsigned char *bytes, size_t length) {\n\
    return tiny_bytes_equal(view.bytes, view.length, bytes, length);\n\
}\n\n\
static int tiny_url_search_params_push(\n\
    tiny_url_search_params *params,\n\
    const unsigned char *name, size_t name_len,\n\
    const unsigned char *value, size_t value_len\n\
) {\n\
    if (params->length == TINY_URL_SEARCH_PARAMS_CAPACITY) return 0;\n\
    tiny_url_search_param *pair = &params->pairs[params->length++];\n\
    pair->name = (tiny_string_view){name, name_len};\n\
    pair->value = (tiny_string_view){value, value_len};\n\
    return 1;\n\
}\n\n\
static int tiny_url_search_params_construct(\n\
    tiny_url_search_params *params,\n\
    const unsigned char *input, size_t input_len\n\
) {\n\
    params->length = 0;\n\
    params->constructed = 1;\n\
    size_t start = input_len > 0 && input[0] == '?' ? 1 : 0;\n\
    while (start <= input_len) {\n\
        size_t end = start;\n\
        while (end < input_len && input[end] != '&') end++;\n\
        if (end > start) {\n\
            size_t equals = start;\n\
            while (equals < end && input[equals] != '=') equals++;\n\
            const unsigned char *value = input + (equals < end ? equals + 1 : end);\n\
            size_t value_len = equals < end ? end - equals - 1 : 0;\n\
            if (!tiny_url_search_params_push(\n\
                    params, input + start, equals - start, value, value_len)) return 0;\n\
        }\n\
        if (end == input_len) break;\n\
        start = end + 1;\n\
    }\n\
    return 1;\n\
}\n\n\
static void __attribute__((unused)) tiny_url_search_params_delete(\n\
    tiny_url_search_params *params,\n\
    const unsigned char *name, size_t name_len,\n\
    const unsigned char *value, size_t value_len, int has_value\n\
) {\n\
    size_t index = 0;\n\
    while (index < params->length) {\n\
        tiny_url_search_param *pair = &params->pairs[index];\n\
        int matches = tiny_view_equal(pair->name, name, name_len)\n\
            && (!has_value || tiny_view_equal(pair->value, value, value_len));\n\
        if (!matches) {\n\
            index++;\n\
            continue;\n\
        }\n\
        for (size_t next = index + 1; next < params->length; next++) {\n\
            params->pairs[next - 1] = params->pairs[next];\n\
        }\n\
        params->length--;\n\
    }\n\
}\n\n\
static const tiny_url_search_param *tiny_url_search_params_find(\n\
    const tiny_url_search_params *params,\n\
    const unsigned char *name, size_t name_len,\n\
    const unsigned char *value, size_t value_len, int has_value\n\
) {\n\
    for (size_t index = 0; index < params->length; index++) {\n\
        const tiny_url_search_param *pair = &params->pairs[index];\n\
        if (tiny_view_equal(pair->name, name, name_len)\n\
            && (!has_value || tiny_view_equal(pair->value, value, value_len))) return pair;\n\
    }\n\
    return NULL;\n\
}\n\n";

pub fn emit_c(program: &WptProgram) -> Result<String, String> {
    program.validate()?;
    let mut source = String::from(PRELUDE);
    emit_static_data(&mut source, program);
    writeln!(source, "\nint main(void) {{").unwrap();
    for (test_index, test) in program.tests.iter().enumerate() {
        writeln!(source, "    {{").unwrap();
        writeln!(
            source,
            "        tiny_url_search_params params[{}] = {{0}};",
            test.slots
        )
        .unwrap();
        for (operation_index, operation) in test.operations.iter().enumerate() {
            emit_operation(&mut source, test_index, operation_index, operation);
        }
        writeln!(source, "    }}").unwrap();
    }
    writeln!(source, "    return 0;\n}}").unwrap();
    Ok(source)
}

fn emit_static_data(source: &mut String, program: &WptProgram) {
    for (test_index, test) in program.tests.iter().enumerate() {
        for (operation_index, operation) in test.operations.iter().enumerate() {
            let prefix = format!("tiny_t{test_index}_o{operation_index}");
            match operation {
                WptOperation::Construct { input, .. } => {
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
                "        if (!tiny_url_search_params_push(&params[{slot}], {prefix}_name, {prefix}_name_len, {prefix}_value, {prefix}_value_len)) return 1;"
            )
            .unwrap();
        }
        WptOperation::Delete { slot, value, .. } => {
            let (value_pointer, value_length, has_value) = optional_value(prefix.as_str(), value);
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
                    "        if (found_{operation_index} == NULL || !tiny_view_equal(found_{operation_index}->value, {prefix}_expected, {prefix}_expected_len)) return 1;"
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
            let (value_pointer, value_length, has_value) = optional_value(prefix.as_str(), value);
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
    }
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
