import assert from "node:assert/strict";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {after, test} from "node:test";
import {fileURLToPath} from "node:url";
import ts from "typescript";
import {analyzeApplicationEntry} from "../src/application-entry.js";
import {
  evaluateApplicationConstructor,
  evaluateApplicationInitialization,
} from "../src/constructor-evaluator.js";
import {auditCompatibility} from "../src/compatibility-audit.js";
import {CompileFailure} from "../src/diagnostics.js";
import {loadModuleGraph} from "../src/module-graph.js";
import {compileEntry} from "../src/program.js";
import {resolveRuntimeClassPlan} from "../src/runtime-class-plan.js";

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
  assert.ok(report.staging.closedComputedAccesses > 0);
  assert.ok(report.staging.runtimeComputedAccesses > 0);
});

test("traces the pinned Hono basic application initialization root", () => {
  const file = path.join(repository, "tests/compat/hono/basic-smoke.ts");
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);

  const application = analyzeApplicationEntry(sourceFile);

  assert.equal(application?.binding, "app");
  assert.equal(application?.constructorName, "Hono");
  assert.deepEqual(application?.constructorArguments, []);
  assert.deepEqual(application?.calls.map(call => ({
    method: call.method,
    arguments: call.arguments.map(argument =>
      argument.kind === "string" ? [argument.kind, argument.value] : [argument.kind]
    ),
  })), [{method: "get", arguments: [["string", "/"], ["function"]]}]);
});

test("resolves the pinned Hono constructor and base-class runtime sources", () => {
  const entry = path.join(repository, "tests/compat/hono/basic-smoke.ts");
  const graph = loadModuleGraph(entry, {
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
  });
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);

  const plan = resolveRuntimeClassPlan(graph, application);

  assert.deepEqual(plan?.classes.map(step => ({
    file: path.relative(repository, step.module),
    name: step.name,
    operations: step.operations,
  })), [
    {
      file: "vendor/hono/src/hono.ts",
      name: "Hono",
      operations: ["superCall", "assignment"],
    },
    {
      file: "vendor/hono/src/hono-base.ts",
      name: "Hono",
      operations: [
        "variable", "forEach", "assignment", "assignment", "variable", "call", "assignment",
      ],
    },
  ]);
});

test("symbolically executes the pinned Hono constructor chain", () => {
  const entry = path.join(repository, "tests/compat/hono/basic-smoke.ts");
  const graph = loadModuleGraph(entry, {
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
  });
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);

  const result = evaluateApplicationConstructor(graph, application);

  assert.deepEqual(result?.issues, []);
  assert.deepEqual(result?.fields.map(field => [field.name, field.kind, field.detail]), [
    ["_basePath", "string", "/"],
    ["#path", "string", "/"],
    ["routes", "array", undefined],
    ["#notFoundHandler", "reference", "notFoundHandler"],
    ["errorHandler", "reference", "errorHandler"],
    ["onError", "closure", undefined],
    ["notFound", "closure", undefined],
    ["fetch", "closure", undefined],
    ["request", "closure", undefined],
    ["fire", "closure", undefined],
    ...["get", "post", "put", "delete", "options", "patch", "all", "on", "use"]
      .map(name => [name, "closure", undefined]),
    ["getPath", "reference", "getPath"],
    ["router", "constructed", "SmartRouter"],
  ]);
});

test("executes the pinned Hono get registration through addRoute", () => {
  const entry = path.join(repository, "tests/compat/hono/basic-smoke.ts");
  const graph = loadModuleGraph(entry, {
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
  });
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);

  const result = evaluateApplicationInitialization(graph, application);

  assert.deepEqual(result?.issues, []);
  assert.deepEqual(result?.routes, [{
    method: "GET",
    path: "/",
    basePath: "/",
    handlerKind: "closure",
    response: {
      kind: "text",
      body: "Hono!!",
      status: 200,
      contentType: "text/plain; charset=UTF-8",
    },
  }]);
  assert.equal(result?.routerInsertions, 1);
});

test("lowers the tiny-preset Hono route into native HIR", () => {
  const hir = compileEntry(path.join(repository, "tests/compat/hono/smoke.ts"), {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {"hono/tiny": path.join(repository, "vendor/hono/src/preset/tiny.ts")},
    apiAliases: {"hono/tiny": path.join(repository, "tests/compat/hono/api.d.ts")},
  });

  assert.equal(hir.modules.length, 17);
  assert.deepEqual(hir.handlers, [{
    method: "GET",
    path: "/",
    response: {
      kind: "text",
      value: {kind: "stringLiteral", string: 0, span: hir.handlers[0]?.span},
    },
    span: hir.handlers[0]?.span,
  }]);
  assert.deepEqual(hir.staticStrings, [{id: 0, value: "Hello from Hono"}]);
});

test("lowers the upstream basic route through the full Hono runtime graph", () => {
  const hir = compileEntry(path.join(repository, "tests/compat/hono/basic-smoke.ts"), {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {"hono": path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {"hono": path.join(repository, "tests/compat/hono/api.d.ts")},
  });

  assert.equal(hir.modules.length, 27);
  assert.equal(hir.handlers[0]?.method, "GET");
  assert.equal(hir.handlers[0]?.path, "/");
  assert.deepEqual(hir.staticStrings, [{id: 0, value: "Hono!!"}]);
});

test("pins the native text response to the upstream Hono contract", () => {
  const manifest = JSON.parse(readFileSync(
    path.join(repository, "tests/compat/hono/manifest.json"),
    "utf8",
  ));
  const contract = manifest.behaviorContracts.textResponse;
  const contextSource = readFileSync(path.join(repository, contract.source), "utf8");
  const basicSource = readFileSync(path.join(repository, manifest.basicSmokeEntry), "utf8");

  assert.match(contextSource, new RegExp(`export const TEXT_PLAIN = ['"]${contract.contentType}['"]`));
  assert.match(basicSource, new RegExp(`context\\.text\\(['"]${contract.body}['"]\\)`));
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
