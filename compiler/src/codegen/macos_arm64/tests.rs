use crate::hir::Program;

use crate::codegen::Options;

use super::emit;

#[test]
fn emits_deterministic_handler_and_static_data() {
    let program: Program = serde_json::from_str(
            r#"{
              "version": 2,
              "target": "aarch64-apple-darwin",
              "entry": "server.tsx",
              "modules": [{"path": "server.tsx"}],
              "functions": [{
                "id": 0,
                "module": "server.tsx",
                "name": "greeting",
                "parameters": [{
                  "name": "value",
                  "type": "string",
                  "span": {"file":"server.tsx","line":1,"column":1,"endLine":1,"endColumn":2}
                }],
                "result": "string",
                "body": {
                  "kind": "directCall",
                  "function": 1,
                  "arguments": [],
                  "span": {"file":"server.tsx","line":1,"column":1,"endLine":1,"endColumn":2}
                },
                "span": {"file":"server.tsx","line":1,"column":1,"endLine":1,"endColumn":2}
              }, {
                "id": 1,
                "module": "server.tsx",
                "name": "message",
                "parameters": [],
                "result": "string",
                "body": {
                  "kind": "constant",
                  "constant": 0,
                  "span": {"file":"server.tsx","line":2,"column":1,"endLine":2,"endColumn":2}
                },
                "span": {"file":"server.tsx","line":2,"column":1,"endLine":2,"endColumn":2}
              }],
              "components": [{
                "id": 0,
                "name": "Page",
                "span": {"file":"server.tsx","line":1,"column":1,"endLine":1,"endColumn":2},
                "html": [{
                  "kind": "writeStatic",
                  "string": 0,
                  "span": {"file":"server.tsx","line":1,"column":1,"endLine":1,"endColumn":2}
                }]
              }],
              "handlers": [{
                "method": "GET",
                "headers": [{"name":"X-Test","value":"yes"}],
                "elapsedHeaders": [{"name":"X-Response-Time","suffix":"ms"}],
                "response": {
                  "kind": "text",
                  "value": {
                    "kind": "directCall",
                    "function": 0,
                    "arguments": [{
                      "kind": "constant",
                      "constant": 0,
                      "span": {"file":"server.tsx","line":2,"column":1,"endLine":2,"endColumn":2}
                    }],
                    "span": {"file":"server.tsx","line":2,"column":1,"endLine":2,"endColumn":2}
                  }
                },
                "span": {"file":"server.tsx","line":2,"column":1,"endLine":2,"endColumn":2}
              }],
              "staticStrings": [{"id":0,"value":"<h1>Hello</h1>"}],
              "constants": [{
                "id": 0,
                "module": "server.tsx",
                "name": "message",
                "span": {"file":"server.tsx","line":1,"column":1,"endLine":1,"endColumn":2},
                "value": {"kind":"string","value":"Hello"}
              }],
              "statistics": {"modules":1,"functions":2,"components":1,"constants":1,"staticHtmlBytes":14,"dynamicHtmlExpressions":0}
            }"#,
        )
        .unwrap();

    let options = Options::default();
    let first = emit(&program, options).unwrap();
    let second = emit(&program, options).unwrap();
    assert_eq!(first, second);
    assert!(first.contains(".globl _tinytsx_handle_get"));
    assert!(first.contains("bl _tinytsx_html_write_static"));
    assert!(first.contains("bl _tinytsx_response_begin"));
    assert!(first.contains("bl _tinytsx_request_path_matches"));
    assert!(first.contains("bl _tinytsx_response_header_static"));
    assert!(first.contains("bl _tinytsx_date_now_millis"));
    assert!(first.contains("bl _tinytsx_response_header_elapsed_millis"));
    assert!(first.contains("Ltinytsx_handler_0_header_0_name:"));
    assert!(first.contains("Ltinytsx_handler_0_elapsed_0_name:"));
    assert!(first.contains("Ltinytsx_handler_0_elapsed_0_suffix:"));
    assert!(first.contains("Ltinytsx_handler_path_0:"));
    assert!(first.contains("bl _tinytsx_function_0"));
    assert!(first.contains("_tinytsx_function_0:"));
    assert!(first.contains("stp x0, x1, [sp, #16]"));
    assert!(first.contains("ldp x0, x1, [sp, #48]"));
    assert!(first.contains("bl _tinytsx_function_1"));
    assert!(first.contains(
        "_tinytsx_function_1:\n    stp x29, x30, [sp, #-16]!\n    mov x29, sp\n    adrp"
    ));
    assert!(first.contains("Ltinytsx_string_0:"));
    assert!(first.contains("Ltinytsx_constant_0:"));
    assert!(first.contains(".byte 60, 104, 49"));
    assert!(first.contains(".byte 4, 5, 0, 0, 0, 72, 101, 108, 108, 111"));
    assert!(first.contains("_tinytsx_config_port:\n    movz x0, #3000"));
    assert!(first.contains("_tinytsx_config_workers:\n    movz x0, #1"));
}

#[test]
fn emits_named_route_matching_and_parameter_writes() {
    let program: Program = serde_json::from_str(
            r#"{
              "version": 2,
              "target": "aarch64-apple-darwin",
              "entry": "server.ts",
              "modules": [{"path": "server.ts"}],
              "functions": [],
              "components": [],
              "handlers": [{
                "method": "POST",
                "path": "/entry/:id",
                "response": {
                  "kind": "text",
                  "status": 201,
                  "value": {
                    "kind": "concat",
                    "values": [{
                      "kind": "stringLiteral",
                      "string": 0,
                      "span": {"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}
                    }, {
                      "kind": "routeParameter",
                      "name": "id",
                      "segment": 1,
                      "span": {"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}
                    }, {
                      "kind": "fetchStatus",
                      "url": 1,
                      "span": {"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}
                    }],
                    "span": {"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}
                  }
                },
                "span": {"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}
              }],
              "staticStrings": [
                {"id":0,"value":"Your ID is "},
                {"id":1,"value":"https://example.com/"}
              ],
              "constants": [],
              "statistics": {"modules":1,"functions":0,"components":0,"constants":0,"staticHtmlBytes":11,"dynamicHtmlExpressions":2}
            }"#,
        )
        .unwrap();

    let assembly = emit(&program, Options::default()).unwrap();

    assert!(assembly.contains("bl _tinytsx_request_path_matches"));
    assert!(assembly.contains("bl _tinytsx_request_method_equals"));
    assert!(assembly.contains("movz x1, #201"));
    assert!(assembly.contains("Ltinytsx_handler_method_0:\n    .byte 80, 79, 83, 84"));
    assert!(assembly.contains("movz x2, #1\n    bl _tinytsx_html_write_path_segment"));
    assert!(assembly.contains("bl _tinytsx_html_write_fetch_status"));
}

#[test]
fn emits_query_conditional_handler_bodies() {
    let program: Program = serde_json::from_str(
            r#"{
              "version": 2,
              "target": "aarch64-apple-darwin",
              "entry": "server.ts",
              "modules": [{"path": "server.ts"}],
              "functions": [],
              "components": [],
              "handlers": [{
                "method": "GET",
                "path": "/posts",
                "response": {
                  "kind": "text",
                  "contentType": "application/json",
                  "value": {
                    "kind": "queryConditional",
                    "query": 0,
                    "whenPresent": {
                      "kind": "stringLiteral",
                      "string": 1,
                      "span": {"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}
                    },
                    "whenAbsent": {
                      "kind": "stringLiteral",
                      "string": 2,
                      "span": {"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}
                    },
                    "span": {"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}
                  }
                },
                "span": {"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}
              }],
              "staticStrings": [
                {"id":0,"value":"pretty"},
                {"id":1,"value":"{\n  \"ok\": true\n}"},
                {"id":2,"value":"{\"ok\":true}"}
              ],
              "constants": [],
              "statistics": {"modules":1,"functions":0,"components":0,"constants":0,"staticHtmlBytes":35,"dynamicHtmlExpressions":1}
            }"#,
        )
        .unwrap();

    let assembly = emit(&program, Options::default()).unwrap();

    assert!(assembly.contains("bl _tinytsx_request_query_has"));
    assert!(assembly.contains("cbz w0, Ltinytsx_handler_0_query_0_absent"));
    assert!(assembly.contains("Ltinytsx_handler_0_query_0_end:"));
}
