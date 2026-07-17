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

test("lowers the complete pinned numeric subtraction/GetValue Test262 case", () => {
  const program = compileTest262Entry(path.join(
    repository,
    "vendor/test262/test/language/expressions/subtraction/S11.6.2_A2.1_T1.js",
  ));

  const assertion = program.assertions[0];
  assert.equal(assertion?.kind, "numericSubtractionProgram");
  if (assertion?.kind !== "numericSubtractionProgram") return;
  assert.equal(assertion.slots, 4);
  assert.deepEqual(assertion.operations.map(({span: _span, ...operation}) => operation), [
    {
      kind: "assertSubtract",
      left: {kind: "literal", value: 1},
      right: {kind: "literal", value: 1},
      expected: 0,
    },
    {kind: "set", slot: 0, value: 1},
    {
      kind: "assertSubtract",
      left: {kind: "slot", slot: 0},
      right: {kind: "literal", value: 1},
      expected: 0,
    },
    {kind: "set", slot: 1, value: 1},
    {
      kind: "assertSubtract",
      left: {kind: "literal", value: 1},
      right: {kind: "slot", slot: 1},
      expected: 0,
    },
    {kind: "set", slot: 0, value: 1},
    {kind: "set", slot: 1, value: 1},
    {
      kind: "assertSubtract",
      left: {kind: "slot", slot: 0},
      right: {kind: "slot", slot: 1},
      expected: 0,
    },
    {kind: "set", slot: 2, value: 1},
    {kind: "set", slot: 3, value: 1},
    {
      kind: "assertSubtract",
      left: {kind: "slot", slot: 2},
      right: {kind: "slot", slot: 3},
      expected: 0,
    },
  ]);
});

test("lowers the complete pinned closed-record membership Test262 case", () => {
  const program = compileTest262Entry(path.join(
    repository,
    "vendor/test262/test/language/expressions/in/S8.12.6_A1.js",
  ));

  assert.deepEqual(program.assertions, [{
    kind: "recordMembershipProgram",
    fields: ["fooProp"],
    property: "fooProp",
    expected: true,
    span: program.assertions[0]?.span,
  }]);
});

test("lowers the complete pinned string throw/catch Test262 case", () => {
  const program = compileTest262Entry(path.join(
    repository,
    "vendor/test262/test/language/statements/throw/S12.13_A1.js",
  ));

  assert.deepEqual(program.assertions, [{
    kind: "throwCatchProgram",
    initialCaught: false,
    thrown: "expected_message",
    expected: "expected_message",
    finalExpected: true,
    span: program.assertions[0]?.span,
  }]);
});

test("lowers the complete pinned Date.now type Test262 case", () => {
  const program = compileTest262Entry(path.join(
    repository,
    "vendor/test262/test/built-ins/Date/now/15.9.4.4-0-4.js",
  ));

  assert.deepEqual(program.assertions, [{
    kind: "dateNowTypeProgram",
    expectedType: "number",
    span: program.assertions[0]?.span,
  }]);
});
