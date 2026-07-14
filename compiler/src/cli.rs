use std::ffi::OsString;

use crate::{codegen, frontend};

const USAGE: &str = "\
TinyTSX native TSX compiler

Usage:
  tinytsx check <entry.tsx> [--emit-hir | --emit-asm]
  tinytsx build <entry.tsx> [options]
  tinytsx run <entry.tsx> [options]
";

pub fn run(arguments: impl Iterator<Item = OsString>) -> Result<(), String> {
    let arguments = arguments
        .map(|argument| {
            argument
                .into_string()
                .map_err(|_| "arguments must be valid UTF-8".to_owned())
        })
        .collect::<Result<Vec<_>, _>>()?;

    match arguments.first().map(String::as_str) {
        Some("check") => check(&arguments[1..]),
        Some("build" | "run") => Err(
            "build and run are introduced with the bootstrap runtime in the next implementation slice"
                .to_owned(),
        ),
        Some("-h" | "--help") | None => {
            print!("{USAGE}");
            Ok(())
        }
        Some(command) => Err(format!("unknown command `{command}`\n\n{USAGE}")),
    }
}

fn check(arguments: &[String]) -> Result<(), String> {
    let mut entry = None;
    let mut emit_hir = false;
    let mut emit_asm = false;

    for argument in arguments {
        match argument.as_str() {
            "--emit-hir" => emit_hir = true,
            "--emit-asm" => emit_asm = true,
            option if option.starts_with('-') => {
                return Err(format!("unknown check option `{option}`"));
            }
            value if entry.is_none() => entry = Some(value),
            value => return Err(format!("unexpected argument `{value}`")),
        }
    }

    if emit_hir && emit_asm {
        return Err("--emit-hir and --emit-asm cannot be used together".to_owned());
    }
    let entry = entry.ok_or_else(|| format!("check requires an entry module\n\n{USAGE}"))?;
    let compilation = frontend::compile(entry)?;

    if emit_hir {
        println!("{}", compilation.json);
    } else if emit_asm {
        print!("{}", codegen::emit_macos_arm64(&compilation.program)?);
    } else {
        println!(
            "checked {}: {} module(s), {} component(s), {} static HTML byte(s)",
            compilation.program.entry,
            compilation.program.statistics.modules,
            compilation.program.statistics.components,
            compilation.program.statistics.static_html_bytes,
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::run;

    #[test]
    fn rejects_unknown_commands() {
        let error = run(["wat"].into_iter().map(Into::into)).unwrap_err();
        assert!(error.contains("unknown command `wat`"));
    }

    #[test]
    fn rejects_conflicting_output_flags() {
        let error = run(["check", "app.tsx", "--emit-hir", "--emit-asm"]
            .into_iter()
            .map(Into::into))
        .unwrap_err();
        assert_eq!(error, "--emit-hir and --emit-asm cannot be used together");
    }
}
