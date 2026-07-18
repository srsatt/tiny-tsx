import assert from "node:assert/strict";
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {after, test} from "node:test";
import {fileURLToPath} from "node:url";
import ts from "typescript";
import {analyzeApplicationEntry} from "../src/application-entry.js";
import {
  evaluateApplicationConstructor,
  evaluateApplicationInitialization,
} from "../src/constructor-evaluator.js";
import {auditCompatibility} from "../src/compatibility-audit.js";
import {CompileFailure} from "../src/diagnostics.js";
import {loadModuleGraph} from "../src/module-graph.js";
import {compileEntry} from "../src/program.js";
import {resolveRuntimeClassPlan} from "../src/runtime-class-plan.js";

const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-compat-"));
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

after(() => rmSync(directory, {recursive: true, force: true}));

test("loads runtime imports transitively while skipping type-only imports", () => {
  const entry = write("entry.ts", `
    import {value} from "./value";
    import type {OnlyType} from "./types";
    export const result: OnlyType = value;
  `);
  const value = write("value.ts", "export const value = 1;");
  write("types.ts", "export type OnlyType = number;");

  const graph = loadModuleGraph(entry);

  assert.deepEqual(graph.diagnostics, []);
  assert.deepEqual(graph.modules.map(module => module.path), [entry, value]);
  assert.deepEqual(graph.modules[0]?.dependencies, [value]);
});

test("reports unresolved runtime imports without discarding the graph", () => {
  const entry = write("missing.ts", 'import {missing} from "not-installed";\nexport {missing};');

  const graph = loadModuleGraph(entry);

  assert.equal(graph.modules.length, 1);
  assert.equal(graph.diagnostics[0]?.code, "TINY2002");
  assert.match(graph.diagnostics[0]?.message ?? "", /not-installed/);
});

test("resolves scoped bare packages, export conditions, and wildcard subpaths", () => {
  const project = path.join(directory, crypto.randomUUID());
  const packageRoot = path.join(project, "node_modules/@example/runtime");
  mkdirSync(path.join(packageRoot, "src/features"), {recursive: true});
  writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({
    name: "@example/runtime",
    exports: {
      ".": {types: "./src/index.d.ts", import: "./src/index.js"},
      "./features/*": {import: "./src/features/*.js"},
    },
  }));
  const runtime = path.join(packageRoot, "src/index.ts");
  const feature = path.join(packageRoot, "src/features/hello.ts");
  writeFileSync(runtime, 'export const runtime = "package";');
  writeFileSync(feature, 'export const feature = "hello";');
  const entry = path.join(project, "entry.ts");
  writeFileSync(entry, `
    import {runtime} from "@example/runtime";
    import {feature} from "@example/runtime/features/hello";
    export const result = runtime + feature;
  `);

  const graph = loadModuleGraph(entry);

  assert.deepEqual(graph.diagnostics, []);
  assert.deepEqual(graph.modules.map(module => module.path), [entry, runtime, feature]);
});

test("resolves protected built-ins before aliases and node_modules packages", () => {
  const project = path.join(directory, crypto.randomUUID());
  const packageRoot = path.join(project, "node_modules/@hono/node-server");
  mkdirSync(packageRoot, {recursive: true});
  writeFileSync(path.join(packageRoot, "package.json"), JSON.stringify({
    name: "@hono/node-server",
    exports: "./index.js",
  }));
  writeFileSync(path.join(packageRoot, "index.js"), 'export const serve = "package";');
  const alias = path.join(project, "alias.ts");
  const builtin = path.join(project, "builtin.ts");
  writeFileSync(alias, 'export const serve = "alias";');
  writeFileSync(builtin, 'export const serve = "builtin";');
  const entry = path.join(project, "entry.ts");
  writeFileSync(entry, 'import {serve} from "@hono/node-server"; export {serve};');

  const graph = loadModuleGraph(entry, {
    aliases: {"@hono/node-server": alias},
    builtins: {"@hono/node-server": builtin},
  });

  assert.deepEqual(graph.diagnostics, []);
  assert.deepEqual(graph.modules.map(module => module.path), [entry, builtin]);
});

test("resolves every backend standard-library module from the shipped SDK", () => {
  const entry = write("builtins-entry.ts", `
    import {get} from "tinytsx:env";
    import {readTextFile} from "tinytsx:fs";
    import {Database} from "tinytsx:sqlite";
    import {spawn} from "tinytsx:actors";
    export function GET(_request: Request): Response { return Response.text("builtins"); }
  `);

  const hir = compileEntry(entry, {sdkPath: path.join(repository, "sdk/index.d.ts")});

  assert.deepEqual(
    hir.modules
      .map(module => path.relative(repository, module.path))
      .filter(module => module.startsWith("sdk/builtins/")),
    [
      "sdk/builtins/env.ts",
      "sdk/builtins/fs.ts",
      "sdk/builtins/sqlite.ts",
      "sdk/builtins/actors.ts",
    ],
  );
});

test("lowers a bounded in-memory SQLite owner and effects", () => {
  const entry = write("sqlite-effects.ts", `
    import {Database} from "tinytsx:sqlite";
    import {serve} from "tinytsx:serve";
    import {Hono} from "hono";
    const database = new Database(":memory:");
    const posts = database.prepare("SELECT title FROM posts");
    const post = database.prepare("SELECT title FROM posts WHERE title = ?1");
    const deletePost = database.prepare("DELETE FROM posts WHERE title = ?1");
    const createPost = database.prepare("INSERT INTO posts (id, title, body) VALUES (?1, ?2, ?3)");
    const updatePost = database.prepare("UPDATE posts SET body = ?1 WHERE title = ?2");
    const app = new Hono();
    app.post("/schema", async context => {
      await database.exec("CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)");
      return context.text("ready");
    });
    app.post("/close", context => {
      database.close();
      return context.text("closed");
    });
    app.get("/posts", async context => context.json({posts: await posts.all()}));
    app.get("/posts/:title", async context => {
      const selected = await post.get([context.req.param("title")]);
      if (!selected) return context.json({error: "Not Found", ok: false}, 404);
      return context.json({post: selected, ok: true});
    });
    app.delete("/posts/:title", async context => {
      await deletePost.run([context.req.param("title")]);
      return context.text("deleted");
    });
    app.post("/posts", async context => {
      const input = await context.req.json() as {title: string; body: string};
      const id = crypto.randomUUID();
      await createPost.run([id, input.title, input.body]);
      return context.text("created", 201);
    });
    app.put("/posts/:title", async context => {
      const input = await context.req.json() as {body: string};
      await updatePost.run([input.body, context.req.param("title")]);
      return context.text("updated");
    });
    serve({fetch: app.fetch});
  `);

  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  });

  assert.deepEqual(hir.sqliteDatabases, [{id: 0, path: ":memory:"}]);
  assert.deepEqual(hir.handlers[0]?.sqliteActions, [{kind: "exec", database: 0, sql: 1}]);
  assert.equal(hir.staticStrings[1]?.value, "CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT)");
  assert.deepEqual(hir.handlers[1]?.sqliteActions, [{kind: "close", database: 0}]);
  assert.deepEqual(
    hir.handlers[2]?.response.kind === "text" ? hir.handlers[2].response.value : undefined,
    {
      kind: "concat",
      values: [
        {kind: "stringLiteral", string: 3, span: hir.handlers[2]?.span},
        {kind: "sqliteQuery", database: 0, sql: 4, mode: "all", parameters: [], span: hir.handlers[2]?.span},
        {kind: "stringLiteral", string: 5, span: hir.handlers[2]?.span},
      ],
      span: hir.handlers[2]?.span,
    },
  );
  assert.deepEqual(
    hir.handlers[3]?.sqliteExistence?.parameters,
    [{kind: "routeParameter", segment: 1}],
  );
  assert.equal(hir.handlers[3]?.sqliteExistence?.database, 0);
  assert.equal(hir.staticStrings[hir.handlers[3]?.sqliteExistence?.sql ?? -1]?.value,
    "SELECT title FROM posts WHERE title = ?1");
  assert.equal(hir.handlers[3]?.sqliteExistence?.missing.response.kind === "text"
    ? hir.handlers[3].sqliteExistence.missing.response.status
    : undefined, 404);
  assert.deepEqual(hir.handlers[4]?.sqliteActions?.[0]?.kind === "exec"
    ? hir.handlers[4].sqliteActions[0].parameters
    : undefined, [{kind: "routeParameter", segment: 1}]);
  const jsonParameters = hir.handlers[5]?.sqliteActions?.[0]?.kind === "exec"
    ? hir.handlers[5].sqliteActions[0].parameters
    : undefined;
  assert.deepEqual(jsonParameters?.map(parameter => parameter.kind === "requestJsonField"
    ? hir.staticStrings[parameter.field]?.value
    : parameter.kind), ["randomUuid", "title", "body"]);
  assert.equal(hir.handlers[4]?.method, "DELETE");
  assert.equal(hir.handlers[6]?.method, "PUT");
  const updateParameters = hir.handlers[6]?.sqliteActions?.[0]?.kind === "exec"
    ? hir.handlers[6].sqliteActions[0].parameters
    : undefined;
  assert.deepEqual(updateParameters?.map(parameter => parameter.kind === "requestJsonField"
    ? hir.staticStrings[parameter.field]?.value
    : parameter.kind), ["body", "routeParameter"]);
});

test("lowers closed primitive SQLite parameters without a dynamic object model", () => {
  const entry = write("sqlite-primitives.ts", `
    import {Database} from "tinytsx:sqlite";
    import {serve} from "tinytsx:serve";
    import {Hono} from "hono";
    const database = new Database(":memory:");
    const insert = database.prepare(
      "INSERT INTO values_table (text, integer, real, enabled, missing) VALUES (?1, ?2, ?3, ?4, ?5)",
    );
    const app = new Hono();
    app.post("/values", async context => {
      await insert.run(["admin", -42, 1.5, true, null]);
      return context.text("created", 201);
    });
    serve({fetch: app.fetch});
  `);

  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  });
  const parameters = hir.handlers[0]?.sqliteActions?.[0]?.kind === "exec"
    ? hir.handlers[0].sqliteActions[0].parameters
    : undefined;
  assert.deepEqual(parameters, [
    {kind: "staticString", string: 2},
    {kind: "staticInteger", value: -42},
    {kind: "staticReal", value: 1.5},
    {kind: "staticBoolean", value: true},
    {kind: "null"},
  ]);
  assert.equal(hir.staticStrings[2]?.value, "admin");
});

test("lowers typed SQLite run results into one serialized owner action", () => {
  const entry = write("sqlite-run-result.ts", `
    import {Database} from "tinytsx:sqlite";
    import {serve} from "tinytsx:serve";
    import {Hono} from "hono";
    const database = new Database(":memory:");
    const insert = database.prepare("INSERT INTO events (name) VALUES (?1)");
    const app = new Hono();
    app.post("/events", async context => {
      const result = await insert.run(["admin"]);
      return context.json(result, 201);
    });
    serve({fetch: app.fetch});
  `);

  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  });
  const handler = hir.handlers[0];
  const action = handler?.sqliteActions?.[0];
  assert.equal(action?.kind, "exec");
  if (action?.kind !== "exec") return;
  assert.equal(action.database, 0);
  assert.equal(action.result, 0);
  assert.equal(hir.staticStrings[action.sql]?.value, "INSERT INTO events (name) VALUES (?1)");
  assert.equal(
    action.parameters?.[0]?.kind === "staticString"
      ? hir.staticStrings[action.parameters[0].string]?.value
      : undefined,
    "admin",
  );
  assert.equal(handler?.response.kind, "text");
  const value = handler?.response.kind === "text" ? handler.response.value : undefined;
  assert.equal(value?.kind, "concat");
  if (value?.kind !== "concat") return;
  assert.deepEqual(value.values.map(part => part.kind), [
    "stringLiteral",
    "sqliteRunChanges",
    "stringLiteral",
    "sqliteRunLastInsertRowId",
    "stringLiteral",
  ]);
  assert.equal(value.values[1]?.kind === "sqliteRunChanges" ? value.values[1].result : -1, 0);
  assert.equal(
    value.values[3]?.kind === "sqliteRunLastInsertRowId" ? value.values[3].result : -1,
    0,
  );
});

test("lowers a bounded prepared transaction callback into one owner action", () => {
  const entry = write("sqlite-transaction-callback.ts", `
    import {Database} from "tinytsx:sqlite";
    import {serve} from "tinytsx:serve";
    import {Hono} from "hono";
    const database = new Database(":memory:");
    const insertItem = database.prepare("INSERT INTO items (id, value) VALUES (?1, ?2)");
    const insertAudit = database.prepare("INSERT INTO audit (id) VALUES (?1)");
    const app = new Hono();
    app.post("/transaction/:id", async context => {
      const input = await context.req.json() as {value: string};
      await database.transaction(async () => {
        await insertItem.run([context.req.param("id"), input.value]);
        await insertAudit.run([context.req.param("id")]);
      });
      return context.json({ok: true});
    });
    serve({fetch: app.fetch});
  `);

  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  });
  const action = hir.handlers[0]?.sqliteActions?.[0];
  assert.equal(action?.kind, "transactionSteps");
  if (action?.kind !== "transactionSteps") return;
  assert.equal(action.database, 0);
  assert.equal(action.steps.length, 2);
  assert.equal(
    hir.staticStrings[action.steps[0]!.sql]?.value,
    "INSERT INTO items (id, value) VALUES (?1, ?2)",
  );
  assert.deepEqual(action.steps[0]!.parameters.map(parameter => parameter.kind), [
    "routeParameter",
    "requestJsonField",
  ]);
  assert.equal(hir.staticStrings[action.steps[1]!.sql]?.value, "INSERT INTO audit (id) VALUES (?1)");
  assert.deepEqual(action.steps[1]!.parameters, [{kind: "routeParameter", segment: 1}]);
});

test("lowers selected request JSON primitives into a dynamic JSON response", () => {
  const entry = write("hono-json-body.ts", `
    import {serve} from "tinytsx:serve";
    import {Hono} from "hono";
    const app = new Hono();
    app.post("/json-body", async context => {
      const input = await context.req.json() as {
        name: string;
        count: number;
        enabled: boolean;
        note: null;
      };
      return context.json({
        name: input.name,
        count: input.count,
        enabled: input.enabled,
        note: input.note,
      });
    });
    serve({fetch: app.fetch});
  `);

  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  });
  const response = hir.handlers[0]?.response;
  assert.equal(response?.kind, "text");
  if (response?.kind !== "text" || response.value.kind !== "concat") return;
  assert.deepEqual(response.value.values.map(value => {
    if (value.kind === "stringLiteral") return hir.staticStrings[value.string]?.value;
    if (value.kind === "requestJsonField") return hir.staticStrings[value.field]?.value;
    return value.kind;
  }), [
    '{"name":',
    "name",
    ',"count":',
    "count",
    ',"enabled":',
    "enabled",
    ',"note":',
    "note",
    "}",
  ]);
});

test("requires matching read/write capabilities for an on-disk SQLite owner", () => {
  const entry = write("sqlite-disk.ts", `
    import {Database} from "tinytsx:sqlite";
    import {serve} from "tinytsx:serve";
    import {Hono} from "hono";
    const database = new Database("state.db");
    const app = new Hono();
    app.post("/schema", async context => {
      await database.exec("CREATE TABLE IF NOT EXISTS values_table (value TEXT)");
      return context.text("ready");
    });
    serve({fetch: app.fetch});
  `);
  const compile = (allowedWriteRoots: string[]) => compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
    allowedReadRoots: [directory],
    allowedWriteRoots,
  });

  assert.throws(
    () => compile([]),
    (error: unknown) => error instanceof CompileFailure
      && error.diagnostics.some(diagnostic => diagnostic.code === "TINY1511"),
  );
  assert.deepEqual(compile([directory]).sqliteDatabases, [{
    id: 0,
    path: path.join(directory, "state.db"),
  }]);
});

test("lowers two independent SQLite owners for one WAL file", () => {
  const hir = compileEntry(path.join(repository, "benchmarks/tiny/hono-sqlite-wal.ts"), {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
    allowedReadRoots: [directory],
    allowedWriteRoots: [directory],
  });

  assert.deepEqual(hir.sqliteDatabases, [
    {id: 0, path: path.join(directory, "wal-load.db")},
    {id: 1, path: path.join(directory, "wal-load.db")},
  ]);
  const first = hir.handlers.find(handler => handler.path === "/sqlite-wal/0");
  const second = hir.handlers.find(handler => handler.path === "/sqlite-wal/1");
  assert.equal(first?.sqliteActions?.[0]?.kind, "transaction");
  assert.equal(first?.sqliteActions?.[0]?.database, 0);
  assert.equal(second?.sqliteActions?.[0]?.kind, "transaction");
  assert.equal(second?.sqliteActions?.[0]?.database, 1);
  const action = first?.sqliteActions?.[0];
  assert.match(
    action?.kind === "transaction" ? hir.staticStrings[action.sql]?.value ?? "" : "",
    /SAVEPOINT rollback_probe.*ROLLBACK TO rollback_probe.*UPDATE benchmark_state/s,
  );
});

test("requires an explicit read root for filesystem access", () => {
  const entry = write("fs-capability.ts", `
    import {readTextFile} from "tinytsx:fs";
    import {serve} from "tinytsx:serve";
    import {Hono} from "hono";
    const app = new Hono();
    app.get("/", async context => context.text(await readTextFile("asset.txt")));
    serve({fetch: app.fetch});
  `);
  assert.throws(
    () => compileEntry(entry, {
      sdkPath: path.join(repository, "sdk/index.d.ts"),
      aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
      apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
    }),
    (error: unknown) => error instanceof CompileFailure
      && error.diagnostics.some(diagnostic => diagnostic.code === "TINY1502"
        && diagnostic.message.includes("asset.txt")),
  );
});

test("lowers a permitted bounded file read through Hono", () => {
  const entry = write("fs-lowering.ts", `
    import {readTextFile} from "tinytsx:fs";
    import {serve} from "tinytsx:serve";
    import {Hono} from "hono";
    const app = new Hono();
    app.get("/asset", async context => context.text(
      await readTextFile("asset.txt", {maxBytes: 32})
    ));
    serve({fetch: app.fetch});
  `);

  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    allowedReadRoots: [directory],
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  });
  assert.deepEqual(hir.handlers[0]?.response.kind === "text"
    ? hir.handlers[0].response.value
    : undefined, {
    kind: "concat",
    values: [{kind: "fileText", path: 0, maxBytes: 32, span: hir.handlers[0]?.span}],
    span: hir.handlers[0]?.span,
  });
  assert.equal(hir.staticStrings[0]?.value, "asset.txt");
});

test("lowers a bounded counter actor with ask, tell, and stop", () => {
  const entry = write("actor-lowering.ts", `
    import {spawn} from "tinytsx:actors";
    import {serve} from "tinytsx:serve";
    import {Hono} from "hono";
    const counter = spawn((context, delta: number) => {
      context.state += delta;
      return String(context.state);
    }, 0);
    const app = new Hono();
    app.get("/ask", async context => context.text(await counter.ask(1, {timeoutMs: 25})));
    app.get("/tell", context => {
      counter.tell(2);
      return context.text("queued");
    });
    app.get("/stop", context => {
      counter.stop();
      return context.text("stopped");
    });
    serve({fetch: app.fetch});
  `);

  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  });
  assert.deepEqual(hir.actors, [{
    id: 0,
    operation: "counter",
    initialState: 0,
    mailboxCapacity: 64,
  }]);
  assert.deepEqual(hir.handlers[0]?.response.kind === "text"
    ? hir.handlers[0].response.value
    : undefined, {
    kind: "concat",
    values: [{kind: "actorCall", actor: 0, message: 1, timeoutMs: 25, span: hir.handlers[0]?.span}],
    span: hir.handlers[0]?.span,
  });
  assert.deepEqual(hir.handlers[1]?.actorActions, [{kind: "tell", actor: 0, message: 2}]);
  assert.deepEqual(hir.handlers[2]?.actorActions, [{kind: "stop", actor: 0}]);
});

test("lowers a bounded fallible counter restart policy", () => {
  const entry = path.join(repository, "examples/hono-actors/restart.ts");
  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  });

  assert.deepEqual(hir.actors, [{
    id: 0,
    operation: "fallibleCounter",
    initialState: 0,
    mailboxCapacity: 64,
    failureMessage: 99,
    restart: {maxRestarts: 2, withinMs: 60_000},
  }]);
  assert.deepEqual(hir.handlers.map(handler => {
    const response = handler.response.kind === "text" ? handler.response.value : undefined;
    const call = response?.kind === "concat" ? response.values[0] : undefined;
    return call?.kind === "actorCall" ? call.message : undefined;
  }), [0, 1, 99]);
});

test("lowers bounded primitive array and record actor messages", () => {
  const entry = path.join(repository, "examples/hono-actors/messages.ts");
  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  });

  assert.deepEqual(hir.actors.map(actor => ({
    operation: actor.operation,
    initial: actor.initialJson === undefined ? undefined : hir.staticStrings[actor.initialJson]?.value,
    mailboxCapacity: actor.mailboxCapacity,
  })), [
    {operation: "jsonMailbox", initial: '"idle"', mailboxCapacity: 64},
    {operation: "jsonMailbox", initial: '["idle"]', mailboxCapacity: 64},
    {operation: "jsonMailbox", initial: '{"status":"idle","tags":[]}', mailboxCapacity: 64},
  ]);
  assert.deepEqual(hir.handlers.map(handler => {
    const response = handler.response.kind === "text" ? handler.response.value : undefined;
    const call = response?.kind === "concat" ? response.values[0] : undefined;
    return call?.kind === "actorCall" && call.jsonMessage !== undefined
      ? hir.staticStrings[call.jsonMessage]?.value
      : undefined;
  }), [
    '"ready"',
    '["ready","warm"]',
    undefined,
    '{"status":"ready","tags":["one","two"]}',
  ]);
  assert.deepEqual(hir.handlers[2]?.actorActions?.map(action => action.kind === "tell"
    && action.jsonMessage !== undefined
    ? hir.staticStrings[action.jsonMessage]?.value
    : undefined), ['{"status":"queued","tags":["fire-and-forget"]}']);
  assert.ok(hir.memory.summary.message >= 4);
});

test("binds a counter actor to a capability-scoped SQLite owner", () => {
  const entry = write("persistent-actor-lowering.ts", `
    import {spawn} from "tinytsx:actors";
    import {Database} from "tinytsx:sqlite";
    import {serve} from "tinytsx:serve";
    import {Hono} from "hono";
    const database = new Database("actors.db");
    const counter = spawn((context, delta: number) => {
      context.state += delta;
      return String(context.state);
    }, 7, {persistence: {database, key: "counter"}});
    const app = new Hono();
    app.get("/", async context => context.text(await counter.ask(0)));
    serve({fetch: app.fetch});
  `);
  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
    allowedReadRoots: [directory],
    allowedWriteRoots: [directory],
  });

  assert.deepEqual(hir.actors, [{
    id: 0,
    operation: "counter",
    initialState: 7,
    mailboxCapacity: 64,
    persistence: {database: 0, key: "counter"},
  }]);
  assert.deepEqual(hir.sqliteDatabases, [{id: 0, path: path.join(directory, "actors.db")}]);
});

test("requires explicit environment capabilities before lowering", () => {
  const entry = write("env-capability.ts", `
    import {get} from "tinytsx:env";
    import {serve} from "tinytsx:serve";
    serve({fetch: () => new Response(get("APP_NAME") ?? "missing")});
  `);
  assert.throws(
    () => compileEntry(entry, {sdkPath: path.join(repository, "sdk/index.d.ts")}),
    (error: unknown) => error instanceof CompileFailure
      && error.diagnostics.some(diagnostic => diagnostic.code === "TINY1501"
        && diagnostic.message.includes("APP_NAME")),
  );
});

test("lowers permitted environment access with a closed fallback", () => {
  const entry = write("env-lowering.ts", `
    import {get} from "tinytsx:env";
    import {serve} from "tinytsx:serve";
    import {Hono} from "hono";
    const app = new Hono();
    app.get("/", context => context.text(get("APP_NAME") ?? "missing"));
    serve({fetch: app.fetch});
  `);

  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    allowedEnvironment: new Set(["APP_NAME"]),
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  });
  assert.deepEqual(hir.handlers[0]?.response, {
    kind: "text",
    value: {
      kind: "concat",
      values: [{
        kind: "environmentVariable",
        name: 0,
        required: false,
        fallback: 1,
        span: hir.handlers[0]?.span,
      }],
      span: hir.handlers[0]?.span,
    },
    contentType: "text/plain;charset=UTF-8",
  });
  assert.deepEqual(hir.staticStrings.map(value => value.value), ["APP_NAME", "missing"]);
});

test("maps typed Hono bindings to required environment capabilities", () => {
  const entry = write("hono-env-binding.ts", `
    import {serve} from "tinytsx:serve";
    import {Hono} from "hono";
    type Bindings = { APP_NAME: string };
    const app = new Hono<{Bindings: Bindings}>();
    app.get("/", context => context.text(context.env.APP_NAME));
    serve({fetch: app.fetch});
  `);
  const options = {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  };

  assert.throws(
    () => compileEntry(entry, options),
    (error: unknown) => error instanceof CompileFailure
      && error.diagnostics.some(diagnostic => diagnostic.code === "TINY1501"
        && diagnostic.message.includes("APP_NAME")),
  );
  const hir = compileEntry(entry, {
    ...options,
    allowedEnvironment: new Set(["APP_NAME"]),
  });
  assert.deepEqual(hir.handlers[0]?.response.kind === "text"
    ? hir.handlers[0].response.value
    : undefined, {
    kind: "concat",
    values: [{
      kind: "environmentVariable",
      name: 0,
      required: true,
      span: hir.handlers[0]?.span,
    }],
    span: hir.handlers[0]?.span,
  });
  assert.equal(hir.staticStrings[0]?.value, "APP_NAME");
});

test("loads a compile-time-known Worker module without treating it as an import binding", () => {
  const entry = path.join(repository, "tests/compat/workers/hono-worker-smoke.ts");
  const graph = loadModuleGraph(entry, {
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
  });
  const worker = path.join(repository, "tests/compat/workers/uppercase.worker.ts");

  assert.deepEqual(graph.diagnostics, []);
  assert.ok(graph.modules.some(module => module.path === worker));
  assert.ok(graph.modules[0]?.dependencies.includes(worker));
  assert.ok(!graph.modules[0]?.runtimeImports.some(binding => binding.path === worker));
});

test("preserves an awaited Worker request as a request-time response value", () => {
  const entry = path.join(repository, "tests/compat/workers/hono-worker-smoke.ts");
  const worker = path.join(repository, "tests/compat/workers/uppercase.worker.ts");
  const graph = loadModuleGraph(entry, {
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
  });
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);

  const result = evaluateApplicationInitialization(graph, application);

  assert.deepEqual(result?.issues, []);
  assert.deepEqual(result?.routes.find(route => route.path === "/worker")?.response?.body, [{
    kind: "workerCall",
    module: worker,
    input: {kind: "queryParameter", name: "input", fallback: "hello worker"},
  }]);
});

test("lowers a static Worker module and request into typed HIR", () => {
  const entry = path.join(repository, "tests/compat/workers/hono-worker-smoke.ts");
  const worker = path.join(repository, "tests/compat/workers/uppercase.worker.ts");

  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  });

  assert.deepEqual(hir.workers, [{id: 0, module: worker, operation: "asciiUppercase"}]);
  assert.deepEqual(hir.handlers[0]?.response, {
    kind: "text",
    value: {
      kind: "concat",
      values: [{
        kind: "workerCall",
        worker: 0,
        input: {
          kind: "queryParameter",
          query: 0,
          fallback: 1,
          escapeHtml: false,
          span: hir.handlers[0]?.span,
        },
        span: hir.handlers[0]?.span,
      }],
      span: hir.handlers[0]?.span,
    },
    contentType: "text/plain;charset=UTF-8",
  });
  assert.deepEqual(hir.staticStrings.map(value => value.value), ["input", "hello worker"]);
});

test("audits the pinned hono/tiny runtime graph", () => {
  const report = auditCompatibility(path.join(repository, "tests/compat/hono/smoke.ts"), {
    root: repository,
    aliases: {"hono/tiny": path.join(repository, "vendor/hono/src/preset/tiny.ts")},
  });

  assert.deepEqual(report.diagnostics, []);
  assert.ok(report.statistics.modules >= 10);
  assert.ok(requirement(report, "classes") > 0);
  assert.ok(requirement(report, "functions-as-values") > 0);
  assert.ok(requirement(report, "loops") > 0);
  assert.ok(requirement(report, "regular-expressions") > 0);
  assert.ok(report.builtins.some(builtin => builtin.name === "Response"));
  assert.ok(report.staging.constantBindings > 0);
  assert.ok(report.staging.constantSpreads > 0);
  assert.ok(report.staging.runtimeSpreads > 0);
  assert.ok(report.staging.closedComputedAccesses > 0);
  assert.ok(report.staging.runtimeComputedAccesses > 0);
});

test("traces the pinned Hono basic application initialization root", () => {
  const file = path.join(repository, "tests/compat/hono/basic-smoke.ts");
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);

  const application = analyzeApplicationEntry(sourceFile);

  assert.equal(application?.binding, "app");
  assert.equal(application?.constructorName, "Hono");
  assert.deepEqual(application?.constructorArguments, []);
  assert.deepEqual(application?.calls.map(call => ({
    method: call.method,
    arguments: call.arguments.map(argument =>
      argument.kind === "string" ? [argument.kind, argument.value] : [argument.kind]
    ),
  })), [{method: "get", arguments: [["string", "/"], ["function"]]}]);
});

test("traces a TinyTSX serve call as the application root and source port", () => {
  const file = write("served-application.ts", `
    import {serve as start} from "tinytsx:serve";
    import {Hono} from "hono";
    const app = new Hono();
    app.get("/", context => context.text("served"));
    start({fetch: app.fetch, port: 8787});
  `);
  const sourceFile = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.ESNext,
    true,
    ts.ScriptKind.TS,
  );

  const application = analyzeApplicationEntry(sourceFile);

  assert.equal(application?.binding, "app");
  assert.deepEqual(application?.server, {port: 8787});
  assert.deepEqual(application?.calls.map(call => call.method), ["get"]);
});

test("lowers @hono/node-server serve without a default export", () => {
  const entry = write("hono-node-server.ts", `
    import {serve} from "@hono/node-server";
    import {Hono} from "hono";
    const app = new Hono();
    app.get("/", context => context.text("Hello Node-style Hono"));
    serve({fetch: app.fetch, port: 8788});
  `);

  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  });

  assert.deepEqual(hir.server, {port: 8788});
  assert.equal(hir.handlers[0]?.path, "/");
  assert.equal(hir.handlers[0]?.response.kind, "text");
  assert.ok(hir.modules.some(module => module.path.endsWith("sdk/builtins/serve.ts")));
});

test("resolves the pinned Hono constructor and base-class runtime sources", () => {
  const entry = path.join(repository, "tests/compat/hono/basic-smoke.ts");
  const graph = loadModuleGraph(entry, {
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
  });
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);

  const plan = resolveRuntimeClassPlan(graph, application);

  assert.deepEqual(plan?.classes.map(step => ({
    file: path.relative(repository, step.module),
    name: step.name,
    operations: step.operations,
  })), [
    {
      file: "vendor/hono/src/hono.ts",
      name: "Hono",
      operations: ["superCall", "assignment"],
    },
    {
      file: "vendor/hono/src/hono-base.ts",
      name: "Hono",
      operations: [
        "variable", "forEach", "assignment", "assignment", "variable", "call", "assignment",
      ],
    },
  ]);
});

test("symbolically executes the pinned Hono constructor chain", () => {
  const entry = path.join(repository, "tests/compat/hono/basic-smoke.ts");
  const graph = loadModuleGraph(entry, {
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
  });
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);

  const result = evaluateApplicationConstructor(graph, application);

  assert.deepEqual(result?.issues, []);
  assert.deepEqual(result?.fields.map(field => [field.name, field.kind, field.detail]), [
    ["_basePath", "string", "/"],
    ["#path", "string", "/"],
    ["routes", "array", undefined],
    ["#notFoundHandler", "reference", "notFoundHandler"],
    ["errorHandler", "reference", "errorHandler"],
    ["onError", "closure", undefined],
    ["notFound", "closure", undefined],
    ["fetch", "closure", undefined],
    ["request", "closure", undefined],
    ["fire", "closure", undefined],
    ...["get", "post", "put", "delete", "options", "patch", "all", "on", "use"]
      .map(name => [name, "closure", undefined]),
    ["getPath", "reference", "getPath"],
    ["router", "constructed", "SmartRouter"],
  ]);
});

test("executes the pinned Hono get registration through addRoute", () => {
  const entry = path.join(repository, "tests/compat/hono/basic-smoke.ts");
  const graph = loadModuleGraph(entry, {
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
  });
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);

  const result = evaluateApplicationInitialization(graph, application);

  assert.deepEqual(result?.issues, []);
  assert.deepEqual(result?.routes, [{
    method: "GET",
    path: "/",
    basePath: "/",
    handlerKind: "closure",
    response: {
      kind: "text",
      body: "Hono!!",
      status: 200,
      contentType: "text/plain;charset=UTF-8",
    },
  }]);
  assert.equal(result?.routerInsertions, 1);
});

test("preserves upstream mergePath semantics across two basic routes", () => {
  const entry = path.join(repository, "tests/compat/hono/multi-route-smoke.ts");
  const graph = loadModuleGraph(entry, {
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
  });
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);

  const result = evaluateApplicationInitialization(graph, application);

  assert.deepEqual(result?.issues, []);
  assert.deepEqual(result?.routes.map(route => ({
    method: route.method,
    path: route.path,
    body: route.response?.body,
  })), [
    {method: "GET", path: "/", body: "Hono!!"},
    {method: "GET", path: "/hello", body: "This is /hello"},
  ]);
  assert.equal(result?.routerInsertions, 2);

  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  });
  assert.deepEqual(hir.handlers.map(handler => ({
    method: handler.method,
    path: handler.path,
    body: handler.response.kind === "text"
      && handler.response.value.kind === "stringLiteral"
      ? hir.staticStrings[handler.response.value.string]?.value
      : undefined,
  })), [
    {method: "GET", path: "/", body: "Hono!!"},
    {method: "GET", path: "/hello", body: "This is /hello"},
  ]);
});

test("lowers a Hono named parameter into a request-time text expression", () => {
  const entry = path.join(repository, "tests/compat/hono/parameter-route-smoke.ts");
  const graph = loadModuleGraph(entry, {
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
  });
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);

  const result = evaluateApplicationInitialization(graph, application);

  assert.deepEqual(result?.issues, []);
  assert.deepEqual(result?.routes[0]?.response?.body, [
    {kind: "literal", value: "Your ID is "},
    {kind: "routeParameter", name: "id"},
  ]);

  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  });
  assert.deepEqual(hir.handlers[0]?.response, {
    kind: "text",
    value: {
      kind: "concat",
      values: [
        {kind: "stringLiteral", string: 0, span: hir.handlers[0]!.span},
        {kind: "routeParameter", name: "id", segment: 1, span: hir.handlers[0]!.span},
      ],
      span: hir.handlers[0]!.span,
    },
    contentType: "text/plain;charset=UTF-8",
  });
  assert.equal(hir.statistics.dynamicHtmlExpressions, 1);
});

test("expands trailing optional Hono parameters into finite native routes", () => {
  const entry = path.join(repository, "tests/compat/hono/optional-param-smoke.ts");
  const options = {
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  };
  const graph = loadModuleGraph(entry, options);
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);

  const result = evaluateApplicationInitialization(graph, application);
  assert.deepEqual(result?.issues, []);
  assert.deepEqual(result?.routes.map(route => ({
    path: route.path,
    body: route.response?.body,
  })), [
    {path: "/api/:version/animal", body: "{}"},
    {
      path: "/api/:version/animal/:type",
      body: [
        {kind: "literal", value: '{"type":"'},
        {kind: "routeParameter", name: "type"},
        {kind: "literal", value: '"}'},
      ],
    },
  ]);

  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    ...options,
  });
  assert.deepEqual(hir.handlers.map(handler => ({
    path: handler.path,
    value: handler.response.kind === "text" ? handler.response.value : undefined,
  })), [
    {
      path: "/api/:version/animal",
      value: {kind: "stringLiteral", string: 0, span: hir.handlers[0]!.span},
    },
    {
      path: "/api/:version/animal/:type",
      value: {
        kind: "concat",
        values: [
          {kind: "stringLiteral", string: 1, span: hir.handlers[1]!.span},
          {kind: "routeParameter", name: "type", segment: 3, span: hir.handlers[1]!.span},
          {kind: "stringLiteral", string: 2, span: hir.handlers[1]!.span},
        ],
        span: hir.handlers[1]!.span,
      },
    },
  ]);
});

test("lowers a terminal multi-segment Hono parameter", () => {
  const entry = path.join(repository, "tests/compat/hono/catch-all-param-smoke.ts");
  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  });

  assert.equal(hir.handlers[0]?.path, "/:remaining{.*}");
  const response = hir.handlers[0]?.response;
  assert.deepEqual(response?.kind === "text" ? response.value : undefined, {
    kind: "concat",
    values: [
      {kind: "stringLiteral", string: 0, span: hir.handlers[0]!.span},
      {
        kind: "routeParameter",
        name: "remaining",
        segment: 0,
        tail: true,
        span: hir.handlers[0]!.span,
      },
      {kind: "stringLiteral", string: 1, span: hir.handlers[0]!.span},
    ],
    span: hir.handlers[0]!.span,
  });
});

test("mounts a nested Hono application through upstream route semantics", () => {
  const entry = path.join(repository, "tests/compat/hono/nested-route-smoke.ts");
  const graph = loadModuleGraph(entry, {
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
  });
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);

  const result = evaluateApplicationInitialization(graph, application);

  assert.deepEqual(result?.issues, []);
  assert.deepEqual(result?.routes.map(route => ({
    method: route.method,
    path: route.path,
    basePath: route.basePath,
    body: route.response?.body,
  })), [
    {method: "GET", path: "/book", basePath: "/book", body: "List Books"},
    {
      method: "GET",
      path: "/book/:id",
      basePath: "/book",
      body: [
        {kind: "literal", value: "Get Book: "},
        {kind: "routeParameter", name: "id"},
      ],
    },
  ]);

  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  });
  assert.deepEqual(hir.handlers.map(handler => handler.path), ["/book", "/book/:id"]);
});

test("lowers a closed Hono POST route into method-aware HIR", () => {
  const entry = path.join(repository, "tests/compat/hono/post-route-smoke.ts");
  const graph = loadModuleGraph(entry, {
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
  });
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);

  const result = evaluateApplicationInitialization(graph, application);

  assert.deepEqual(result?.issues, []);
  assert.deepEqual(result?.routes.map(route => ({
    method: route.method,
    path: route.path,
    status: route.response?.status,
    body: route.response?.body,
  })), [{method: "POST", path: "/book", status: 200, body: "Create Book"}]);

  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  });
  assert.equal(hir.handlers[0]?.method, "POST");
  assert.equal(hir.handlers[0]?.path, "/book");
});

test("lowers Hono JSON serialization and status through Context newResponse", () => {
  const entry = path.join(repository, "tests/compat/hono/json-post-smoke.ts");
  const graph = loadModuleGraph(entry, {
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
  });
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);

  const result = evaluateApplicationInitialization(graph, application);

  assert.deepEqual(result?.issues, []);
  assert.deepEqual(result?.routes.find(route => route.method === "POST")?.response, {
    kind: "text",
    body: "{\"message\":\"Created!\"}",
    status: 201,
    contentType: "application/json",
  });

  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  });
  assert.equal(hir.handlers[0]?.method, "POST");
  assert.deepEqual(hir.handlers[0]?.response.kind === "text"
    ? {
      status: hir.handlers[0].response.status,
      contentType: hir.handlers[0].response.contentType,
    }
    : undefined, {status: 201, contentType: "application/json"});
});

test("lowers Hono's terminal wildcard API fallback with status 404", () => {
  const entry = path.join(repository, "tests/compat/hono/wildcard-route-smoke.ts");
  const graph = loadModuleGraph(entry, {
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
  });
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);

  const result = evaluateApplicationInitialization(graph, application);

  assert.deepEqual(result?.issues, []);
  assert.deepEqual(result?.routes[0]?.response, {
    kind: "text",
    body: "API endpoint is not found",
    status: 404,
    contentType: "text/plain; charset=UTF-8",
  });

  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  });
  assert.equal(hir.handlers[0]?.path, "/api/*");
  assert.deepEqual(hir.handlers[0]?.response.kind === "text"
    ? {
      status: hir.handlers[0].response.status,
      contentType: hir.handlers[0].response.contentType,
    }
    : undefined, {status: 404, contentType: "text/plain; charset=UTF-8"});
});

test("composes same-method Hono handlers into one native route", () => {
  const entry = path.join(repository, "tests/compat/hono/handler-chain-smoke.ts");
  const graph = loadModuleGraph(entry, {
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
  });
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);

  const result = evaluateApplicationInitialization(graph, application);

  assert.deepEqual(result?.issues, []);
  assert.equal(result?.routerInsertions, 2);
  assert.deepEqual(result?.routes.map(route => ({
    method: route.method,
    path: route.path,
    body: route.response?.body,
    headers: route.response?.headers,
  })), [{
    method: "GET",
    path: "/chain",
    body: "chained",
    headers: [{name: "X-Chain", value: "yes"}],
  }]);

  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  });
  assert.equal(hir.handlers.length, 1);
  assert.deepEqual(hir.handlers[0]?.headers, [{name: "X-Chain", value: "yes"}]);
});

test("lowers closed Response init headers from a Hono route", () => {
  const entry = path.join(repository, "tests/compat/hono/response-headers-smoke.ts");
  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  });

  assert.equal(hir.handlers[0]?.path, "/headers");
  assert.deepEqual(hir.handlers[0]?.headers, [{name: "X-Test", value: "yes"}]);
  assert.deepEqual(hir.staticStrings, [{id: 0, value: "Headers"}]);
});

test("executes the pinned Hono cookie lifecycle helpers for closed values", () => {
  const entry = path.join(repository, "tests/compat/hono/cookie-smoke.ts");
  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {
      hono: path.join(repository, "vendor/hono/src/index.ts"),
      "hono/cookie": path.join(repository, "vendor/hono/src/helper/cookie/index.ts"),
    },
    apiAliases: {
      hono: path.join(repository, "tests/compat/hono/api.d.ts"),
      "hono/cookie": path.join(repository, "tests/compat/hono/cookie-api.d.ts"),
    },
  });

  assert.deepEqual(hir.handlers.map(handler => ({
    path: handler.path,
    headers: handler.headers,
  })), [
    {
      path: "/set-cookie",
      headers: [{name: "Set-Cookie", value: "delicious_cookie=macha; Path=/"}],
    },
    {
      path: "/a/set-cookie-path",
      headers: [{name: "Set-Cookie", value: "delicious_cookie=macha; Path=/a"}],
    },
    {path: "/get-cookie", headers: undefined},
    {
      path: "/set-multiple-cookies",
      headers: [{
        name: "Set-Cookie",
        value: "first_cookie=one; Path=/, second_cookie=two; Path=/; HttpOnly",
      }],
    },
    {
      path: "/delete-cookie",
      headers: [{name: "Set-Cookie", value: "delicious_cookie=; Max-Age=0; Path=/"}],
    },
  ]);
  const getCookie = hir.handlers[2]?.response;
  assert.deepEqual(getCookie?.kind === "text" ? getCookie.value : undefined, {
    kind: "concat",
    values: [{
      kind: "requestCookie",
      cookie: 1,
      fallback: 2,
      span: hir.handlers[2]!.span,
    }],
    span: hir.handlers[2]!.span,
  });
  const deleteCookie = hir.handlers[4]?.response;
  assert.deepEqual(deleteCookie?.kind === "text" ? deleteCookie.value : undefined, {
    kind: "concat",
    values: [{
      kind: "requestCookie",
      cookie: 1,
      fallback: 2,
      span: hir.handlers[4]!.span,
    }],
    span: hir.handlers[4]!.span,
  });
});

test("applies the upstream poweredBy middleware after the root handler", () => {
  const entry = path.join(repository, "tests/compat/hono/powered-by-smoke.ts");
  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {
      hono: path.join(repository, "vendor/hono/src/index.ts"),
      "hono/powered-by": path.join(repository, "vendor/hono/src/middleware/powered-by/index.ts"),
    },
    apiAliases: {
      hono: path.join(repository, "tests/compat/hono/api.d.ts"),
      "hono/powered-by": path.join(repository, "tests/compat/hono/powered-by-api.d.ts"),
    },
  });

  assert.equal(hir.handlers.length, 1);
  assert.equal(hir.handlers[0]?.path, "/");
  assert.deepEqual(hir.handlers[0]?.headers, [{name: "X-Powered-By", value: "Hono"}]);
});

test("executes upstream secureHeaders defaults, overrides, and middleware order", () => {
  const entry = path.join(repository, "tests/compat/hono/secure-headers-smoke.ts");
  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {
      hono: path.join(repository, "vendor/hono/src/index.ts"),
      "hono/powered-by": path.join(repository, "vendor/hono/src/middleware/powered-by/index.ts"),
      "hono/secure-headers": path.join(
        repository,
        "vendor/hono/src/middleware/secure-headers/index.ts",
      ),
    },
    apiAliases: {
      hono: path.join(repository, "tests/compat/hono/api.d.ts"),
      "hono/powered-by": path.join(repository, "tests/compat/hono/powered-by-api.d.ts"),
      "hono/secure-headers": path.join(
        repository,
        "tests/compat/hono/secure-headers-api.d.ts",
      ),
    },
  });

  const byPath = new Map(hir.handlers.map(handler => [handler.path, handler]));
  const defaults = byPath.get("/default")?.headers ?? [];
  assert.equal(defaults.length, 12);
  assert.ok(defaults.some(header =>
    header.name === "Strict-Transport-Security"
      && header.value === "max-age=15552000; includeSubDomains"
  ));
  assert.ok(defaults.some(header => header.name === "X-Powered-By"));
  assert.equal(
    byPath.get("/ordered")?.headers?.some(header => header.name === "X-Powered-By"),
    false,
  );
  const custom = byPath.get("/custom")?.headers ?? [];
  assert.ok(custom.some(header => header.name === "X-Frame-Options" && header.value === "DENY"));
  assert.ok(custom.some(header =>
    header.name === "Strict-Transport-Security"
      && header.value === "max-age=31536000; includeSubDomains; preload;"
  ));
  assert.equal(custom.some(header => header.name === "X-XSS-Protection"), false);
});

test("lowers the pinned published Hono secureHeaders JavaScript shape", () => {
  const entry = path.join(repository, "tests/compat/hono/secure-headers-smoke.ts");
  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {
      hono: path.join(repository, "vendor/hono/src/index.ts"),
      "hono/powered-by": path.join(repository, "vendor/hono/src/middleware/powered-by/index.ts"),
      "hono/secure-headers": path.join(
        repository,
        "tests/compat/node-server/node_modules/hono/dist/middleware/secure-headers/index.js",
      ),
    },
    apiAliases: {
      hono: path.join(repository, "tests/compat/hono/api.d.ts"),
      "hono/powered-by": path.join(repository, "tests/compat/hono/powered-by-api.d.ts"),
      "hono/secure-headers": path.join(
        repository,
        "tests/compat/hono/secure-headers-api.d.ts",
      ),
    },
  });

  const ordered = hir.handlers.find(handler => handler.path === "/ordered");
  assert.equal(ordered?.headers?.some(header => header.name === "X-Powered-By"), false);
  const custom = hir.handlers.find(handler => handler.path === "/custom")?.headers ?? [];
  assert.ok(custom.some(header => header.name === "X-Frame-Options" && header.value === "DENY"));
});

test("rejects secureHeaders policies outside the closed header subset", () => {
  const entry = write("secure-headers-csp.ts", `
    import {Hono} from "hono";
    import {secureHeaders} from "hono/secure-headers";
    const app = new Hono();
    app.use("*", secureHeaders({contentSecurityPolicy: {defaultSrc: ["'self'"]}}));
    app.get("/", context => context.text("unreachable"));
    export default app;
  `);
  assert.throws(
    () => compileEntry(entry, {
      sdkPath: path.join(repository, "sdk/index.d.ts"),
      aliases: {
        hono: path.join(repository, "vendor/hono/src/index.ts"),
        "hono/secure-headers": path.join(
          repository,
          "vendor/hono/src/middleware/secure-headers/index.ts",
        ),
      },
      apiAliases: {
        hono: path.join(repository, "tests/compat/hono/api.d.ts"),
        "hono/secure-headers": path.join(
          repository,
          "tests/compat/hono/secure-headers-api.d.ts",
        ),
      },
    }),
    error => error instanceof CompileFailure
      && error.diagnostics.some(diagnostic => diagnostic.message.includes("contentSecurityPolicy")),
  );
});

test("lowers bounded upstream CORS headers and preflight", () => {
  const entry = path.join(repository, "tests/compat/hono/cors-smoke.ts");
  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {
      hono: path.join(repository, "vendor/hono/src/index.ts"),
      "hono/cors": path.join(repository, "vendor/hono/src/middleware/cors/index.ts"),
    },
    apiAliases: {
      hono: path.join(repository, "tests/compat/hono/api.d.ts"),
      "hono/cors": path.join(repository, "tests/compat/hono/cors-api.d.ts"),
    },
  });

  const get = hir.handlers.find(handler => handler.method === "GET" && handler.path === "/posts");
  assert.deepEqual(get?.headers, [{name: "Access-Control-Allow-Origin", value: "*"}]);
  const preflight = hir.handlers.find(handler =>
    handler.method === "OPTIONS" && handler.path === "/posts"
  );
  assert.equal(preflight?.response.kind === "text" ? preflight.response.status : undefined, 204);
  assert.deepEqual(preflight?.headers, [
    {name: "Access-Control-Allow-Origin", value: "*"},
    {
      name: "Access-Control-Allow-Methods",
      value: "GET,HEAD,PUT,POST,DELETE,PATCH",
    },
  ]);
});

test("retains the upstream bodyLimit factory as a request-body guard", () => {
  const entry = path.join(repository, "tests/compat/hono/body-limit-smoke.ts");
  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {
      hono: path.join(repository, "vendor/hono/src/index.ts"),
      "hono/body-limit": path.join(
        repository,
        "vendor/hono/src/middleware/body-limit/index.ts",
      ),
    },
    apiAliases: {
      hono: path.join(repository, "tests/compat/hono/api.d.ts"),
      "hono/body-limit": path.join(repository, "tests/compat/hono/body-limit-api.d.ts"),
    },
  });

  for (const handler of hir.handlers) {
    assert.deepEqual(
      (handler as unknown as {bodyLimit?: unknown}).bodyLimit,
      {
        maxBytes: 14,
        rejected: {
          response: {
            kind: "text",
            value: {kind: "stringLiteral", string: 1, span: handler.span},
            status: 413,
            contentType: "text/plain;charset=UTF-8",
          },
        },
      },
    );
  }
});

test("lowers the pinned published Hono bodyLimit JavaScript shape", () => {
  const entry = path.join(repository, "tests/compat/hono/body-limit-smoke.ts");
  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {
      hono: path.join(repository, "vendor/hono/src/index.ts"),
      "hono/body-limit": path.join(
        repository,
        "tests/compat/node-server/node_modules/hono/dist/middleware/body-limit/index.js",
      ),
    },
    apiAliases: {
      hono: path.join(repository, "tests/compat/hono/api.d.ts"),
      "hono/body-limit": path.join(repository, "tests/compat/hono/body-limit-api.d.ts"),
    },
  });

  assert.equal(hir.handlers.length, 2);
  for (const handler of hir.handlers) {
    assert.equal(handler.bodyLimit?.maxBytes, 14);
    assert.equal(handler.bodyLimit?.rejected.response.kind, "text");
    assert.equal(handler.bodyLimit?.rejected.response.status, 413);
  }
});

test("rejects an upstream bodyLimit beyond the native transport bound", () => {
  const entry = write("body-limit-too-large.ts", `
    import {Hono} from "hono";
    import {bodyLimit} from "hono/body-limit";
    const app = new Hono();
    app.use("*", bodyLimit({maxSize: 65537}));
    app.post("/", context => context.text("unreachable"));
    export default app;
  `);
  assert.throws(
    () => compileEntry(entry, {
      sdkPath: path.join(repository, "sdk/index.d.ts"),
      aliases: {
        hono: path.join(repository, "vendor/hono/src/index.ts"),
        "hono/body-limit": path.join(
          repository,
          "vendor/hono/src/middleware/body-limit/index.ts",
        ),
      },
      apiAliases: {
        hono: path.join(repository, "tests/compat/hono/api.d.ts"),
        "hono/body-limit": path.join(repository, "tests/compat/hono/body-limit-api.d.ts"),
      },
    }),
    error => error instanceof CompileFailure
      && error.diagnostics.some(diagnostic =>
        diagnostic.message.includes("closed maxSize from 0 through 65536")
      ),
  );
});

test("rejects a custom upstream bodyLimit error handler", () => {
  const bodyLimitApi = write("body-limit-custom-api.d.ts", `
    declare module "hono/body-limit" {
      import type {HonoContextApi, HonoMiddlewareApi} from "hono";
      export function bodyLimit(options: {
        maxSize: number;
        onError?: (context: HonoContextApi) => Response;
      }): HonoMiddlewareApi;
    }
  `);
  const entry = write("body-limit-custom-handler.ts", `
    import {Hono} from "hono";
    import {bodyLimit} from "hono/body-limit";
    const app = new Hono();
    app.use("*", bodyLimit({
      maxSize: 14,
      onError: context => context.text("custom", 413),
    }));
    app.post("/", context => context.text("unreachable"));
    export default app;
  `);
  assert.throws(
    () => compileEntry(entry, {
      sdkPath: path.join(repository, "sdk/index.d.ts"),
      aliases: {
        hono: path.join(repository, "vendor/hono/src/index.ts"),
        "hono/body-limit": path.join(
          repository,
          "vendor/hono/src/middleware/body-limit/index.ts",
        ),
      },
      apiAliases: {
        hono: path.join(repository, "tests/compat/hono/api.d.ts"),
        "hono/body-limit": bodyLimitApi,
      },
    }),
    error => error instanceof CompileFailure
      && error.diagnostics.some(diagnostic =>
        diagnostic.message.includes("requires a default error handler")
      ),
  );
});

test("retains upstream requestId as one reusable request-local value", () => {
  const entry = path.join(repository, "tests/compat/hono/request-id-smoke.ts");
  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {
      hono: path.join(repository, "vendor/hono/src/index.ts"),
      "hono/request-id": path.join(repository, "vendor/hono/src/middleware/request-id/index.ts"),
    },
    apiAliases: {
      hono: path.join(repository, "tests/compat/hono/api.d.ts"),
      "hono/request-id": path.join(repository, "tests/compat/hono/request-id-api.d.ts"),
    },
  });

  assert.deepEqual(hir.handlers[0]?.requestId, {header: 0, maxLength: 255});
  assert.equal(hir.handlers[0]?.response.kind, "text");
  assert.deepEqual(
    hir.handlers[0]?.response.kind === "text" ? hir.handlers[0].response.value : undefined,
    {
      kind: "concat",
      values: [{kind: "requestId", header: 0, span: hir.handlers[0]?.span}],
      span: hir.handlers[0]?.span,
    },
  );
});

test("lowers bounded Hono context variables across middleware and route handling", () => {
  const entry = path.join(repository, "tests/compat/hono/context-variables-smoke.ts");
  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  });

  const handler = hir.handlers.find(candidate => candidate.path === "/context/:value");
  assert.equal(handler?.response.kind, "text");
  const response = handler?.response.kind === "text" ? handler.response.value : undefined;
  assert.equal(response?.kind, "concat");
  assert.match(JSON.stringify(response), /routeParameter/);
  assert.ok(hir.staticStrings.some(value => value.value.includes("ctx:")));
  assert.ok(hir.staticStrings.some(value => value.value.includes(":absent")));

  const varHandler = hir.handlers.find(candidate => candidate.path === "/context-var/:value");
  assert.equal(varHandler?.response.kind, "text");
  const varResponse = varHandler?.response.kind === "text" ? varHandler.response.value : undefined;
  assert.equal(varResponse?.kind, "concat");
  assert.match(JSON.stringify(varResponse), /routeParameter/);
});

test("rejects Context.var operations that require a runtime map", () => {
  const cases = [
    {
      name: "dynamic key",
      body: 'return context.text(`${context.var[context.req.param("key")]}`);',
      message: "computed property access is not supported",
    },
    {
      name: "enumeration",
      body: 'return context.text(Object.keys(context.var).join(","));',
      message: "Object.keys argument is not a closed object",
    },
    {
      name: "destructuring",
      body: 'const {value} = context.var; return context.text(value as string);',
      message: "destructuring source is not a closed record",
    },
  ];
  for (const candidate of cases) {
    const entry = write(`context-var-${candidate.name}.ts`, `
      import {Hono} from "hono";
      const app = new Hono();
      app.get("/:key", context => {
        context.set("value", "closed");
        ${candidate.body}
      });
      export default app;
    `);
    assert.throws(
      () => compileEntry(entry, {
        sdkPath: path.join(repository, "sdk/index.d.ts"),
        aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
        apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
      }),
      error => error instanceof CompileFailure
        && error.diagnostics.some(diagnostic => diagnostic.message.includes(candidate.message)),
      candidate.name,
    );
  }

  const assignment = write("context-var-assignment.ts", `
    import {Hono} from "hono";
    const app = new Hono();
    app.get("/", context => {
      context.var.value = "changed";
      return context.text("ok");
    });
    export default app;
  `);
  assert.throws(
    () => compileEntry(assignment, {
      sdkPath: path.join(repository, "sdk/index.d.ts"),
      aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
      apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
    }),
    error => error instanceof CompileFailure
      && error.diagnostics.some(diagnostic => diagnostic.code === "TS2542"),
  );
});

test("rejects context variables outside the bounded static slot contract", () => {
  const cases = [
    {
      name: "dynamic key",
      effect: 'context.set(context.req.param("key"), "value");',
      message: "requires one static string key",
    },
    {
      name: "empty key",
      effect: 'context.set("", "value");',
      message: "non-empty UTF-8 string",
    },
    {
      name: "oversized key",
      effect: `context.set("${"x".repeat(129)}", "value");`,
      message: "at most 128 bytes",
    },
    {
      name: "reserved key",
      effect: 'context.set("requestId", "value");',
      message: "reserved requestId",
    },
    {
      name: "structured value",
      effect: 'context.set("value", {nested: true});',
      message: "bounded primitive",
    },
    {
      name: "slot limit",
      effect: Array.from({length: 17}, (_, index) =>
        `context.set("slot${index}", "value");`
      ).join("\n"),
      message: "at most 16 static slots",
    },
  ];
  for (const candidate of cases) {
    const entry = write(`context-variables-${candidate.name.replaceAll(" ", "-")}.ts`, `
      import {Hono} from "hono";
      const app = new Hono();
      app.get("/:key", context => {
        ${candidate.effect}
        return context.text("ok");
      });
      export default app;
    `);
    assert.throws(
      () => compileEntry(entry, {
        sdkPath: path.join(repository, "sdk/index.d.ts"),
        aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
        apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
      }),
      error => error instanceof CompileFailure
        && error.diagnostics.some(diagnostic =>
          diagnostic.code === "TINY1403" && diagnostic.message.includes(candidate.message)
        ),
      candidate.name,
    );
  }
});

test("binds closed requestId options to the same route-local value", () => {
  const entry = path.join(repository, "tests/compat/hono/request-id-options-smoke.ts");
  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {
      hono: path.join(repository, "vendor/hono/src/index.ts"),
      "hono/request-id": path.join(repository, "vendor/hono/src/middleware/request-id/index.ts"),
    },
    apiAliases: {
      hono: path.join(repository, "tests/compat/hono/api.d.ts"),
      "hono/request-id": path.join(repository, "tests/compat/hono/request-id-api.d.ts"),
    },
  });

  const handler = hir.handlers.find(candidate => candidate.path === "/custom-request-id");
  assert.ok(handler?.requestId);
  assert.equal(handler.requestId.maxLength, 16);
  assert.equal(hir.staticStrings[handler.requestId.header]?.value, "Hono-Request-Id");
  assert.equal(handler.response.kind, "text");
  const value = handler.response.kind === "text" ? handler.response.value : undefined;
  assert.equal(value?.kind, "concat");
  assert.equal(
    value?.kind === "concat" && value.values[0]?.kind === "requestId"
      ? hir.staticStrings[value.values[0].header]?.value
      : undefined,
    "Hono-Request-Id",
  );
});

test("rejects unsupported or missing requestId policies", () => {
  const cases = [
    {
      name: "custom generator",
      source: `
        import {Hono} from "hono";
        import {requestId} from "hono/request-id";
        const app = new Hono();
        app.use("*", requestId({generator: () => "fixed"}));
        app.get("/", context => context.text(context.get("requestId") ?? "missing"));
        export default app;
      `,
      message: "requires its default generator",
    },
    {
      name: "multiple policies",
      source: `
        import {Hono} from "hono";
        import {requestId} from "hono/request-id";
        const app = new Hono();
        app.use("*", requestId());
        app.use("*", requestId({headerName: "Hono-Request-Id"}));
        app.get("/", context => context.text(context.get("requestId") ?? "missing"));
        export default app;
      `,
      message: "multiple requestId middleware policies",
    },
    {
      name: "missing middleware",
      source: `
        import {Hono} from "hono";
        import {requestId} from "hono/request-id";
        const app = new Hono();
        app.get("/", context => context.text(context.get("requestId") ?? "missing"));
        export default app;
      `,
      message: "requires one matched upstream requestId middleware",
    },
  ];
  for (const candidate of cases) {
    const entry = write(`request-id-${candidate.name.replaceAll(" ", "-")}.ts`, candidate.source);
    assert.throws(
      () => compileEntry(entry, {
        sdkPath: path.join(repository, "sdk/index.d.ts"),
        aliases: {
          hono: path.join(repository, "vendor/hono/src/index.ts"),
          "hono/request-id": path.join(
            repository,
            "vendor/hono/src/middleware/request-id/index.ts",
          ),
        },
        apiAliases: {
          hono: path.join(repository, "tests/compat/hono/api.d.ts"),
          "hono/request-id": path.join(repository, "tests/compat/hono/request-id-api.d.ts"),
        },
      }),
      error => error instanceof CompileFailure
        && error.diagnostics.some(diagnostic =>
          diagnostic.code === "TINY1403" && diagnostic.message.includes(candidate.message)
        ),
      candidate.name,
    );
  }
});

test("lowers the pinned published Hono requestId JavaScript shape", () => {
  const entry = path.join(repository, "tests/compat/hono/request-id-smoke.ts");
  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {
      hono: path.join(
        repository,
        "tests/compat/node-server/node_modules/hono/dist/index.js",
      ),
      "hono/request-id": path.join(
        repository,
        "tests/compat/node-server/node_modules/hono/dist/middleware/request-id/index.js",
      ),
    },
    apiAliases: {
      hono: path.join(repository, "tests/compat/hono/api.d.ts"),
      "hono/request-id": path.join(repository, "tests/compat/hono/request-id-api.d.ts"),
    },
  });

  const requestId = hir.handlers[0]?.requestId;
  assert.equal(requestId?.maxLength, 255);
  assert.equal(
    requestId === undefined ? undefined : hir.staticStrings[requestId.header]?.value,
    "X-Request-Id",
  );
});

test("lowers the pinned published Hono CORS JavaScript shape", () => {
  const entry = path.join(repository, "tests/compat/hono/cors-smoke.ts");
  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {
      hono: path.join(repository, "vendor/hono/src/index.ts"),
      "hono/cors": path.join(repository, "tests/compat/hono/published/middleware/cors/index.js"),
    },
    apiAliases: {
      hono: path.join(repository, "tests/compat/hono/api.d.ts"),
      "hono/cors": path.join(repository, "tests/compat/hono/cors-api.d.ts"),
    },
  });

  const get = hir.handlers.find(handler => handler.method === "GET" && handler.path === "/posts");
  assert.deepEqual(get?.headers, [{name: "Access-Control-Allow-Origin", value: "*"}]);
  const preflight = hir.handlers.find(handler =>
    handler.method === "OPTIONS" && handler.path === "/posts"
  );
  assert.equal(preflight?.response.kind === "text" ? preflight.response.status : undefined, 204);
});

test("lowers the upstream response-time middleware into a native elapsed header", () => {
  const entry = path.join(repository, "tests/compat/hono/response-time-smoke.ts");
  const options = {
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  };
  const graph = loadModuleGraph(entry, options);
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);

  const result = evaluateApplicationInitialization(graph, application);

  assert.deepEqual(result?.issues, []);
  assert.deepEqual(result?.routes.find(route => route.method === "GET")?.response?.headers, [{
    name: "X-Response-Time",
    value: [
      {kind: "elapsedMilliseconds"},
      {kind: "literal", value: "ms"},
    ],
  }]);

  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    ...options,
  });
  assert.deepEqual(
    (hir.handlers[0] as unknown as {elapsedHeaders?: unknown}).elapsedHeaders,
    [{name: "X-Response-Time", suffix: "ms"}],
  );
});

test("preserves response timing when prettyJSON clones a conditional body", () => {
  const entry = path.join(
    repository,
    "tests/compat/hono/response-time-pretty-json-smoke.ts",
  );
  const options = {
    aliases: {
      hono: path.join(repository, "vendor/hono/src/index.ts"),
      "hono/pretty-json": path.join(
        repository,
        "vendor/hono/src/middleware/pretty-json/index.ts",
      ),
    },
    apiAliases: {
      hono: path.join(repository, "tests/compat/hono/api.d.ts"),
      "hono/pretty-json": path.join(repository, "tests/compat/hono/pretty-json-api.d.ts"),
    },
  };
  const graph = loadModuleGraph(entry, options);
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);

  const result = evaluateApplicationInitialization(graph, application);

  assert.deepEqual(result?.issues, []);
  const route = result?.routes.find(candidate => candidate.method === "GET");
  assert.deepEqual(route?.response?.headers, [{
    name: "X-Response-Time",
    value: [
      {kind: "elapsedMilliseconds"},
      {kind: "literal", value: "ms"},
    ],
  }]);

  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    ...options,
  });
  assert.deepEqual(hir.handlers[0]?.elapsedHeaders, [{
    name: "X-Response-Time",
    suffix: "ms",
  }]);
  assert.equal(hir.handlers[0]?.response.kind, "text");
  assert.equal(
    hir.handlers[0]?.response.kind === "text"
      ? hir.handlers[0].response.value.kind
      : undefined,
    "queryConditional",
  );
});

test("retains the closed upstream basicAuth factory as a request guard", () => {
  const entry = path.join(repository, "tests/compat/hono/basic-auth-smoke.ts");
  const options = {
    aliases: {
      hono: path.join(repository, "vendor/hono/src/index.ts"),
      "hono/basic-auth": path.join(
        repository,
        "vendor/hono/src/middleware/basic-auth/index.ts",
      ),
    },
    apiAliases: {
      hono: path.join(repository, "tests/compat/hono/api.d.ts"),
      "hono/basic-auth": path.join(repository, "tests/compat/hono/basic-auth-api.d.ts"),
    },
  };
  const graph = loadModuleGraph(entry, options);
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);

  const result = evaluateApplicationInitialization(graph, application);

  assert.deepEqual(result?.issues, []);
  const response = result?.routes.find(route => route.method === "GET")?.response;
  assert.deepEqual(
    (response as unknown as {basicAuthorization?: unknown})?.basicAuthorization,
    {
      credentials: [{username: "hono", password: "acoolproject"}],
      rejected: {
        kind: "text",
        body: "Unauthorized",
        status: 401,
        contentType: "",
        headers: [{name: "WWW-Authenticate", value: 'Basic realm="Secure Area"'}],
      },
    },
  );

  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    ...options,
  });
  assert.deepEqual(
    (hir.handlers[0] as unknown as {basicAuthorization?: unknown}).basicAuthorization,
    {
      credentials: [{username: "hono", password: "acoolproject"}],
      rejected: {
        headers: [{name: "WWW-Authenticate", value: 'Basic realm="Secure Area"'}],
        response: {
          kind: "text",
          value: {kind: "stringLiteral", string: 1, span: hir.handlers[0]?.span},
          status: 401,
          contentType: "",
        },
      },
    },
  );

});

test("preserves Hono middleware order around rejected Basic Authorization", () => {
  const entry = path.join(repository, "tests/compat/hono/basic-auth-error-smoke.ts");
  const aliases = {
    hono: path.join(repository, "vendor/hono/src/index.ts"),
    "hono/basic-auth": path.join(
      repository,
      "vendor/hono/src/middleware/basic-auth/index.ts",
    ),
    "hono/powered-by": path.join(
      repository,
      "vendor/hono/src/middleware/powered-by/index.ts",
    ),
  };
  const graph = loadModuleGraph(entry, {aliases});
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);

  const result = evaluateApplicationInitialization(graph, application);

  assert.deepEqual(result?.issues, []);
  const response = result?.routes.find(route => route.method === "GET")?.response;
  assert.deepEqual(response?.headers, [
    {
      name: "X-Response-Time",
      value: [{kind: "elapsedMilliseconds"}, {kind: "literal", value: "ms"}],
    },
    {name: "X-Powered-By", value: "Hono"},
  ]);
  assert.deepEqual(response?.basicAuthorization?.rejected, {
    kind: "text",
    body: "Custom Error Message",
    status: 500,
    contentType: "text/plain; charset=UTF-8",
    headers: [{name: "X-Powered-By", value: "Hono"}],
    stderr: ["Error"],
  });
});

test("specializes the upstream ETag middleware for a closed response body", () => {
  const entry = path.join(repository, "tests/compat/hono/etag-smoke.ts");
  const options = {
    aliases: {
      hono: path.join(repository, "vendor/hono/src/index.ts"),
      "hono/etag": path.join(repository, "vendor/hono/src/middleware/etag/index.ts"),
    },
    apiAliases: {
      hono: path.join(repository, "tests/compat/hono/api.d.ts"),
      "hono/etag": path.join(repository, "tests/compat/hono/etag-api.d.ts"),
    },
  };
  const graph = loadModuleGraph(entry, options);
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);

  const result = evaluateApplicationInitialization(graph, application);

  assert.deepEqual(result?.issues, []);
  const response = result?.routes.find(route => route.method === "GET")?.response;
  assert.deepEqual(response?.headers, [{
    name: "ETag",
    value: '"90ea638841fff3c326fc22cbd156f1146ac0ac02"',
  }]);
  assert.deepEqual(
    (response as unknown as {entityTag?: unknown})?.entityTag,
    {
      value: '"90ea638841fff3c326fc22cbd156f1146ac0ac02"',
      notModified: {
        kind: "text",
        body: "",
        status: 304,
        contentType: "",
        headers: [{name: "ETag", value: '"90ea638841fff3c326fc22cbd156f1146ac0ac02"'}],
      },
    },
  );

  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    ...options,
  });
  assert.deepEqual(
    (hir.handlers[0] as unknown as {entityTag?: unknown}).entityTag,
    {
      value: '"90ea638841fff3c326fc22cbd156f1146ac0ac02"',
      notModified: {
        headers: [{name: "ETag", value: '"90ea638841fff3c326fc22cbd156f1146ac0ac02"'}],
        response: {
          kind: "text",
          value: {kind: "stringLiteral", string: 1, span: hir.handlers[0]?.span},
          status: 304,
          contentType: "",
        },
      },
    },
  );
});

test("lowers upstream prettyJSON into a query-conditional native response", () => {
  const entry = path.join(repository, "tests/compat/hono/pretty-json-smoke.ts");
  const options = {
    aliases: {
      hono: path.join(repository, "vendor/hono/src/index.ts"),
      "hono/pretty-json": path.join(
        repository,
        "vendor/hono/src/middleware/pretty-json/index.ts",
      ),
    },
    apiAliases: {
      hono: path.join(repository, "tests/compat/hono/api.d.ts"),
      "hono/pretty-json": path.join(repository, "tests/compat/hono/pretty-json-api.d.ts"),
    },
  };
  const graph = loadModuleGraph(entry, options);
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);

  const result = evaluateApplicationInitialization(graph, application);

  assert.deepEqual(result?.issues, []);
  assert.deepEqual(result?.routes.map(route => route.response?.body), [{
    kind: "queryConditional",
    query: "pretty",
    whenPresent: '[\n  {\n    "id": 1,\n    "title": "Good Morning"\n  }\n]',
    whenAbsent: '[{"id":1,"title":"Good Morning"}]',
  }]);

  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    ...options,
  });
  assert.equal(hir.handlers[0]?.path, "/api/posts");
  assert.deepEqual(
    hir.handlers[0]?.response.kind === "text" ? hir.handlers[0].response.value : undefined,
    {
      kind: "queryConditional",
      query: 0,
      whenPresent: {kind: "stringLiteral", string: 1, span: hir.handlers[0]?.span},
      whenAbsent: {kind: "stringLiteral", string: 2, span: hir.handlers[0]?.span},
      span: hir.handlers[0]?.span,
    },
  );
});

test("lowers upstream Context.redirect with an empty body and Location header", () => {
  const entry = path.join(repository, "tests/compat/hono/redirect-smoke.ts");
  const options = {
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  };
  const graph = loadModuleGraph(entry, options);
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);

  const result = evaluateApplicationInitialization(graph, application);

  assert.deepEqual(result?.issues, []);
  assert.deepEqual(result?.routes[0]?.response, {
    kind: "text",
    body: "",
    status: 302,
    contentType: "",
    headers: [{name: "Location", value: "/"}],
  });

  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    ...options,
  });
  assert.deepEqual(
    hir.handlers[0]?.response.kind === "text"
      ? {
        status: hir.handlers[0].response.status,
        contentType: hir.handlers[0].response.contentType,
      }
      : undefined,
    {status: 302, contentType: ""},
  );
  assert.deepEqual(hir.handlers[0]?.headers, [{name: "Location", value: "/"}]);
});

test("lowers an upstream Hono request header into request-time text", () => {
  const entry = path.join(repository, "tests/compat/hono/request-header-smoke.ts");
  const options = {
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  };
  const graph = loadModuleGraph(entry, options);
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);

  const result = evaluateApplicationInitialization(graph, application);

  assert.deepEqual(result?.issues, []);
  assert.deepEqual(result?.routes[0]?.response?.body, [
    {kind: "literal", value: "Your UserAgent is "},
    {kind: "requestHeader", name: "User-Agent"},
  ]);

  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    ...options,
  });
  assert.deepEqual(
    hir.handlers[0]?.response.kind === "text" ? hir.handlers[0].response.value : undefined,
    {
      kind: "concat",
      values: [
        {kind: "stringLiteral", string: 0, span: hir.handlers[0]?.span},
        {kind: "requestHeader", header: 1, span: hir.handlers[0]?.span},
      ],
      span: hir.handlers[0]?.span,
    },
  );
  assert.deepEqual(hir.staticStrings.map(string => string.value), [
    "Your UserAgent is ",
    "User-Agent",
  ]);
});

test("rolls back an unsupported middleware effect without corrupting the response", () => {
  const entry = path.join(repository, "tests/compat/hono/middleware-rollback-smoke.ts");
  const graph = loadModuleGraph(entry, {
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
  });
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);

  const result = evaluateApplicationInitialization(graph, application);

  assert.equal(result?.issues.length, 1);
  assert.deepEqual(result?.routes.find(route => route.method === "GET")?.response, {
    kind: "text",
    body: [
      {kind: "literal", value: "Your UserAgent is "},
      {kind: "requestHeader", name: "User-Agent"},
    ],
    status: 200,
    contentType: "text/plain;charset=UTF-8",
  });
});

test("applies upstream custom middleware to its wildcard base path", () => {
  const entry = path.join(repository, "tests/compat/hono/custom-middleware-smoke.ts");
  const graph = loadModuleGraph(entry, {
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
  });
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);

  const result = evaluateApplicationInitialization(graph, application);

  assert.deepEqual(result?.issues, []);
  assert.deepEqual(result?.routes.find(route => route.method === "GET")?.response, {
    kind: "text",
    body: "This is /hello",
    status: 200,
    contentType: "text/plain;charset=UTF-8",
    headers: [{name: "X-message", value: "This is addHeader middleware!"}],
  });
});

test("lowers the installed upstream not-found handler after explicit routes", () => {
  const entry = path.join(repository, "tests/compat/hono/not-found-smoke.ts");
  const options = {
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  };
  const graph = loadModuleGraph(entry, options);
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);

  const result = evaluateApplicationInitialization(graph, application);

  assert.deepEqual(result?.issues, []);
  assert.deepEqual(result?.notFoundResponse, {
    kind: "text",
    body: "Custom 404 Not Found",
    status: 404,
    contentType: "text/plain; charset=UTF-8",
  });

  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    ...options,
  });
  assert.deepEqual(hir.handlers.map(handler => ({
    method: handler.method,
    path: handler.path,
    status: handler.response.kind === "text" ? handler.response.status : undefined,
  })), [
    {method: "GET", path: "/", status: undefined},
    {method: "GET", path: "/*", status: 404},
    {method: "POST", path: "/*", status: 404},
  ]);
  assert.deepEqual(hir.staticStrings.map(string => string.value), [
    "Home",
    "Custom 404 Not Found",
  ]);
});

test("routes a closed throw through the installed upstream error handler", () => {
  const entry = path.join(repository, "tests/compat/hono/error-handler-smoke.ts");
  const options = {
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  };
  const graph = loadModuleGraph(entry, options);
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);

  const result = evaluateApplicationInitialization(graph, application);

  assert.deepEqual(result?.issues, []);
  assert.deepEqual(result?.routes[0]?.response, {
    kind: "text",
    body: "Custom Error Message",
    status: 500,
    contentType: "text/plain; charset=UTF-8",
    stderr: ["Error: Error has occurred"],
  });

  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    ...options,
  });
  assert.deepEqual(hir.handlers[0]?.stderr, [1]);
  assert.deepEqual(hir.staticStrings.map(string => string.value), [
    "Custom Error Message",
    "Error: Error has occurred",
  ]);
  assert.deepEqual(
    hir.handlers[0]?.response.kind === "text"
      ? {
        status: hir.handlers[0].response.status,
        contentType: hir.handlers[0].response.contentType,
      }
      : undefined,
    {status: 500, contentType: "text/plain; charset=UTF-8"},
  );
});

test("routes an invalid truthy handler return through Hono response finalization", () => {
  const entry = path.join(repository, "tests/compat/hono/invalid-return-smoke.ts");
  const options = {
    aliases: {
      hono: path.join(repository, "vendor/hono/src/index.ts"),
      "hono/powered-by": path.join(
        repository,
        "vendor/hono/src/middleware/powered-by/index.ts",
      ),
    },
    apiAliases: {
      hono: path.join(repository, "tests/compat/hono/api.d.ts"),
      "hono/powered-by": path.join(repository, "tests/compat/hono/powered-by-api.d.ts"),
    },
  };
  const graph = loadModuleGraph(entry, options);
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);

  const result = evaluateApplicationInitialization(graph, application);

  assert.deepEqual(result?.issues, []);
  assert.deepEqual(result?.routes.find(route => route.method === "GET")?.response, {
    kind: "text",
    body: "Custom Error Message",
    status: 500,
    contentType: "text/plain; charset=UTF-8",
    stderr: [
      "TypeError [ERR_INVALID_ARG_TYPE]: Failed to construct 'Response': The provided body value is not of type 'ResponseInit'",
      "TypeError: undefined is not an object (evaluating 'this.#res.headers.entries')",
      "TypeError: undefined is not an object (evaluating 'this.#res.headers.entries')",
    ],
  });

  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    ...options,
  });
  assert.equal(hir.handlers[0]?.path, "/type-error");
  assert.equal(hir.handlers[0]?.headers, undefined);
  assert.deepEqual(hir.handlers[0]?.stderr?.map(id => hir.staticStrings[id]?.value), [
    "TypeError [ERR_INVALID_ARG_TYPE]: Failed to construct 'Response': The provided body value is not of type 'ResponseInit'",
    "TypeError: undefined is not an object (evaluating 'this.#res.headers.entries')",
    "TypeError: undefined is not an object (evaluating 'this.#res.headers.entries')",
  ]);
});

test("lowers the tiny-preset Hono route into native HIR", () => {
  const hir = compileEntry(path.join(repository, "tests/compat/hono/smoke.ts"), {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {"hono/tiny": path.join(repository, "vendor/hono/src/preset/tiny.ts")},
    apiAliases: {"hono/tiny": path.join(repository, "tests/compat/hono/api.d.ts")},
  });

  assert.equal(hir.modules.length, 17);
  assert.deepEqual(hir.handlers, [{
    method: "GET",
    path: "/",
    response: {
      kind: "text",
      value: {kind: "stringLiteral", string: 0, span: hir.handlers[0]?.span},
      contentType: "text/plain;charset=UTF-8",
    },
    span: hir.handlers[0]?.span,
  }]);
  assert.deepEqual(hir.staticStrings, [{id: 0, value: "Hello from Hono"}]);
});

test("lowers the upstream basic route through the full Hono runtime graph", () => {
  const hir = compileEntry(path.join(repository, "tests/compat/hono/basic-smoke.ts"), {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {"hono": path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {"hono": path.join(repository, "tests/compat/hono/api.d.ts")},
  });

  assert.equal(hir.modules.length, 27);
  assert.equal(hir.handlers[0]?.method, "GET");
  assert.equal(hir.handlers[0]?.path, "/");
  assert.deepEqual(hir.staticStrings, [{id: 0, value: "Hono!!"}]);
});

test("lowers closed JSX component props through the pinned Hono runtime", () => {
  const entry = write("hono-jsx-props.tsx", `
    import {Hono} from "hono";

    const Item = (props: {label: string}) => <li data-id="item">{props.label}</li>;
    const List = (props: {labels: string[]}) => (
      <main><h1>{"Posts & Notes"}</h1><ul>{props.labels.map(label => <Item label={label} />)}</ul></main>
    );

    const app = new Hono();
    app.get("/", context => context.html(<List labels={["One", "Two < Three"]} />));
    export default app;
  `);
  const aliases = {hono: path.join(repository, "vendor/hono/src/index.ts")};
  const graph = loadModuleGraph(entry, {aliases});
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);
  const initialization = evaluateApplicationInitialization(graph, application);
  assert.deepEqual(initialization?.issues, []);

  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases,
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  });

  assert.deepEqual(hir.staticStrings.map(string => string.value), [
    '<main><h1>Posts &amp; Notes</h1><ul><li data-id="item">One</li><li data-id="item">Two &lt; Three</li></ul></main>',
  ]);
});

test("lowers request-time Hono JSX through nested components with HTML escaping", () => {
  const entry = path.join(repository, "tests/compat/hono/dynamic-jsx-smoke.tsx");
  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  });

  assert.deepEqual(hir.handlers.map(handler => `${handler.method} ${handler.path}`), [
    "GET /dynamic",
  ]);
  const response = hir.handlers[0]?.response;
  assert.ok(response?.kind === "text");
  assert.equal(response.contentType, "text/html; charset=UTF-8");
  const value = JSON.parse(JSON.stringify(response.value, (key, candidate) =>
    key === "span" ? undefined : candidate
  ));
  assert.deepEqual(value, {
    kind: "concat",
    values: [
      {kind: "stringLiteral", string: 0},
      {kind: "queryParameter", query: 1, fallback: 2, escapeHtml: true},
      {kind: "stringLiteral", string: 3},
      {kind: "queryParameter", query: 1, fallback: 2, escapeHtml: true},
      {kind: "stringLiteral", string: 4},
    ],
  });
});

test("lowers pinned upstream Hono streamText writes into ordered response chunks", () => {
  const entry = path.join(repository, "tests/compat/hono/stream-text-smoke.ts");
  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {
      hono: path.join(repository, "vendor/hono/src/index.ts"),
      "hono/streaming": path.join(repository, "vendor/hono/src/helper/streaming/index.ts"),
    },
    apiAliases: {
      hono: path.join(repository, "tests/compat/hono/api.d.ts"),
      "hono/streaming": path.join(repository, "tests/compat/hono/streaming-api.d.ts"),
    },
  });

  assert.equal(hir.modules.length, 33);
  assert.deepEqual(hir.staticStrings.map(value => value.value), ["first\n", "second\n", "third\n"]);
  const handler = hir.handlers[0];
  assert.equal(handler?.path, "/stream");
  assert.deepEqual(handler?.headers, [
    {name: "X-Content-Type-Options", value: "nosniff"},
    {name: "Transfer-Encoding", value: "chunked"},
  ]);
  assert.equal(handler?.response.kind, "stream");
  assert.deepEqual(
    handler?.response.kind === "stream"
      ? handler.response.chunks.map(chunk => chunk.kind === "stringLiteral" ? chunk.string : -1)
      : [],
    [0, 1, 2],
  );
});

test("compiles the exact pinned Hono JSX SSR source graph", () => {
  const entry = path.join(repository, "vendor/hono-examples/jsx-ssr/src/index.tsx");
  const aliases = {
    hono: path.join(repository, "vendor/hono/src/index.ts"),
    "hono/html": path.join(repository, "vendor/hono/src/helper/html/index.ts"),
  };
  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases,
    apiAliases: {
      hono: path.join(repository, "tests/compat/hono/api.d.ts"),
      "hono/html": path.join(repository, "tests/compat/hono/html-api.d.ts"),
    },
  });

  assert.deepEqual(hir.handlers.map(handler => `${handler.method} ${handler.path}`), [
    "GET /",
    "GET /post/1",
    "GET /post/2",
    "GET /post/3",
    "GET /post/4",
    "GET /post/5",
    "GET /post/:id{[0-9]+}",
    "GET /*",
  ]);
  assert.match(hir.staticStrings[0]?.value ?? "", /<title>Top<\/title>/);
  assert.match(hir.staticStrings[0]?.value ?? "", /こんにちは/);
  const fallback = hir.handlers.at(-2)?.response;
  assert.equal(fallback?.kind, "text");
  assert.equal(fallback?.kind === "text" ? fallback.status : undefined, 404);
});

test("lowers a closed fetch response status as a native runtime expression", () => {
  const hir = compileEntry(path.join(repository, "tests/compat/hono/fetch-status-smoke.ts"), {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases: {hono: path.join(repository, "vendor/hono/src/index.ts")},
    apiAliases: {hono: path.join(repository, "tests/compat/hono/api.d.ts")},
  });

  assert.equal(hir.handlers[0]?.path, "/fetch-url");
  assert.deepEqual(
    hir.handlers[0]?.response.kind === "text" ? hir.handlers[0].response.value : undefined,
    {
      kind: "concat",
      values: [
        {kind: "stringLiteral", string: 0, span: hir.handlers[0]?.span},
        {kind: "fetchStatus", url: 1, span: hir.handlers[0]?.span},
      ],
      span: hir.handlers[0]?.span,
    },
  );
  assert.deepEqual(hir.staticStrings.map(string => string.value), [
    "https://example.com/ is ",
    "https://example.com/",
  ]);
});

test("compiles the complete exact upstream basic source", () => {
  const entry = path.join(repository, "vendor/hono-examples/basic/src/index.ts");
  const aliases = {
    hono: path.join(repository, "vendor/hono/src/index.ts"),
    "hono/basic-auth": path.join(repository, "vendor/hono/src/middleware/basic-auth/index.ts"),
    "hono/etag": path.join(repository, "vendor/hono/src/middleware/etag/index.ts"),
    "hono/powered-by": path.join(repository, "vendor/hono/src/middleware/powered-by/index.ts"),
    "hono/pretty-json": path.join(
      repository,
      "vendor/hono/src/middleware/pretty-json/index.ts",
    ),
  };
  const graph = loadModuleGraph(entry, {aliases});
  const application = analyzeApplicationEntry(graph.modules[0]!.sourceFile);
  assert.ok(application);

  const result = evaluateApplicationInitialization(graph, application);

  assert.deepEqual(result?.issues, []);
  assert.deepEqual(
    result?.routes.find(route => route.path === "/fetch-url")?.response?.body,
    [
      {kind: "literal", value: "https://example.com/ is "},
      {kind: "fetchStatus", url: "https://example.com/"},
    ],
  );
  assert.deepEqual(
    result?.routes.find(route => route.path === "/type-error")?.response,
    {
      kind: "text",
      body: "Custom Error Message",
      status: 500,
      contentType: "text/plain; charset=UTF-8",
      stderr: [
        "TypeError [ERR_INVALID_ARG_TYPE]: Failed to construct 'Response': The provided body value is not of type 'ResponseInit'",
        "TypeError: undefined is not an object (evaluating 'this.#res.headers.entries')",
        "TypeError: undefined is not an object (evaluating 'this.#res.headers.entries')",
      ],
    },
  );

  const apiAliases = {
    hono: path.join(repository, "tests/compat/hono/api.d.ts"),
    "hono/basic-auth": path.join(repository, "tests/compat/hono/basic-auth-api.d.ts"),
    "hono/etag": path.join(repository, "tests/compat/hono/etag-api.d.ts"),
    "hono/powered-by": path.join(repository, "tests/compat/hono/powered-by-api.d.ts"),
    "hono/pretty-json": path.join(repository, "tests/compat/hono/pretty-json-api.d.ts"),
  };
  const hir = compileEntry(entry, {
    sdkPath: path.join(repository, "sdk/index.d.ts"),
    aliases,
    apiAliases,
  });
  assert.equal(hir.modules.length, 34);
  assert.deepEqual(hir.handlers.map(handler => `${handler.method} ${handler.path}`), [
    "GET /",
    "GET /hello",
    "GET /entry/:id",
    "GET /book",
    "GET /book/:id",
    "POST /book",
    "GET /redirect",
    "GET /auth/*",
    "GET /etag/cached",
    "GET /fetch-url",
    "GET /user-agent",
    "GET /api/posts",
    "POST /api/posts",
    "GET /api/*",
    "GET /error",
    "GET /type-error",
    "GET /*",
    "POST /*",
  ]);
});

test("pins the native text response to the upstream Hono contract", () => {
  const manifest = JSON.parse(readFileSync(
    path.join(repository, "tests/compat/hono/manifest.json"),
    "utf8",
  ));
  const contract = manifest.behaviorContracts.textResponse;
  const contextSource = readFileSync(path.join(repository, contract.source), "utf8");
  const basicSource = readFileSync(path.join(repository, manifest.basicSmokeEntry), "utf8");

  assert.match(contextSource, new RegExp(`export const TEXT_PLAIN = ['"]${contract.fallbackContentType}['"]`));
  assert.match(basicSource, new RegExp(`context\\.text\\(['"]${contract.body}['"]\\)`));
});

test("type-checks the entry against the Hono API overlay before runtime lowering", () => {
  const entry = write("invalid-hono.ts", `
    import {Hono} from "hono/tiny";
    const app = new Hono();
    app.get(42, context => context.text("bad path"));
    export default app;
  `);

  assert.throws(
    () => compileEntry(entry, {
      sdkPath: path.join(repository, "sdk/index.d.ts"),
      aliases: {"hono/tiny": path.join(repository, "vendor/hono/src/preset/tiny.ts")},
      apiAliases: {"hono/tiny": path.join(repository, "tests/compat/hono/api.d.ts")},
    }),
    (error: unknown) => error instanceof CompileFailure
      && error.diagnostics[0]?.code === "TS2345"
      && error.diagnostics[0]?.span?.file === entry,
  );
});

function write(name: string, source: string): string {
  const file = path.join(directory, name);
  writeFileSync(file, source);
  return file;
}

function requirement(
  report: ReturnType<typeof auditCompatibility>,
  feature: string,
): number {
  return report.requirements.find(requirement => requirement.feature === feature)?.occurrences ?? 0;
}
