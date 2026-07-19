use crate::{
    codegen::{emit, Options},
    hir::Program,
    target::Target,
};

fn static_program(target: Target) -> Program {
    serde_json::from_str(&format!(
        r#"{{
          "version": 2,
          "target": "{}",
          "entry": "server.tsx",
          "modules": [{{"path": "server.tsx"}}],
          "functions": [],
          "components": [],
          "handlers": [{{
            "method": "GET",
            "path": "/",
            "response": {{
              "kind": "text",
              "value": {{
                "kind": "stringLiteral",
                "string": 0,
                "span": {{"file":"server.tsx","line":1,"column":1,"endLine":1,"endColumn":2}}
              }}
            }},
            "span": {{"file":"server.tsx","line":1,"column":1,"endLine":1,"endColumn":2}}
          }}],
          "staticStrings": [{{"id":0,"value":"hello from x86"}}],
          "constants": [],
          "statistics": {{"modules":1,"functions":0,"components":0,"constants":0,"staticHtmlBytes":14,"dynamicHtmlExpressions":0}}
        }}"#,
        target.triple()
    ))
    .expect("valid static HIR fixture")
}

fn html_program(target: Target) -> Program {
    serde_json::from_str(&format!(
        r#"{{
          "version": 2,
          "target": "{}",
          "entry": "server.tsx",
          "modules": [{{"path": "server.tsx"}}],
          "functions": [],
          "components": [{{
            "id": 0,
            "name": "Page",
            "html": [{{
              "kind": "writeStatic",
              "string": 0,
              "span": {{"file":"server.tsx","line":1,"column":1,"endLine":1,"endColumn":2}}
            }}],
            "span": {{"file":"server.tsx","line":1,"column":1,"endLine":1,"endColumn":2}}
          }}],
          "handlers": [{{
            "method": "GET",
            "path": "/",
            "response": {{"kind": "html", "component": 0}},
            "span": {{"file":"server.tsx","line":1,"column":1,"endLine":1,"endColumn":2}}
          }}],
          "staticStrings": [{{"id":0,"value":"<h1>hello</h1>"}}],
          "constants": [],
          "statistics": {{"modules":1,"functions":0,"components":1,"constants":0,"staticHtmlBytes":14,"dynamicHtmlExpressions":0}}
        }}"#,
        target.triple()
    ))
    .expect("valid HTML HIR fixture")
}

fn dynamic_program(target: Target) -> Program {
    serde_json::from_str(&format!(
        r#"{{
          "version": 2,
          "target": "{}",
          "entry": "server.ts",
          "modules": [{{"path": "server.ts"}}],
          "functions": [],
          "components": [],
          "handlers": [{{
            "method": "GET",
            "path": "/users/:id",
            "response": {{
              "kind": "text",
              "value": {{
                "kind": "concat",
                "values": [
                  {{"kind":"stringLiteral","string":0,"span":{{"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}}}},
                  {{"kind":"routeParameter","name":"id","segment":1,"tail":false,"span":{{"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}}}}
                ],
                "span": {{"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}}
              }},
              "status": 200,
              "contentType": "application/json"
            }},
            "span": {{"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}}
          }}],
          "staticStrings": [{{"id":0,"value":"{{\"id\":\""}}],
          "constants": [],
          "statistics": {{"modules":1,"functions":0,"components":0,"constants":0,"staticHtmlBytes":7,"dynamicHtmlExpressions":1}}
        }}"#,
        target.triple()
    ))
    .expect("valid dynamic HIR fixture")
}

fn function_program(target: Target) -> Program {
    serde_json::from_str(&format!(
        r#"{{
          "version": 2,
          "target": "{}",
          "entry": "server.ts",
          "modules": [{{"path": "server.ts"}}],
          "functions": [{{
            "id": 0,
            "module": "server.ts",
            "name": "select",
            "parameters": [{{"name":"enabled","type":"boolean","span":{{"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}}}}],
            "result": "string",
            "body": {{
              "kind": "booleanEqualConditional",
              "left": {{"kind":"parameter","parameter":0,"span":{{"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}}}},
              "right": {{"kind":"booleanLiteral","value":true,"span":{{"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}}}},
              "whenEqual": {{"kind":"stringLiteral","string":0,"span":{{"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}}}},
              "whenNotEqual": {{"kind":"stringLiteral","string":1,"span":{{"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}}}},
              "span": {{"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}}
            }},
            "span": {{"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}}
          }}],
          "components": [],
          "handlers": [{{
            "method": "GET",
            "path": "/",
            "response": {{
              "kind": "text",
              "value": {{
                "kind": "directCall",
                "function": 0,
                "arguments": [{{"kind":"booleanLiteral","value":true,"span":{{"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}}}}],
                "span": {{"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}}
              }},
              "status": 200,
              "contentType": null
            }},
            "span": {{"file":"server.ts","line":1,"column":1,"endLine":1,"endColumn":2}}
          }}],
          "staticStrings": [{{"id":0,"value":"enabled"}},{{"id":1,"value":"disabled"}}],
          "constants": [],
          "statistics": {{"modules":1,"functions":1,"components":0,"constants":0,"staticHtmlBytes":0,"dynamicHtmlExpressions":1}}
        }}"#,
        target.triple()
    ))
    .expect("valid function HIR fixture")
}

#[test]
fn emits_linux_x86_64_static_handler_assembly() {
    let assembly = emit(
        &static_program(Target::LinuxX86_64),
        Target::LinuxX86_64,
        Options::default(),
    )
    .expect("emit Linux x86-64 assembly");

    assert!(assembly.contains("tinytsx_handle_get:"));
    assert!(assembly.contains("tinytsx_response_begin"));
    assert!(assembly.contains("tinytsx_html_write_static"));
    assert!(assembly.contains("tinytsx_config_workers:"));
}

#[test]
fn emits_macos_x86_64_static_handler_assembly() {
    let assembly = emit(
        &static_program(Target::MacosX86_64),
        Target::MacosX86_64,
        Options::default(),
    )
    .expect("emit macOS x86-64 assembly");

    assert!(assembly.contains("_tinytsx_handle_get:"));
    assert!(assembly.contains("_tinytsx_response_begin"));
    assert!(assembly.contains("_tinytsx_html_write_static"));
    assert!(assembly.contains("_tinytsx_config_workers:"));
}

#[test]
fn emits_x86_64_html_components() {
    for target in [Target::LinuxX86_64, Target::MacosX86_64] {
        let assembly = emit(&html_program(target), target, Options::default())
            .expect("emit x86-64 component assembly");
        assert!(assembly.contains("tinytsx_html_write_static"));
        assert!(assembly.contains("<h1>hello</h1>"));
    }
}

#[test]
fn declares_components_before_nested_calls() {
    let mut program = html_program(Target::LinuxX86_64);
    let span = || crate::hir::SourceSpan {
        file: "server.tsx".to_owned(),
        line: 1,
        column: 1,
        end_line: 1,
        end_column: 2,
    };
    program.components.push(crate::hir::Component {
        id: 1,
        name: "Nested".to_owned(),
        html: Vec::new(),
        span: span(),
    });
    program.components[0]
        .html
        .push(crate::hir::HtmlOp::CallComponent {
            component: 1,
            span: span(),
        });

    emit(&program, Target::LinuxX86_64, Options::default()).expect("emit forward component call");
}

#[test]
fn emits_dynamic_route_text_for_both_x86_targets() {
    for target in [Target::LinuxX86_64, Target::MacosX86_64] {
        let assembly = emit(&dynamic_program(target), target, Options::default())
            .expect("emit dynamic route response");
        assert!(assembly.contains("tinytsx_html_write_path_segment"));
    }
}

#[test]
fn emits_request_guards_and_headers() {
    let mut program = dynamic_program(Target::LinuxX86_64);
    program.static_strings.push(crate::hir::StaticString {
        id: 1,
        value: "X-Request-Id".to_owned(),
    });
    program.handlers[0].headers.push(crate::hir::StaticHeader {
        name: "X-Frame-Options".to_owned(),
        value: "DENY".to_owned(),
    });
    program.handlers[0].elapsed_headers.push(crate::hir::ElapsedHeader {
        name: "X-Response-Time".to_owned(),
        suffix: "ms".to_owned(),
    });
    program.handlers[0]
        .parameter_validations
        .push(crate::hir::ParameterValidation {
            name: "id".to_owned(),
            segment: 1,
            min_length: 3,
            rejected: crate::hir::GuardedResponse {
                headers: Vec::new(),
                stderr: Vec::new(),
                response: crate::hir::HandlerResponse::Text {
                    value: crate::hir::ValueExpression::StringLiteral {
                        string: 0,
                        span: crate::hir::SourceSpan {
                            file: "server.ts".to_owned(),
                            line: 1,
                            column: 1,
                            end_line: 1,
                            end_column: 2,
                        },
                    },
                    status: 400,
                    content_type: Some("application/json".to_owned()),
                },
            },
        });
    program.handlers[0].request_id = Some(crate::hir::RequestId {
        header: 1,
        max_length: 255,
    });
    program.handlers[0].body_limit = Some(crate::hir::BodyLimit {
        max_bytes: 64,
        rejected: crate::hir::GuardedResponse {
            headers: Vec::new(),
            stderr: Vec::new(),
            response: crate::hir::HandlerResponse::Text {
                value: crate::hir::ValueExpression::StringLiteral {
                    string: 0,
                    span: crate::hir::SourceSpan {
                        file: "server.ts".to_owned(),
                        line: 1,
                        column: 1,
                        end_line: 1,
                        end_column: 2,
                    },
                },
                status: 413,
                content_type: None,
            },
        },
    });

    let assembly =
        emit(&program, Target::LinuxX86_64, Options::default()).expect("emit handler guards");
    assert!(assembly.contains("tinytsx_request_body_length"));
    assert!(assembly.contains("tinytsx_response_header_request_id"));
    assert!(assembly.contains("tinytsx_response_header_static"));
    assert!(assembly.contains("tinytsx_response_header_elapsed_millis"));
    assert!(assembly.contains("tinytsx_request_path_segment_min_length"));
    assert!(assembly.contains("X-Response-Time"));
}

#[test]
fn emits_session_authorization_for_both_x86_targets() {
    for target in [Target::LinuxX86_64, Target::MacosX86_64] {
        let mut program = dynamic_program(target);
        program.static_strings.extend([
            crate::hir::StaticString {
                id: 1,
                value: "stytch_session_jwt".to_owned(),
            },
            crate::hir::StaticString {
                id: 2,
                value: "Unauthenticated".to_owned(),
            },
        ]);
        program.handlers[0].session_authorization = Some(crate::hir::SessionAuthorization {
            mode: "local".to_owned(),
            cookie: 1,
            rejected: crate::hir::GuardedResponse {
                headers: vec![crate::hir::StaticHeader {
                    name: "Cache-Control".to_owned(),
                    value: "no-store".to_owned(),
                }],
                stderr: vec![2],
                response: crate::hir::HandlerResponse::Text {
                    value: crate::hir::ValueExpression::StringLiteral {
                        string: 2,
                        span: crate::hir::SourceSpan {
                            file: "server.ts".to_owned(),
                            line: 1,
                            column: 1,
                            end_line: 1,
                            end_column: 2,
                        },
                    },
                    status: 401,
                    content_type: None,
                },
            },
        });

        let assembly = emit(&program, target, Options::default())
            .expect("emit x86-64 session authorization");
        assert!(assembly.contains("tinytsx_request_cookie_present"));
        assert!(assembly.contains("tinytsx_console_error_static"));
        assert!(assembly.contains("Cache-Control"));
        assert!(assembly.contains("no-store"));
    }
}

#[test]
fn emits_basic_authorization_for_both_x86_targets() {
    for target in [Target::LinuxX86_64, Target::MacosX86_64] {
        let mut program = dynamic_program(target);
        program.static_strings.push(crate::hir::StaticString {
            id: 1,
            value: "Unauthorized".to_owned(),
        });
        program.handlers[0].basic_authorization = Some(crate::hir::BasicAuthorization {
            credentials: vec![crate::hir::BasicCredential {
                username: "admin".to_owned(),
                password: "secret".to_owned(),
            }],
            rejected: crate::hir::GuardedResponse {
                headers: vec![crate::hir::StaticHeader {
                    name: "WWW-Authenticate".to_owned(),
                    value: "Basic realm=\"tinytsx\"".to_owned(),
                }],
                stderr: Vec::new(),
                response: crate::hir::HandlerResponse::Text {
                    value: crate::hir::ValueExpression::StringLiteral {
                        string: 1,
                        span: crate::hir::SourceSpan {
                            file: "server.ts".to_owned(),
                            line: 1,
                            column: 1,
                            end_line: 1,
                            end_column: 2,
                        },
                    },
                    status: 401,
                    content_type: None,
                },
            },
        });

        let assembly = emit(&program, target, Options::default())
            .expect("emit x86-64 basic authorization");
        assert!(assembly.contains("tinytsx_request_basic_auth_equals"));
        assert!(assembly.contains("admin"));
        assert!(assembly.contains("secret"));
        assert!(assembly.contains("WWW-Authenticate"));
    }
}

#[test]
fn emits_todo_store_operations_for_both_x86_targets() {
    for target in [Target::LinuxX86_64, Target::MacosX86_64] {
        for (operation, argument, expected) in [
            (crate::hir::TodoOperation::List, None, "tinytsx_todo_store_list_json"),
            (
                crate::hir::TodoOperation::Add,
                Some(crate::hir::TodoArgument::RequestJsonField { field: 2 }),
                "tinytsx_todo_store_add_json",
            ),
            (
                crate::hir::TodoOperation::Complete,
                Some(crate::hir::TodoArgument::RouteParameter { segment: 1 }),
                "tinytsx_todo_store_mutation_json",
            ),
            (
                crate::hir::TodoOperation::Delete,
                Some(crate::hir::TodoArgument::RouteParameter { segment: 1 }),
                "tinytsx_todo_store_mutation_json",
            ),
        ] {
            let mut program = dynamic_program(target);
            program.static_strings.extend([
                crate::hir::StaticString {
                    id: 1,
                    value: "user-1".to_owned(),
                },
                crate::hir::StaticString {
                    id: 2,
                    value: "text".to_owned(),
                },
            ]);
            program.sqlite_databases.push(crate::hir::SqliteDatabase {
                id: 0,
                path: ":memory:".to_owned(),
            });
            program.handlers[0].response = crate::hir::HandlerResponse::Text {
                value: crate::hir::ValueExpression::TodoStore {
                    database: 0,
                    operation,
                    user: crate::hir::TodoUser::StaticString { string: 1 },
                    argument,
                    span: crate::hir::SourceSpan {
                        file: "server.ts".to_owned(),
                        line: 1,
                        column: 1,
                        end_line: 1,
                        end_column: 2,
                    },
                },
                status: 200,
                content_type: Some("application/json".to_owned()),
            };

            let assembly = emit(&program, target, Options::default())
                .expect("emit x86-64 TODO store operation");
            assert!(assembly.contains(expected));
        }
    }
}

#[test]
fn emits_portable_scalar_functions() {
    for target in [Target::LinuxX86_64, Target::MacosX86_64] {
        let assembly = emit(&function_program(target), target, Options::default())
            .expect("emit scalar function");
        assert!(assembly.contains("tinytsx_handle_get"));
        assert!(assembly.contains("enabled"));
    }
}

#[test]
fn emits_filesystem_capability_configuration() {
    let mut program = dynamic_program(Target::LinuxX86_64);
    program.static_strings.push(crate::hir::StaticString {
        id: 1,
        value: "asset.txt".to_owned(),
    });
    program.handlers[0].response = crate::hir::HandlerResponse::Text {
        value: crate::hir::ValueExpression::FileText {
            path: 1,
            max_bytes: 1024,
            span: crate::hir::SourceSpan {
                file: "server.ts".to_owned(),
                line: 1,
                column: 1,
                end_line: 1,
                end_column: 2,
            },
        },
        status: 200,
        content_type: None,
    };
    let options = Options {
        read_roots: vec!["/tmp/assets".to_owned()],
        ..Options::default()
    };

    let assembly = emit(&program, Target::LinuxX86_64, options)
        .expect("emit filesystem capability configuration");
    assert!(assembly.contains("/tmp/assets"));
    assert!(assembly.contains("tinytsx_config_read_root"));
}
