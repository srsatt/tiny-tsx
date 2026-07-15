import assert from "node:assert/strict";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {after, test} from "node:test";
import {loadModuleGraph} from "../src/module-graph.js";
import {resolveRuntimeCallable} from "../src/runtime-callable.js";

const directory = mkdtempSync(path.join(tmpdir(), "tinytsx-callable-"));

after(() => rmSync(directory, {recursive: true, force: true}));

test("resolves a callable through star and named barrel re-exports", () => {
  const implementation = path.join(directory, "implementation.ts");
  const feature = path.join(directory, "feature.ts");
  const barrel = path.join(directory, "barrel.ts");
  const entry = path.join(directory, "entry.ts");
  writeFileSync(implementation, "export async function generateText(): Promise<string> { return 'ok'; }");
  writeFileSync(feature, "export {generateText} from './implementation.js';");
  writeFileSync(barrel, "export * from './feature.js';");
  writeFileSync(entry, "import {generateText} from './barrel.js'; void generateText;");

  const graph = loadModuleGraph(entry);
  const modules = new Map(graph.modules.map(module => [module.path, module]));
  const entryModule = modules.get(graph.entry);

  assert.deepEqual(graph.diagnostics, []);
  assert.ok(entryModule !== undefined);
  const callable = resolveRuntimeCallable(modules, entryModule, "generateText");
  assert.equal(callable?.module.path, implementation);
  assert.equal(callable?.declaration.name?.text, "generateText");
});
