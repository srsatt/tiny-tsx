import {afterAll, beforeAll, expect, test} from "bun:test";
import {existsSync, mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";

const port = 39_496;
const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-sqlite-wal-reference-"));
const database = path.join(directory, "wal-load.db");
let stop: (() => Promise<void>) | undefined;

beforeAll(async () => {
  process.env.TINYTSX_BENCH_PORT = String(port);
  process.env.TINYTSX_BENCH_SQLITE_PATH = database;
  ({stop} = await import("../../../benchmarks/bun/hono-sqlite-wal-server.ts"));
});

afterAll(async () => {
  await stop?.();
  rmSync(directory, {recursive: true, force: true});
});

async function response(pathname: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${pathname}`);
}

async function text(pathname: string): Promise<string> {
  const value = await response(pathname);
  expect(value.status).toBe(200);
  return value.text();
}

test("contends through two WAL owners while rolling back each probe", async () => {
  expect(await text("/sqlite-wal/setup/0")).toBe("ready");
  expect(await text("/sqlite-wal/setup/1")).toBe("ready");
  expect(await (await response("/sqlite-wal/journal")).json()).toEqual({
    journal: {journal_mode: "wal"},
  });

  const requests = Array.from(
    {length: 32},
    (_, index) => text(`/sqlite-wal/${index % 2}`),
  );
  expect(await Promise.all(requests)).toEqual(Array(32).fill("committed"));
  expect(await (await response("/sqlite-wal/state")).json()).toEqual({
    state: {committed: 32, rolledBack: 0},
  });
  expect(existsSync(database)).toBe(true);
  expect(existsSync(`${database}-wal`)).toBe(true);
  expect(existsSync(`${database}-shm`)).toBe(true);
});
