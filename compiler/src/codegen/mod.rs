mod macos_arm64;

use crate::hir::Program;

pub fn emit_macos_arm64(program: &Program) -> Result<String, String> {
    macos_arm64::emit(program)
}
