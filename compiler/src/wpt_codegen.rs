use std::fmt::Write;

use crate::wpt_hir::{WptAssertion, WptProgram};

pub fn emit_c(program: &WptProgram) -> Result<String, String> {
    program.validate()?;
    let mut source = String::from(
        "#include <stddef.h>\n#include <string.h>\n\n\
static int tiny_bytes_equal(const unsigned char *left, size_t left_len,\n\
                            const unsigned char *right, size_t right_len) {\n\
    return left_len == right_len && (left_len == 0 || memcmp(left, right, left_len) == 0);\n\
}\n\n\
typedef struct {\n\
    const unsigned char *query;\n\
    size_t query_len;\n\
} tiny_url_search_params;\n\n\
static tiny_url_search_params tiny_url_search_params_construct(\n\
    const unsigned char *query, size_t query_len\n\
) {\n\
    tiny_url_search_params params = {query, query_len};\n\
    return params;\n\
}\n\n\
static int tiny_url_search_params_find_first(\n\
    const unsigned char *query, size_t query_len,\n\
    const unsigned char *name, size_t name_len,\n\
    const unsigned char **value, size_t *value_len\n\
) {\n\
    size_t start = 0;\n\
    while (start <= query_len) {\n\
        size_t end = start;\n\
        while (end < query_len && query[end] != '&') end++;\n\
        if (end > start) {\n\
            size_t equals = start;\n\
            while (equals < end && query[equals] != '=') equals++;\n\
            if (tiny_bytes_equal(query + start, equals - start, name, name_len)) {\n\
                *value = query + (equals < end ? equals + 1 : end);\n\
                *value_len = equals < end ? end - equals - 1 : 0;\n\
                return 1;\n\
            }\n\
        }\n\
        if (end == query_len) break;\n\
        start = end + 1;\n\
    }\n\
    return 0;\n\
}\n\n",
    );

    for (index, assertion) in program.assertions.iter().enumerate() {
        let query = match assertion {
            WptAssertion::Constructed { query, .. }
            | WptAssertion::Get { query, .. }
            | WptAssertion::Has { query, .. } => query,
        };
        emit_bytes(
            &mut source,
            &format!("tiny_query_{index}"),
            query.as_bytes(),
        );
        match assertion {
            WptAssertion::Constructed { .. } => {}
            WptAssertion::Get { name, expected, .. } => {
                emit_bytes(&mut source, &format!("tiny_name_{index}"), name.as_bytes());
                if let Some(expected) = expected {
                    emit_bytes(
                        &mut source,
                        &format!("tiny_expected_{index}"),
                        expected.as_bytes(),
                    );
                }
            }
            WptAssertion::Has { name, .. } => {
                emit_bytes(&mut source, &format!("tiny_name_{index}"), name.as_bytes());
            }
        }
    }

    writeln!(source, "\nint main(void) {{").unwrap();
    writeln!(source, "    const unsigned char *value = NULL;").unwrap();
    writeln!(source, "    size_t value_len = 0;").unwrap();
    for (index, assertion) in program.assertions.iter().enumerate() {
        match assertion {
            WptAssertion::Constructed { .. } => {
                writeln!(
                    source,
                    "    tiny_url_search_params params_{index} = tiny_url_search_params_construct(tiny_query_{index}, tiny_query_{index}_len);"
                )
                .unwrap();
                writeln!(
                    source,
                    "    if (params_{index}.query == NULL || params_{index}.query_len != tiny_query_{index}_len) return 1;"
                )
                .unwrap();
            }
            WptAssertion::Get { expected, .. } => {
                writeln!(
                    source,
                    "    int found_{index} = tiny_url_search_params_find_first(tiny_query_{index}, tiny_query_{index}_len, tiny_name_{index}, tiny_name_{index}_len, &value, &value_len);"
                )
                .unwrap();
                if expected.is_some() {
                    writeln!(source, "    if (!found_{index}) return 1;").unwrap();
                    writeln!(
                        source,
                        "    if (!tiny_bytes_equal(value, value_len, tiny_expected_{index}, tiny_expected_{index}_len)) return 1;"
                    )
                    .unwrap();
                } else {
                    writeln!(source, "    if (found_{index}) return 1;").unwrap();
                }
            }
            WptAssertion::Has { expected, .. } => {
                writeln!(
                    source,
                    "    int found_{index} = tiny_url_search_params_find_first(tiny_query_{index}, tiny_query_{index}_len, tiny_name_{index}, tiny_name_{index}_len, &value, &value_len);"
                )
                .unwrap();
                writeln!(
                    source,
                    "    if (found_{index} != {}) return 1;",
                    i32::from(*expected)
                )
                .unwrap();
            }
        }
    }
    writeln!(source, "    return 0;\n}}").unwrap();
    Ok(source)
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
