import assert from "node:assert/strict";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawn, spawnSync} from "node:child_process";
import {test} from "node:test";
import {fileURLToPath} from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const hono = [
  "--alias", "hono=vendor/hono/src/index.ts",
  "--api", "hono=tests/compat/hono/api.d.ts",
];
const basic = [
  ...hono,
  "--alias", "hono/basic-auth=vendor/hono/src/middleware/basic-auth/index.ts",
  "--alias", "hono/etag=vendor/hono/src/middleware/etag/index.ts",
  "--alias", "hono/powered-by=vendor/hono/src/middleware/powered-by/index.ts",
  "--alias", "hono/pretty-json=vendor/hono/src/middleware/pretty-json/index.ts",
  "--api", "hono/basic-auth=tests/compat/hono/basic-auth-api.d.ts",
  "--api", "hono/etag=tests/compat/hono/etag-api.d.ts",
  "--api", "hono/powered-by=tests/compat/hono/powered-by-api.d.ts",
  "--api", "hono/pretty-json=tests/compat/hono/pretty-json-api.d.ts",
];
const jsx = [
  ...hono,
  "--alias", "hono/html=vendor/hono/src/helper/html/index.ts",
  "--api", "hono/html=tests/compat/hono/html-api.d.ts",
];

test("assembles both supported serve entry contracts for Linux arm64", () => {
  for (const entry of [
    "examples/hono-node-server/server.ts",
    "examples/tiny-serve/server.ts",
  ]) {
    const checked = spawnSync("cargo", [
      "run", "-q", "-p", "tinytsx", "--", "check", entry,
      "--emit-asm",
      "--target", "aarch64-unknown-linux-gnu",
      ...hono,
    ], {cwd: repository, encoding: "utf8"});
    assert.equal(checked.status, 0, `${entry}: ${checked.stderr || checked.stdout}`);

    const assembled = spawnSync("clang", [
      "--target=aarch64-unknown-linux-gnu", "-x", "assembler", "-c", "-o", "/dev/null", "-",
    ], {cwd: repository, input: checked.stdout, encoding: "utf8"});
    assert.equal(assembled.status, 0, `${entry}: ${assembled.stderr}`);
  }
});

test("executes the complete pinned Hono basic application natively", async context => {
  await withServer(
    context,
    "vendor/hono-examples/basic/src/index.ts",
    39_481,
    basic,
    async port => {
      const root = await request(port, "/");
      assert.equal(root.status, 200);
      assert.equal(root.headers.get("content-type"), "text/plain;charset=UTF-8");
      assert.equal(root.headers.get("x-powered-by"), "Hono");
      assert.match(root.headers.get("x-response-time") ?? "", /^\d+ms$/);
      assert.equal(await root.text(), "Hono!!");

      await assertText(port, "/missing", 404, "Custom 404 Not Found");
      await assertText(port, "/auth/test", 500, "Custom Error Message");
    },
  );
});

test("executes the complete pinned Hono JSX SSR application natively", async context => {
  const rootFixture = fixture("jsx-ssr-root.html");
  const postFixture = fixture("jsx-ssr-post-1.html");
  await withServer(
    context,
    "vendor/hono-examples/jsx-ssr/src/index.tsx",
    39_482,
    jsx,
    async port => {
      const root = await request(port, "/");
      assert.equal(root.status, 200);
      assert.equal(root.headers.get("content-type")?.toLowerCase(), "text/html; charset=utf-8");
      assert.equal(await root.text(), rootFixture);
      await assertText(port, "/post/1", 200, postFixture);
      await assertText(port, "/post/99", 404, "404 Not Found");
    },
  );
});

test("executes the @hono/node-server source entry natively", async context => {
  await withServer(
    context,
    "examples/hono-node-server/server.ts",
    39_483,
    hono,
    async port => {
      await assertText(port, "/", 200, "Hello from @hono/node-server on TinyTSX");
      await assertText(port, "/missing", 404, "404 Not Found");
    },
  );
});

test("executes the Hono-neutral tinytsx:serve source entry natively", async context => {
  await withServer(
    context,
    "examples/tiny-serve/server.ts",
    39_484,
    hono,
    async port => {
      await assertText(port, "/", 200, "Hello from tinytsx:serve");
      await assertText(port, "/missing", 404, "404 Not Found");
    },
  );
});

test("executes trailing optional Hono parameters as finite native routes", async context => {
  await withServer(
    context,
    "tests/compat/hono/optional-param-smoke.ts",
    39_488,
    hono,
    async port => {
      await assertText(port, "/api/v1/animal/bird", 200, '{"type":"bird"}');
      await assertText(port, "/api/v1/animal", 200, "{}");
      await assertText(port, "/api/v1/animal/bird/extra", 404, "404 Not Found");
    },
  );
});

async function withServer(context, entry, port, options, verify) {
  const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-alpha-native-"));
  const binary = path.join(directory, "server");
  context.after(() => rmSync(directory, {recursive: true, force: true}));
  const built = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "build", entry,
    "--output", binary,
    "--port", String(port),
    ...options,
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(built.status, 0, built.stderr || built.stdout);

  const server = spawn(binary, [], {stdio: ["ignore", "pipe", "pipe"]});
  context.after(() => server.kill("SIGTERM"));
  await waitForServer(port, server);
  await verify(port);
  server.kill("SIGTERM");
  await new Promise(resolve => server.once("exit", resolve));
}

async function request(port, pathname) {
  return fetch(`http://127.0.0.1:${port}${pathname}`, {
    headers: {connection: "close"},
  });
}

async function assertText(port, pathname, status, body) {
  const response = await request(port, pathname);
  assert.equal(response.status, status);
  assert.equal(await response.text(), body);
}

async function waitForServer(port, server) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (server.exitCode !== null) throw new Error(`native server exited with ${server.exitCode}`);
    try {
      const response = await request(port, "/");
      await response.body?.cancel();
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  throw new Error("native alpha server did not start");
}

function fixture(name) {
  return readFileSync(path.join(repository, "tests/compat/hono/fixtures", name), "utf8")
    .replace(/\n$/, "");
}
