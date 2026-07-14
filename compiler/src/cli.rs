use std::{ffi::OsString, path::PathBuf};

use crate::{build, codegen, frontend};

const USAGE: &str = "\
TinyTSX native TSX compiler

Usage:
  tinytsx check <entry.tsx> [--emit-hir | --emit-asm] [--alias specifier=path] [--api specifier=path]
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
        Some("build") => build(&arguments[1..]),
        Some("run") => run_server(&arguments[1..]),
        Some("-h" | "--help") | None => {
            print!("{USAGE}");
            Ok(())
        }
        Some(command) => Err(format!("unknown command `{command}`\n\n{USAGE}")),
    }
}

fn build(arguments: &[String]) -> Result<(), String> {
    let options = parse_build_options(arguments, PathBuf::from("dist/server"))?;
    build::execute(&options).map(|_| ())
}

fn run_server(arguments: &[String]) -> Result<(), String> {
    let options = parse_build_options(arguments, PathBuf::from(".tinytsx/run/server"))?;
    let output = build::execute(&options)?;
    let status = std::process::Command::new(&output)
        .status()
        .map_err(|error| format!("could not start {}: {error}", output.display()))?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("{} exited with {status}", output.display()))
    }
}

fn parse_build_options(
    arguments: &[String],
    default_output: PathBuf,
) -> Result<build::Options, String> {
    let mut options = build::Options {
        entry: String::new(),
        output: default_output,
        port: 3000,
        workers: 1,
        request_memory: 262_144,
        release: false,
        emit_hir: false,
        emit_asm: false,
        keep_temps: false,
        aliases: Vec::new(),
        api_aliases: Vec::new(),
    };
    let mut index = 0;
    while index < arguments.len() {
        let argument = &arguments[index];
        match argument.as_str() {
            "--release" => options.release = true,
            "--emit-hir" => options.emit_hir = true,
            "--emit-asm" => options.emit_asm = true,
            "--keep-temps" => options.keep_temps = true,
            "--print-size" => {}
            "--output" => options.output = PathBuf::from(option_value(arguments, &mut index)?),
            "--port" => options.port = parse_number(option_value(arguments, &mut index)?, "port")?,
            "--workers" => {
                options.workers = parse_number(option_value(arguments, &mut index)?, "workers")?
            }
            "--request-memory" => {
                options.request_memory =
                    parse_number(option_value(arguments, &mut index)?, "request memory")?
            }
            "--alias" => options
                .aliases
                .push(option_value(arguments, &mut index)?.to_owned()),
            "--api" => options
                .api_aliases
                .push(option_value(arguments, &mut index)?.to_owned()),
            "--runtime" => {
                let runtime = option_value(arguments, &mut index)?;
                if runtime != "bootstrap" {
                    return Err(
                        "the first vertical slice supports only `--runtime bootstrap`".to_owned(),
                    );
                }
            }
            "--worker-stack" => {
                return Err(
                    "--worker-stack is not available in the single-worker bootstrap runtime"
                        .to_owned(),
                );
            }
            option if option.starts_with('-') => {
                return Err(format!("unknown build option `{option}`"));
            }
            value if options.entry.is_empty() => options.entry = value.to_owned(),
            value => return Err(format!("unexpected argument `{value}`")),
        }
        index += 1;
    }

    if options.entry.is_empty() {
        return Err(format!("build requires an entry module\n\n{USAGE}"));
    }
    if options.port == 0 {
        return Err("port must be greater than zero".to_owned());
    }
    if options.workers != 1 {
        return Err("the first bootstrap runtime supports exactly one worker".to_owned());
    }
    if options.request_memory == 0 {
        return Err("request memory must be greater than zero".to_owned());
    }
    Ok(options)
}

fn option_value<'a>(arguments: &'a [String], index: &mut usize) -> Result<&'a str, String> {
    *index += 1;
    arguments
        .get(*index)
        .map(String::as_str)
        .ok_or_else(|| format!("{} requires a value", arguments[*index - 1]))
}

fn parse_number<T>(value: &str, name: &str) -> Result<T, String>
where
    T: std::str::FromStr,
{
    value
        .parse()
        .map_err(|_| format!("invalid {name} `{value}`"))
}

fn check(arguments: &[String]) -> Result<(), String> {
    let mut entry = None;
    let mut emit_hir = false;
    let mut emit_asm = false;
    let mut aliases = Vec::new();
    let mut api_aliases = Vec::new();

    let mut index = 0;
    while index < arguments.len() {
        match arguments[index].as_str() {
            "--emit-hir" => emit_hir = true,
            "--emit-asm" => emit_asm = true,
            "--alias" => aliases.push(option_value(arguments, &mut index)?.to_owned()),
            "--api" => api_aliases.push(option_value(arguments, &mut index)?.to_owned()),
            option if option.starts_with('-') => {
                return Err(format!("unknown check option `{option}`"));
            }
            value if entry.is_none() => entry = Some(value),
            value => return Err(format!("unexpected argument `{value}`")),
        }
        index += 1;
    }

    if emit_hir && emit_asm {
        return Err("--emit-hir and --emit-asm cannot be used together".to_owned());
    }
    let entry = entry.ok_or_else(|| format!("check requires an entry module\n\n{USAGE}"))?;
    let compilation = frontend::compile(entry, &aliases, &api_aliases)?;

    if emit_hir {
        println!("{}", compilation.json);
    } else if emit_asm {
        print!(
            "{}",
            codegen::emit_macos_arm64(&compilation.program, codegen::Options::default())?
        );
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
