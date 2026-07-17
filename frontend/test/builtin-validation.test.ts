import assert from "node:assert/strict";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {after, test} from "node:test";
import {fileURLToPath} from "node:url";
import {CompileFailure} from "../src/diagnostics.js";
import {compileEntry} from "../src/program.js";

const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-builtins-"));
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sdkPath = path.join(repository, "sdk/index.d.ts");

after(() => rmSync(directory, {recursive: true, force: true}));

test("uses a stable diagnostic for invalid environment input", () => {
  expectCode(`
    import {get} from "tinytsx:env";
    get("not portable");
    export function GET(): Response { return Response.text("ok"); }
  `, "TINY1504");
});

test("uses a stable diagnostic for an exceeded filesystem limit", () => {
  expectCode(`
    import {readTextFile} from "tinytsx:fs";
    readTextFile("asset.txt", {maxBytes: 1048577});
    export function GET(): Response { return Response.text("ok"); }
  `, "TINY1504", {allowedReadRoots: [directory]});
});

test("uses stable diagnostics for unsupported SQLite operations and limits", () => {
  expectCode(`
    import {Database} from "tinytsx:sqlite";
    const database = new Database(":memory:");
    database.migrate();
    export function GET(): Response { return Response.text("ok"); }
  `, "TINY1512");

  expectCode(`
    import {Database} from "tinytsx:sqlite";
    const database = new Database(":memory:");
    const statement = database.prepare("SELECT ?1");
    statement.run([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    export function GET(): Response { return Response.text("ok"); }
  `, "TINY1512");
});

test("uses stable diagnostics for unsupported actor configuration and calls", () => {
  expectCode(`
    import {spawn} from "tinytsx:actors";
    const counter = spawn((context, delta: number) => {
      context.state += delta;
      return String(context.state);
    }, 0, {mailboxCapacity: 65});
    export function GET(): Response { return Response.text("ok"); }
  `, "TINY1520");

  expectCode(`
    import {spawn} from "tinytsx:actors";
    spawn((context, delta: number) => {
      context.state += delta;
      return String(context.state);
    }, 0, {restart: {maxRestarts: 2, withinMs: 1000}});
    export function GET(): Response { return Response.text("ok"); }
  `, "TINY1520");

  expectCode(`
    import {spawn} from "tinytsx:actors";
    import {Database} from "tinytsx:sqlite";
    const database = new Database(":memory:");
    spawn((context, delta: number) => {
      if (delta === 99) throw Error("failure");
      context.state += delta;
      return String(context.state);
    }, 0, {
      restart: {maxRestarts: 2, withinMs: 1000},
      persistence: {database, key: "counter"},
    });
    export function GET(): Response { return Response.text("ok"); }
  `, "TINY1520");

  expectCode(`
    import {spawn} from "tinytsx:actors";
    spawn((context, delta: number) => {
      if (delta === 99) throw Error("failure");
      context.state += delta;
      return String(context.state);
    }, 0);
    export function GET(): Response { return Response.text("ok"); }
  `, "TINY1520");

  expectCode(`
    import {spawn} from "tinytsx:actors";
    spawn((context, delta: number) => {
      if (delta === 99) throw Error("failure");
      context.state += delta;
      return String(context.state);
    }, 0, {restart: {maxRestarts: 17, withinMs: 1000}});
    export function GET(): Response { return Response.text("ok"); }
  `, "TINY1520");

  expectCode(`
    import {spawn} from "tinytsx:actors";
    const counter = spawn((context, delta: number) => {
      context.state += delta;
      return String(context.state);
    }, 0);
    counter.restart();
    export function GET(): Response { return Response.text("ok"); }
  `, "TINY1521");

  expectCode(`
    import {spawn} from "tinytsx:actors";
    const counter = spawn((context, delta: number) => String(context.state += delta), 0);
    const options = {timeoutMs: 25};
    counter.ask(1, options);
    export function GET(): Response { return Response.text("ok"); }
  `, "TINY1521");

  expectCode(`
    import {spawn} from "tinytsx:actors";
    const counter = spawn((context, delta: number) => String(context.state += delta), 0);
    counter.ask(1, {timeoutMs: 25, signal: null});
    export function GET(): Response { return Response.text("ok"); }
  `, "TINY1521");

  expectCode(`
    import {spawn} from "tinytsx:actors";
    const counter = spawn((context, delta: number) => {
      context.state += delta;
      return String(context.state);
    }, 0);
    counter.ask(1, {timeoutMs: 0});
    export function GET(): Response { return Response.text("ok"); }
  `, "TINY1521");

  expectCode(`
    import {spawn} from "tinytsx:actors";
    const counter = spawn((context, delta: number) => {
      context.state += delta;
      return String(context.state);
    }, 0);
    counter.ask(1, {timeoutMs: 60001});
    export function GET(): Response { return Response.text("ok"); }
  `, "TINY1521");

  expectCode(`
    import {spawn} from "tinytsx:actors";
    const mailbox = spawn((context, message: readonly number[]) => {
      context.state = message;
      return JSON.stringify(context.state);
    }, [${Array.from({length: 65}, (_, index) => index).join(", ")}]);
    export function GET(): Response { return Response.text("ok"); }
  `, "TINY1520");

  expectCode(`
    import {spawn} from "tinytsx:actors";
    const mailbox = spawn((context, message: string) => {
      context.state = message;
      return JSON.stringify(context.state);
    }, "idle");
    function send(message: string): void { mailbox.ask(message); }
    export function GET(): Response { return Response.text("ok"); }
  `, "TINY1521");

  expectCode(`
    import {spawn} from "tinytsx:actors";
    const mailbox = spawn((context, message: string) => {
      context.state = message;
      return JSON.stringify(context.state);
    }, "${"x".repeat(1_025)}");
    export function GET(): Response { return Response.text("ok"); }
  `, "TINY1520");
});

function expectCode(
  source: string,
  code: string,
  options: {allowedReadRoots?: string[]} = {},
): void {
  const entry = path.join(directory, `${crypto.randomUUID()}.ts`);
  writeFileSync(entry, source);
  assert.throws(
    () => compileEntry(entry, {sdkPath, ...options}),
    (error: unknown) => error instanceof CompileFailure
      && error.diagnostics.some(diagnostic => diagnostic.code === code),
  );
}
