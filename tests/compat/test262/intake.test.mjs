import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import ts from "../../../frontend/node_modules/typescript/lib/typescript.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const repository = path.resolve(directory, "../../..");
const manifest = JSON.parse(fs.readFileSync(path.join(directory, "allowlist.json"), "utf8"));
const upstream = path.join(repository, manifest.upstream.path);

test("uses the pinned Test262 revision", () => {
  const revision = execFileSync("git", ["-C", upstream, "rev-parse", "HEAD"], {encoding: "utf8"}).trim();
  assert.equal(revision, manifest.upstream.commit);
});

test("contains a unique allowlist with explicit evidence modes", () => {
  assert.equal(manifest.version, 2);
  assert.ok(manifest.cases.length > 0);
  assert.equal(new Set(manifest.cases.map(testCase => testCase.path)).size, manifest.cases.length);
  for (const testCase of manifest.cases) {
    assert.ok(["syntax", "native"].includes(testCase.mode));
    assert.match(testCase.path, /^test\//);
    assert.ok(testCase.feature);
  }
  assert.ok(manifest.cases.some(testCase => testCase.mode === "native"));
});

for (const testCase of manifest.cases) {
  test(`parses ${testCase.path}`, () => {
    const file = path.join(upstream, testCase.path);
    const source = fs.readFileSync(file, "utf8");
    assert.match(source, /\/\*---[\s\S]*---\*\//, "Test262 metadata is required");

    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
    const diagnostics = sourceFile.parseDiagnostics ?? [];
    assert.deepEqual(
      diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
      [],
    );
  });
}
