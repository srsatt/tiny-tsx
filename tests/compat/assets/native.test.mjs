import assert from "node:assert/strict";
import {mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawn, spawnSync} from "node:child_process";
import {createConnection} from "node:net";
import {test} from "node:test";
import {fileURLToPath} from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const entry = path.join(repository, "tests/compat/assets/server.ts");

test("embeds a bounded Vite-style asset tree with HTTP caching", async context => {
  const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-assets-native-"));
  const web = path.join(directory, "web");
  const nested = path.join(web, "assets");
  const binary = path.join(directory, "server");
  const port = 39_497;
  mkdirSync(nested, {recursive: true});
  writeFileSync(path.join(web, "index.html"), "<!doctype html><main>Tiny air</main>");
  writeFileSync(path.join(nested, "app.js"), "export const ready = true;\n");
  writeFileSync(path.join(nested, "probe.bin"), Buffer.from([0, 1, 2, 127, 128, 255]));
  context.after(() => rmSync(directory, {recursive: true, force: true}));

  const built = compile("build", web, binary, port);
  assert.equal(built.status, 0, built.stderr || built.stdout);
  const report = JSON.parse(readFileSync(`${binary}.build.json`, "utf8"));
  assert.equal(report.assetStores, 1);
  assert.equal(report.assetFiles, 3);
  assert.equal(report.embeddedAssetBytes,
    Buffer.byteLength("<!doctype html><main>Tiny air</main>") +
    Buffer.byteLength("export const ready = true;\n") + 6);
  assert.ok(report.runtimeFeatures.includes("embedded-assets"));
  const server = spawn(binary, [], {stdio: ["ignore", "pipe", "pipe"]});
  context.after(() => server.kill("SIGTERM"));
  await waitForServer(port, server);

  const index = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(index.status, 200);
  assert.equal(index.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(await index.text(), "<!doctype html><main>Tiny air</main>");
  const etag = index.headers.get("etag");
  assert.match(etag, /^"[0-9a-f]{16}-[0-9a-f]+"$/);

  const cached = await fetch(`http://127.0.0.1:${port}/`, {headers: {"If-None-Match": etag}});
  assert.equal(cached.status, 304);
  assert.equal(await cached.text(), "");

  const binaryResponse = await fetch(`http://127.0.0.1:${port}/assets/probe.bin`);
  assert.equal(binaryResponse.headers.get("content-type"), "application/octet-stream");
  assert.deepEqual(new Uint8Array(await binaryResponse.arrayBuffer()), new Uint8Array([0, 1, 2, 127, 128, 255]));

  const head = await fetch(`http://127.0.0.1:${port}/assets/app.js`, {method: "HEAD"});
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("content-length"), String(Buffer.byteLength("export const ready = true;\n")));
  assert.equal((await head.arrayBuffer()).byteLength, 0);

  const fallback = await fetch(`http://127.0.0.1:${port}/dashboard/history`);
  assert.equal(await fallback.text(), "<!doctype html><main>Tiny air</main>");

  const traversal = await rawRequest(port, "/../secret");
  assert.match(traversal, /^HTTP\/1\.1 404 /);
  assert.doesNotMatch(traversal, /Tiny air/);
});

test("rejects symlinks and emits deterministic Linux arm64 asset assembly", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-assets-safety-"));
  const web = path.join(directory, "web");
  mkdirSync(web);
  writeFileSync(path.join(web, "index.html"), "safe");
  try {
    const first = compile("check", web, undefined, undefined, ["--emit-asm", "--target", "aarch64-unknown-linux-gnu"]);
    const second = compile("check", web, undefined, undefined, ["--emit-asm", "--target", "aarch64-unknown-linux-gnu"]);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(first.stdout, second.stdout);
    assert.match(first.stdout, /tinytsx_config_asset_file_data/);
    const assembled = spawnSync("clang", [
      "--target=aarch64-unknown-linux-gnu", "-x", "assembler", "-c", "-o", "/dev/null", "-",
    ], {cwd: repository, input: first.stdout, encoding: "utf8"});
    assert.equal(assembled.status, 0, assembled.stderr);

    symlinkSync(path.join(web, "index.html"), path.join(web, "linked.html"));
    const unsafe = compile("build", web, path.join(directory, "unsafe"), 39_498);
    assert.notEqual(unsafe.status, 0);
    assert.match(unsafe.stderr, /must not be a symbolic link/);
  } finally {
    rmSync(directory, {recursive: true, force: true});
  }
});

function compile(command, web, output, port, extra = []) {
  return spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", command, entry,
    ...(output === undefined ? [] : ["--output", output]),
    ...(port === undefined ? [] : ["--port", String(port)]),
    "--asset", `WEB=${web}`,
    "--alias", "hono=vendor/hono/src/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
    ...extra,
  ], {cwd: repository, encoding: "utf8"});
}

async function waitForServer(port, child) {
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) assert.fail(`server exited early: ${stderr}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      await response.arrayBuffer();
      return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(`server did not start: ${stderr}`);
}

function rawRequest(port, target) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({host: "127.0.0.1", port});
    const chunks = [];
    socket.on("connect", () => {
      socket.end(`GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
    });
    socket.on("data", chunk => chunks.push(chunk));
    socket.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    socket.on("error", reject);
  });
}
