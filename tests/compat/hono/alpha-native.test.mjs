import assert from "node:assert/strict";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawn, spawnSync} from "node:child_process";
import {once} from "node:events";
import net from "node:net";
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
const cookie = [
  ...hono,
  "--alias", "hono/cookie=vendor/hono/src/helper/cookie/index.ts",
  "--api", "hono/cookie=tests/compat/hono/cookie-api.d.ts",
];
const bodyLimit = [
  ...hono,
  "--alias", "hono/body-limit=vendor/hono/src/middleware/body-limit/index.ts",
  "--api", "hono/body-limit=tests/compat/hono/body-limit-api.d.ts",
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

test("executes a terminal multi-segment Hono parameter natively", async context => {
  await withServer(
    context,
    "tests/compat/hono/catch-all-param-smoke.ts",
    39_490,
    hono,
    async port => {
      await assertText(port, "/", 200, '{"type":"string","value":""}');
      await assertText(port, "/one/two", 200, '{"type":"string","value":"one/two"}');
      await assertText(port, "/hello%20world/two", 200, '{"type":"string","value":"hello world/two"}');
    },
  );
});

test("assembles a terminal multi-segment Hono parameter for Linux arm64", () => {
  const checked = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "check",
    "tests/compat/hono/catch-all-param-smoke.ts",
    "--emit-asm", "--target", "aarch64-unknown-linux-gnu",
    ...hono,
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  assert.match(checked.stdout, /tinytsx_html_write_path_tail/);
  const assembled = spawnSync("clang", [
    "--target=aarch64-unknown-linux-gnu", "-x", "assembler", "-c", "-o", "/dev/null", "-",
  ], {cwd: repository, input: checked.stdout, encoding: "utf8"});
  assert.equal(assembled.status, 0, assembled.stderr);
});

test("executes the pinned Hono setCookie helper natively", async context => {
  await withServer(
    context,
    "tests/compat/hono/cookie-smoke.ts",
    39_489,
    cookie,
    async port => {
      for (const [pathname, expected] of [
        ["/set-cookie", "delicious_cookie=macha; Path=/"],
        ["/a/set-cookie-path", "delicious_cookie=macha; Path=/a"],
      ]) {
        const response = await request(port, pathname);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("set-cookie"), expected);
        assert.equal(await response.text(), "Give cookie");
      }
      await assertText(port, "/get-cookie", 200, "missing");
      const parsed = await request(port, "/get-cookie", {
        headers: {cookie: "other=one; delicious_cookie = macha"},
      });
      assert.equal(parsed.status, 200);
      assert.equal(await parsed.text(), "macha");
      const decoded = await request(port, "/get-cookie", {
        headers: {cookie: "delicious_cookie=green%20tea"},
      });
      assert.equal(decoded.status, 200);
      assert.equal(await decoded.text(), "green tea");
      const multiple = await request(port, "/set-multiple-cookies");
      assert.equal(multiple.status, 200);
      assert.equal(
        multiple.headers.get("set-cookie"),
        "first_cookie=one; Path=/, second_cookie=two; Path=/; HttpOnly",
      );
      assert.equal(await multiple.text(), "Give cookies");
      const deleted = await request(port, "/delete-cookie", {
        headers: {cookie: "delicious_cookie=macha"},
      });
      assert.equal(deleted.status, 200);
      assert.equal(deleted.headers.get("set-cookie"), "delicious_cookie=; Max-Age=0; Path=/");
      assert.equal(await deleted.text(), "macha");
    },
  );
});

test("assembles the pinned Hono cookie helper for Linux arm64", () => {
  const checked = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "check",
    "tests/compat/hono/cookie-smoke.ts",
    "--emit-asm", "--target", "aarch64-unknown-linux-gnu",
    ...cookie,
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  assert.match(checked.stdout, /tinytsx_html_write_request_cookie/);
  const assembled = spawnSync("clang", [
    "--target=aarch64-unknown-linux-gnu", "-x", "assembler", "-c", "-o", "/dev/null", "-",
  ], {cwd: repository, input: checked.stdout, encoding: "utf8"});
  assert.equal(assembled.status, 0, assembled.stderr);
});

test("executes the pinned Hono bodyLimit middleware natively", async context => {
  await withServer(
    context,
    "tests/compat/hono/body-limit-smoke.ts",
    39_491,
    bodyLimit,
    async port => {
      await assertText(port, "/", 200, "index");
      await assertText(port, "/body-limit", 200, "pass :)", {
        method: "POST",
        body: "hono is so hot",
      });
      const rejected = await request(port, "/body-limit", {
        method: "POST",
        body: "hono is so hot and cute",
      });
      assert.equal(rejected.status, 413);
      assert.equal(rejected.headers.get("content-type"), "text/plain;charset=UTF-8");
      assert.equal(await rejected.text(), "Payload Too Large");

      const pipelined = await rawRequest(port,
        "POST /body-limit HTTP/1.1\r\n"
        + "Host: localhost\r\nContent-Length: 23\r\nConnection: keep-alive\r\n\r\n"
        + "hono is so hot and cute"
        + "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
      );
      assert.match(pipelined, /^HTTP\/1\.1 413 Payload Too Large\r\n/);
      assert.match(pipelined, /Connection: keep-alive\r\n/);
      assert.match(pipelined, /Payload Too LargeHTTP\/1\.1 200 OK\r\n/);
      assert.ok(pipelined.endsWith("index"), pipelined);

      const chunked = await rawRequest(port,
        "POST /body-limit HTTP/1.1\r\nHost: localhost\r\n"
        + "Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n"
        + "e\r\nhono is so hot\r\n0\r\n\r\n",
      );
      assert.match(chunked, /^HTTP\/1\.1 400 Bad Request\r\n/);
      await assertText(port, "/", 200, "index");
    },
  );
});

test("assembles the pinned Hono bodyLimit middleware for Linux arm64", () => {
  const checked = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "check",
    "tests/compat/hono/body-limit-smoke.ts",
    "--emit-asm", "--target", "aarch64-unknown-linux-gnu",
    ...bodyLimit,
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  assert.match(checked.stdout, /tinytsx_request_body_length/);
  const assembled = spawnSync("clang", [
    "--target=aarch64-unknown-linux-gnu", "-x", "assembler", "-c", "-o", "/dev/null", "-",
  ], {cwd: repository, input: checked.stdout, encoding: "utf8"});
  assert.equal(assembled.status, 0, assembled.stderr);
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

async function request(port, pathname, init = {}) {
  return fetch(`http://127.0.0.1:${port}${pathname}`, {
    ...init,
    headers: {connection: "close", ...init.headers},
  });
}

async function assertText(port, pathname, status, body, init = {}) {
  const response = await request(port, pathname, init);
  assert.equal(response.status, status);
  assert.equal(await response.text(), body);
}

async function rawRequest(port, bytes) {
  const socket = net.createConnection({host: "127.0.0.1", port});
  socket.setEncoding("utf8");
  let response = "";
  socket.on("data", chunk => { response += chunk; });
  await once(socket, "connect");
  socket.end(bytes);
  await once(socket, "close");
  return response;
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
