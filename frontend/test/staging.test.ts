import assert from "node:assert/strict";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {after, test} from "node:test";
import {fileURLToPath} from "node:url";
import ts from "typescript";
import {lowerStagedConstants} from "../src/constant-lowering.js";
import {loadModuleGraph} from "../src/module-graph.js";
import {analyzeStaging, evaluateConstantExpression} from "../src/staging.js";
import {STAGED_UNDEFINED} from "../src/staged-value.js";

const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-staging-"));
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

after(() => rmSync(directory, {recursive: true, force: true}));

test("folds closed arrays and records across ESM imports", () => {
  writeFileSync(path.join(directory, "constants.ts"), `
    export const METHODS = ["get", "post"] as const;
    export const DEFAULTS = {strict: true, workers: 1} as const;
  `);
  const entry = path.join(directory, "entry.ts");
  writeFileSync(entry, `
    import {DEFAULTS, METHODS} from "./constants.js";
    const allMethods = [...METHODS, "all"];
    const options = {...DEFAULTS, strict: false};
    const source = {first: 1, second: 2};
    const {first, ...remaining} = source;
    const closedRecord = {name: "tiny", missing: undefined};
    const dynamicMap = new Map([["name", "tiny"]]);
    function append(values: string[]) { return [...values, "tail"]; }
  `);

  const report = analyzeStaging(loadModuleGraph(entry));

  assert.deepEqual(binding(report, "allMethods"), ["get", "post", "all"]);
  assert.deepEqual(binding(report, "options"), {strict: false, workers: 1});
  assert.deepEqual(binding(report, "remaining"), {second: 2});
  assert.deepEqual(binding(report, "closedRecord"), {
    name: "tiny",
    missing: STAGED_UNDEFINED,
  });
  assert.equal(report.bindings.some(binding => binding.name === "dynamicMap"), false);
  assert.equal(report.spreads.filter(spread => spread.disposition === "constant").length, 3);
  assert.equal(report.spreads.filter(spread => spread.disposition === "runtime").length, 1);
});

test("stages undefined and bigint without conflating undefined with failure", () => {
  const sourceFile = ts.createSourceFile(
    "primitives.ts",
    "[undefined, -9007199254740993n]",
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );
  const statement = sourceFile.statements[0];
  assert.ok(statement && ts.isExpressionStatement(statement));

  assert.deepEqual(
    evaluateConstantExpression(statement.expression),
    [STAGED_UNDEFINED, -9007199254740993n],
  );
});

test("tags special numbers and preserves compile-time symbol identity", () => {
  const entry = path.join(directory, "special-constants.ts");
  writeFileSync(entry, `
    const shared = Symbol("shared");
    const alias = shared;
    const other = Symbol("shared");
    const values = {
      negativeZero: -0,
      nan: NaN,
      positiveInfinity: Infinity,
      negativeInfinity: -Infinity,
      shared,
      alias,
      other,
      anonymous: Symbol(),
    } as const;
  `);

  const constants = lowerStagedConstants(analyzeStaging(loadModuleGraph(entry)).bindings);
  const shared = constants.find(constant => constant.name === "shared")?.value;
  const alias = constants.find(constant => constant.name === "alias")?.value;
  const other = constants.find(constant => constant.name === "other")?.value;
  const values = constants.find(constant => constant.name === "values")?.value;

  assert.deepEqual(shared, {kind: "symbol", id: 0, description: "shared"});
  assert.deepEqual(alias, shared);
  assert.deepEqual(other, {kind: "symbol", id: 1, description: "shared"});
  assert.deepEqual(values, {
    kind: "record",
    fields: [
      {name: "negativeZero", value: {kind: "numberSpecial", value: "negativeZero"}},
      {name: "nan", value: {kind: "numberSpecial", value: "nan"}},
      {name: "positiveInfinity", value: {kind: "numberSpecial", value: "positiveInfinity"}},
      {name: "negativeInfinity", value: {kind: "numberSpecial", value: "negativeInfinity"}},
      {name: "shared", value: shared},
      {name: "alias", value: shared},
      {name: "other", value: other},
      {name: "anonymous", value: {kind: "symbol", id: 2}},
    ],
  });
});

test("folds Hono's method-table spread during process initialization", () => {
  const entry = path.join(repository, "tests/compat/hono/smoke.ts");
  const graph = loadModuleGraph(entry, {
    aliases: {"hono/tiny": path.join(repository, "vendor/hono/src/preset/tiny.ts")},
  });

  const report = analyzeStaging(graph);
  const constants = lowerStagedConstants(report.bindings);

  assert.deepEqual(binding(report, "allMethods"), [
    "get", "post", "put", "delete", "options", "patch", "all",
  ]);
  assert.deepEqual(
    constants.find(constant => constant.name === "allMethods")?.value,
    {
      kind: "array",
      items: ["get", "post", "put", "delete", "options", "patch", "all"]
        .map(value => ({kind: "string", value})),
    },
  );
  assert.ok(report.spreads.some(spread =>
    spread.disposition === "constant"
    && spread.span.file.endsWith("vendor/hono/src/hono-base.ts")
    && spread.span.line === 128
  ));
  assert.ok(report.computedAccesses.some(access =>
    access.disposition === "closed"
    && access.operation === "write"
    && access.span.file.endsWith("vendor/hono/src/hono-base.ts")
    && access.span.line === 130
    && JSON.stringify(access.keys) === JSON.stringify([
      "get", "post", "put", "delete", "options", "patch", "all",
    ])
  ));
});

test("distinguishes closed forEach keys from dynamic computed access", () => {
  const entry = path.join(directory, "computed.ts");
  writeFileSync(entry, `
    const keys = ["get", "post"] as const;
    class Routes {
      constructor(dynamic: string) {
        keys.forEach((key) => { this[key] = key; });
        this[dynamic] = dynamic;
      }
    }
  `);

  const report = analyzeStaging(loadModuleGraph(entry));

  assert.deepEqual(report.computedAccesses.map(access => ({
    disposition: access.disposition,
    keys: access.keys,
  })), [
    {disposition: "closed", keys: ["get", "post"]},
    {disposition: "runtime", keys: []},
  ]);
});

test("folds the array literal in the pinned Test262 spread case", () => {
  const file = path.join(
    repository,
    "vendor/test262/test/language/expressions/array/spread-sngl-literal.js",
  );
  const sourceFile = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.JS,
  );
  let spreadArray: ts.ArrayLiteralExpression | undefined;
  function visit(node: ts.Node): void {
    if (
      spreadArray === undefined
      && ts.isArrayLiteralExpression(node)
      && node.elements.some(ts.isSpreadElement)
    ) {
      spreadArray = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  assert.ok(spreadArray);
  assert.deepEqual(evaluateConstantExpression(spreadArray), [3, 4, 5]);
});

function binding(report: ReturnType<typeof analyzeStaging>, name: string) {
  return report.bindings.find(binding => binding.name === name)?.value;
}
