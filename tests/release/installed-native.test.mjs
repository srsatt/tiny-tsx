import assert from "node:assert/strict";
import {cpSync, mkdtempSync, readFileSync, rmSync, statSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {after, test} from "node:test";
import {
  assertBuilt,
  binaryPath,
  build,
  openStalled,
  rawRequest,
  request,
  withServer,
} from "./helpers.mjs";

const releaseRoot = process.env.TINYTSX_RELEASE_ROOT;
assert.ok(releaseRoot, "TINYTSX_RELEASE_ROOT is required");
const compiler = path.join(releaseRoot, "bin", "tinytsx");
const resources = path.join(releaseRoot, "lib", "tinytsx");
const project = mkdtempSync(path.join(tmpdir(), "tinytsx-installed-examples-"));
cpSync(path.join(resources, "examples"), project, {recursive: true});
const installed = spawnSync("npm", ["ci"], {cwd: project, encoding: "utf8"});
assert.equal(installed.status, 0, installed.stderr || installed.stdout);
after(() => rmSync(project, {recursive: true, force: true}));

test("ships runnable Hono, node-server, tinytsx serve, and Zod examples", async () => {
  statSync(path.join(project, "README.md"));

  const nodePort = 39_490;
  const nodeBinary = binaryPath(project, "node-server");
  assertBuilt(build(compiler, project, "hono-node-server/server.ts", nodeBinary, nodePort), "node-server");
  await withServer(nodeBinary, nodePort, async () => {
    await assertText(nodePort, "/", 200, "Hello from @hono/node-server on TinyTSX");
    await assertText(nodePort, "/missing", 404, "404 Not Found");
  });

  const neutralPort = 39_491;
  const neutralBinary = binaryPath(project, "tiny-serve");
  assertBuilt(build(compiler, project, "tiny-serve/server.ts", neutralBinary, neutralPort), "tinytsx:serve");
  await withServer(neutralBinary, neutralPort, async () => {
    await assertText(neutralPort, "/", 200, "Hello from tinytsx:serve");
  });

  const zodPort = 39_492;
  const zodBinary = binaryPath(project, "zod-openapi");
  assertBuilt(build(compiler, project, "hono-zod-openapi/server.ts", zodBinary, zodPort), "zod-openapi");
  await withServer(zodBinary, zodPort, async () => {
    await assertText(zodPort, "/users/1212121", 200, '{"id":"1212121","age":20,"name":"Ultra-man"}');
    const rejected = await request(zodPort, "/users/x");
    assert.equal(rejected.status, 400);
    assert.match(await rejected.text(), /Too small: expected string to have >=3 characters/);
    const document = await request(zodPort, "/doc");
    assert.equal(document.status, 200);
    assert.equal((await document.json()).openapi, "3.0.0");
  }, {waitPath: "/doc"});
});

test("runs capability, malformed-input, and disposal failures in release servers", async () => {
  const fsBinary = binaryPath(project, "filesystem");
  const denied = build(compiler, project, "hono-static/server.ts", fsBinary, 39_493);
  assert.notEqual(denied.status, 0);
  assert.match(denied.stderr, /TINY1502/);
  const assets = path.join(project, "hono-static", "assets");
  assertBuilt(build(
    compiler, project, "hono-static/server.ts", fsBinary, 39_493,
    ["--allow-read", assets],
  ), "filesystem");
  await withServer(fsBinary, 39_493, async () => {
    await assertText(39_493, "/my-file.txt", 200, "This is a sample file\n");
    await assertText(39_493, "/missing.txt", 500, "internal server error");
  });

  const sqliteBinary = binaryPath(project, "sqlite");
  assertBuilt(build(
    compiler, project, "hono-sqlite/server.ts", sqliteBinary, 39_494,
    ["--allow-env", "TINYTSX_BLOG_NAME"],
  ), "sqlite");
  await withServer(sqliteBinary, 39_494, async () => {
    await assertText(39_494, "/schema", 200, "ready", {method: "POST"});
    await assertText(39_494, "/posts", 400, "bad request", {
      method: "POST",
      headers: {"content-type": "application/json"},
      body: "{",
    });
    await assertText(39_494, "/close", 200, "closed", {method: "POST"});
    await assertText(39_494, "/schema", 500, "internal server error", {method: "POST"});
  }, {waitPath: "/config", environment: {TINYTSX_BLOG_NAME: "Release Blog"}});

  const actorBinary = binaryPath(project, "actors");
  assertBuilt(build(compiler, project, "hono-actors/server.ts", actorBinary, 39_495), "actors");
  await withServer(actorBinary, 39_495, async () => {
    await assertText(39_495, "/increment", 200, "1");
    await assertText(39_495, "/stop", 200, "stopped");
    await assertText(39_495, "/", 500, "internal server error");
  });
});

test("recovers from release request-memory exhaustion", async () => {
  const entry = path.join(project, "request-memory.ts");
  cpSync(new URL("./request-memory.ts", import.meta.url), entry);
  const binary = binaryPath(project, "request-memory");
  assertBuilt(build(
    compiler, project, "request-memory.ts", binary, 39_496,
    ["--workers", "1", "--request-memory", "8"],
  ), "request memory");
  await withServer(binary, 39_496, async () => {
    await assertText(39_496, "/", 200, "ok");
    await assertText(39_496, "/large", 503, "request memory exhausted");
    await assertText(39_496, "/", 200, "ok");
  });
});

test("rejects and recovers from release HTTP worker saturation", async () => {
  const binary = binaryPath(project, "saturation");
  assertBuilt(build(
    compiler, project, "hono-node-server/server.ts", binary, 39_497,
    ["--workers", "1"],
  ), "worker saturation");
  await withServer(binary, 39_497, async () => {
    const stalled = [];
    try {
      for (let index = 0; index < 80; index++) stalled.push(await openStalled(39_497));
      await new Promise(resolve => setTimeout(resolve, 500));
      const overloads = await Promise.all(Array.from({length: 8}, () => rawRequest(
        39_497,
        "GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n",
      )));
      assert.ok(overloads.some(response =>
        /^HTTP\/1\.1 503 Service Unavailable\r\n/.test(response)
        && response.endsWith("server overloaded")
      ), JSON.stringify(overloads));
    } finally {
      for (const socket of stalled) socket.destroy();
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    await assertText(39_497, "/", 200, "Hello from @hono/node-server on TinyTSX");
  });
});

async function assertText(port, pathname, status, body, options) {
  const response = await request(port, pathname, options);
  assert.equal(response.status, status);
  assert.equal(await response.text(), body);
}
