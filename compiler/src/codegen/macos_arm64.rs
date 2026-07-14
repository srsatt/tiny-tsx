use std::fmt::Write;

use crate::{
    codegen::Options,
    hir::{ConstantValue, HandlerResponse, HtmlOp, Program, ValueExpression},
};

use super::constant_data;

pub fn emit(program: &Program, options: Options) -> Result<String, String> {
    program.validate()?;
    let mut assembly = String::new();
    writeln!(assembly, ".section __TEXT,__text,regular,pure_instructions").unwrap();
    writeln!(assembly, ".p2align 2").unwrap();

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

    let handler = &program.handlers[0];
    emit_handler(&mut assembly, &handler.response, program)?;
    emit_config(&mut assembly, options);
    emit_static_data(&mut assembly, program)?;
    Ok(assembly)
}

fn emit_config(assembly: &mut String, options: Options) {
    writeln!(assembly, "\n.globl _tinytsx_config_port").unwrap();
    writeln!(assembly, "_tinytsx_config_port:").unwrap();
    emit_immediate(assembly, "x0", u64::from(options.port));
    writeln!(assembly, "    ret").unwrap();

    writeln!(assembly, "\n.globl _tinytsx_config_request_memory").unwrap();
    writeln!(assembly, "_tinytsx_config_request_memory:").unwrap();
    emit_immediate(assembly, "x0", options.request_memory as u64);
    writeln!(assembly, "    ret").unwrap();
}

fn emit_function(assembly: &mut String, symbol: &str, operations: &[HtmlOp], program: &Program) {
    writeln!(assembly, "\n.private_extern {symbol}").unwrap();
    writeln!(assembly, "{symbol}:").unwrap();
    emit_prologue(assembly, 32);
    preserve_request_context(assembly);
    let return_label = format!("L{}_return", symbol.trim_start_matches('_'));

    if operations.is_empty() {
        writeln!(assembly, "    mov w0, #0").unwrap();
    }
    for operation in operations {
        match operation {
            HtmlOp::WriteStatic { string, .. } => {
                writeln!(assembly, "    ldr x0, [sp, #16]").unwrap();
                writeln!(assembly, "    adrp x1, Ltinytsx_string_{string}@PAGE").unwrap();
                writeln!(assembly, "    add x1, x1, Ltinytsx_string_{string}@PAGEOFF").unwrap();
                emit_immediate(
                    assembly,
                    "x2",
                    program.static_strings[*string].value.len() as u64,
                );
                writeln!(assembly, "    bl _tinytsx_html_write_static").unwrap();
                writeln!(assembly, "    cbnz w0, {return_label}").unwrap();
            }
            HtmlOp::CallComponent { component, .. } => {
                writeln!(assembly, "    ldr x0, [sp, #24]").unwrap();
                writeln!(assembly, "    ldr x1, [sp, #16]").unwrap();
                writeln!(assembly, "    bl _tinytsx_component_{component}").unwrap();
                writeln!(assembly, "    cbnz w0, {return_label}").unwrap();
            }
        }
    }
    writeln!(assembly, "    mov w0, #0").unwrap();
    writeln!(assembly, "{return_label}:").unwrap();
    emit_epilogue(assembly, 32);
}

fn emit_value_function(
    assembly: &mut String,
    id: usize,
    body: &ValueExpression,
    program: &Program,
) -> Result<(), String> {
    let function = &program.functions[id];
    let scratch_base = 16 + function.parameters.len() * 16;
    let frame_size = value_frame_size(scratch_base, body)?;
    writeln!(assembly, "\n.private_extern _tinytsx_function_{id}").unwrap();
    writeln!(assembly, "_tinytsx_function_{id}:").unwrap();
    emit_prologue(assembly, frame_size);
    for (index, (first, second)) in [("x0", "x1"), ("x2", "x3"), ("x4", "x5"), ("x6", "x7")]
        .into_iter()
        .take(function.parameters.len())
        .enumerate()
    {
        writeln!(
            assembly,
            "    stp {}, {}, [sp, #{}]",
            first,
            second,
            16 + index * 16
        )
        .unwrap();
    }
    emit_value_expression(assembly, body, program, scratch_base)?;
    emit_epilogue(assembly, frame_size);
    Ok(())
}

fn emit_handler(
    assembly: &mut String,
    response: &HandlerResponse,
    program: &Program,
) -> Result<(), String> {
    writeln!(assembly, "\n.globl _tinytsx_handle_get").unwrap();
    writeln!(assembly, "_tinytsx_handle_get:").unwrap();
    let frame_size = match response {
        HandlerResponse::Text { value } => value_frame_size(32, value)?,
        HandlerResponse::Html { .. } => 32,
    };
    emit_prologue(assembly, frame_size);
    preserve_request_context(assembly);
    let return_label = "Ltinytsx_handle_get_return";
    match response {
        HandlerResponse::Html { component } => {
            emit_response_begin(assembly, 1, return_label);
            writeln!(assembly, "    ldr x0, [sp, #24]").unwrap();
            writeln!(assembly, "    ldr x1, [sp, #16]").unwrap();
            writeln!(assembly, "    bl _tinytsx_component_{component}").unwrap();
        }
        HandlerResponse::Text { value } => {
            emit_response_begin(assembly, 2, return_label);
            emit_value_expression(assembly, value, program, 32)?;
            writeln!(assembly, "    mov x2, x1").unwrap();
            writeln!(assembly, "    mov x1, x0").unwrap();
            writeln!(assembly, "    ldr x0, [sp, #16]").unwrap();
            writeln!(assembly, "    bl _tinytsx_html_write_static").unwrap();
        }
    }
    writeln!(assembly, "{return_label}:").unwrap();
    emit_epilogue(assembly, frame_size);
    Ok(())
}

fn emit_response_begin(assembly: &mut String, content_type: u16, return_label: &str) {
    writeln!(assembly, "    ldr x0, [sp, #16]").unwrap();
    emit_immediate(assembly, "x1", 200);
    emit_immediate(assembly, "x2", u64::from(content_type));
    writeln!(assembly, "    bl _tinytsx_response_begin").unwrap();
    writeln!(assembly, "    cbnz w0, {return_label}").unwrap();
}

fn emit_value_expression(
    assembly: &mut String,
    expression: &ValueExpression,
    program: &Program,
    scratch_base: usize,
) -> Result<(), String> {
    match expression {
        ValueExpression::StringLiteral { string, .. } => {
            writeln!(assembly, "    adrp x0, Ltinytsx_string_{string}@PAGE").unwrap();
            writeln!(assembly, "    add x0, x0, Ltinytsx_string_{string}@PAGEOFF").unwrap();
            emit_immediate(
                assembly,
                "x1",
                program.static_strings[*string].value.len() as u64,
            );
        }
        ValueExpression::Constant { constant, .. } => {
            let ConstantValue::String { value } = &program.constants[*constant].value else {
                return Err("string expression references a non-string constant".to_owned());
            };
            writeln!(assembly, "    adrp x0, Ltinytsx_constant_{constant}@PAGE").unwrap();
            writeln!(
                assembly,
                "    add x0, x0, Ltinytsx_constant_{constant}@PAGEOFF"
            )
            .unwrap();
            writeln!(assembly, "    add x0, x0, #5").unwrap();
            emit_immediate(assembly, "x1", value.len() as u64);
        }
        ValueExpression::Parameter { parameter, .. } => {
            writeln!(assembly, "    ldp x0, x1, [sp, #{}]", 16 + parameter * 16).unwrap();
        }
        ValueExpression::DirectCall {
            function,
            arguments,
            ..
        } => {
            let nested_scratch = scratch_base + arguments.len() * 16;
            for (index, argument) in arguments.iter().enumerate() {
                emit_value_expression(assembly, argument, program, nested_scratch)?;
                writeln!(
                    assembly,
                    "    stp x0, x1, [sp, #{}]",
                    scratch_base + index * 16
                )
                .unwrap();
            }
            for (index, (first, second)) in [("x0", "x1"), ("x2", "x3"), ("x4", "x5"), ("x6", "x7")]
                .into_iter()
                .take(arguments.len())
                .enumerate()
            {
                writeln!(
                    assembly,
                    "    ldp {first}, {second}, [sp, #{}]",
                    scratch_base + index * 16
                )
                .unwrap();
            }
            writeln!(assembly, "    bl _tinytsx_function_{function}").unwrap();
        }
    }
    Ok(())
}

fn emit_prologue(assembly: &mut String, frame_size: usize) {
    writeln!(assembly, "    stp x29, x30, [sp, #-{frame_size}]!").unwrap();
    writeln!(assembly, "    mov x29, sp").unwrap();
}

fn preserve_request_context(assembly: &mut String) {
    writeln!(assembly, "    str x1, [sp, #16]").unwrap();
    writeln!(assembly, "    str x0, [sp, #24]").unwrap();
}

fn emit_epilogue(assembly: &mut String, frame_size: usize) {
    writeln!(assembly, "    ldp x29, x30, [sp], #{frame_size}").unwrap();
    writeln!(assembly, "    ret").unwrap();
}

fn value_frame_size(base: usize, expression: &ValueExpression) -> Result<usize, String> {
    let required = base + scratch_slots(expression) * 16;
    let frame_size = required.max(16).div_ceil(16) * 16;
    if frame_size > 496 {
        return Err("function call expression requires more than 496 bytes of stack".to_owned());
    }
    Ok(frame_size)
}

fn scratch_slots(expression: &ValueExpression) -> usize {
    match expression {
        ValueExpression::DirectCall { arguments, .. } => {
            arguments.len() + arguments.iter().map(scratch_slots).max().unwrap_or(0)
        }
        _ => 0,
    }
}

fn emit_static_data(assembly: &mut String, program: &Program) -> Result<(), String> {
    writeln!(assembly, "\n.section __TEXT,__const").unwrap();
    for string in &program.static_strings {
        writeln!(assembly, ".p2align 3").unwrap();
        writeln!(assembly, "Ltinytsx_string_{}:", string.id).unwrap();
        emit_bytes(assembly, string.value.as_bytes());
    }
    for constant in &program.constants {
        writeln!(assembly, ".p2align 3").unwrap();
        writeln!(assembly, "Ltinytsx_constant_{}:", constant.id).unwrap();
        emit_bytes(assembly, &constant_data::encode(&constant.value)?);
    }
    Ok(())
}

fn emit_bytes(assembly: &mut String, bytes: &[u8]) {
    if bytes.is_empty() {
        writeln!(assembly, "    .byte 0").unwrap();
        return;
    }
    for chunk in bytes.chunks(16) {
        write!(assembly, "    .byte ").unwrap();
        for (index, byte) in chunk.iter().enumerate() {
            if index > 0 {
                write!(assembly, ", ").unwrap();
            }
            write!(assembly, "{byte}").unwrap();
        }
        writeln!(assembly).unwrap();
    }
}

fn emit_immediate(assembly: &mut String, register: &str, value: u64) {
    let chunks = [
        (value & 0xffff) as u16,
        ((value >> 16) & 0xffff) as u16,
        ((value >> 32) & 0xffff) as u16,
        ((value >> 48) & 0xffff) as u16,
    ];
    writeln!(assembly, "    movz {register}, #{}", chunks[0]).unwrap();
    for (index, chunk) in chunks.into_iter().enumerate().skip(1) {
        if chunk != 0 {
            writeln!(
                assembly,
                "    movk {register}, #{chunk}, lsl #{}",
                index * 16
            )
            .unwrap();
        }
    }
}

#[cfg(test)]
mod tests {
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
        assert!(first.contains("bl _tinytsx_function_0"));
        assert!(first.contains("_tinytsx_function_0:"));
        assert!(first.contains("stp x0, x1, [sp, #16]"));
        assert!(first.contains("ldp x0, x1, [sp, #32]"));
        assert!(first.contains("bl _tinytsx_function_1"));
        assert!(first.contains(
            "_tinytsx_function_1:\n    stp x29, x30, [sp, #-16]!\n    mov x29, sp\n    adrp"
        ));
        assert!(first.contains("Ltinytsx_string_0:"));
        assert!(first.contains("Ltinytsx_constant_0:"));
        assert!(first.contains(".byte 60, 104, 49"));
        assert!(first.contains(".byte 4, 5, 0, 0, 0, 72, 101, 108, 108, 111"));
        assert!(first.contains("_tinytsx_config_port:\n    movz x0, #3000"));
    }
}
