import assert from "node:assert/strict";
import path from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {compileWptEntry} from "../src/wpt.js";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

function upstream(name: string): string {
  return path.join(repository, "tests/compat/wpt/upstream", name);
}

function derived(name: string): string {
  return path.join(repository, "tests/compat/wpt/derived", name);
}

test("lowers the complete pinned URLSearchParams get WPT as sequential operations", () => {
  const program = compileWptEntry(upstream("urlsearchparams-get.any.js"));

  assert.equal(program.version, 3);
  assert.deepEqual(program.tests.map(wptTest => [wptTest.name, wptTest.slots, wptTest.operations.length]), [
    ["Get basics", 1, 10],
    ["More get() basics", 1, 6],
  ]);
  assert.deepEqual(program.tests[0]?.operations[4], {
    kind: "urlSearchParamsConstruct",
    slot: 0,
    input: "a=b&c=d&a=e",
    span: program.tests[0]?.operations[4]?.span,
  });
  assert.deepEqual(program.tests[1]?.operations.at(-1), {
    kind: "urlSearchParamsAssertGet",
    slot: 0,
    name: "fourth",
    expected: null,
    message: "Search params object has no \"fourth\" name and value.",
    span: program.tests[1]?.operations.at(-1)?.span,
  });
});

test("lowers the complete pinned URLSearchParams stringifier WPT", () => {
  const program = compileWptEntry(upstream("urlsearchparams-stringifier.any.js"));

  assert.equal(program.tests.length, 14);
  assert.deepEqual(program.tests.slice(-2).map(wptTest => [
    wptTest.name,
    wptTest.slots,
    wptTest.urlSlots,
  ]), [
    ["URLSearchParams connected to URL", 1, 1],
    ["URLSearchParams must not do newline normalization", 1, 1],
  ]);
  assert.ok(program.tests.some(wptTest => wptTest.operations.some(operation =>
    operation.kind === "urlSearchParamsAssertStringified"
    && operation.expected === "a=b%F0%9F%92%A9c"
  )));
  assert.deepEqual(program.tests.at(-2)?.operations.map(operation => operation.kind), [
    "urlConstruct",
    "urlAssertStringified",
    "urlSearchParamsAssertStringified",
    "urlSearchParamsAppend",
    "urlAssertStringified",
    "urlSearchParamsAssertStringified",
  ]);
});

test("lowers the complete pinned URLSearchParams has WPT with mutation and coercion", () => {
  const program = compileWptEntry(upstream("urlsearchparams-has.any.js"));

  assert.deepEqual(program.tests.map(wptTest => [wptTest.name, wptTest.operations.length]), [
    ["Has basics", 10],
    ["has() following delete()", 9],
    ["Two-argument has()", 10],
    ["Two-argument has() respects undefined as second arg", 5],
  ]);
  assert.deepEqual(program.tests[0]?.operations.at(-1), {
    kind: "urlSearchParamsAssertHas",
    slot: 0,
    name: "null",
    expected: true,
    span: program.tests[0]?.operations.at(-1)?.span,
  });
  assert.deepEqual(program.tests[1]?.operations.slice(1, 3).map(operation => {
    const {span: _span, ...observable} = operation;
    return observable;
  }), [
    {kind: "urlSearchParamsAppend", slot: 0, name: "first", value: "1"},
    {kind: "urlSearchParamsAppend", slot: 0, name: "first", value: "2"},
  ]);
  assert.deepEqual(program.tests[2]?.operations.at(-2), {
    kind: "urlSearchParamsDelete",
    slot: 0,
    name: "a",
    value: "b",
    span: program.tests[2]?.operations.at(-2)?.span,
  });
  assert.deepEqual(program.tests[3]?.operations.at(-1), {
    kind: "urlSearchParamsAssertHas",
    slot: 0,
    name: "a",
    expected: true,
    span: program.tests[3]?.operations.at(-1)?.span,
  });
});

test("lowers the derived invalid UTF-8 form-decoder case", () => {
  const program = compileWptEntry(derived("urlencoded-parser-invalid-utf8.any.js"));

  assert.equal(program.tests.length, 4);
  assert.deepEqual(program.tests.map(wptTest => [wptTest.name, wptTest.operations.length]), [
    ["URLSearchParams replaces two invalid leading bytes", 3],
    ["URLSearchParams replaces two reversed invalid leading bytes", 3],
    ["URLSearchParams replaces an incomplete UTF-8 sequence", 3],
    ["URLSearchParams replaces an interrupted UTF-8 sequence", 3],
  ]);
  assert.ok(program.tests.every(wptTest => wptTest.operations[1]?.kind === "urlSearchParamsAssertGet"));
  assert.deepEqual(program.tests.map(wptTest => wptTest.operations[2]?.kind), [
    "urlSearchParamsAssertStringified",
    "urlSearchParamsAssertStringified",
    "urlSearchParamsAssertStringified",
    "urlSearchParamsAssertStringified",
  ]);
});
