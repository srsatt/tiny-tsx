mod aarch64;
mod aarch64_backend;
mod assembly;
mod constant_data;
mod linux_arm64;
mod macos_arm64;
mod portable_c;
mod x86_64;

#[cfg(test)]
#[path = "x86_64_tests.rs"]
mod x86_64_tests;

use crate::hir::Program;
use crate::target::Target;

#[derive(Clone)]
pub struct Options {
    pub port: u16,
    pub workers: usize,
    pub request_memory: usize,
    pub read_roots: Vec<String>,
    pub asset_stores: Vec<AssetStore>,
}

#[derive(Clone)]
pub struct AssetStore {
    pub files: Vec<AssetFile>,
    pub index: usize,
    pub spa_fallback: bool,
}

#[derive(Clone)]
pub struct AssetFile {
    pub path: String,
    pub mime: String,
    pub etag: String,
    pub bytes: Vec<u8>,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            port: 3000,
            workers: 1,
            request_memory: 262_144,
            read_roots: Vec::new(),
            asset_stores: Vec::new(),
        }
    }
}

pub fn emit_macos_arm64(program: &Program, options: Options) -> Result<String, String> {
    macos_arm64::emit(program, options)
}

pub fn emit_linux_arm64(program: &Program, options: Options) -> Result<String, String> {
    linux_arm64::emit(program, options)
}

pub fn emit(program: &Program, target: Target, options: Options) -> Result<String, String> {
    if program.target != target.triple() {
        return Err(format!(
            "HIR target `{}` does not match codegen target `{target}`",
            program.target
        ));
    }
    match target {
        Target::MacosArm64 => emit_macos_arm64(program, options),
        Target::LinuxArm64 => emit_linux_arm64(program, options),
        Target::MacosX86_64 | Target::LinuxX86_64 => x86_64::emit(program, options, target),
    }
}
