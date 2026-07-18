use crate::{
    codegen::{Options, emit},
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
    program.components[0].html.push(crate::hir::HtmlOp::CallComponent {
        component: 1,
        span: span(),
    });

    emit(
        &program,
        Target::LinuxX86_64,
        Options::default(),
    )
    .expect("emit forward component call");
}

#[test]
fn emits_dynamic_route_text_for_both_x86_targets() {
    for target in [Target::LinuxX86_64, Target::MacosX86_64] {
        let assembly = emit(&dynamic_program(target), target, Options::default())
            .expect("emit dynamic route response");
        assert!(assembly.contains("tinytsx_html_write_path_segment"));
    }
}
