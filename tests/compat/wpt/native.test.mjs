import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {assertNativeExecutable} from "../native-format.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, "../../..");
const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
const nativeCases = manifest.selected.flatMap(selected => {
  const cases = selected.status === "native"
    ? [{name: selected.upstreamPath, entry: selected.localPath}]
    : [];
  if (selected.nativeCase !== undefined) {
    cases.push({name: `${selected.upstreamPath} derived case`, entry: selected.nativeCase});
  }
  return cases;
});

test("contains at least one native WPT case", () => {
  assert.ok(nativeCases.length > 0);
});

for (const selected of nativeCases) {
  test(`executes ${selected.name} as native code`, () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "tinytsx-wpt-native-"));
    const binary = path.join(temporary, "case");
    try {
      execFileSync(
        "cargo",
        [
          "run",
          "-q",
          "-p",
          "tinytsx",
          "--",
          "wpt",
          selected.entry,
          "--output",
          binary,
        ],
        {cwd: repository, stdio: "pipe"},
      );
      assertNativeExecutable(binary);
      execFileSync(binary, {stdio: "pipe"});
    } finally {
      fs.rmSync(temporary, {recursive: true, force: true});
    }
  });
}

test("executes the bounded form decoder and compiles it for Linux arm64", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "tinytsx-wpt-portable-"));
  const source = path.join(directory, "portable-runtime-smoke.c");
  const binary = path.join(temporary, "portable-runtime-smoke");
  const assembly = path.join(temporary, "portable-runtime-smoke.s");
  try {
    execFileSync(
      "clang",
      ["-std=c11", "-Wall", "-Wextra", "-Werror", source, "-o", binary],
      {cwd: repository, stdio: "pipe"},
    );
    execFileSync(binary, {stdio: "pipe"});
    execFileSync(
      "clang",
      [
        "--target=aarch64-unknown-linux-gnu",
        "-std=c11",
        "-ffreestanding",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-S",
        source,
        "-o",
        assembly,
      ],
      {cwd: repository, stdio: "pipe"},
    );
    assert.match(fs.readFileSync(assembly, "utf8"), /\bmain:/);
  } finally {
    fs.rmSync(temporary, {recursive: true, force: true});
  }
});
