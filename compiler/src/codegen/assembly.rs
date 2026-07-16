use std::fmt::{self, Write as _};

/// Target-neutral text sink for generated assembly.
///
/// Formatting into an owned `String` cannot fail, so target adapters should use
/// `asm_line!` and `asm_write!` instead of repeating `writeln!(...).unwrap()`.
pub(super) struct Assembly {
    output: String,
}

impl Assembly {
    pub(super) fn new() -> Self {
        Self {
            output: String::new(),
        }
    }

    pub(super) fn line(&mut self, arguments: fmt::Arguments<'_>) {
        self.output
            .write_fmt(arguments)
            .expect("writing assembly into a String cannot fail");
        self.output.push('\n');
    }

    pub(super) fn write(&mut self, arguments: fmt::Arguments<'_>) {
        self.output
            .write_fmt(arguments)
            .expect("writing assembly into a String cannot fail");
    }

    pub(super) fn finish(self) -> String {
        self.output
    }
}

macro_rules! asm_line {
    ($assembly:expr) => {
        $assembly.line(format_args!(""))
    };
    ($assembly:expr, $($arguments:tt)*) => {
        $assembly.line(format_args!($($arguments)*))
    };
}

macro_rules! asm_write {
    ($assembly:expr, $($arguments:tt)*) => {
        $assembly.write(format_args!($($arguments)*))
    };
}

pub(super) use {asm_line, asm_write};

#[cfg(test)]
#[path = "assembly_tests.rs"]
mod tests;
