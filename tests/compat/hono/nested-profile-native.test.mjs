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
const entry = "examples/hono-nested-json/server.ts";
const hono = [
  "--alias", "hono=vendor/hono/src/index.ts",
  "--api", "hono=tests/compat/hono/api.d.ts",
];
const valid = {
  profile: {
    name: "Alice",
    preferences: {theme: "dark", alerts: true},
  },
  score: 7,
};

test("persists a nested profile atomically and recovers after bounded failures", async context => {
  const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-nested-profile-"));
  const binary = path.join(directory, "server");
  const port = 39_505;
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

  await assertText(port, "/profiles/schema", "POST", undefined, 200, "ready");
  await assertPost(port, "/profiles/alice", valid, 201, {
    id: "alice",
    ...valid,
  });
  await assertGetProfile(port, "alice", 200, {
    profile: {id: "alice", name: "Alice", score: 7, theme: "dark", alerts: 1},
  });
  await assertGetProfile(port, "missing", 404, {error: "Not Found"});

  await assertPost(port, "/profiles/rolled-back", {
    profile: {
      name: "Rollback",
      preferences: {theme: "dark", alerts: false},
    },
    score: null,
  }, 500, "internal server error");
  await assertGetProfile(port, "rolled-back", 404, {error: "Not Found"});

  await assertRawPost(port, "/profiles/malformed", "{", 400, "bad request");
  await assertPost(port, "/profiles/missing-theme", {
    profile: {name: "Missing", preferences: {alerts: true}},
    score: 1,
  }, 400, "bad request");
  await assertPost(port, "/profiles/wrong-shape", {
    profile: {name: "Wrong", preferences: []},
    score: 1,
  }, 400, "bad request");
  await assertPost(port, "/profiles/oversized-leaf", {
    profile: {
      name: "x".repeat(4_097),
      preferences: {theme: "oversized", alerts: true},
    },
    score: 1,
  }, 400, "bad request");

  const recovered = {
    profile: {
      name: "Recovered",
      preferences: {theme: "light", alerts: false},
    },
    score: null,
  };
  await assertPost(port, "/profiles/recovered", recovered, 201, {
    id: "recovered",
    ...recovered,
  });
  await assertGetProfile(port, "recovered", 200, {
    profile: {id: "recovered", name: "Recovered", score: null, theme: "light", alerts: 0},
  });

  const pipelined = await rawRequest(
    port,
    requestBytes("/profiles/pipeline-bad", "{", true)
      + requestBytes("/profiles/pipeline-good", JSON.stringify({
        profile: {
          name: "Pipeline",
          preferences: {theme: "blue", alerts: true},
        },
        score: 3,
      }), false),
  );
  assert.match(pipelined, /^HTTP\/1\.1 400 Bad Request\r\n/);
  assert.match(pipelined, /Connection: keep-alive\r\n/);
  assert.match(pipelined, /bad requestHTTP\/1\.1 201 Created\r\n/);
  assert.match(pipelined, /"id":"pipeline-good"/);
});

test("assembles the nested profile transaction for Linux arm64", () => {
  const checked = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "check", entry,
    "--emit-asm", "--target", "aarch64-unknown-linux-gnu",
    ...hono,
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  assert.match(checked.stdout, /tinytsx_html_write_request_json_field/);
  assert.match(checked.stdout, /tinytsx_sqlite_transaction_params/);
  const assembled = spawnSync("clang", [
    "--target=aarch64-unknown-linux-gnu", "-x", "assembler", "-c", "-o", "/dev/null", "-",
  ], {cwd: repository, input: checked.stdout, encoding: "utf8"});
  assert.equal(assembled.status, 0, assembled.stderr);
});

async function assertPost(port, route, body, status, expected) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method: "POST",
    headers: {connection: "close", "content-type": "application/json"},
    body: JSON.stringify(body),
  });
  assert.equal(response.status, status);
  if (typeof expected === "string") {
    assert.equal(await response.text(), expected);
  } else {
    assert.deepEqual(await response.json(), expected);
  }
}

async function assertRawPost(port, route, body, status, expected) {
  await assertText(port, route, "POST", body, status, expected, {
    "content-type": "application/json",
  });
}

async function assertGetProfile(port, id, status, expected) {
  const response = await fetch(`http://127.0.0.1:${port}/profiles/${id}`, {
    headers: {connection: "close"},
  });
  assert.equal(response.status, status);
  assert.deepEqual(await response.json(), expected);
}

async function assertText(port, route, method, body, status, expected, headers = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, {
    method,
    headers: {connection: "close", ...headers},
    ...(body === undefined ? {} : {body}),
  });
  assert.equal(response.status, status);
  assert.equal(await response.text(), expected);
}

function requestBytes(route, body, keepAlive) {
  return `POST ${route} HTTP/1.1\r\n`
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
      const response = await fetch(`http://127.0.0.1:${port}/profiles/missing`);
      await response.body?.cancel();
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  throw new Error("native nested-profile server did not start");
}
