import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, "../../..");
const manifest = JSON.parse(fs.readFileSync(path.join(directory, "manifest.json"), "utf8"));
const nativeCases = manifest.selected.filter(selected => selected.status === "native");

test("contains at least one native WPT case", () => {
  assert.ok(nativeCases.length > 0);
});

for (const selected of nativeCases) {
  test(`executes ${selected.upstreamPath} as native code`, () => {
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
          selected.localPath,
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
