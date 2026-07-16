import assert from "node:assert/strict";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawn, spawnSync} from "node:child_process";
import {test} from "node:test";
import {fileURLToPath} from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const entry = path.join(repository, "examples/hono-static/server.ts");
const upstreamEntry = path.join(repository, "vendor/hono-examples/serve-static/src/index.ts");
const assets = path.join(repository, "vendor/hono-examples/serve-static/assets");

test("denies filesystem access without a read root", () => {
  const result = build(path.join(tmpdir(), "tinytsx-fs-denied"), []);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /TINY1502/);
  assert.match(result.stderr, /my-file\.txt/);
});

test("assembles the filesystem tracer for Linux arm64", () => {
  const result = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "check", entry,
    "--emit-asm",
    "--target", "aarch64-unknown-linux-gnu",
    "--allow-read", assets,
    "--alias", "hono=vendor/hono/src/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
    "--alias", "hono/powered-by=vendor/hono/src/middleware/powered-by/index.ts",
    "--api", "hono/powered-by=tests/compat/hono/powered-by-api.d.ts",
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /tinytsx_html_write_file_text/);
  const assembled = spawnSync("clang", [
    "--target=aarch64-unknown-linux-gnu", "-x", "assembler", "-c", "-o", "/dev/null", "-",
  ], {cwd: repository, input: result.stdout, encoding: "utf8"});
  assert.equal(assembled.status, 0, assembled.stderr);
});

test("serves pinned Hono static assets through bounded application workers", async context => {
  const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-fs-native-"));
  const binary = path.join(directory, "server");
  const port = 39_463;
  context.after(() => rmSync(directory, {recursive: true, force: true}));

  const upstreamBinary = path.join(directory, "upstream-server");
  const upstreamBuild = build(upstreamBinary, [], port, upstreamEntry);
  assert.equal(upstreamBuild.status, 0, upstreamBuild.stderr || upstreamBuild.stdout);
  const upstream = spawn(upstreamBinary, [], {stdio: ["ignore", "pipe", "pipe"]});
  await waitForServer(port, upstream);
  const landing = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(landing.status, 200);
  assert.equal(landing.headers.get("x-powered-by"), "Hono");
  assert.match(await landing.text(), /Try visiting:.*\/my-file\.txt/s);
  upstream.kill("SIGTERM");
  await new Promise(resolve => upstream.once("exit", resolve));

  const result = build(binary, [assets], port, entry);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(readFileSync(`${binary}.build.json`, "utf8"));
  assert.deepEqual(report.permissions.read, [assets]);
  assert.equal(report.filesystem, true);
  assert.ok(report.runtimeFeatures.includes("bounded-filesystem-read"));

  const server = spawn(binary, [], {stdio: ["ignore", "pipe", "pipe"]});
  context.after(() => server.kill("SIGTERM"));
  await waitForServer(port, server);

  await assertResponse(port, "/my-file.txt", 200, readFileSync(path.join(assets, "my-file.txt"), "utf8"));
  await assertResponse(
    port,
    "/folder/nested-file.txt",
    200,
    readFileSync(path.join(assets, "folder/nested-file.txt"), "utf8"),
  );
  await assertResponse(port, "/missing.txt", 500, "internal server error");
  await assertResponse(port, "/too-small", 500, "internal server error");
});

function build(binary, roots, port = 39_463, source = entry) {
  return spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "build", source,
    "--output", binary,
    "--port", String(port),
    "--alias", "hono=vendor/hono/src/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
    "--alias", "hono/powered-by=vendor/hono/src/middleware/powered-by/index.ts",
    "--api", "hono/powered-by=tests/compat/hono/powered-by-api.d.ts",
    ...roots.flatMap(root => ["--allow-read", root]),
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
  throw new Error("native filesystem server did not start");
}
