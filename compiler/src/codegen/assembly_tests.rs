use super::{Assembly, asm_line, asm_write};

#[test]
fn macros_append_formatted_assembly_without_exposing_fmt_errors() {
    let mut assembly = Assembly::new();

    asm_line!(assembly, ".text");
    asm_write!(assembly, "    mov x{}, #", 0);
    asm_line!(assembly, "{}", 42);

    assert_eq!(assembly.finish(), ".text\n    mov x0, #42\n");
}
