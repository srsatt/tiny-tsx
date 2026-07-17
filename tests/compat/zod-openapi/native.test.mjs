import assert from "node:assert/strict";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawn, spawnSync} from "node:child_process";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {compileEntry} from "../../../frontend/dist/src/program.js";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const entry = path.join(repository, "tests/compat/zod-openapi/server.ts");
const expectedUser = '{"id":"1212121","age":20,"name":"Ultra-man"}';
const expectedFailure = '{"success":false,"error":{"name":"ZodError","message":"[\\n  {\\n    \\"origin\\": \\"string\\",\\n    \\"code\\": \\"too_small\\",\\n    \\"minimum\\": 3,\\n    \\"inclusive\\": true,\\n    \\"path\\": [\\n      \\"id\\"\\n    ],\\n    \\"message\\": \\"Too small: expected string to have >=3 characters\\"\\n  }\\n]"}}';
const expectedDocument = '{"openapi":"3.0.0","info":{"version":"1.0.0","title":"TinyTSX Zod OpenAPI example"},"components":{"schemas":{"User":{"type":"object","properties":{"id":{"type":"string","example":"123"},"name":{"type":"string","example":"John Doe"},"age":{"type":"number","example":42}},"required":["id","name","age"]}},"parameters":{}},"paths":{"/users/{id}":{"get":{"parameters":[{"schema":{"type":"string","minLength":3,"example":"1212121"},"required":true,"name":"id","in":"path"}],"responses":{"200":{"description":"Retrieve the user","content":{"application/json":{"schema":{"$ref":"#/components/schemas/User"}}}}}}}}}';

test("compiles the pinned upstream Zod OpenAPI graph into native routes", () => {
  const hir = compileEntry(entry, {sdkPath: path.join(repository, "sdk/index.d.ts")});
  assert.equal(hir.modules.length, 113);

  const user = hir.handlers.find(handler => handler.path === "/users/:id");
  assert.equal(user?.response.kind, "text");
  assert.equal(user?.parameterValidations?.[0]?.name, "id");
  assert.equal(user?.parameterValidations?.[0]?.minLength, 3);
  assert.equal(staticGuardBody(hir, user?.parameterValidations?.[0]?.rejected), expectedFailure);

  const document = hir.handlers.find(handler => handler.path === "/doc");
  assert.equal(staticBody(hir, document?.response), expectedDocument);
});

test("assembles the pinned Zod OpenAPI graph for Linux arm64", () => {
  const checked = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "check", entry,
    "--emit-asm",
    "--target", "aarch64-unknown-linux-gnu",
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);

  const assembled = spawnSync("clang", [
    "--target=aarch64-unknown-linux-gnu", "-x", "assembler", "-c", "-o", "/dev/null", "-",
  ], {cwd: repository, input: checked.stdout, encoding: "utf8"});
  assert.equal(assembled.status, 0, assembled.stderr);
});

test("serves the same pinned success, rejection, and OpenAPI document natively", async (context) => {
  const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-zod-openapi-"));
  const binary = path.join(directory, "server");
  const port = 39_461;
  context.after(() => rmSync(directory, {recursive: true, force: true}));

  const built = spawnSync(
    "cargo",
    ["run", "-q", "-p", "tinytsx", "--", "build", entry, "--output", binary, "--port", String(port)],
    {cwd: repository, encoding: "utf8"},
  );
  assert.equal(built.status, 0, built.stderr || built.stdout);

  const server = spawn(binary, [], {stdio: ["ignore", "pipe", "pipe"]});
  context.after(() => server.kill("SIGTERM"));
  await waitForServer(port, server);

  await assertResponse(port, "/users/1212121", 200, expectedUser);
  await assertResponse(port, "/users/x", 400, expectedFailure);
  await assertResponse(port, "/doc", 200, expectedDocument);
});

async function assertResponse(port, pathname, status, body) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
  assert.equal(response.status, status);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.equal(await response.text(), body);
}

async function waitForServer(port, server) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`native server exited with ${server.exitCode}`);
    try {
      await fetch(`http://127.0.0.1:${port}/doc`);
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  throw new Error("native server did not start");
}

function staticBody(hir, response) {
  return response?.kind === "text" && response.value.kind === "stringLiteral"
    ? hir.staticStrings[response.value.string]?.value
    : undefined;
}

function staticGuardBody(hir, guarded) {
  return guarded === undefined ? undefined : staticBody(hir, guarded.response);
}
