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
  const hir = compileEntry(path.join(repository, "tests/compat/ai/hono-generate-text-smoke.ts"), {
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

  const route = hir.handlers.find(handler => handler.path === "/ai");
  assert.equal(route?.response.kind, "text");
  assert.equal(route?.response.kind === "text" ? route.response.value.kind : undefined, "stringLiteral");
  const string = route?.response.kind === "text" && route.response.value.kind === "stringLiteral"
    ? hir.staticStrings[route.response.value.string]?.value
    : undefined;
  assert.equal(string, "Hello from deterministic AI");
});

function absoluteAliases(aliases) {
  return Object.fromEntries(Object.entries(aliases).map(([name, target]) => [
    name,
    path.join(repository, target),
  ]));
}
