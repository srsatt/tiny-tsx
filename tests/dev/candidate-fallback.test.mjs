import assert from "node:assert/strict";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import test from "node:test";
import {availablePort, stopChild, waitForBody, waitForOutput} from "./helpers.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const compiler = path.join(root, "target/debug/tinytsx");

test("dev restores the last good server when a candidate cannot listen", async context => {
  const project = await mkdtemp(path.join(os.tmpdir(), "tinytsx-dev-fallback-"));
  const goodPort = await availablePort();
  const occupiedPort = await availablePort();
  const blocker = net.createServer();
  await new Promise((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(occupiedPort, "127.0.0.1", resolve);
  });
  const entry = path.join(project, "server.ts");
  await writeFile(entry, honoSource("first", goodPort));

  const child = spawn(compiler, [
    "dev", entry,
    "--alias", `hono=${path.join(root, "vendor/hono/src/index.ts")}`,
    "--api", `hono=${path.join(root, "tests/compat/hono/api.d.ts")}`,
  ], {
    cwd: project,
    env: {...process.env, TINYTSX_HOME: root},
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", chunk => output += chunk);
  child.stderr.on("data", chunk => output += chunk);
  context.after(async () => {
    await stopChild(child);
    await new Promise(resolve => blocker.close(resolve));
    await rm(project, {recursive: true, force: true});
  });

  assert.equal(await waitForBody(goodPort, "first", child, () => output), "first");
  const failureOffset = output.length;
  await writeFile(entry, honoSource("unavailable", occupiedPort));
  await waitForOutput("candidate failed; restored generation", child, () => output.slice(failureOffset));
  assert.equal(await waitForBody(goodPort, "first", child, () => output), "first");

  await writeFile(entry, honoSource("third", goodPort));
  assert.equal(await waitForBody(goodPort, "third", child, () => output), "third");
  assert.equal(child.exitCode, null, output);
});

function honoSource(message, port) {
  return [
    'import {Hono} from "hono";',
    'import {serve} from "tinytsx:serve";',
    "const app = new Hono();",
    `app.get("/", context => context.text(${JSON.stringify(message)}));`,
    `serve({fetch: app.fetch, port: ${port}});`,
    "",
  ].join("\n");
}
