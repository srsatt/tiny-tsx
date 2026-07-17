import assert from "node:assert/strict";
import {spawn, spawnSync} from "node:child_process";
import {once} from "node:events";
import net from "node:net";
import path from "node:path";

export function build(compiler, project, entry, output, port, options = []) {
  return spawnSync(compiler, [
    "build", entry,
    "--output", output,
    "--port", String(port),
    "--release",
    ...options,
  ], {cwd: project, encoding: "utf8"});
}

export async function withServer(binary, port, verify, options = {}) {
  const server = spawn(binary, [], {
    env: {...process.env, ...options.environment},
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  server.stdout.on("data", chunk => { stdout += chunk; });
  server.stderr.on("data", chunk => { stderr += chunk; });
  try {
    await waitForServer(port, server, options.waitPath ?? "/");
    await verify();
  } finally {
    if (server.exitCode === null) server.kill("SIGTERM");
  }
  const [code, signal] = await Promise.race([
    once(server, "exit"),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(`server did not shut down\nstdout:\n${stdout}\nstderr:\n${stderr}`)),
      5_000,
    )),
  ]);
  assert.equal(code, 0, `shutdown code; signal=${signal}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  assert.equal(signal, null);
  assert.match(stdout, /TinyTSX shutting down/);
}

export function request(port, pathname, options) {
  return fetch(`http://127.0.0.1:${port}${pathname}`, {
    headers: {connection: "close", ...options?.headers},
    ...options,
  });
}

export async function openStalled(port) {
  const socket = net.createConnection({host: "127.0.0.1", port});
  await once(socket, "connect");
  socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n");
  return socket;
}

export async function rawRequest(port, bytes) {
  const socket = net.createConnection({host: "127.0.0.1", port});
  socket.setEncoding("utf8");
  let response = "";
  socket.on("data", chunk => { response += chunk; });
  await once(socket, "connect");
  socket.end(bytes);
  await once(socket, "close");
  return response;
}

export function assertBuilt(result, label) {
  assert.equal(result.status, 0, `${label}: ${result.stderr || result.stdout}`);
}

async function waitForServer(port, server, pathname) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (server.exitCode !== null) throw new Error(`server exited with ${server.exitCode}`);
    try {
      const response = await request(port, pathname);
      await response.body?.cancel();
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  throw new Error(`server did not start on port ${port}`);
}

export function binaryPath(project, name) {
  return path.join(project, `.release-${name}`);
}
