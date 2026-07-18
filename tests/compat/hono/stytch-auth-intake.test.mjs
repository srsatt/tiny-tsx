import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import path from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const manifest = JSON.parse(readFileSync(
  path.join(repository, "tests/compat/hono/examples-manifest.json"),
  "utf8",
));
const tracer = manifest.nextTracer;
const frontendCli = path.join(repository, "frontend/dist/src/cli.js");

test("pins the next real-world Hono backend without widening its boundary", () => {
  assert.equal(tracer.id, "upstream-stytch-auth-todo-backend");
  assert.equal(tracer.upstreamCommit, manifest.upstream.commit);
  assert.equal(tracer.intake.status, "audit-pass");
  assert.equal(tracer.nativeCompile.status, "not-admitted");
  assert.equal(tracer.httpBehavior.status, "not-admitted");
  assert.match(tracer.firstUnsupportedBoundary, /React\/Vite/);
  assert.match(tracer.firstUnsupportedBoundary, /live Stytch/);

  for (const file of tracer.files) {
    const source = readFileSync(path.join(repository, file.path));
    assert.equal(createHash("sha256").update(source).digest("hex"), file.sha256, file.path);
  }

  const packageJson = JSON.parse(readFileSync(
    path.join(repository, tracer.packageDeclaration.path),
    "utf8",
  ));
  assert.equal(
    packageJson.dependencies[tracer.packageDeclaration.specifier],
    tracer.packageDeclaration.declaredRange,
  );
  assert.equal(tracer.packageDeclaration.resolvedVersion, null);
});

test("retains the exact TodoService language requirements before native admission", () => {
  const audit = runAudit(tracer.serviceEntry);
  assert.deepEqual(audit.diagnostics, []);
  assert.equal(audit.statistics.modules, 1);
  assert.deepEqual(Object.fromEntries(audit.requirements.map(item => [item.feature, item.occurrences])), {
    "functions-as-values": 9,
    classes: 1,
    "private-fields": 4,
    "async-await": 10,
    "object-literals": 1,
    "array-literals": 1,
    "new-expressions": 1,
  });
  assert.deepEqual(audit.builtins, [{name: "Promise", occurrences: 5}]);
  assert.equal(audit.staging.runtimeSpreads, 0);

  const source = readFileSync(path.join(repository, tracer.serviceEntry), "utf8");
  for (const operation of ["todos.sort", "todos.push", "todos.filter", "todos.find"]) {
    assert.ok(source.includes(operation), operation);
  }
  assert.match(source, /class TodoService/);
  assert.match(source, /#set = async/);
});

test("audits the complete backend graph with only the declared auth package unresolved", () => {
  const audit = runAudit(tracer.entry, [
    "--alias", "hono=vendor/hono/src/index.ts",
    "--alias", "hono/cors=vendor/hono/src/middleware/cors/index.ts",
  ]);
  assert.deepEqual(audit.diagnostics.map(({code, message}) => ({code, message})), [{
    code: "TINY2002",
    message: "could not resolve runtime import `@hono/stytch-auth`",
  }]);

  const modules = new Set(audit.modules.map(module => module.path));
  for (const file of tracer.files.map(file => file.path)) assert.ok(modules.has(file), file);

  const entry = readFileSync(path.join(repository, tracer.entry), "utf8");
  const api = readFileSync(path.join(repository, tracer.apiEntry), "utf8");
  assert.match(entry, /\.route\('\/api', TodoAPI\)/);
  assert.match(entry, /\.mount\('\/', \(req, env\) => env\.ASSETS\.fetch\(req\)\)/);
  assert.equal([...api.matchAll(/\.(?:get|post|delete)\('/g)].length, 4);
  assert.match(api, /Consumer\.authenticateSessionLocal\(\)/);
  assert.match(api, /Consumer\.authenticateSessionRemote\(\)/);
});

function runAudit(entry, extra = []) {
  const result = spawnSync(process.execPath, [
    frontendCli,
    "--audit-compat",
    entry,
    ...extra,
  ], {
    cwd: repository,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  assert.equal(result.error, undefined);
  assert.ok(result.status === 0 || result.status === 1, result.stderr);
  return JSON.parse(result.stdout);
}
