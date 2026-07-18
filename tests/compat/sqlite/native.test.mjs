import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawn, spawnSync} from "node:child_process";
import {test} from "node:test";
import {fileURLToPath} from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const entry = path.join(repository, "examples/hono-sqlite/server.ts");
const persistentEntry = path.join(repository, "examples/hono-sqlite/persistent.ts");
const callbackTransactionEntry = path.join(repository, "examples/hono-sqlite/callback-transaction.ts");
const benchmarkTransactionEntry = path.join(
  repository,
  "benchmarks/tiny/hono-sqlite-transaction.ts",
);
const walBenchmarkEntry = path.join(repository, "benchmarks/tiny/hono-sqlite-wal.ts");

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
  assert.deepEqual(report.permissions.environment, ["TINYTSX_BLOG_NAME"]);

  const server = spawn(binary, [], {
    env: {...process.env, TINYTSX_BLOG_NAME: "Tiny Blog"},
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(() => server.kill("SIGTERM"));
  await waitForServer(port, server);

  await assertResponse(port, "/schema", 200, "ready");
  await assertGet(port, "/config", 200, "Tiny Blog");
  await assertCors(port);
  await assertResponse(
    port,
    "/run-result",
    201,
    '{"changes":1,"lastInsertRowId":"1"}',
  );
  await assertGet(port, "/posts", 200, '{"posts":[],"ok":true}');
  await assertGet(port, "/first", 200, '{"post":null}');
  await assertResponse(port, "/seed", 201, "created");
  await assertGet(port, "/posts", 200, '{"posts":[{"id":"morning","title":"Morning","body":null}],"ok":true}');
  await assertGet(port, "/first", 200, '{"post":{"id":"morning","title":"Morning","body":null}}');
  await assertGet(port, "/posts/morning", 200, '{"post":{"id":"morning","title":"Morning","body":null},"ok":true}');
  await assertResponse(port, "/seed", 500, "internal server error");
  await assertResponse(port, "/bad-sql", 500, "internal server error");
  await assertResponse(port, "/schema", 200, "ready");
  await assertMethod(port, "/posts/morning", "DELETE", 200, '{"ok":true}');
  await assertGet(port, "/posts", 200, '{"posts":[],"ok":true}');
  await assertResponse(port, "/seed", 201, "created");
  const created = await createPost(port, {title: "Night", body: "Good Night"});
  const second = await createPost(port, {title: "Dawn", body: "Good Dawn"});
  assert.notEqual(second.id, created.id);
  await assertMethod(port, `/posts/${second.id}`, "DELETE", 200, '{"ok":true}');
  await assertJson(port, "/posts", "POST", {title: "missing"}, 400, "bad request");
  await assertRawJson(port, "/posts", "POST", "{", 400, "bad request");
  await assertRawJson(
    port,
    "/posts",
    "POST",
    JSON.stringify({title: "large", body: "x".repeat(65_536)}),
    413,
    "request body too large",
  );
  await assertJson(
    port,
    `/posts/${created.id}`,
    "PUT",
    {title: "Late Night", body: "Still Night"},
    200,
    '{"ok":true}',
  );
  await assertMethod(port, `/posts/${created.id}`, "DELETE", 200, '{"ok":true}');
  await assertGet(port, `/posts/${created.id}`, 404, '{"error":"Not Found","ok":false}');
  await assertMethod(port, `/posts/${created.id}`, "DELETE", 204, "");
  await assertJson(
    port,
    `/posts/${created.id}`,
    "PUT",
    {title: "Missing", body: "Missing"},
    204,
    "",
  );
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
    "--alias", "hono/cors=vendor/hono/src/middleware/cors/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
    "--api", "hono/cors=tests/compat/hono/cors-api.d.ts",
    "--allow-env", "TINYTSX_BLOG_NAME",
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /tinytsx_sqlite_execute_batch/);
  const assembled = spawnSync("clang", [
    "--target=aarch64-unknown-linux-gnu", "-x", "assembler", "-c", "-o", "/dev/null", "-",
  ], {cwd: repository, input: result.stdout, encoding: "utf8"});
  assert.equal(assembled.status, 0, assembled.stderr);
});

test("assembles the on-disk SQLite owner for Linux arm64", () => {
  const result = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "check", persistentEntry,
    "--emit-asm", "--target", "aarch64-unknown-linux-gnu",
    "--alias", "hono=vendor/hono/src/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
    "--allow-read", repository,
    "--allow-write", repository,
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /tinytsx_config_sqlite_database_path/);
  const assembled = spawnSync("clang", [
    "--target=aarch64-unknown-linux-gnu", "-x", "assembler", "-c", "-o", "/dev/null", "-",
  ], {cwd: repository, input: result.stdout, encoding: "utf8"});
  assert.equal(assembled.status, 0, assembled.stderr);
});

test("commits or rolls back a prepared transaction callback as one owner message", async context => {
  const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-sqlite-callback-"));
  const binary = path.join(directory, "server");
  const port = 39_493;
  context.after(() => rmSync(directory, {recursive: true, force: true}));

  const result = buildCallbackTransaction(binary, port);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const server = spawn(binary, [], {stdio: ["ignore", "pipe", "pipe"]});
  context.after(() => server.kill("SIGTERM"));
  await waitForServer(port, server);

  await assertResponse(port, "/schema", 200, "ready");
  await assertJson(port, "/transaction/created", "POST", {value: "committed"}, 201, '{"ok":true}');
  await assertGet(port, "/items/created", 200, '{"item":{"id":"created","value":"committed"}}');
  await assertGet(port, "/audit/created", 200, '{"audit":{"id":"created"}}');
  await assertJson(port, "/transaction/blocked", "POST", {value: "rolled back"}, 500, "internal server error");
  await assertGet(port, "/items/blocked", 404, '{"error":"Not Found"}');
  await assertJson(port, "/transaction/reused", "POST", {value: "after failure"}, 201, '{"ok":true}');
  await assertGet(port, "/items/reused", 200, '{"item":{"id":"reused","value":"after failure"}}');
});

test("assembles the prepared transaction callback ABI for Linux arm64", () => {
  const result = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "check", callbackTransactionEntry,
    "--emit-asm", "--target", "aarch64-unknown-linux-gnu",
    "--alias", "hono=vendor/hono/src/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /tinytsx_sqlite_transaction_params/);
  const assembled = spawnSync("clang", [
    "--target=aarch64-unknown-linux-gnu", "-x", "assembler", "-c", "-o", "/dev/null", "-",
  ], {cwd: repository, input: result.stdout, encoding: "utf8"});
  assert.equal(assembled.status, 0, assembled.stderr);
});

test("repeats the idempotent transaction benchmark with a non-empty row", async context => {
  const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-sqlite-benchmark-"));
  const binary = path.join(directory, "server");
  const port = 39_494;
  context.after(() => rmSync(directory, {recursive: true, force: true}));

  const result = buildBenchmarkTransaction(binary, port);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const server = spawn(binary, [], {stdio: ["ignore", "pipe", "pipe"]});
  context.after(() => server.kill("SIGTERM"));
  await waitForServer(port, server);

  for (let request = 0; request < 16; request++) {
    await assertGet(
      port,
      "/sqlite-transaction",
      200,
      '{"value":{"id":"stable","value":"ready"}}',
    );
  }
});

test("persists WAL progress across contention, rollback, and restart", async context => {
  const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-sqlite-wal-native-"));
  const stateDirectory = path.join(directory, "state");
  const database = path.join(stateDirectory, "wal-load.db");
  const binary = path.join(directory, "server");
  const port = 39_497;
  mkdirSync(stateDirectory, {mode: 0o700});
  context.after(() => rmSync(directory, {recursive: true, force: true}));

  const result = buildWalBenchmark(binary, port, stateDirectory);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(readFileSync(`${binary}.build.json`, "utf8"));
  assert.equal(report.sqliteDatabases, 2);
  assert.deepEqual(report.permissions.read, [realpathSync(stateDirectory)]);
  assert.deepEqual(report.permissions.write, [realpathSync(stateDirectory)]);

  const first = spawn(binary, [], {stdio: ["ignore", "pipe", "pipe"]});
  await waitForServer(port, first);
  await assertGet(port, "/sqlite-wal/setup/0", 200, "ready");
  await assertGet(port, "/sqlite-wal/setup/1", 200, "ready");
  await assertGet(port, "/sqlite-wal/journal", 200, '{"journal":{"journal_mode":"wal"}}');
  await Promise.all(Array.from({length: 32}, (_, index) =>
    assertGet(port, `/sqlite-wal/${index % 2}`, 200, "committed")
  ));
  await assertGet(
    port,
    "/sqlite-wal/state",
    200,
    '{"state":{"committed":32,"rolledBack":0}}',
  );
  for (const file of [database, `${database}-wal`, `${database}-shm`]) {
    assert.equal(existsSync(file), true, `${file} must exist while both owners are live`);
    assert.ok(statSync(file).size > 0, `${file} must be non-empty`);
  }
  first.kill("SIGTERM");
  await new Promise(resolve => first.once("exit", resolve));

  const second = spawn(binary, [], {stdio: ["ignore", "pipe", "pipe"]});
  context.after(() => second.kill("SIGTERM"));
  await waitForServer(port, second);
  await assertGet(port, "/sqlite-wal/setup/0", 200, "ready");
  await assertGet(port, "/sqlite-wal/setup/1", 200, "ready");
  await assertGet(
    port,
    "/sqlite-wal/state",
    200,
    '{"state":{"committed":32,"rolledBack":0}}',
  );

  const lock = holdWriteLock(database);
  context.after(() => lock.kill("SIGTERM"));
  await waitForOutput(lock, "locked");
  await assertGet(port, "/sqlite-wal/0", 500, "internal server error");
  lock.stdin.end();
  await new Promise(resolve => lock.once("exit", resolve));
  await assertGet(port, "/sqlite-wal/1", 200, "committed");
  await assertGet(
    port,
    "/sqlite-wal/state",
    200,
    '{"state":{"committed":33,"rolledBack":0}}',
  );
});

test("assembles both WAL database owners for Linux arm64", () => {
  const result = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "check", walBenchmarkEntry,
    "--emit-asm", "--target", "aarch64-unknown-linux-gnu",
    "--alias", "hono=vendor/hono/src/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
    "--allow-read", repository,
    "--allow-write", repository,
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Ltinytsx_sqlite_database_path_data_0/);
  assert.match(result.stdout, /Ltinytsx_sqlite_database_path_data_1/);
  assert.equal(result.stdout.match(/bl tinytsx_sqlite_transaction/g)?.length, 2);
  const assembled = spawnSync("clang", [
    "--target=aarch64-unknown-linux-gnu", "-x", "assembler", "-c", "-o", "/dev/null", "-",
  ], {cwd: repository, input: result.stdout, encoding: "utf8"});
  assert.equal(assembled.status, 0, assembled.stderr);
});

test("assembles the transaction benchmark ABI for Linux arm64", () => {
  const result = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "check", benchmarkTransactionEntry,
    "--emit-asm", "--target", "aarch64-unknown-linux-gnu",
    "--alias", "hono=vendor/hono/src/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /tinytsx_sqlite_transaction_params/);
  const assembled = spawnSync("clang", [
    "--target=aarch64-unknown-linux-gnu", "-x", "assembler", "-c", "-o", "/dev/null", "-",
  ], {cwd: repository, input: result.stdout, encoding: "utf8"});
  assert.equal(assembled.status, 0, assembled.stderr);
});

test("retains an on-disk SQLite row across process restart", async context => {
  const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-sqlite-persistent-"));
  const binary = path.join(directory, "server");
  const port = 39_466;
  context.after(() => rmSync(directory, {recursive: true, force: true}));

  const result = buildPersistent(binary, port, directory);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(readFileSync(`${binary}.build.json`, "utf8"));
  assert.deepEqual(report.permissions.read, [realpathSync(directory)]);
  assert.deepEqual(report.permissions.write, [realpathSync(directory)]);

  const first = spawn(binary, [], {stdio: ["ignore", "pipe", "pipe"]});
  await waitForServer(port, first);
  await assertResponse(port, "/transaction-failure", 500, "internal server error");
  await assertGet(port, "/values", 200, '{"values":[]}');
  await assertJson(port, "/values", "POST", {value: "retained"}, 201, '{"ok":true}');
  await assertGet(port, "/values", 200, '{"values":[{"value":"retained"}]}');
  first.kill("SIGTERM");
  await new Promise(resolve => first.once("exit", resolve));

  const second = spawn(binary, [], {stdio: ["ignore", "pipe", "pipe"]});
  context.after(() => second.kill("SIGTERM"));
  await waitForServer(port, second);
  await assertGet(port, "/values", 200, '{"values":[{"value":"retained"}]}');
  await assertResponse(port, "/transaction-success", 200, '{"ok":true}');
  await assertGet(
    port,
    "/values",
    200,
    '{"values":[{"value":"retained"},{"value":"first"},{"value":"second"}]}',
  );
});

test("rejects an unsafe on-disk database directory at native startup", async context => {
  const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-sqlite-unsafe-"));
  const binary = path.join(directory, "server");
  const port = 39_492;
  context.after(() => {
    chmodSync(directory, 0o700);
    rmSync(directory, {recursive: true, force: true});
  });

  const result = buildPersistent(binary, port, directory);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  chmodSync(directory, 0o777);

  const server = spawn(binary, [], {stdio: ["ignore", "pipe", "pipe"]});
  context.after(() => server.kill("SIGTERM"));
  await waitForServer(port, server);
  await assertResponse(port, "/schema", 500, "internal server error");
});

function build(binary, port) {
  return spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "build", entry,
    "--output", binary,
    "--port", String(port),
    "--alias", "hono=vendor/hono/src/index.ts",
    "--alias", "hono/cors=vendor/hono/src/middleware/cors/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
    "--api", "hono/cors=tests/compat/hono/cors-api.d.ts",
    "--allow-env", "TINYTSX_BLOG_NAME",
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

function buildCallbackTransaction(binary, port) {
  return spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "build", callbackTransactionEntry,
    "--output", binary,
    "--port", String(port),
    "--alias", "hono=vendor/hono/src/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
  ], {cwd: repository, encoding: "utf8"});
}

function buildBenchmarkTransaction(binary, port) {
  return spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "build", benchmarkTransactionEntry,
    "--output", binary,
    "--port", String(port),
    "--alias", "hono=vendor/hono/src/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
  ], {cwd: repository, encoding: "utf8"});
}

function buildWalBenchmark(binary, port, directory) {
  return spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "build", walBenchmarkEntry,
    "--output", binary,
    "--port", String(port),
    "--workers", "8",
    "--alias", "hono=vendor/hono/src/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
    "--allow-read", directory,
    "--allow-write", directory,
  ], {cwd: repository, encoding: "utf8"});
}

function holdWriteLock(database) {
  return spawn("python3", ["-c", [
    "import sqlite3, sys",
    "connection = sqlite3.connect(sys.argv[1], timeout=1)",
    "connection.execute('BEGIN IMMEDIATE')",
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

async function assertResponse(port, pathname, status, body) {
  return assertMethod(port, pathname, "POST", status, body);
}

async function assertMethod(port, pathname, method, status, body) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {method});
  assert.equal(response.status, status);
  assert.equal(await response.text(), body);
}

async function assertGet(port, pathname, status, body) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
  assert.equal(response.status, status);
  assert.equal(await response.text(), body);
}

async function assertJson(port, pathname, method, value, status, body) {
  return assertRawJson(port, pathname, method, JSON.stringify(value), status, body);
}

async function createPost(port, value) {
  const response = await fetch(`http://127.0.0.1:${port}/posts`, {
    method: "POST",
    headers: {"content-type": "application/json"},
    body: JSON.stringify(value),
  });
  assert.equal(response.status, 201);
  const result = await response.json();
  assert.match(
    result.post.id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  assert.deepEqual(result.post, {id: result.post.id, ...value});
  return result.post;
}

async function assertRawJson(port, pathname, method, value, status, body) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers: {"content-type": "application/json"},
    body: value,
  });
  assert.equal(response.status, status);
  assert.equal(await response.text(), body);
}

async function assertCors(port) {
  const response = await fetch(`http://127.0.0.1:${port}/posts`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.deepEqual(await response.json(), {posts: [], ok: true});

  const preflight = await fetch(`http://127.0.0.1:${port}/posts`, {
    method: "OPTIONS",
    headers: {
      origin: "https://example.com",
      "access-control-request-headers": "Content-Type",
      "access-control-request-method": "POST",
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
  assert.equal(
    preflight.headers.get("access-control-allow-methods"),
    "GET,HEAD,PUT,POST,DELETE,PATCH",
  );
  assert.equal(preflight.headers.get("access-control-allow-headers"), "Content-Type");
  assert.equal(preflight.headers.get("vary"), "Access-Control-Request-Headers");
  assert.equal(await preflight.text(), "");
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
