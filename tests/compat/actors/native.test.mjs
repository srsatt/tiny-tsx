import assert from "node:assert/strict";
import {mkdtempSync, readFileSync, realpathSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawn, spawnSync} from "node:child_process";
import {test} from "node:test";
import {fileURLToPath} from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const entry = path.join(repository, "examples/hono-actors/server.ts");
const persistentEntry = path.join(repository, "examples/hono-actors/persistent.ts");

test("serves a local counter actor with ordered ask, tell, and idempotent stop", async context => {
  const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-actors-native-"));
  const binary = path.join(directory, "server");
  const port = 39_464;
  context.after(() => rmSync(directory, {recursive: true, force: true}));

  const result = build(binary, port);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(readFileSync(`${binary}.build.json`, "utf8"));
  assert.equal(report.actors, 1);
  assert.ok(report.runtimeFeatures.includes("bounded-local-actors"));

  const server = spawn(binary, [], {stdio: ["ignore", "pipe", "pipe"]});
  context.after(() => server.kill("SIGTERM"));
  await waitForServer(port, server);

  await assertResponse(port, "/", 200, "0");
  await assertResponse(port, "/increment", 200, "1");
  await assertResponse(port, "/decrement", 200, "0");
  await assertResponse(port, "/tell", 200, "queued");
  await assertResponse(port, "/", 200, "2");
  await assertResponse(port, "/stop", 200, "stopped");
  await assertResponse(port, "/stop", 200, "stopped");
  await assertResponse(port, "/", 500, "internal server error");
});

test("assembles the actor tracer for Linux arm64", () => {
  const result = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "check", entry,
    "--emit-asm", "--target", "aarch64-unknown-linux-gnu",
    "--alias", "hono=vendor/hono/src/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /tinytsx_actor_ask_counter/);
  const assembled = spawnSync("clang", [
    "--target=aarch64-unknown-linux-gnu", "-x", "assembler", "-c", "-o", "/dev/null", "-",
  ], {cwd: repository, input: result.stdout, encoding: "utf8"});
  assert.equal(assembled.status, 0, assembled.stderr);
});

test("retains a SQLite-backed counter across process restart", async context => {
  const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-actors-persistent-"));
  const binary = path.join(directory, "server");
  const port = 39_467;
  context.after(() => rmSync(directory, {recursive: true, force: true}));

  const result = buildPersistent(binary, port, directory);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(readFileSync(`${binary}.build.json`, "utf8"));
  assert.equal(report.actors, 1);
  assert.equal(report.sqliteDatabases, 1);
  assert.deepEqual(report.permissions.write, [realpathSync(directory)]);

  const first = spawn(binary, [], {stdio: ["ignore", "pipe", "pipe"]});
  await waitForServer(port, first);
  await assertResponse(port, "/increment", 200, "1");
  await assertResponse(port, "/increment", 200, "2");
  first.kill("SIGTERM");
  await new Promise(resolve => first.once("exit", resolve));

  const second = spawn(binary, [], {stdio: ["ignore", "pipe", "pipe"]});
  context.after(() => second.kill("SIGTERM"));
  await waitForServer(port, second);
  await assertResponse(port, "/", 200, "2");
  await assertResponse(port, "/increment", 200, "3");
});

test("assembles the persistent actor tracer for Linux arm64", () => {
  const result = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "check", persistentEntry,
    "--emit-asm", "--target", "aarch64-unknown-linux-gnu",
    "--alias", "hono=vendor/hono/src/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
    "--allow-read", repository,
    "--allow-write", repository,
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /tinytsx_actor_persistence_database/);
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

function buildPersistent(binary, port, directory) {
  return spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "build", persistentEntry,
    "--output", binary,
    "--port", String(port),
    "--alias", "hono=vendor/hono/src/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
    "--allow-read", directory,
    "--allow-write", directory,
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
      await fetch(`http://127.0.0.1:${port}/`);
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  throw new Error("native actor server did not start");
}
