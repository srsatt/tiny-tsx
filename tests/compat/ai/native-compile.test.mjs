import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {compileEntry} from "../../../frontend/dist/src/program.js";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const manifest = JSON.parse(readFileSync(
  path.join(repository, "tests/compat/ai/manifest.json"),
  "utf8",
));

test("compiles deterministic AI SDK text through the pinned Hono runtime", () => {
  const hir = compileAiEntry("hono-generate-text-smoke.ts");

  const route = hir.handlers.find(handler => handler.path === "/ai");
  assert.equal(route?.response.kind, "text");
  assert.equal(route?.response.kind === "text" ? route.response.value.kind : undefined, "stringLiteral");
  assert.equal(staticText(hir, route), "Hello from deterministic AI");
  assertArenaMemoryReport(hir);

  const generatedIds = hir.memory.sites.filter(site =>
    site.module.endsWith("/provider-utils/src/generate-id.ts")
  );
  assert.ok(generatedIds.length > 0, "expected allocation evidence for generated AI SDK IDs");
  assert.ok(generatedIds.every(site => site.lifetime === "compileTime"));
  assert.ok(generatedIds.every(site => site.escape === "none"));
});

test("compiles invalid AI SDK prompt handling through the pinned Hono runtime", () => {
  const hir = compileAiEntry("hono-invalid-prompt-smoke.ts");

  const route = hir.handlers.find(handler => handler.path === "/ai-invalid");
  assert.equal(route?.response.kind, "text");
  assert.equal(route?.response.kind === "text" ? route.response.status : undefined, 500);
  assert.match(staticText(hir, route), /prompt and messages cannot be defined at the same time/);
  assertArenaMemoryReport(hir);
});

test("compiles deterministic AI SDK streaming through a Web Response", () => {
  const hir = compileAiEntry("hono-stream-text-smoke.ts");

  const route = hir.handlers.find(handler => handler.path === "/ai-stream");
  assert.equal(route?.response.kind, "stream");
  assert.equal(
    route?.response.kind === "stream" ? route.response.contentType : undefined,
    "text/plain; charset=utf-8",
  );
  assert.deepEqual(
    route?.response.kind === "stream"
      ? route.response.chunks.map(chunk => staticExpressionText(hir, chunk))
      : [],
    ["Hello", " from streaming AI"],
  );
  assertArenaMemoryReport(hir);
  assert.ok(hir.memory.summary.request > 0);
});

function assertArenaMemoryReport(hir) {
  assert.equal(hir.memory.policy, "arena");
  assert.equal(hir.memory.managedHeapRequired, false);
  assert.equal(hir.memory.summary.managed, 0);
  assert.ok(hir.memory.sites.length > 0);
  assert.ok(hir.memory.summary.responseEscapes > 0);
  assert.equal(
    hir.memory.sites.length,
    ["compileTime", "static", "request", "worker", "message", "managed"]
      .reduce((total, lifetime) => total + hir.memory.summary[lifetime], 0),
  );
}

function compileAiEntry(entry) {
  return compileEntry(path.join(repository, "tests/compat/ai", entry), {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {
      ...absoluteAliases(manifest.runtimeAliases),
      "ai/test": path.join(repository, "vendor/ai/packages/ai/test/index.ts"),
      "@ai-sdk/provider-utils/test": path.join(
        repository,
        "vendor/ai/packages/provider-utils/src/test/index.ts",
      ),
      hono: path.join(repository, "vendor/hono/src/index.ts"),
    },
    apiAliases: absoluteAliases({
      ai: "tests/compat/ai/node_modules/ai/dist/index.d.ts",
      "ai/test": "tests/compat/ai/node_modules/ai/test/index.d.ts",
      hono: "tests/compat/ai/node_modules/hono/dist/types/index.d.ts",
      "@ai-sdk/gateway": "tests/compat/ai/node_modules/@ai-sdk/gateway/dist/index.d.ts",
      "@ai-sdk/provider": "tests/compat/ai/node_modules/@ai-sdk/provider/dist/index.d.ts",
      "@ai-sdk/provider-utils": "tests/compat/ai/node_modules/@ai-sdk/provider-utils/dist/index.d.ts",
    }),
  });
}

function staticText(hir, route) {
  return route?.response.kind === "text" && route.response.value.kind === "stringLiteral"
    ? hir.staticStrings[route.response.value.string]?.value ?? ""
    : "";
}

function staticExpressionText(hir, expression) {
  return expression.kind === "stringLiteral"
    ? hir.staticStrings[expression.string]?.value ?? ""
    : "";
}

function absoluteAliases(aliases) {
  return Object.fromEntries(Object.entries(aliases).map(([name, target]) => [
    name,
    path.join(repository, target),
  ]));
}
