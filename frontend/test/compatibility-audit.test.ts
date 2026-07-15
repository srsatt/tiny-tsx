import assert from "node:assert/strict";
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
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
