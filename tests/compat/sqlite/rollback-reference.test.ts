import {afterAll, beforeAll, expect, test} from "bun:test";
import {existsSync, mkdtempSync, rmSync, statSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";

const port = 39_500;
const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-sqlite-rollback-reference-"));
const database = path.join(directory, "rollback-load.db");
let stop: (() => Promise<void>) | undefined;

beforeAll(async () => {
  process.env.TINYTSX_BENCH_PORT = String(port);
  process.env.TINYTSX_BENCH_SQLITE_PATH = database;
  ({stop} = await import("../../../benchmarks/bun/hono-sqlite-rollback-server.ts"));
});

afterAll(async () => {
  await stop?.();
  rmSync(directory, {recursive: true, force: true});
});

test("Bun/Hono rolls back the failed payment and commits later recovery", async () => {
  expect(await text("GET", "/sqlite-rollback/setup")).toEqual({status: 200, body: "ready"});
  expect(await post("/sqlite-rollback/fail/acme", "benchmark-key", 7)).toEqual({
    status: 500,
    body: "internal server error",
  });
  expect(await json("/sqlite-rollback/state")).toEqual({
    state: {partialRows: 0, committed: 0},
  });
  expect(await json("/sqlite-rollback/journal")).toEqual({journal: {journal_mode: "wal"}});
  expect(await post("/sqlite-rollback/recover", "recovery-key", 9)).toEqual({
    status: 200,
    body: "recovered",
  });
  expect(await json("/sqlite-rollback/state")).toEqual({
    state: {partialRows: 0, committed: 1},
  });
  expect(await post("/sqlite-rollback/fail/acme", "benchmark-key", 7)).toEqual({
    status: 500,
    body: "internal server error",
  });
  expect(await json("/sqlite-rollback/state")).toEqual({
    state: {partialRows: 0, committed: 1},
  });
  for (const file of [database, `${database}-wal`, `${database}-shm`]) {
    expect(existsSync(file)).toBe(true);
    expect(statSync(file).size).toBeGreaterThan(0);
  }
});

async function post(pathname: string, key: string, amount: number) {
  return text("POST", pathname, {
    "content-type": "application/json",
    "idempotency-key": key,
  }, JSON.stringify({amount}));
}

async function json(pathname: string): Promise<unknown> {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`);
  expect(response.status).toBe(200);
  return response.json();
}

async function text(
  method: string,
  pathname: string,
  headers?: Record<string, string>,
  body?: string,
) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {method, headers, body});
  return {status: response.status, body: await response.text()};
}
