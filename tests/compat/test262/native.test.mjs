import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, "../../..");
const manifest = JSON.parse(fs.readFileSync(path.join(directory, "allowlist.json"), "utf8"));
const nativeCases = manifest.cases.filter(testCase => testCase.mode === "native");

test("contains at least one native Test262 case", () => {
  assert.ok(nativeCases.length > 0);
});

for (const testCase of nativeCases) {
  test(`executes ${testCase.path} as native code`, () => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "tinytsx-test262-native-"));
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
          "test262",
          path.join(manifest.upstream.path, testCase.path),
          "--output",
          binary,
        ],
        {cwd: repository, stdio: "pipe"},
      );
      assert.deepEqual(fs.readFileSync(binary).subarray(0, 4), Buffer.from([0xcf, 0xfa, 0xed, 0xfe]));
      execFileSync(binary, {stdio: "pipe"});
    } finally {
      fs.rmSync(temporary, {recursive: true, force: true});
    }
  });
}
