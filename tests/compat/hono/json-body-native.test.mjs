import assert from "node:assert/strict";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawn, spawnSync} from "node:child_process";
import {once} from "node:events";
import net from "node:net";
import {test} from "node:test";
import {fileURLToPath} from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const entry = "tests/compat/hono/json-body-smoke.ts";
const hono = [
  "--alias", "hono=vendor/hono/src/index.ts",
  "--api", "hono=tests/compat/hono/api.d.ts",
];
const validBody = JSON.stringify({
  name: 'TinyTSX & "Bun"',
  count: 7,
  enabled: true,
  note: null,
});

test("executes bounded request JSON response values natively", async context => {
  const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-json-body-"));
  const binary = path.join(directory, "server");
  const port = 39_495;
  context.after(() => rmSync(directory, {recursive: true, force: true}));

  const built = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "build", entry,
    "--output", binary,
    "--port", String(port),
    ...hono,
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(built.status, 0, built.stderr || built.stdout);
  const server = spawn(binary, [], {stdio: ["ignore", "pipe", "pipe"]});
  context.after(() => server.kill("SIGTERM"));
  await waitForServer(port, server);

  await assertPost(port, validBody, 200, validBody);
  await assertPost(port, "{", 400, "bad request");
  await assertPost(port, JSON.stringify({name: "missing"}), 400, "bad request");
  await assertPost(
    port,
    JSON.stringify({name: [], count: 7, enabled: true, note: null}),
    400,
    "bad request",
  );
  await assertPost(port, JSON.stringify({name: "x".repeat(65_536)}), 413, "request body too large");

  const malformed = "{";
  const pipelined = await rawRequest(
    port,
    requestBytes(malformed, true) + requestBytes(validBody, false),
  );
  assert.match(pipelined, /^HTTP\/1\.1 400 Bad Request\r\n/);
  assert.match(pipelined, /Connection: keep-alive\r\n/);
  assert.match(pipelined, /bad requestHTTP\/1\.1 200 OK\r\n/);
  assert.ok(pipelined.endsWith(validBody), pipelined);
});

test("assembles bounded request JSON response values for Linux arm64", () => {
  const checked = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "check", entry,
    "--emit-asm", "--target", "aarch64-unknown-linux-gnu",
    ...hono,
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  assert.match(checked.stdout, /tinytsx_html_write_request_json_field/);
  const assembled = spawnSync("clang", [
    "--target=aarch64-unknown-linux-gnu", "-x", "assembler", "-c", "-o", "/dev/null", "-",
  ], {cwd: repository, input: checked.stdout, encoding: "utf8"});
  assert.equal(assembled.status, 0, assembled.stderr);
});

async function assertPost(port, body, status, expected) {
  const response = await fetch(`http://127.0.0.1:${port}/json-body`, {
    method: "POST",
    headers: {connection: "close", "content-type": "application/json"},
    body,
  });
  assert.equal(response.status, status);
  assert.equal(await response.text(), expected);
}

function requestBytes(body, keepAlive) {
  return "POST /json-body HTTP/1.1\r\n"
    + "Host: localhost\r\n"
    + "Content-Type: application/json\r\n"
    + `Content-Length: ${Buffer.byteLength(body)}\r\n`
    + `Connection: ${keepAlive ? "keep-alive" : "close"}\r\n\r\n`
    + body;
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
      const response = await fetch(`http://127.0.0.1:${port}/`);
      await response.body?.cancel();
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  throw new Error("native JSON body server did not start");
}
