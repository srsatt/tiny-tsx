use crate::hir::Program;

use super::{Options, aarch64::Dialect, aarch64_backend};

pub(super) fn emit(program: &Program, options: Options) -> Result<String, String> {
    aarch64_backend::emit(program, options, Dialect::Apple)
}
