import assert from "node:assert/strict";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import test from "node:test";
import {availablePort, stopChild, waitForBody, waitForOutput} from "./helpers.mjs";

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
    await stopChild(child);
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

  const failureOffset = output.length;
  await writeFile(entry, [
    'import {LATE} from "./late.js";',
    "export function GET(_request: Request): Response {",
    "  return Response.text(LATE);",
    "}",
    "",
  ].join("\n"));
  await waitForOutput("build failed", child, () => output.slice(failureOffset));
  assert.equal(await waitForBody(port, "second", child, () => output), "second");
  await writeFile(path.join(project, "late.ts"), 'export const LATE = "third";\n');
  assert.equal(await waitForBody(port, "third", child, () => output), "third");
  assert.equal(child.exitCode, null, output);
});
