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

  assert.equal(program.version, 2);
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
