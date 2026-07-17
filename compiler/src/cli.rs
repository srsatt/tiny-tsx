use std::{ffi::OsString, path::PathBuf};

use crate::{build, builtins, codegen, frontend, target::Target, test262_build, wpt_build};

const USAGE: &str = "\
TinyTSX native TSX compiler

Usage:
  tinytsx check <entry.tsx> [--emit-hir | --emit-asm] [--target triple] [--alias specifier=path] [--api specifier=path] [--allow-env name]... [--allow-read root]... [--allow-write root]...
  tinytsx build <entry.tsx> [options]
  tinytsx run <entry.tsx> [options]
  tinytsx test262 <case.js> [--output path]
  tinytsx wpt <case.js> [--output path]
  tinytsx --list-builtins
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
        Some("test262") => test262(&arguments[1..]),
        Some("wpt") => wpt(&arguments[1..]),
        Some("--list-builtins") if arguments.len() == 1 => {
            println!("{}", builtins::json()?);
            Ok(())
        }
        Some("-h" | "--help") | None => {
            print!("{USAGE}");
            Ok(())
        }
        Some(command) => Err(format!("unknown command `{command}`\n\n{USAGE}")),
    }
}

fn wpt(arguments: &[String]) -> Result<(), String> {
    let mut entry = None;
    let mut output = PathBuf::from("dist/wpt");
    let mut index = 0;
    while index < arguments.len() {
        match arguments[index].as_str() {
            "--output" => output = PathBuf::from(option_value(arguments, &mut index)?),
            option if option.starts_with('-') => {
                return Err(format!("unknown WPT option `{option}`"));
            }
            value if entry.is_none() => entry = Some(value.to_owned()),
            value => return Err(format!("unexpected argument `{value}`")),
        }
        index += 1;
    }
    let entry = entry.ok_or_else(|| format!("wpt requires a case file\n\n{USAGE}"))?;
    wpt_build::execute(&wpt_build::Options { entry, output }).map(|_| ())
}

fn test262(arguments: &[String]) -> Result<(), String> {
    let mut entry = None;
    let mut output = PathBuf::from("dist/test262");
    let mut index = 0;
    while index < arguments.len() {
        match arguments[index].as_str() {
            "--output" => output = PathBuf::from(option_value(arguments, &mut index)?),
            option if option.starts_with('-') => {
                return Err(format!("unknown Test262 option `{option}`"));
            }
            value if entry.is_none() => entry = Some(value.to_owned()),
            value => return Err(format!("unexpected argument `{value}`")),
        }
        index += 1;
    }
    let entry = entry.ok_or_else(|| format!("test262 requires a case file\n\n{USAGE}"))?;
    test262_build::execute(&test262_build::Options { entry, output }).map(|_| ())
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
        port_explicit: false,
        workers: 1,
        request_memory: 262_144,
        release: false,
        emit_hir: false,
        emit_asm: false,
        keep_temps: false,
        aliases: Vec::new(),
        api_aliases: Vec::new(),
        allowed_environment: Vec::new(),
        allowed_read_roots: Vec::new(),
        allowed_write_roots: Vec::new(),
        target: Target::default_for_host(),
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
            "--port" => {
                options.port = parse_number(option_value(arguments, &mut index)?, "port")?;
                options.port_explicit = true;
            }
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
            "--allow-env" => options
                .allowed_environment
                .push(option_value(arguments, &mut index)?.to_owned()),
            "--allow-read" => options
                .allowed_read_roots
                .push(option_value(arguments, &mut index)?.to_owned()),
            "--allow-write" => options
                .allowed_write_roots
                .push(option_value(arguments, &mut index)?.to_owned()),
            "--target" => {
                options.target = option_value(arguments, &mut index)?.parse()?;
            }
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
                    "--worker-stack is not yet available in the fixed-worker bootstrap runtime"
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
    if options.workers == 0 {
        return Err("workers must be greater than zero".to_owned());
    }
    if options.request_memory == 0 {
        return Err("request memory must be greater than zero".to_owned());
    }
    validate_environment_capabilities(&mut options.allowed_environment)?;
    validate_read_capabilities(&mut options.allowed_read_roots)?;
    validate_write_capabilities(&mut options.allowed_write_roots)?;
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
    let mut allowed_environment = Vec::new();
    let mut allowed_read_roots = Vec::new();
    let mut allowed_write_roots = Vec::new();
    let mut target = Target::default_for_host();

    let mut index = 0;
    while index < arguments.len() {
        match arguments[index].as_str() {
            "--emit-hir" => emit_hir = true,
            "--emit-asm" => emit_asm = true,
            "--alias" => aliases.push(option_value(arguments, &mut index)?.to_owned()),
            "--api" => api_aliases.push(option_value(arguments, &mut index)?.to_owned()),
            "--allow-env" => {
                allowed_environment.push(option_value(arguments, &mut index)?.to_owned())
            }
            "--allow-read" => {
                allowed_read_roots.push(option_value(arguments, &mut index)?.to_owned())
            }
            "--allow-write" => {
                allowed_write_roots.push(option_value(arguments, &mut index)?.to_owned())
            }
            "--target" => target = option_value(arguments, &mut index)?.parse()?,
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
    validate_environment_capabilities(&mut allowed_environment)?;
    validate_read_capabilities(&mut allowed_read_roots)?;
    validate_write_capabilities(&mut allowed_write_roots)?;
    let mut compilation = frontend::compile(
        entry,
        &aliases,
        &api_aliases,
        &allowed_environment,
        &allowed_read_roots,
        &allowed_write_roots,
    )?;
    compilation.retarget(target)?;

    if emit_hir {
        println!("{}", compilation.json);
    } else if emit_asm {
        let mut options = codegen::Options::default();
        if let Some(port) = compilation.program.server.port {
            options.port = port;
        }
        options.read_roots = allowed_read_roots;
        print!("{}", codegen::emit(&compilation.program, target, options)?);
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

fn validate_environment_capabilities(names: &mut Vec<String>) -> Result<(), String> {
    names.sort();
    names.dedup();
    if names.len() > 64 {
        return Err("at most 64 environment capabilities may be granted".to_owned());
    }
    for name in names.iter() {
        if name.is_empty()
            || name.len() > 128
            || !name.is_ascii()
            || name.as_bytes()[0].is_ascii_digit()
            || !name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        {
            return Err(format!(
                "invalid environment capability `{name}`; expected an ASCII name up to 128 bytes"
            ));
        }
    }
    Ok(())
}

fn validate_read_capabilities(roots: &mut Vec<String>) -> Result<(), String> {
    if roots.len() > 16 {
        return Err("at most 16 filesystem read roots may be granted".to_owned());
    }
    for root in roots.iter_mut() {
        let canonical = std::fs::canonicalize(&*root)
            .map_err(|error| format!("TINY1502: cannot grant read root `{root}`: {error}"))?;
        if !canonical.is_dir() {
            return Err(format!("TINY1502: read root `{root}` is not a directory"));
        }
        *root = canonical
            .into_os_string()
            .into_string()
            .map_err(|_| "TINY1502: read roots must be valid UTF-8".to_owned())?;
    }
    roots.sort();
    roots.dedup();
    Ok(())
}

fn validate_write_capabilities(roots: &mut Vec<String>) -> Result<(), String> {
    if roots.len() > 16 {
        return Err("at most 16 filesystem write roots may be granted".to_owned());
    }
    for root in roots.iter_mut() {
        let canonical = std::fs::canonicalize(&*root)
            .map_err(|error| format!("TINY1511: cannot grant write root `{root}`: {error}"))?;
        if !canonical.is_dir() {
            return Err(format!("TINY1511: write root `{root}` is not a directory"));
        }
        *root = canonical
            .into_os_string()
            .into_string()
            .map_err(|_| "TINY1511: write roots must be valid UTF-8".to_owned())?;
    }
    roots.sort();
    roots.dedup();
    Ok(())
}

#[cfg(test)]
#[path = "cli_tests.rs"]
mod tests;
