import assert from "node:assert/strict";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
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

  assert.equal(hir.version, 1);
  assert.equal(hir.components.length, 1);
  assert.deepEqual(hir.components[0]?.html.map(op => op.kind), ["writeStatic"]);
  const stringId = hir.components[0]?.html[0]?.kind === "writeStatic"
    ? hir.components[0].html[0].string
    : -1;
  assert.equal(
    hir.staticStrings[stringId]?.value,
    '<html lang="en"><body><h1 class="title">Hello</h1></body></html>',
  );
  assert.equal(hir.handlers[0]?.component, 0);
  assert.equal(hir.statistics.dynamicHtmlExpressions, 0);
  assert.ok(hir.components[0]?.span.line);
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

for (const [name, source, code] of [
  ["any", `function Bad(value: any): JSX.Element { return <p>Bad</p>; }`, "TINY1001"],
  ["classes", `class Bad {}`, "TINY1002"],
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
