import assert from "node:assert/strict";
import {readFileSync, statSync} from "node:fs";
import path from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const matrix = JSON.parse(readFileSync(
  path.join(repository, "tests/compat/hono/docs-matrix.json"),
  "utf8",
));

test("covers the official Hono guide, helper, middleware, and core API inventory", () => {
  assert.equal(matrix.source.documentation, "https://hono.dev/docs/");
  assert.equal(matrix.source.llmsFull, "https://hono.dev/llms-full.txt");
  assert.equal(matrix.source.honoVersion, "4.12.30");
  assert.equal(new Set(matrix.rows.map(row => row.id)).size, matrix.rows.length);

  const expectedCounts = {middleware: 24, helper: 15, guide: 7, api: 6};
  for (const [kind, count] of Object.entries(expectedCounts)) {
    assert.equal(matrix.rows.filter(row => row.kind === kind).length, count, kind);
  }
  for (const row of matrix.rows) {
    assert.ok(matrix.statusVocabulary.includes(row.status), `${row.id}: ${row.status}`);
    assert.ok(row.url.startsWith("https://hono.dev/docs/"), row.id);
    assert.ok(row.firstBoundary.length > 0, row.id);
    if (row.status === "native-pass") assert.equal(typeof row.evidence, "string", row.id);
    if (typeof row.evidence === "string") statSync(path.join(repository, row.evidence));
  }
});

test("keeps alpha priorities explicit instead of implying blanket Hono support", () => {
  assert.deepEqual(
    matrix.rows.filter(row => row.status === "planned-alpha").map(row => row.id),
    ["middleware-body-limit", "middleware-cors"],
  );
  assert.ok(matrix.rows.some(row => row.status === "partial"));
  assert.ok(matrix.rows.some(row => row.status === "out-of-scope"));
  assert.ok(matrix.rows.every(row => row.status !== "supported"));
});
