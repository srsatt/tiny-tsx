import assert from "node:assert/strict";
import {mkdtempSync, realpathSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawn, spawnSync} from "node:child_process";
import {test} from "node:test";
import {fileURLToPath} from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const entry = path.join(repository, "tests/compat/sqlite/readonly-server.ts");

test("requires and serves a deploy-time read-only SQLite binding", async context => {
  const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-sqlite-ro-native-"));
  const binary = path.join(directory, "server");
  const database = path.join(directory, "air.db");
  const port = 39_496;
  context.after(() => rmSync(directory, {recursive: true, force: true}));

  const seeded = spawnSync("python3", ["-c", [
    "import sqlite3, sys",
    "db = sqlite3.connect(sys.argv[1])",
    "db.execute('CREATE TABLE readings (recorded_at INTEGER, co2 INTEGER, temperature REAL, humidity REAL)')",
    "db.execute('INSERT INTO readings VALUES (100, 612, 21.5, 43.25)')",
    "db.execute('INSERT INTO readings VALUES (200, 620, 21.75, 43.5)')",
    "db.execute('INSERT INTO readings VALUES (300, 630, 22.0, 44.0)')",
    "db.commit()",
  ].join("\n"), database], {encoding: "utf8"});
  assert.equal(seeded.status, 0, seeded.stderr);

  const built = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "build", entry,
    "--output", binary,
    "--port", String(port),
    "--binding", "AIR_DB=sqlite-ro",
    "--alias", "hono=vendor/hono/src/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(built.status, 0, built.stderr || built.stdout);

  const missing = spawnSync(binary, [], {encoding: "utf8"});
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /missing read-only SQLite binding `AIR_DB`/);

  const server = spawn(binary, ["--bind", `AIR_DB=${realpathSync(database)}`], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(() => server.kill("SIGTERM"));
  await waitForServer(port, server);

  const response = await fetch(`http://127.0.0.1:${port}/readings`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    readings: [
      {recorded_at: 100, co2: 612, temperature: 21.5, humidity: 43.25},
      {recorded_at: 200, co2: 620, temperature: 21.75, humidity: 43.5},
      {recorded_at: 300, co2: 630, temperature: 22, humidity: 44},
    ],
  });

  const history = await fetch(`http://127.0.0.1:${port}/history?since=100&limit=2`);
  assert.equal(history.status, 200);
  assert.deepEqual(await history.json(), {
    readings: [{recorded_at: 100, co2: 612}, {recorded_at: 200, co2: 620}],
  });

  const fallback = await fetch(`http://127.0.0.1:${port}/history`);
  assert.equal(fallback.status, 200);
  assert.equal((await fallback.json()).readings.length, 3);

  const invalid = await fetch(`http://127.0.0.1:${port}/history?limit=nope`);
  assert.equal(invalid.status, 400);
});

test("assembles the read-only binding ABI for Linux arm64", () => {
  const checked = spawnSync("cargo", [
    "run", "-q", "-p", "tinytsx", "--", "check", entry,
    "--emit-asm",
    "--target", "aarch64-unknown-linux-gnu",
    "--binding", "AIR_DB=sqlite-ro",
    "--alias", "hono=vendor/hono/src/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
  ], {cwd: repository, encoding: "utf8"});
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /tinytsx_config_sqlite_database_binding/);
  assert.match(checked.stdout, /Ltinytsx_sqlite_database_binding_data_0/);
  const assembled = spawnSync("clang", [
    "--target=aarch64-unknown-linux-gnu", "-x", "assembler", "-c", "-o", "/dev/null", "-",
  ], {cwd: repository, input: checked.stdout, encoding: "utf8"});
  assert.equal(assembled.status, 0, assembled.stderr);
});

async function waitForServer(port, child) {
  let stderr = "";
  child.stderr.on("data", chunk => { stderr += chunk; });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) assert.fail(`server exited early: ${stderr}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/readings`);
      await response.arrayBuffer();
      return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(`server did not start: ${stderr}`);
}
