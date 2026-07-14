import assert from "node:assert/strict";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {after, test} from "node:test";
import {fileURLToPath} from "node:url";
import {auditCompatibility} from "../src/compatibility-audit.js";
import {loadModuleGraph} from "../src/module-graph.js";

const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-compat-"));
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

after(() => rmSync(directory, {recursive: true, force: true}));

test("loads runtime imports transitively while skipping type-only imports", () => {
  const entry = write("entry.ts", `
    import {value} from "./value";
    import type {OnlyType} from "./types";
    export const result: OnlyType = value;
  `);
  const value = write("value.ts", "export const value = 1;");
  write("types.ts", "export type OnlyType = number;");

  const graph = loadModuleGraph(entry);

  assert.deepEqual(graph.diagnostics, []);
  assert.deepEqual(graph.modules.map(module => module.path), [entry, value]);
  assert.deepEqual(graph.modules[0]?.dependencies, [value]);
});

test("reports unresolved runtime imports without discarding the graph", () => {
  const entry = write("missing.ts", 'import {missing} from "not-installed";\nexport {missing};');

  const graph = loadModuleGraph(entry);

  assert.equal(graph.modules.length, 1);
  assert.equal(graph.diagnostics[0]?.code, "TINY2002");
  assert.match(graph.diagnostics[0]?.message ?? "", /not-installed/);
});

test("audits the pinned hono/tiny runtime graph", () => {
  const report = auditCompatibility(path.join(repository, "tests/compat/hono/smoke.ts"), {
    root: repository,
    aliases: {"hono/tiny": path.join(repository, "vendor/hono/src/preset/tiny.ts")},
  });

  assert.deepEqual(report.diagnostics, []);
  assert.ok(report.statistics.modules >= 10);
  assert.ok(requirement(report, "classes") > 0);
  assert.ok(requirement(report, "functions-as-values") > 0);
  assert.ok(requirement(report, "loops") > 0);
  assert.ok(requirement(report, "regular-expressions") > 0);
  assert.ok(report.builtins.some(builtin => builtin.name === "Response"));
});

function write(name: string, source: string): string {
  const file = path.join(directory, name);
  writeFileSync(file, source);
  return file;
}

function requirement(
  report: ReturnType<typeof auditCompatibility>,
  feature: string,
): number {
  return report.requirements.find(requirement => requirement.feature === feature)?.occurrences ?? 0;
}
