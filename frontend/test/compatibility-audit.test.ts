import assert from "node:assert/strict";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {after, test} from "node:test";
import {fileURLToPath} from "node:url";
import {auditCompatibility} from "../src/compatibility-audit.js";
import {CompileFailure} from "../src/diagnostics.js";
import {loadModuleGraph} from "../src/module-graph.js";
import {compileEntry} from "../src/program.js";

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
  assert.ok(report.staging.constantBindings > 0);
  assert.ok(report.staging.constantSpreads > 0);
  assert.ok(report.staging.runtimeSpreads > 0);
});

test("the compiling frontend reaches the first unsupported Hono class", () => {
  assert.throws(
    () => compileEntry(path.join(repository, "tests/compat/hono/smoke.ts"), {
      sdkPath: path.join(repository, "sdk/index.d.ts"),
      aliases: {"hono/tiny": path.join(repository, "vendor/hono/src/preset/tiny.ts")},
      apiAliases: {"hono/tiny": path.join(repository, "tests/compat/hono/api.d.ts")},
    }),
    (error: unknown) => error instanceof CompileFailure
      && error.diagnostics[0]?.code === "TINY1002"
      && error.diagnostics[0]?.span?.file.endsWith("vendor/hono/src/preset/tiny.ts") === true,
  );
});

test("the upstream basic route enters the full Hono package runtime graph", () => {
  assert.throws(
    () => compileEntry(path.join(repository, "tests/compat/hono/basic-smoke.ts"), {
      sdkPath: path.join(repository, "sdk/index.d.ts"),
      aliases: {"hono": path.join(repository, "vendor/hono/src/index.ts")},
      apiAliases: {"hono": path.join(repository, "tests/compat/hono/api.d.ts")},
    }),
    (error: unknown) => error instanceof CompileFailure
      && error.diagnostics[0]?.code === "TINY1002"
      && error.diagnostics[0]?.span?.file.includes("vendor/hono/src/") === true,
  );
});

test("type-checks the entry against the Hono API overlay before runtime lowering", () => {
  const entry = write("invalid-hono.ts", `
    import {Hono} from "hono/tiny";
    const app = new Hono();
    app.get(42, context => context.text("bad path"));
    export default app;
  `);

  assert.throws(
    () => compileEntry(entry, {
      sdkPath: path.join(repository, "sdk/index.d.ts"),
      aliases: {"hono/tiny": path.join(repository, "vendor/hono/src/preset/tiny.ts")},
      apiAliases: {"hono/tiny": path.join(repository, "tests/compat/hono/api.d.ts")},
    }),
    (error: unknown) => error instanceof CompileFailure
      && error.diagnostics[0]?.code === "TS2345"
      && error.diagnostics[0]?.span?.file === entry,
  );
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
