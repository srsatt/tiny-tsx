import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const manifest = JSON.parse(readFileSync(
  path.join(repository, "tests/compat/ai/manifest.json"),
  "utf8",
));
const runtimeAliases = {
  ...manifest.runtimeAliases,
  "ai/test": "vendor/ai/packages/ai/test/index.ts",
  "@ai-sdk/provider-utils/test": "vendor/ai/packages/provider-utils/src/test/index.ts",
  hono: "vendor/hono/src/index.ts",
};
const apiAliases = {
  ai: "tests/compat/ai/node_modules/ai/dist/index.d.ts",
  "ai/test": "tests/compat/ai/node_modules/ai/test/index.d.ts",
  hono: "tests/compat/ai/node_modules/hono/dist/types/index.d.ts",
  "@ai-sdk/gateway": "tests/compat/ai/node_modules/@ai-sdk/gateway/dist/index.d.ts",
  "@ai-sdk/provider": "tests/compat/ai/node_modules/@ai-sdk/provider/dist/index.d.ts",
  "@ai-sdk/provider-utils": "tests/compat/ai/node_modules/@ai-sdk/provider-utils/dist/index.d.ts",
  "@ai-sdk/openai-compatible": "tests/compat/ai/node_modules/@ai-sdk/openai-compatible/dist/index.d.ts",
};
const args = [
  "run", "-q", "-p", "tinytsx", "--", "build",
  process.env.TINYTSX_AI_ENTRY ?? "tests/compat/ai/hono-generate-text-smoke.ts",
  "--port", process.env.TINYTSX_AI_PORT ?? "39451",
  ...aliases("--alias", runtimeAliases),
  ...aliases("--api", apiAliases),
  "--output", process.env.TINYTSX_AI_OUTPUT ?? "dist/ai-hono",
];

execFileSync("cargo", args, {cwd: repository, stdio: "inherit"});

function aliases(flag, values) {
  return Object.entries(values).flatMap(([specifier, target]) => [flag, `${specifier}=${target}`]);
}
