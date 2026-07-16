mod aarch64;
mod assembly;
mod constant_data;
mod macos_arm64;

use crate::hir::Program;

#[derive(Clone, Copy)]
pub struct Options {
    pub port: u16,
    pub workers: usize,
    pub request_memory: usize,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            port: 3000,
            workers: 1,
            request_memory: 262_144,
        }
    }
}

pub fn emit_macos_arm64(program: &Program, options: Options) -> Result<String, String> {
    macos_arm64::emit(program, options)
}
