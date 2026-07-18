import assert from "node:assert/strict";
import {spawn, spawnSync} from "node:child_process";
import {mkdtempSync, readFileSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const entry = "tests/compat/hono/map-smoke.ts";
const hono = [
  "--alias", "hono=vendor/hono/src/index.ts",
  "--api", "hono=tests/compat/hono/api.d.ts",
];

test("executes isolated bounded request-local Maps natively", async context => {
  const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-map-"));
  const binary = path.join(directory, "server");
  const port = 39_497;
  context.after(() => rmSync(directory, {recursive: true, force: true}));

  const built = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "build", entry,
    "--output", binary,
    "--port", String(port),
    "--workers", "8",
    ...hono,
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(built.status, 0, built.stderr || built.stdout);
  const report = JSON.parse(readFileSync(`${binary}.build.json`, "utf8"));
  assert.ok(report.memory.sites.some(site =>
    site.valueKind === "runtimeMap" && site.lifetime === "request" && site.escape === "none"
  ));
  assert.equal(report.memory.managedHeapRequired, false);

  const server = spawn(binary, [], {stdio: ["ignore", "pipe", "pipe"]});
  context.after(() => server.kill("SIGTERM"));
  await waitForServer(port, server);

  const values = Array.from({length: 32}, (_, index) => `request-${index}`);
  const responses = await Promise.all(values.map(async value => {
    const response = await fetch(`http://127.0.0.1:${port}/map/${value}`);
    return {status: response.status, body: await response.text()};
  }));
  assert.deepEqual(responses, values.map(value => ({status: 200, body: value})));

  const cleared = await fetch(`http://127.0.0.1:${port}/map-clear`);
  assert.equal(cleared.status, 200);
  assert.equal(await cleared.text(), "empty");
  const recovered = await fetch(`http://127.0.0.1:${port}/map/recovered`);
  assert.equal(recovered.status, 200);
  assert.equal(await recovered.text(), "recovered");
});

test("assembles bounded request-local Maps for Linux arm64", () => {
  const checked = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "check", entry,
    "--emit-asm", "--target", "aarch64-unknown-linux-gnu",
    ...hono,
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  assert.match(checked.stdout, /tinytsx_html_write_path_segment/);
  const assembled = spawnSync("clang", [
    "--target=aarch64-unknown-linux-gnu", "-x", "assembler", "-c", "-o", "/dev/null", "-",
  ], {cwd: repository, input: checked.stdout, encoding: "utf8"});
  assert.equal(assembled.status, 0, assembled.stderr);
});

async function waitForServer(port, server) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (server.exitCode !== null) throw new Error(`native Map server exited with ${server.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/map/ready`);
      assert.equal(await response.text(), "ready");
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  throw new Error("native Map server did not start");
}
