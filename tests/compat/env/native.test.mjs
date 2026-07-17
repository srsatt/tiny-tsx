import assert from "node:assert/strict";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawn, spawnSync} from "node:child_process";
import {once} from "node:events";
import {test} from "node:test";
import {fileURLToPath} from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const entry = path.join(repository, "examples/hono-env/server.ts");
const environmentNames = [
  "TINYTSX_TEST_MISSING",
  "TINYTSX_TEST_PRESENT",
  "TINYTSX_TEST_REQUIRED",
];

test("denies undeclared environment access at compile time", () => {
  const result = build(path.join(tmpdir(), "tinytsx-env-denied"), ["TINYTSX_TEST_PRESENT"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /TINY1501/);
  assert.match(result.stderr, /TINYTSX_TEST_MISSING/);
});

test("serves snapshotted environment values, fallbacks, and missing-required errors", async context => {
  const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-env-native-"));
  const binary = path.join(directory, "server");
  const port = 39_462;
  context.after(() => rmSync(directory, {recursive: true, force: true}));

  const result = build(binary, environmentNames, port);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(readFileSync(`${binary}.build.json`, "utf8"));
  assert.deepEqual(report.permissions.environment, environmentNames);

  const environment = {...process.env, TINYTSX_TEST_PRESENT: "native"};
  delete environment.TINYTSX_TEST_MISSING;
  delete environment.TINYTSX_TEST_REQUIRED;
  const server = spawn(binary, [], {env: environment, stdio: ["ignore", "pipe", "pipe"]});
  context.after(() => server.kill("SIGTERM"));
  await waitForServer(port, server);

  await assertResponse(port, "/present", 200, "native");
  await assertResponse(port, "/fallback", 200, "fallback");
  await assertResponse(port, "/required", 500, "internal server error");
  await assertResponse(port, "/required-explicit", 500, "internal server error");

  server.kill("SIGTERM");
  await once(server, "exit");
  const oversized = spawn(binary, [], {
    env: {...environment, TINYTSX_TEST_PRESENT: "x".repeat(4097)},
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(() => oversized.kill("SIGTERM"));
  await waitForServer(port, oversized);
  await assertResponse(port, "/present", 500, "internal server error");
});

test("assembles typed Hono environment bindings for Linux arm64", () => {
  const result = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "check", entry,
    "--emit-asm", "--target", "aarch64-unknown-linux-gnu",
    "--alias", "hono=vendor/hono/src/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
    ...environmentNames.flatMap(name => ["--allow-env", name]),
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /tinytsx_html_write_environment_variable/);
  const assembled = spawnSync("clang", [
    "--target=aarch64-unknown-linux-gnu", "-x", "assembler", "-c", "-o", "/dev/null", "-",
  ], {cwd: repository, input: result.stdout, encoding: "utf8"});
  assert.equal(assembled.status, 0, assembled.stderr);
});

function build(binary, allowed, port = 39_462) {
  return spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "build", entry,
    "--output", binary,
    "--port", String(port),
    "--alias", "hono=vendor/hono/src/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
    ...allowed.flatMap(name => ["--allow-env", name]),
  ], {cwd: repository, encoding: "utf8"});
}

async function assertResponse(port, pathname, status, body) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
  assert.equal(response.status, status);
  assert.equal(await response.text(), body);
}

async function waitForServer(port, server) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`native server exited with ${server.exitCode}`);
    try {
      await fetch(`http://127.0.0.1:${port}/present`);
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  throw new Error("native environment server did not start");
}
