import assert from "node:assert/strict";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../..");
const compiler = path.join(root, "target/debug/tinytsx");

test("dev replaces the running server after a dependency changes", async context => {
  const project = await mkdtemp(path.join(os.tmpdir(), "tinytsx-dev-"));
  const port = await availablePort();
  const message = path.join(project, "message.ts");
  const entry = path.join(project, "server.ts");
  await writeFile(message, 'export const MESSAGE = "first";\n');
  await writeFile(entry, [
    'import {MESSAGE} from "./message.js";',
    "export function GET(_request: Request): Response {",
    "  return Response.text(MESSAGE);",
    "}",
    "",
  ].join("\n"));

  const child = spawn(compiler, ["dev", entry, "--port", String(port)], {
    cwd: project,
    env: {...process.env, TINYTSX_HOME: root},
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", chunk => output += chunk);
  child.stderr.on("data", chunk => output += chunk);
  context.after(async () => {
    if (child.exitCode === null) child.kill("SIGTERM");
    await Promise.race([
      new Promise(resolve => child.once("exit", resolve)),
      new Promise(resolve => setTimeout(resolve, 2_000)),
    ]);
    await rm(project, {recursive: true, force: true});
  });

  assert.equal(await waitForBody(port, "first", child, () => output), "first");
  await writeFile(message, 'export const MESSAGE: string = 42;\n');
  await waitForOutput("build failed", child, () => output);
  assert.equal(await waitForBody(port, "first", child, () => output), "first");

  const changedAt = Date.now();
  await writeFile(message, 'export const MESSAGE = "second";\n');
  assert.equal(await waitForBody(port, "second", child, () => output), "second");
  const reloadMs = Date.now() - changedAt;
  assert.ok(reloadMs <= 1_500, `warm reload took ${reloadMs}ms\n${output}`);
  assert.equal(child.exitCode, null, output);
});

async function waitForOutput(expected, child, getOutput) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      assert.fail(`dev process exited with ${child.exitCode}\n${getOutput()}`);
    }
    if (getOutput().includes(expected)) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(`timed out waiting for output ${JSON.stringify(expected)}\n${getOutput()}`);
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const {port} = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForBody(port, expected, child, getOutput) {
  const deadline = Date.now() + 20_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      assert.fail(`dev process exited with ${child.exitCode}\n${getOutput()}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      const body = await response.text();
      if (body === expected) return body;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(`timed out waiting for ${JSON.stringify(expected)}: ${lastError ?? "wrong body"}\n${getOutput()}`);
}
