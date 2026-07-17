import assert from "node:assert/strict";
import path from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {compileTest262Entry} from "../src/test262.js";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

test("lowers the complete pinned infinite for/throw Test262 case", () => {
  const program = compileTest262Entry(path.join(
    repository,
    "vendor/test262/test/language/statements/for/S12.6.3_A1.js",
  ));

  assert.equal(program.version, 3);
  assert.deepEqual(program.assertions, [{
    kind: "forThrowCounter",
    initial: 0,
    threshold: 100,
    thrown: 1,
    catchExpected: 1,
    finalExpected: 101,
    span: program.assertions[0]?.span,
  }]);
});

test("lowers the complete pinned Array.prototype.unshift Test262 case", () => {
  const program = compileTest262Entry(path.join(
    repository,
    "vendor/test262/test/built-ins/Array/prototype/unshift/S15.4.4.13_A1_T1.js",
  ));

  assert.equal(program.version, 3);
  const assertion = program.assertions[0];
  assert.equal(assertion?.kind, "arrayUnshiftProgram");
  if (assertion?.kind !== "arrayUnshiftProgram") return;
  assert.equal(assertion.capacity, 16);
  assert.deepEqual(assertion.operations.map(({span: _span, ...operation}) => operation), [
    {kind: "unshift", values: [1]},
    {kind: "assertResult", expected: 1},
    {kind: "assertElement", index: 0, expected: 1},
    {kind: "unshift", values: []},
    {kind: "assertResult", expected: 1},
    {kind: "assertElement", index: 1, expected: null},
    {kind: "unshift", values: [-1]},
    {kind: "assertResult", expected: 2},
    {kind: "assertElement", index: 0, expected: -1},
    {kind: "assertElement", index: 1, expected: 1},
    {kind: "assertLength", expected: 2},
  ]);
});

test("lowers the complete pinned array spread/apply Test262 case", () => {
  const program = compileTest262Entry(path.join(
    repository,
    "vendor/test262/test/language/expressions/array/spread-sngl-literal.js",
  ));

  assert.deepEqual(program.assertions, [{
    kind: "arraySpreadApplyProgram",
    values: [3, 4, 5],
    expectedArguments: [3, 4, 5],
    expectedCalls: 1,
    span: program.assertions[0]?.span,
  }]);
});
