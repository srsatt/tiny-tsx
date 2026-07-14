use std::fmt::Write;

use crate::{
    codegen::Options,
    hir::{HtmlOp, Program},
};

use super::constant_data;

pub fn emit(program: &Program, options: Options) -> Result<String, String> {
    program.validate()?;
    let mut assembly = String::new();
    writeln!(assembly, ".section __TEXT,__text,regular,pure_instructions").unwrap();
    writeln!(assembly, ".p2align 2").unwrap();

    for component in &program.components {
        emit_function(
            &mut assembly,
            &format!("_tinytsx_component_{}", component.id),
            &component.html,
            program,
        );
    }

    let handler = &program.handlers[0];
    emit_handler(&mut assembly, handler.component);
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
    emit_prologue(assembly);
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
    emit_epilogue(assembly);
}

fn emit_handler(assembly: &mut String, component: usize) {
    writeln!(assembly, "\n.globl _tinytsx_handle_get").unwrap();
    writeln!(assembly, "_tinytsx_handle_get:").unwrap();
    emit_prologue(assembly);
    writeln!(assembly, "    ldr x0, [sp, #24]").unwrap();
    writeln!(assembly, "    ldr x1, [sp, #16]").unwrap();
    writeln!(assembly, "    bl _tinytsx_component_{component}").unwrap();
    emit_epilogue(assembly);
}

fn emit_prologue(assembly: &mut String) {
    writeln!(assembly, "    stp x29, x30, [sp, #-32]!").unwrap();
    writeln!(assembly, "    mov x29, sp").unwrap();
    writeln!(assembly, "    str x1, [sp, #16]").unwrap();
    writeln!(assembly, "    str x0, [sp, #24]").unwrap();
}

fn emit_epilogue(assembly: &mut String) {
    writeln!(assembly, "    ldp x29, x30, [sp], #32").unwrap();
    writeln!(assembly, "    ret").unwrap();
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
              "version": 1,
              "target": "aarch64-apple-darwin",
              "entry": "server.tsx",
              "modules": [{"path": "server.tsx"}],
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
                "component": 0,
                "span": {"file":"server.tsx","line":2,"column":1,"endLine":2,"endColumn":2}
              }],
              "staticStrings": [{"id":0,"value":"<h1>Hello</h1>"}],
              "constants": [{
                "id": 0,
                "module": "server.tsx",
                "name": "methods",
                "span": {"file":"server.tsx","line":1,"column":1,"endLine":1,"endColumn":2},
                "value": {"kind":"array","items":[{"kind":"string","value":"get"}]}
              }],
              "statistics": {"modules":1,"components":1,"constants":1,"staticHtmlBytes":14,"dynamicHtmlExpressions":0}
            }"#,
        )
        .unwrap();

        let options = Options::default();
        let first = emit(&program, options).unwrap();
        let second = emit(&program, options).unwrap();
        assert_eq!(first, second);
        assert!(first.contains(".globl _tinytsx_handle_get"));
        assert!(first.contains("bl _tinytsx_html_write_static"));
        assert!(first.contains("Ltinytsx_string_0:"));
        assert!(first.contains("Ltinytsx_constant_0:"));
        assert!(first.contains(".byte 60, 104, 49"));
        assert!(first.contains(".byte 5, 1, 0, 0, 0, 4, 3, 0, 0, 0, 103, 101, 116"));
        assert!(first.contains("_tinytsx_config_port:\n    movz x0, #3000"));
    }
}
