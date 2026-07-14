#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import {fileURLToPath} from "node:url";
import {auditCompatibility} from "./compatibility-audit.js";
import {CompileFailure, formatDiagnostic} from "./diagnostics.js";
import {compileEntry} from "./program.js";

const args = process.argv.slice(2);
if (args[0] === "--audit-compat") {
  audit(args.slice(1));
} else if (args[0] === undefined) {
  usage();
  process.exitCode = 2;
} else {
  compile(args);
}

function compile(args: string[]): void {
  const entry = args[0]!;
  const sdkArgument = process.argv.indexOf("--sdk");
  const defaultSdk = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../sdk/index.d.ts");
  const sdkPath = sdkArgument === -1 ? defaultSdk : process.argv[sdkArgument + 1];
  if (sdkPath === undefined) {
    process.stderr.write("error: --sdk requires a path\n");
    process.exitCode = 2;
  } else {
    try {
      const hir = compileEntry(entry, {sdkPath});
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

function audit(args: string[]): void {
  const entry = args[0];
  if (entry === undefined) {
    usage();
    process.exitCode = 2;
    return;
  }

  const aliases: Record<string, string> = {};
  for (let index = 1; index < args.length; index++) {
    if (args[index] !== "--alias" || args[index + 1] === undefined) {
      process.stderr.write(`error: unexpected audit argument \`${args[index]}\`\n`);
      process.exitCode = 2;
      return;
    }
    const alias = args[++index]!;
    const separator = alias.indexOf("=");
    if (separator <= 0 || separator === alias.length - 1) {
      process.stderr.write("error: --alias requires <specifier>=<path>\n");
      process.exitCode = 2;
      return;
    }
    aliases[alias.slice(0, separator)] = alias.slice(separator + 1);
  }

  const report = auditCompatibility(entry, {aliases});
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.diagnostics.length > 0) {
    process.exitCode = 1;
  }
}

function usage(): void {
  process.stderr.write(
    "usage: tinytsx-frontend <entry.tsx> [--sdk <index.d.ts>]\n"
    + "       tinytsx-frontend --audit-compat <entry> [--alias <specifier>=<path>]...\n",
  );
}
