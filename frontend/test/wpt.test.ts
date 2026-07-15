import assert from "node:assert/strict";
import path from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {compileWptEntry} from "../src/wpt.js";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const urlSearchParamsGet = path.join(
  repository,
  "tests/compat/wpt/upstream/urlsearchparams-get.any.js",
);

test("lowers the complete pinned URLSearchParams get WPT", () => {
  const program = compileWptEntry(urlSearchParamsGet);

  assert.equal(program.assertions.length, 11);
  assert.deepEqual(program.assertions.map(assertion => assertion.kind), [
    "urlSearchParamsGet",
    "urlSearchParamsGet",
    "urlSearchParamsGet",
    "urlSearchParamsGet",
    "urlSearchParamsGet",
    "urlSearchParamsGet",
    "urlSearchParamsConstructed",
    "urlSearchParamsHas",
    "urlSearchParamsGet",
    "urlSearchParamsGet",
    "urlSearchParamsGet",
  ]);
  assert.deepEqual(program.assertions[3], {
    kind: "urlSearchParamsGet",
    query: "a=b&c=d&a=e",
    name: "a",
    expected: "b",
    testName: "Get basics",
    span: program.assertions[3]?.span,
  });
  assert.deepEqual(program.assertions.at(-1), {
    kind: "urlSearchParamsGet",
    query: "first=second&third&&",
    name: "fourth",
    expected: null,
    message: "Search params object has no \"fourth\" name and value.",
    testName: "More get() basics",
    span: program.assertions.at(-1)?.span,
  });
});
