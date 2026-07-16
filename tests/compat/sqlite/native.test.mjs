import assert from "node:assert/strict";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawn, spawnSync} from "node:child_process";
import {test} from "node:test";
import {fileURLToPath} from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const entry = path.join(repository, "examples/hono-sqlite/server.ts");

test("serializes an in-memory SQLite owner and recovers from SQL errors", async context => {
  const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-sqlite-native-"));
  const binary = path.join(directory, "server");
  const port = 39_465;
  context.after(() => rmSync(directory, {recursive: true, force: true}));

  const result = build(binary, port);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(readFileSync(`${binary}.build.json`, "utf8"));
  assert.equal(report.sqliteDatabases, 1);
  assert.ok(report.runtimeFeatures.includes("bounded-sqlite"));

  const server = spawn(binary, [], {stdio: ["ignore", "pipe", "pipe"]});
  context.after(() => server.kill("SIGTERM"));
  await waitForServer(port, server);

  await assertResponse(port, "/schema", 200, "ready");
  await assertGet(port, "/posts", 200, '{"posts":[]}');
  await assertGet(port, "/first", 200, '{"post":null}');
  await assertResponse(port, "/seed", 201, "created");
  await assertGet(port, "/posts", 200, '{"posts":[{"title":"Morning"}]}');
  await assertGet(port, "/first", 200, '{"post":{"title":"Morning"}}');
  await assertResponse(port, "/seed", 500, "internal server error");
  await assertResponse(port, "/schema", 200, "ready");
  await assertResponse(port, "/close", 200, "closed");
  await assertResponse(port, "/close", 200, "closed");
  await assertResponse(port, "/schema", 500, "internal server error");
});

test("assembles the SQLite owner tracer for Linux arm64", () => {
  const result = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "check", entry,
    "--emit-asm", "--target", "aarch64-unknown-linux-gnu",
    "--alias", "hono=vendor/hono/src/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /tinytsx_sqlite_execute_batch/);
  const assembled = spawnSync("clang", [
    "--target=aarch64-unknown-linux-gnu", "-x", "assembler", "-c", "-o", "/dev/null", "-",
  ], {cwd: repository, input: result.stdout, encoding: "utf8"});
  assert.equal(assembled.status, 0, assembled.stderr);
});

function build(binary, port) {
  return spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "build", entry,
    "--output", binary,
    "--port", String(port),
    "--alias", "hono=vendor/hono/src/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
  ], {cwd: repository, encoding: "utf8"});
}

async function assertResponse(port, pathname, status, body) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {method: "POST"});
  assert.equal(response.status, status);
  assert.equal(await response.text(), body);
}

async function assertGet(port, pathname, status, body) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
  assert.equal(response.status, status);
  assert.equal(await response.text(), body);
}

async function waitForServer(port, server) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (server.exitCode !== null) throw new Error(`native server exited with ${server.exitCode}`);
    try {
      await fetch(`http://127.0.0.1:${port}/schema`, {method: "POST"});
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  throw new Error("native SQLite server did not start");
}
