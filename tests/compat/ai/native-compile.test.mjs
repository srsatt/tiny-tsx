import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {CompileFailure} from "../../../frontend/dist/src/diagnostics.js";
import {compileEntry} from "../../../frontend/dist/src/program.js";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const manifest = JSON.parse(readFileSync(
  path.join(repository, "tests/compat/ai/manifest.json"),
  "utf8",
));

test("reaches the schema and bounded-loop boundaries in the AI plus Hono tracer", () => {
  assert.throws(
    () => compileEntry(path.join(repository, "tests/compat/ai/hono-generate-text-smoke.ts"), {
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
    }),
    error => error instanceof CompileFailure
      && error.diagnostics.map(diagnostic => diagnostic.message).some(message =>
        message.includes("actualSchema.validate")
      )
      && error.diagnostics.map(diagnostic => diagnostic.span?.file).some(file =>
        file?.endsWith("/generate-text/generate-text.ts")
      ),
  );
});

function absoluteAliases(aliases) {
  return Object.fromEntries(Object.entries(aliases).map(([name, target]) => [
    name,
    path.join(repository, target),
  ]));
}
