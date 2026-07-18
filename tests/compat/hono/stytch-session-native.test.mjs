import assert from "node:assert/strict";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawn, spawnSync} from "node:child_process";
import {test} from "node:test";
import {fileURLToPath} from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const entry = path.join(repository, "tests/compat/hono/stytch-session-smoke.ts");

test("executes the credential-free Stytch session adapter natively", async context => {
  const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-stytch-session-"));
  const binary = path.join(directory, "server");
  const port = 39_491;
  context.after(() => rmSync(directory, {recursive: true, force: true}));

  const built = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "build", entry,
    "--output", binary, "--port", String(port),
    ...compilerOptions(),
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(built.status, 0, built.stderr || built.stdout);

  const server = spawn(binary, [], {cwd: directory, stdio: "ignore"});
  context.after(() => server.kill("SIGTERM"));
  await waitForServer(port, server);

  await assertResponse(port, "/session/local", 401, "Unauthenticated");
  await assertResponse(port, "/session/local", 401, "Unauthenticated", {
    headers: {cookie: "stytch_session_jwt="},
  });
  await assertResponse(port, "/session/local", 200, "local:user-1", {
    headers: {cookie: "theme=dark; stytch_session_jwt=user%2D1"},
  });
  await assertResponse(port, "/session/remote", 200, "remote:writer-1", {
    method: "POST",
    headers: {cookie: "stytch_session_jwt=writer%2D1"},
  });
});

test("assembles the credential-free Stytch session adapter for Linux arm64", () => {
  const checked = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "check", entry,
    "--emit-asm", "--target", "aarch64-unknown-linux-gnu",
    ...compilerOptions(),
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  assert.match(checked.stdout, /tinytsx_request_cookie_present/);
  assert.match(checked.stdout, /tinytsx_html_write_request_cookie/);

  const assembled = spawnSync("clang", [
    "--target=aarch64-unknown-linux-gnu", "-x", "assembler", "-c", "-o", "/dev/null", "-",
  ], {cwd: repository, input: checked.stdout, encoding: "utf8"});
  assert.equal(assembled.status, 0, assembled.stderr);
});

function compilerOptions() {
  return [
    "--alias", "hono=vendor/hono/src/index.ts",
    "--alias", "@hono/stytch-auth=tests/compat/stytch-auth/node_modules/@hono/stytch-auth/dist/index.js",
    "--api", "hono=tests/compat/hono/api.d.ts",
    "--api", "@hono/stytch-auth=tests/compat/stytch-auth/api.d.ts",
  ];
}

async function assertResponse(port, pathname, status, body, init) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, init);
  assert.equal(response.status, status);
  assert.equal(await response.text(), body);
}

async function waitForServer(port, server) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (server.exitCode !== null) throw new Error(`native server exited with ${server.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/session/local`);
      await response.body?.cancel();
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  throw new Error("native Stytch session server did not start");
}
