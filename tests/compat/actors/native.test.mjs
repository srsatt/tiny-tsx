import assert from "node:assert/strict";
import {once} from "node:events";
import {mkdtempSync, readFileSync, realpathSync, rmSync} from "node:fs";
import net from "node:net";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawn, spawnSync} from "node:child_process";
import {test} from "node:test";
import {fileURLToPath} from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const entry = path.join(repository, "examples/hono-actors/server.ts");
const persistentEntry = path.join(repository, "examples/hono-actors/persistent.ts");
const messagesEntry = path.join(repository, "examples/hono-actors/messages.ts");
const restartEntry = path.join(repository, "examples/hono-actors/restart.ts");
const supervisionEntry = path.join(repository, "examples/hono-actors/supervision.ts");
const multiEntry = path.join(repository, "benchmarks/tiny/hono-actor-multi.ts");

test("serves a local counter actor with ordered ask, tell, and idempotent stop", async context => {
  const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-actors-native-"));
  const binary = path.join(directory, "server");
  const port = await availablePort();
  context.after(() => rmSync(directory, {recursive: true, force: true}));

  const result = build(binary, port);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(readFileSync(`${binary}.build.json`, "utf8"));
  assert.equal(report.actors, 1);
  assert.ok(report.runtimeFeatures.includes("bounded-local-actors"));

  const server = spawn(binary, [], {stdio: ["ignore", "pipe", "pipe"]});
  context.after(() => stopProcess(server));
  await waitForServer(port, server);

  await assertResponse(port, "/", 200, "0");
  await assertResponse(port, "/increment", 200, "1");
  await assertResponse(port, "/decrement", 200, "0");
  await assertResponse(port, "/bounded", 200, "0");
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
  const port = await availablePort();
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
  context.after(() => stopProcess(second));
  await waitForServer(port, second);
  await assertResponse(port, "/", 200, "2");
  await assertResponse(port, "/increment", 200, "3");

  const locker = holdWriteLock(path.join(directory, "actors.db"));
  context.after(() => locker.kill("SIGTERM"));
  await waitForOutput(locker, "locked\n");

  const resetClient = net.createConnection({host: "127.0.0.1", port});
  await once(resetClient, "connect");
  resetClient.write(
    "GET /increment HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
  );
  await new Promise(resolve => setTimeout(resolve, 100));
  resetClient.resetAndDestroy();

  const healthStarted = performance.now();
  try {
    await assertResponseWithin(port, "/health", 200, "ok", 500);
    assert.ok(performance.now() - healthStarted < 500);
  } finally {
    locker.stdin.end();
    await once(locker, "exit");
  }
  await waitForResponse(port, "/", 200, "4");
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

test("copies bounded primitive array and record actor messages", async context => {
  const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-actor-messages-"));
  const binary = path.join(directory, "server");
  const port = await availablePort();
  context.after(() => rmSync(directory, {recursive: true, force: true}));

  const result = buildMessages(binary, port);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(readFileSync(`${binary}.build.json`, "utf8"));
  assert.equal(report.actors, 3);

  const server = spawn(binary, [], {stdio: ["ignore", "pipe", "pipe"]});
  context.after(() => stopProcess(server));
  await waitForServer(port, server, "/primitive");
  await assertResponse(port, "/primitive", 200, '"ready"');
  await assertResponse(port, "/array", 200, '["ready","warm"]');
  await assertResponse(port, "/tell", 200, "queued");
  await assertResponse(port, "/record", 200, '{"status":"ready","tags":["one","two"]}');
  await assertResponse(port, "/record", 200, '{"status":"ready","tags":["one","two"]}');
});

test("assembles bounded actor messages for Linux arm64", () => {
  const result = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "check", messagesEntry,
    "--emit-asm", "--target", "aarch64-unknown-linux-gnu",
    "--alias", "hono=vendor/hono/src/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /tinytsx_actor_ask_json/);
  const assembled = spawnSync("clang", [
    "--target=aarch64-unknown-linux-gnu", "-x", "assembler", "-c", "-o", "/dev/null", "-",
  ], {cwd: repository, input: result.stdout, encoding: "utf8"});
  assert.equal(assembled.status, 0, assembled.stderr);
});

test("restarts a fallible counter within a bounded intensity window", async context => {
  const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-actor-restart-"));
  const binary = path.join(directory, "server");
  const port = await availablePort();
  context.after(() => rmSync(directory, {recursive: true, force: true}));

  const result = buildRestart(binary, port);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(readFileSync(`${binary}.build.json`, "utf8"));
  assert.equal(report.actors, 1);

  const server = spawn(binary, [], {stdio: ["ignore", "pipe", "pipe"]});
  context.after(() => stopProcess(server));
  await waitForServer(port, server);
  await assertResponse(port, "/", 200, "0");
  await assertResponse(port, "/increment", 200, "1");
  await assertResponse(port, "/failure", 500, "internal server error");
  await assertResponse(port, "/", 200, "0");
  await assertResponse(port, "/increment", 200, "1");
  await assertResponse(port, "/failure", 500, "internal server error");
  await assertResponse(port, "/", 200, "0");
  await assertResponse(port, "/failure", 500, "internal server error");
  await assertResponse(port, "/", 500, "internal server error");
});

test("assembles the fallible actor restart policy for Linux arm64", () => {
  const result = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "check", restartEntry,
    "--emit-asm", "--target", "aarch64-unknown-linux-gnu",
    "--alias", "hono=vendor/hono/src/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /tinytsx_actor_restart_max/);
  assert.match(result.stdout, /tinytsx_actor_restart_within_ms/);
  const assembled = spawnSync("clang", [
    "--target=aarch64-unknown-linux-gnu", "-x", "assembler", "-c", "-o", "/dev/null", "-",
  ], {cwd: repository, input: result.stdout, encoding: "utf8"});
  assert.equal(assembled.status, 0, assembled.stderr);
});

test("supervises two fallible counters with one shared root intensity", async context => {
  const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-actor-supervision-"));
  const binary = path.join(directory, "server");
  const port = await availablePort();
  context.after(() => rmSync(directory, {recursive: true, force: true}));

  const result = buildSupervision(binary, port);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(readFileSync(`${binary}.build.json`, "utf8"));
  assert.equal(report.supervisors, 1);
  assert.equal(report.actors, 3);
  assert.ok(report.runtimeFeatures.includes("bounded-one-for-one-supervision"));

  const server = spawn(binary, [], {stdio: ["ignore", "pipe", "pipe"]});
  context.after(() => stopProcess(server));
  await waitForServer(port, server, "/supervision/outside/read");

  await assertResponse(port, "/supervision/left/add", 200, "15");
  await assertResponse(port, "/supervision/right/add", 200, "107");
  await assertResponse(port, "/supervision/outside/add", 200, "2");

  await assertResponse(port, "/supervision/left/fail", 500, "internal server error");
  await assertResponse(port, "/supervision/left/read", 200, "10");
  await assertResponse(port, "/supervision/right/read", 200, "107");

  await assertResponse(port, "/supervision/right/fail", 500, "internal server error");
  await assertResponse(port, "/supervision/left/read", 200, "10");
  await assertResponse(port, "/supervision/right/read", 200, "100");

  await assertResponse(port, "/supervision/left/fail", 500, "internal server error");
  await assertResponse(port, "/supervision/left/read", 500, "internal server error");
  await assertResponse(port, "/supervision/right/read", 500, "internal server error");
  await assertResponse(port, "/supervision/outside/read", 200, "2");
  await assertResponse(port, "/supervision/outside/add", 200, "3");
});

test("assembles the root supervisor ABI for Linux arm64", () => {
  const result = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "check", supervisionEntry,
    "--emit-asm", "--target", "aarch64-unknown-linux-gnu",
    "--alias", "hono=vendor/hono/src/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /tinytsx_config_supervisors/);
  assert.match(result.stdout, /tinytsx_supervisor_restart_max/);
  assert.match(result.stdout, /tinytsx_supervisor_restart_within_ms/);
  assert.match(result.stdout, /tinytsx_actor_supervisor/);
  const assembled = spawnSync("clang", [
    "--target=aarch64-unknown-linux-gnu", "-x", "assembler", "-c", "-o", "/dev/null", "-",
  ], {cwd: repository, input: result.stdout, encoding: "utf8"});
  assert.equal(assembled.status, 0, assembled.stderr);
});

test("keeps eight native counter actors isolated under concurrent mutation", async context => {
  const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-actor-multi-"));
  const binary = path.join(directory, "server");
  const port = await availablePort();
  context.after(() => rmSync(directory, {recursive: true, force: true}));

  const result = buildMulti(binary, port);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(readFileSync(`${binary}.build.json`, "utf8"));
  assert.equal(report.actors, 8);

  const server = spawn(binary, [], {stdio: ["ignore", "pipe", "pipe"]});
  context.after(() => stopProcess(server));
  await waitForServer(port, server, "/actor/0/read");
  for (let index = 0; index < 8; index++) {
    await assertResponse(port, `/actor/${index}/read`, 200, "0");
  }

  await assertResponse(port, "/actor/3/tell", 200, "queued");
  await assertResponse(port, "/actor/3/tell", 200, "queued");
  await assertResponse(port, "/actor/3/read", 200, "2");
  await assertResponse(port, "/actor/2/read", 200, "0");

  await Promise.all(Array.from({length: 8}, (_, index) =>
    assertResponse(port, `/actor/${index}/tell`, 200, "queued")
  ));
  for (let index = 0; index < 8; index++) {
    await assertResponse(port, `/actor/${index}/read`, 200, index === 3 ? "3" : "1");
  }
});

test("assembles all eight counter actor routes for Linux arm64", () => {
  const result = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "check", multiEntry,
    "--emit-asm", "--target", "aarch64-unknown-linux-gnu",
    "--alias", "hono=vendor/hono/src/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  assert.ok([...result.stdout.matchAll(/bl tinytsx_actor_tell_counter/g)].length >= 8);
  assert.ok([...result.stdout.matchAll(/bl tinytsx_actor_ask_counter/g)].length >= 8);
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
    "--workers", "1",
    "--allow-read", directory,
    "--allow-write", directory,
  ], {cwd: repository, encoding: "utf8"});
}

function buildMessages(binary, port) {
  return spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "build", messagesEntry,
    "--output", binary,
    "--port", String(port),
    "--alias", "hono=vendor/hono/src/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
  ], {cwd: repository, encoding: "utf8"});
}

function buildRestart(binary, port) {
  return spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "build", restartEntry,
    "--output", binary,
    "--port", String(port),
    "--alias", "hono=vendor/hono/src/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
  ], {cwd: repository, encoding: "utf8"});
}

function buildSupervision(binary, port) {
  return spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "build", supervisionEntry,
    "--output", binary,
    "--port", String(port),
    "--alias", "hono=vendor/hono/src/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
  ], {cwd: repository, encoding: "utf8"});
}

function buildMulti(binary, port) {
  return spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "build", multiEntry,
    "--output", binary,
    "--port", String(port),
    "--alias", "hono=vendor/hono/src/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
    "--workers", "8",
  ], {cwd: repository, encoding: "utf8"});
}

async function assertResponse(port, pathname, status, body) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
  assert.equal(response.status, status);
  assert.equal(await response.text(), body);
}

async function assertResponseWithin(port, pathname, status, body, timeoutMs) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  assert.equal(response.status, status);
  assert.equal(await response.text(), body);
}

async function waitForResponse(port, pathname, status, body) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await assertResponseWithin(port, pathname, status, body, 500);
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  throw new Error(`native actor response did not become ${status} ${body}`);
}

function holdWriteLock(database) {
  return spawn("python3", ["-c", [
    "import sqlite3, sys",
    "connection = sqlite3.connect(sys.argv[1], timeout=1)",
    "connection.execute('BEGIN EXCLUSIVE')",
    "print('locked', flush=True)",
    "sys.stdin.read()",
    "connection.rollback()",
    "connection.close()",
  ].join("\n"), database], {stdio: ["pipe", "pipe", "pipe"]});
}

async function waitForOutput(process, expected) {
  let output = "";
  process.stdout.setEncoding("utf8");
  for await (const chunk of process.stdout) {
    output += chunk;
    if (output.includes(expected)) return;
    if (process.exitCode !== null) break;
  }
  throw new Error(`process exited before output ${JSON.stringify(expected)}: ${output}`);
}

async function waitForServer(port, server, pathname = "/") {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`native server exited with ${server.exitCode}`);
    try {
      await fetch(`http://127.0.0.1:${port}${pathname}`);
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  throw new Error("native actor server did not start");
}

async function availablePort() {
  const server = net.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  const port = address.port;
  server.close();
  await once(server, "close");
  return port;
}

async function stopProcess(process) {
  if (process.exitCode !== null) return;
  process.kill("SIGTERM");
  await Promise.race([
    once(process, "exit"),
    new Promise(resolve => setTimeout(resolve, 2_000)),
  ]);
  if (process.exitCode === null) {
    process.kill("SIGKILL");
    await once(process, "exit");
  }
}
