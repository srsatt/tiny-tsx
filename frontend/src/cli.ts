#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import {fileURLToPath} from "node:url";
import {auditCompatibility} from "./compatibility-audit.js";
import {CompileFailure, formatDiagnostic} from "./diagnostics.js";
import {compileEntry} from "./program.js";
import {compileTest262Entry} from "./test262.js";
import {compileWptEntry} from "./wpt.js";

const args = process.argv.slice(2);
if (args[0] === "--audit-compat") {
  audit(args.slice(1));
} else if (args[0] === "--test262") {
  compileTest262(args.slice(1));
} else if (args[0] === "--wpt") {
  compileWpt(args.slice(1));
} else if (args[0] === undefined) {
  usage();
  process.exitCode = 2;
} else {
  compile(args);
}

function compileWpt(args: string[]): void {
  const entry = args[0];
  if (entry === undefined || args.length !== 1) {
    process.stderr.write("error: --wpt requires exactly one entry file\n");
    process.exitCode = 2;
    return;
  }
  try {
    process.stdout.write(`${JSON.stringify(compileWptEntry(entry), null, 2)}\n`);
  } catch (error) {
    if (error instanceof CompileFailure) {
      process.stderr.write(`${error.diagnostics.map(formatDiagnostic).join("\n\n")}\n`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}

function compileTest262(args: string[]): void {
  const entry = args[0];
  if (entry === undefined || args.length !== 1) {
    process.stderr.write("error: --test262 requires exactly one entry file\n");
    process.exitCode = 2;
    return;
  }
  try {
    const hir = compileTest262Entry(entry);
    process.stdout.write(`${JSON.stringify(hir, null, 2)}\n`);
  } catch (error) {
    if (error instanceof CompileFailure) {
      process.stderr.write(`${error.diagnostics.map(formatDiagnostic).join("\n\n")}\n`);
      process.exitCode = 1;
    } else {
      throw error;
    }
  }
}

function compile(args: string[]): void {
  const entry = args[0]!;
  const defaultSdk = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../sdk/index.d.ts");
  const options = parseOptions(args.slice(1), new Set([
    "--sdk", "--alias", "--api", "--allow-env", "--allow-read", "--allow-write", "--binding",
  ]));
  if (options === undefined) {
    return;
  }
  const sdkPath = options.values.get("--sdk")?.[0] ?? defaultSdk;
  const aliases = parseAliases(options.values.get("--alias") ?? []);
  const apiAliases = parseAliases(options.values.get("--api") ?? []);
  const sqliteKvBindings = parseSqliteKvBindings(options.values.get("--binding") ?? []);
  if (aliases === undefined || apiAliases === undefined || sqliteKvBindings === undefined) {
    return;
  }
  if ((options.values.get("--sdk")?.length ?? 0) > 1) {
    process.stderr.write("error: --sdk may only be provided once\n");
    process.exitCode = 2;
  } else {
    try {
      const hir = compileEntry(entry, {
        sdkPath,
        aliases,
        apiAliases,
        allowedEnvironment: new Set(options.values.get("--allow-env") ?? []),
        allowedReadRoots: options.values.get("--allow-read") ?? [],
        allowedWriteRoots: options.values.get("--allow-write") ?? [],
        sqliteKvBindings,
      });
      process.stdout.write(`${JSON.stringify(hir, null, 2)}\n`);
    } catch (error) {
      if (error instanceof CompileFailure) {
        process.stderr.write(`${error.diagnostics.map(formatDiagnostic).join("\n\n")}\n`);
        process.exitCode = 1;
      } else {
        throw error;
      }
    }
  }
}

function parseSqliteKvBindings(values: string[]): Record<string, string> | undefined {
  const bindings: Record<string, string> = {};
  for (const value of values) {
    const separator = value.indexOf("=");
    const name = value.slice(0, separator);
    const adapter = value.slice(separator + 1);
    const path = adapter.startsWith("sqlite-kv:") ? adapter.slice("sqlite-kv:".length) : "";
    if (
      separator <= 0
      || !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name)
      || path.length === 0
      || Buffer.byteLength(path, "utf8") > 4096
      || bindings[name] !== undefined
    ) {
      process.stderr.write(
        "error: --binding requires one unique <name>=sqlite-kv:<path> value\n",
      );
      process.exitCode = 2;
      return undefined;
    }
    bindings[name] = path;
  }
  return bindings;
}

function audit(args: string[]): void {
  const entry = args[0];
  if (entry === undefined) {
    usage();
    process.exitCode = 2;
    return;
  }

  const options = parseOptions(args.slice(1), new Set(["--alias"]));
  if (options === undefined) {
    return;
  }
  const aliases = parseAliases(options.values.get("--alias") ?? []);
  if (aliases === undefined) {
    return;
  }

  const report = auditCompatibility(entry, {aliases});
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.diagnostics.length > 0) {
    process.exitCode = 1;
  }
}

function parseAliases(values: string[]): Record<string, string> | undefined {
  const aliases: Record<string, string> = {};
  for (const alias of values) {
    const separator = alias.indexOf("=");
    if (separator <= 0 || separator === alias.length - 1) {
      process.stderr.write("error: --alias requires <specifier>=<path>\n");
      process.exitCode = 2;
      return undefined;
    }
    aliases[alias.slice(0, separator)] = alias.slice(separator + 1);
  }
  return aliases;
}

function parseOptions(
  args: string[],
  accepted: ReadonlySet<string>,
): {values: Map<string, string[]>} | undefined {
  const values = new Map<string, string[]>();
  for (let index = 0; index < args.length; index += 2) {
    const option = args[index]!;
    const value = args[index + 1];
    if (!accepted.has(option) || value === undefined) {
      process.stderr.write(`error: unexpected or incomplete argument \`${option}\`\n`);
      process.exitCode = 2;
      return undefined;
    }
    const existing = values.get(option) ?? [];
    existing.push(value);
    values.set(option, existing);
  }
  return {values};
}

function usage(): void {
  process.stderr.write(
    "usage: tinytsx-frontend <entry.tsx> [--sdk <index.d.ts>] [--alias <specifier>=<path>]..."
    + " [--api <specifier>=<api.d.ts>]... [--allow-env <name>]... [--allow-read <root>]... [--allow-write <root>]...\n"
    + "       bindings: [--binding <name>=sqlite-kv:<path>]...\n"
    + "       tinytsx-frontend --audit-compat <entry> [--alias <specifier>=<path>]...\n"
    + "       tinytsx-frontend --test262 <entry.js>\n"
    + "       tinytsx-frontend --wpt <entry.js>\n",
  );
}
