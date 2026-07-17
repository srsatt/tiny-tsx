import assert from "node:assert/strict";
import {mkdtempSync, readFileSync, realpathSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawn, spawnSync} from "node:child_process";
import {test} from "node:test";
import {fileURLToPath} from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const entry = path.join(repository, "examples/hono-user-auth/server.ts");
const authorization = `Basic ${Buffer.from("admin:tinytsx").toString("base64")}`;

test("serves the multi-module auth/config/persistence tracer", async context => {
  const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-user-auth-"));
  const binary = path.join(directory, "server");
  const port = 39_487;
  context.after(() => rmSync(directory, {recursive: true, force: true}));

  const built = build(binary, port, directory);
  assert.equal(built.status, 0, built.stderr || built.stdout);
  const report = JSON.parse(readFileSync(`${binary}.build.json`, "utf8"));
  assert.deepEqual(report.permissions.environment, ["TINYTSX_AUTH_APP_NAME"]);
  assert.deepEqual(report.permissions.read, [realpathSync(directory)]);
  assert.deepEqual(report.permissions.write, [realpathSync(directory)]);
  assert.equal(report.sqliteDatabases, 1);

  const first = start(binary, port, directory);
  await waitForServer(port, first);
  await assertText(port, "/config", 200, "TinyTSX Auth");
  await assertText(port, "/account/events", 500, "handled error");
  await assertText(port, "/schema", 200, "ready", {method: "POST"});
  await assertText(port, "/account/events", 201, '{"ok":true}', {
    method: "POST",
    headers: {authorization},
  });
  await assertText(port, "/account/events", 200, '{"events":[{"username":"admin"}]}', {
    headers: {authorization},
  });
  await assertText(port, "/failure", 500, "handled error");
  first.kill("SIGTERM");
  await new Promise(resolve => first.once("exit", resolve));

  const second = start(binary, port, directory);
  context.after(() => second.kill("SIGTERM"));
  await waitForServer(port, second);
  await assertText(port, "/account/events", 200, '{"events":[{"username":"admin"}]}', {
    headers: {authorization},
  });
});

test("assembles the auth/config/persistence tracer for Linux arm64", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-user-auth-asm-"));
  try {
    const checked = spawnSync("cargo", [
      "run", "-q", "-p", "tinytsx", "--", "check", entry,
      "--emit-asm", "--target", "aarch64-unknown-linux-gnu",
      ...compilerOptions(directory),
    ], {cwd: repository, encoding: "utf8"});
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);
    assert.match(checked.stdout, /tinytsx_sqlite_execute_batch/);
    assert.match(checked.stdout, /tinytsx_html_write_environment_variable/);
    const assembled = spawnSync("clang", [
      "--target=aarch64-unknown-linux-gnu", "-x", "assembler", "-c", "-o", "/dev/null", "-",
    ], {cwd: repository, input: checked.stdout, encoding: "utf8"});
    assert.equal(assembled.status, 0, assembled.stderr);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});

function build(binary, port, directory) {
  return spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "build", entry,
    "--output", binary, "--port", String(port),
    ...compilerOptions(directory),
  ], {cwd: repository, encoding: "utf8"});
}

function compilerOptions(directory) {
  return [
    "--alias", "hono=vendor/hono/src/index.ts",
    "--alias", "hono/basic-auth=vendor/hono/src/middleware/basic-auth/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
    "--api", "hono/basic-auth=tests/compat/hono/basic-auth-api.d.ts",
    "--allow-env", "TINYTSX_AUTH_APP_NAME",
    "--allow-read", directory,
    "--allow-write", directory,
  ];
}

function start(binary, port, directory) {
  return spawn(binary, [], {
    cwd: directory,
    env: {...process.env, TINYTSX_AUTH_APP_NAME: "TinyTSX Auth"},
    stdio: "ignore",
  });
}

async function assertText(port, pathname, status, body, init) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, init);
  assert.equal(response.status, status);
  assert.equal(await response.text(), body);
}

async function waitForServer(port, server) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (server.exitCode !== null) throw new Error(`native server exited with ${server.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/config`);
      await response.body?.cancel();
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  throw new Error("native user-auth server did not start");
}
