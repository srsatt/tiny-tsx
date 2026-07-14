#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import {fileURLToPath} from "node:url";
import {CompileFailure, formatDiagnostic} from "./diagnostics.js";
import {compileEntry} from "./program.js";

const entry = process.argv[2];
if (entry === undefined) {
  process.stderr.write("usage: tinytsx-frontend <entry.tsx> [--sdk <index.d.ts>]\n");
  process.exitCode = 2;
} else {
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
