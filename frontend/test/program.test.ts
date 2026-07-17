import assert from "node:assert/strict";
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {after, test} from "node:test";
import {fileURLToPath} from "node:url";
import {CompileFailure} from "../src/diagnostics.js";
import {compileEntry} from "../src/program.js";

const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-frontend-"));
const sdkPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../sdk/index.d.ts");

after(() => rmSync(directory, {recursive: true, force: true}));

test("lowers a static component to one coalesced HTML fragment", () => {
  const hir = compileSource(`
    function Page(): JSX.Element {
      return <html lang="en"><body><h1 className="title">Hello</h1></body></html>;
    }
    export function GET(request: Request): Response {
      return Response.html(<Page />);
    }
  `);

  assert.equal(hir.version, 2);
  assert.equal(hir.handlers[0]?.path, "/");
  assert.equal(hir.components.length, 1);
  assert.deepEqual(hir.components[0]?.html.map(op => op.kind), ["writeStatic"]);
  const stringId = hir.components[0]?.html[0]?.kind === "writeStatic"
    ? hir.components[0].html[0].string
    : -1;
  assert.equal(
    hir.staticStrings[stringId]?.value,
    '<html lang="en"><body><h1 class="title">Hello</h1></body></html>',
  );
  assert.deepEqual(hir.handlers[0]?.response, {kind: "html", component: 0});
  assert.equal(hir.statistics.dynamicHtmlExpressions, 0);
  assert.ok(hir.components[0]?.span.line);
});

test("type-checks Web standard constructors with the DOM declarations", () => {
  const hir = compileSource(`
    const headers = new Headers({"content-type": "text/plain"});
    const url = new URL("https://example.test/path");
    const request = new Request(url, {headers});
    const response = new Response("unused");
    function Page(): JSX.Element { return <p>Web types</p>; }
    export function GET(input: Request): Response {
      return Response.html(<Page />);
    }
  `);

  assert.equal(hir.handlers[0]?.response.kind, "html");
});

test("does not hide unknown Response static properties", () => {
  assert.throws(
    () => compileSource(`
      export function GET(request: Request): Response {
        return Response.missing("bad");
      }
    `),
    (error: unknown) => error instanceof CompileFailure
      && error.diagnostics[0]?.code === "TS2339",
  );
});

test("lowers nested component calls without a JSX object tree", () => {
  const hir = compileSource(`
    function Heading(): JSX.Element { return <h1>Hello</h1>; }
    function Page(): JSX.Element { return <main><Heading /></main>; }
    export function GET(request: Request): Response { return Response.html(<Page />); }
  `);

  assert.deepEqual(hir.components[1]?.html.map(op => op.kind), [
    "writeStatic",
    "callComponent",
    "writeStatic",
  ]);
});

test("compiles an imported component through the runtime module graph", () => {
  const moduleName = crypto.randomUUID();
  writeFileSync(path.join(directory, `${moduleName}.tsx`), `
    export function Heading(): JSX.Element { return <h1>Hello from a module</h1>; }
  `);
  const entry = path.join(directory, `${crypto.randomUUID()}.tsx`);
  writeFileSync(entry, `
    import {Heading} from "./${moduleName}.js";
    function Page(): JSX.Element { return <main><Heading /></main>; }
    export function GET(request: Request): Response { return Response.html(<Page />); }
  `);

  const hir = compileEntry(entry, {sdkPath});

  assert.equal(hir.modules.length, 2);
  assert.equal(hir.statistics.modules, 2);
  assert.deepEqual(hir.components.map(component => component.name), ["Page", "Heading"]);
  assert.deepEqual(hir.components[0]?.html.map(op => op.kind), [
    "writeStatic",
    "callComponent",
    "writeStatic",
  ]);
  assert.equal(hir.components[0]?.html[1]?.kind === "callComponent"
    ? hir.components[0].html[1].component
    : -1, 1);
});

test("carries staged closed values into the typed HIR constant pool", () => {
  const hir = compileSource(`
    const METHODS = ["get", "post"] as const;
    const CONFIG = {
      methods: [...METHODS, "all"],
      strict: true,
      retries: 2,
      fallback: null,
      timeout: undefined,
      generation: 9007199254740993n,
    } as const;
    function Page(): JSX.Element { return <h1>Hello</h1>; }
    export function GET(request: Request): Response { return Response.html(<Page />); }
  `);

  assert.equal(hir.statistics.constants, 2);
  assert.deepEqual(hir.constants.map(constant => constant.name), ["METHODS", "CONFIG"]);
  assert.deepEqual(hir.constants[1]?.value, {
    kind: "record",
    fields: [
      {
        name: "methods",
        value: {
          kind: "array",
          items: ["get", "post", "all"].map(value => ({kind: "string", value})),
        },
      },
      {name: "strict", value: {kind: "boolean", value: true}},
      {name: "retries", value: {kind: "number", value: 2}},
      {name: "fallback", value: {kind: "null"}},
      {name: "timeout", value: {kind: "undefined"}},
      {name: "generation", value: {kind: "bigint", value: "9007199254740993"}},
    ],
  });
});

test("lowers imported string functions and direct calls for Response.text", () => {
  const suffix = crypto.randomUUID();
  const constants = path.join(directory, `constants-${suffix}.ts`);
  const functions = path.join(directory, `functions-${suffix}.ts`);
  writeFileSync(constants, 'export const MESSAGE = "Hello from native functions";');
  writeFileSync(functions, `
    import {MESSAGE} from "./constants-${suffix}.js";
    export function message(): string { return MESSAGE; }
  `);
  const entry = path.join(directory, `text-${suffix}.ts`);
  writeFileSync(entry, `
    import {message} from "./functions-${suffix}.js";
    function greeting(): string { return message(); }
    export function GET(request: Request): Response { return Response.text(greeting()); }
  `);

  const hir = compileEntry(entry, {sdkPath});

  assert.equal(hir.components.length, 0);
  assert.equal(hir.statistics.functions, 2);
  assert.deepEqual(hir.functions.map(func => func.name), ["greeting", "message"]);
  assert.deepEqual(hir.functions[0]?.body, {
    kind: "directCall",
    function: 1,
    arguments: [],
    span: hir.functions[0]?.body.span,
  });
  assert.deepEqual(hir.functions[1]?.body, {
    kind: "constant",
    constant: 0,
    span: hir.functions[1]?.body.span,
  });
  assert.deepEqual(hir.handlers[0]?.response, {
    kind: "text",
    value: {
      kind: "directCall",
      function: 0,
      arguments: [],
      span: hir.handlers[0]?.response.kind === "text"
        ? hir.handlers[0].response.value.span
        : undefined,
    },
  });
});

test("type-checks an API-backed dependency at its declaration boundary", () => {
  const suffix = crypto.randomUUID();
  const packageDirectory = path.join(directory, `api-backed-${suffix}`);
  const runtime = path.join(packageDirectory, "index.ts");
  const api = path.join(packageDirectory, "index.d.ts");
  const entry = path.join(directory, `api-backed-entry-${suffix}.ts`);
  mkdirSync(packageDirectory);
  writeFileSync(path.join(packageDirectory, "package.json"), '{"name":"api-backed"}');
  writeFileSync(runtime, `
    const dependencyInternalTypeError: string = 1;
    export const PUBLIC = "typed at the public boundary";
  `);
  writeFileSync(api, "export declare const PUBLIC: string;");
  writeFileSync(entry, `
    import {PUBLIC} from "api-backed";
    const typedAtPublicBoundary: string = PUBLIC;
    export function GET(request: Request): Response { return Response.text(typedAtPublicBoundary); }
  `);

  const hir = compileEntry(entry, {
    sdkPath,
    aliases: {"api-backed": runtime},
    apiAliases: {"api-backed": api},
  });

  assert.equal(hir.constants.some(constant => constant.name === "typedAtPublicBoundary"), true);
});

test("rejects recursive functions before native code generation", () => {
  assert.throws(
    () => compileSource(`
      function recursive(): string { return recursive(); }
      export function GET(request: Request): Response { return Response.text(recursive()); }
    `),
    (error: unknown) => error instanceof CompileFailure
      && error.diagnostics[0]?.code === "TINY1305",
  );
});

test("lowers string parameters and direct-call arguments", () => {
  const hir = compileSource(`
    const MESSAGE = "Hono!!";
    function identity(value: string): string { return value; }
    function greeting(value: string): string { return identity(value); }
    export function GET(request: Request): Response {
      return Response.text(greeting(MESSAGE));
    }
  `);

  assert.deepEqual(hir.functions.map(func => ({
    name: func.name,
    parameters: func.parameters.map(parameter => [parameter.name, parameter.type]),
  })), [
    {name: "greeting", parameters: [["value", "string"]]},
    {name: "identity", parameters: [["value", "string"]]},
  ]);
  assert.equal(hir.functions[0]?.body.kind, "directCall");
  assert.deepEqual(
    hir.functions[0]?.body.kind === "directCall"
      ? hir.functions[0].body.arguments.map(argument => argument.kind)
      : [],
    ["parameter"],
  );
  assert.equal(hir.handlers[0]?.response.kind, "text");
  assert.deepEqual(
    hir.handlers[0]?.response.kind === "text"
      && hir.handlers[0].response.value.kind === "directCall"
      ? hir.handlers[0].response.value.arguments.map(argument => argument.kind)
      : [],
    ["constant"],
  );
});

test("lowers immutable string locals and runtime equality branches", () => {
  const hir = compileSource(`
    function select(value: string): string {
      const local = value;
      if (local === "admin") return "allowed";
      return "denied";
    }
    export function GET(request: Request): Response {
      return Response.text(select("admin"));
    }
  `);

  assert.equal(hir.functions[0]?.body.kind, "stringEqualConditional");
  assert.deepEqual(
    hir.functions[0]?.body.kind === "stringEqualConditional"
      ? {
          left: hir.functions[0].body.left.kind,
          right: hir.functions[0].body.right.kind,
          whenEqual: hir.functions[0].body.whenEqual.kind,
          whenNotEqual: hir.functions[0].body.whenNotEqual.kind,
        }
      : undefined,
    {
      left: "parameter",
      right: "stringLiteral",
      whenEqual: "stringLiteral",
      whenNotEqual: "stringLiteral",
    },
  );
});

test("lambda-lifts closed local function values and immutable captures", () => {
  const hir = compileSource(`
    function authorize(result: string): string {
      const expected = "admin";
      const decide = (candidate: string): string => {
        if (candidate === expected) return result;
        return "denied";
      };
      return decide("admin");
    }
    export function GET(request: Request): Response {
      return Response.text(authorize("allowed"));
    }
  `);

  assert.deepEqual(hir.functions.map(func => ({
    name: func.name,
    parameters: func.parameters.map(parameter => parameter.name),
    body: func.body.kind,
  })), [
    {name: "authorize", parameters: ["result"], body: "directCall"},
    {
      name: "authorize.decide",
      parameters: ["candidate", "$capture.expected", "$capture.result"],
      body: "stringEqualConditional",
    },
  ]);
  const call = hir.functions[0]?.body;
  assert.deepEqual(
    call?.kind === "directCall" ? call.arguments.map(argument => argument.kind) : [],
    ["stringLiteral", "stringLiteral", "parameter"],
  );
});

test("lowers thrown strings across direct calls into native try/catch", () => {
  const hir = compileSource(`
    function risky(value: string): string {
      if (value === "bad") throw "bad";
      return value;
    }
    function recover(value: string): string {
      try {
        return risky(value);
      } catch (error: any) {
        return error;
      }
    }
    export function GET(request: Request): Response {
      return Response.text(recover("bad"));
    }
  `);

  assert.deepEqual(hir.functions.map(func => [func.name, func.body.kind]), [
    ["recover", "tryCatch"],
    ["risky", "stringEqualConditional"],
  ]);
  const recovery = hir.functions[0]?.body;
  assert.equal(recovery?.kind === "tryCatch" ? recovery.tryValue.kind : undefined, "directCall");
  assert.equal(recovery?.kind === "tryCatch" ? recovery.catchValue.kind : undefined, "caughtException");
  const risky = hir.functions[1]?.body;
  assert.equal(
    risky?.kind === "stringEqualConditional" ? risky.whenEqual.kind : undefined,
    "throwValue",
  );
});

test("ignores unsupported exception syntax outside the reachable function graph", () => {
  const hir = compileSource(`
    function unused(): string {
      try {
        throw new Error("unused");
      } catch {
        return "unused";
      }
    }
    export function GET(request: Request): Response {
      return Response.text("reachable");
    }
  `);

  assert.equal(hir.statistics.functions, 0);
  assert.equal(hir.handlers[0]?.response.kind, "text");
});

test("lowers a closed class field and immediate method call", () => {
  const hir = compileSource(`
    const MESSAGE = "Hono!!";
    class TextContext {
      constructor(readonly body: string) {}
      render(): string { return this.body; }
    }
    export function GET(request: Request): Response {
      return Response.text(new TextContext(MESSAGE).render());
    }
  `);

  assert.equal(hir.functions[0]?.name, "TextContext.render");
  assert.deepEqual(
    hir.functions[0]?.parameters.map(parameter => [parameter.name, parameter.type]),
    [["this.body", "string"]],
  );
  assert.equal(hir.functions[0]?.body.kind, "parameter");
  assert.deepEqual(
    hir.handlers[0]?.response.kind === "text"
      && hir.handlers[0].response.value.kind === "directCall"
      ? hir.handlers[0].response.value.arguments.map(argument => argument.kind)
      : [],
    ["constant"],
  );
});

test("rejects inheritance outside the closed class slice", () => {
  assert.throws(
    () => compileSource(`
      class Base {
        constructor(readonly value: string) {}
        text(): string { return this.value; }
      }
      class Derived extends Base {}
      export function GET(request: Request): Response {
        return Response.text(new Derived("bad").text());
      }
    `),
    (error: unknown) => error instanceof CompileFailure
      && error.diagnostics[0]?.code === "TINY1314",
  );
});

for (const [name, source, code] of [
  ["any component props", `function Bad(value: any): JSX.Element { return <p>Bad</p>; }`, "TINY1102"],
  ["async", `async function Bad(): Promise<void> {}`, "TINY1003"],
  ["computed properties", `const key = "x"; const value = ({x: 1})[key];`, "TINY1004"],
  ["event attributes", `function Bad(): JSX.Element { return <button onClick="x">Bad</button>; }`, "TINY1204"],
] as const) {
  test(`rejects ${name}`, () => {
    assert.throws(
      () => compileSource(`${source}\nexport function GET(request: Request): Response { return Response.html(<Bad />); }`),
      (error: unknown) => error instanceof CompileFailure && error.diagnostics[0]?.code === code,
    );
  });
}

function compileSource(source: string) {
  const entry = path.join(directory, `${crypto.randomUUID()}.tsx`);
  writeFileSync(entry, source);
  return compileEntry(entry, {sdkPath});
}
