import assert from "node:assert/strict";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {after, test} from "node:test";
import {fileURLToPath} from "node:url";
import {CompileFailure} from "../src/diagnostics.js";
import {compileEntry} from "../src/program.js";

const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-sqlite-readonly-"));
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sdkPath = path.join(repository, "sdk/index.d.ts");
const aliases = {hono: path.join(repository, "vendor/hono/src/index.ts")};
const apiAliases = {hono: path.join(repository, "tests/compat/hono/api.d.ts")};

after(() => rmSync(directory, {recursive: true, force: true}));

test("lowers a declared read-only SQLite binding to a named database", () => {
  const entry = write(`
    import {Hono} from "hono";
    import {openReadonlyDatabase} from "tinytsx:sqlite";

    const database = openReadonlyDatabase("AIR_DB");
    const readings = database.prepare("SELECT value FROM readings ORDER BY value");
    const app = new Hono();
    app.get("/readings", async context => context.json({readings: await readings.all()}));
    export default app;
  `);

  const hir = compileEntry(entry, {
    sdkPath,
    aliases,
    apiAliases,
    sqliteReadonlyBindings: new Set(["AIR_DB"]),
  });

  assert.deepEqual(hir.sqliteDatabases, [{id: 0, binding: "AIR_DB", readonly: true}]);
  assert.match(JSON.stringify(hir.handlers[0]?.response), /sqliteQuery/);
});

test("lowers a bounded Hono query parameter into a read-only SQLite query", () => {
  const entry = write(`
    import {Hono} from "hono";
    import {openReadonlyDatabase} from "tinytsx:sqlite";

    const database = openReadonlyDatabase("AIR_DB");
    const history = database.prepare(
      "SELECT recorded_at, co2 FROM readings WHERE recorded_at >= CAST(?1 AS INTEGER) ORDER BY recorded_at LIMIT 256",
    );
    const app = new Hono();
    app.get("/history", async context => {
      return context.json({readings: await history.all([context.req.query("since") ?? "0"])});
    });
    export default app;
  `);

  const hir = compileEntry(entry, {
    sdkPath,
    aliases,
    apiAliases,
    sqliteReadonlyBindings: new Set(["AIR_DB"]),
  });

  const response = hir.handlers.find(handler => handler.path === "/history")?.response;
  assert.match(JSON.stringify(response), /"kind":"sqliteQuery"/);
  assert.match(JSON.stringify(response),
    /"parameters":\[\{"kind":"queryParameter","string":\d+,"queryLength":5,"fallbackLength":1\}\]/);
});

test("rejects missing bindings and mutation through a read-only database", () => {
  const missing = write(`
    import {openReadonlyDatabase} from "tinytsx:sqlite";
    openReadonlyDatabase("AIR_DB");
    export function GET(): Response { return Response.text("ok"); }
  `);
  assert.throws(
    () => compileEntry(missing, {sdkPath}),
    (error: unknown) => error instanceof CompileFailure
      && error.diagnostics.some(diagnostic => diagnostic.code === "TINY1513"),
  );

  const mutation = write(`
    import {openReadonlyDatabase} from "tinytsx:sqlite";
    const database = openReadonlyDatabase("AIR_DB");
    database.exec("DELETE FROM readings");
    export function GET(): Response { return Response.text("ok"); }
  `);
  assert.throws(
    () => compileEntry(mutation, {sdkPath, sqliteReadonlyBindings: new Set(["AIR_DB"])}),
    (error: unknown) => error instanceof CompileFailure
      && error.diagnostics.some(diagnostic => diagnostic.code === "TINY1512"),
  );
});

function write(source: string): string {
  const entry = path.join(directory, `${crypto.randomUUID()}.ts`);
  writeFileSync(entry, source);
  return entry;
}
