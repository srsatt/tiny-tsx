import assert from "node:assert/strict";
import {mkdirSync, mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawn, spawnSync} from "node:child_process";
import {test} from "node:test";
import {fileURLToPath} from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const entry = path.join(repository, "vendor/hono-examples/stytch-auth/api/index.ts");

test("executes the unchanged authenticated Stytch TODO backend natively", async context => {
  const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-stytch-todo-"));
  const binary = path.join(directory, "server");
  const port = 39_492;
  context.after(() => rmSync(directory, {recursive: true, force: true}));

  const built = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "build", entry,
    "--output", binary, "--port", String(port),
    "--binding", "TODOS=sqlite-kv::memory:",
    ...compilerOptions(),
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(built.status, 0, built.stderr || built.stdout);

  const server = spawn(binary, [], {cwd: directory, stdio: "ignore"});
  context.after(() => server.kill("SIGTERM"));
  await waitForServer(port, server);

  const denied = await request(port, "/api/todos");
  assert.equal(denied.status, 401);
  assert.equal(await denied.text(), "Unauthenticated");
  assert.equal(denied.headers.get("access-control-allow-origin"), "*");

  assert.deepEqual(await json(port, "/api/todos", "reader"), {todos: []});
  const created = await json(port, "/api/todos", "reader", {
    method: "POST",
    body: JSON.stringify({todoText: "first"}),
  });
  assert.equal(created.todos.length, 1);
  assert.match(created.todos[0].id, /^\d+$/);
  assert.deepEqual(
    {text: created.todos[0].text, completed: created.todos[0].completed},
    {text: "first", completed: false},
  );
  assert.deepEqual(await json(port, "/api/todos", "other"), {todos: []});
  assert.deepEqual(
    await json(port, `/api/todos/${created.todos[0].id}/complete`, "reader", {method: "POST"}),
    {todos: [{...created.todos[0], completed: true}]},
  );
  assert.deepEqual(
    await json(port, `/api/todos/${created.todos[0].id}`, "reader", {method: "DELETE"}),
    {todos: []},
  );

  const options = await request(port, "/api/todos", {method: "OPTIONS"});
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("access-control-allow-origin"), "*");
});

test("assembles the unchanged Stytch TODO backend for Linux arm64", () => {
  const checked = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "check", entry,
    "--emit-asm", "--target", "aarch64-unknown-linux-gnu",
    "--binding", "TODOS=sqlite-kv::memory:",
    ...compilerOptions(),
  ], {cwd: repository, encoding: "utf8", maxBuffer: 4 * 1024 * 1024});
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  assert.match(checked.stdout, /tinytsx_todo_store_list_json/);
  assert.match(checked.stdout, /tinytsx_todo_store_add_json/);
  assert.match(checked.stdout, /tinytsx_todo_store_mutation_json/);

  const assembled = spawnSync("clang", [
    "--target=aarch64-unknown-linux-gnu", "-x", "assembler", "-c", "-o", "/dev/null", "-",
  ], {cwd: repository, input: checked.stdout, encoding: "utf8"});
  assert.equal(assembled.status, 0, assembled.stderr);
});

test("persists, rolls back saturation, and recovers through the SQLite owner", async context => {
  const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-stytch-todo-disk-"));
  const state = path.join(directory, "state");
  const binary = path.join(directory, "server");
  const port = 39_493;
  mkdirSync(state, {mode: 0o700});
  context.after(() => rmSync(directory, {recursive: true, force: true}));

  const built = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "build", entry,
    "--output", binary, "--port", String(port),
    "--binding", "TODOS=sqlite-kv:state/todos.db",
    "--allow-read", directory,
    "--allow-write", directory,
    ...compilerOptions(),
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(built.status, 0, built.stderr || built.stdout);

  let server = spawn(binary, [], {cwd: directory, stdio: "ignore"});
  context.after(() => server.kill("SIGTERM"));
  await waitForServer(port, server);
  const first = await json(port, "/api/todos", "persistent", {
    method: "POST",
    body: JSON.stringify({todoText: "before restart"}),
  });
  server.kill("SIGTERM");
  await waitForExit(server);

  server = spawn(binary, [], {cwd: directory, stdio: "ignore"});
  await waitForServer(port, server);
  assert.deepEqual(await json(port, "/api/todos", "persistent"), first);

  for (let index = 1; index < 16; index++) {
    await new Promise(resolve => setTimeout(resolve, 2));
    const created = await request(port, "/api/todos", "persistent", {
      method: "POST",
      body: JSON.stringify({todoText: `todo-${index}`}),
    });
    assert.equal(created.status, 200, `create ${index}`);
    await created.body?.cancel();
  }
  const beforeFailure = await json(port, "/api/todos", "persistent");
  assert.equal(beforeFailure.todos.length, 16);

  const saturated = await request(port, "/api/todos", "persistent", {
    method: "POST",
    body: JSON.stringify({todoText: "must roll back"}),
  });
  assert.equal(saturated.status, 500);
  await saturated.body?.cancel();
  assert.deepEqual(await json(port, "/api/todos", "persistent"), beforeFailure);

  const malformed = await request(port, "/api/todos", "persistent", {
    method: "POST",
    body: JSON.stringify({wrong: "shape"}),
  });
  assert.equal(malformed.status, 400);
  await malformed.body?.cancel();
  assert.deepEqual(await json(port, "/api/todos", "persistent"), beforeFailure);

  const removed = beforeFailure.todos[0];
  const afterDelete = await json(port, `/api/todos/${removed.id}`, "persistent", {
    method: "DELETE",
  });
  assert.ok(afterDelete.todos.length < 16);
  await new Promise(resolve => setTimeout(resolve, 2));
  const recovered = await json(port, "/api/todos", "persistent", {
    method: "POST",
    body: JSON.stringify({todoText: "after recovery"}),
  });
  assert.ok(recovered.todos.length <= 16);
  assert.ok(recovered.todos.some(todo => todo.text === "after recovery"));
});

test("denies an on-disk TODO binding without matching capabilities", () => {
  const checked = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "check", entry,
    "--binding", "TODOS=sqlite-kv:state/todos.db",
    ...compilerOptions(),
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(checked.status, 1, checked.stdout);
  assert.match(checked.stderr, /TINY1511/);
});

function compilerOptions() {
  return [
    "--alias", "hono=vendor/hono/src/index.ts",
    "--alias", "hono/cors=vendor/hono/src/middleware/cors/index.ts",
    "--alias", "@hono/stytch-auth=tests/compat/stytch-auth/node_modules/@hono/stytch-auth/dist/index.js",
    "--api", "hono=tests/compat/hono/api.d.ts",
    "--api", "hono/cors=tests/compat/hono/cors-api.d.ts",
    "--api", "@hono/stytch-auth=tests/compat/stytch-auth/api.d.ts",
  ];
}

async function json(port, pathname, user, init = {}) {
  const response = await request(port, pathname, user, init);
  if (response.status !== 200) {
    assert.fail(`expected 200, received ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

function request(port, pathname, user, init = {}) {
  if (typeof user === "object") {
    init = user;
    user = undefined;
  }
  return fetch(`http://127.0.0.1:${port}${pathname}`, {
    ...init,
    headers: {
      ...(init.body === undefined ? {} : {"content-type": "application/json"}),
      ...(user === undefined ? {} : {cookie: `stytch_session_jwt=${encodeURIComponent(user)}`}),
      ...init.headers,
    },
  });
}

async function waitForServer(port, server) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (server.exitCode !== null) throw new Error(`native server exited with ${server.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/todos`);
      await response.body?.cancel();
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  throw new Error("native Stytch TODO server did not start");
}

async function waitForExit(server) {
  if (server.exitCode !== null) return;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("native server did not exit")), 2000);
    server.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
}
