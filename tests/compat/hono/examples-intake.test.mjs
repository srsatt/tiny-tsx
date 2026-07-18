import assert from "node:assert/strict";
import {readFileSync, statSync} from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {test} from "node:test";
import {fileURLToPath} from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const manifest = JSON.parse(readFileSync(
  path.join(repository, "tests/compat/hono/examples-manifest.json"),
  "utf8",
));
const workspace = JSON.parse(readFileSync(path.join(repository, "package.json"), "utf8"));
const releaseSource = readFileSync(path.join(repository, "tools/release.mjs"), "utf8");

test("uses the pinned Hono examples revision", () => {
  const revision = execFileSync(
    "git",
    ["-C", path.join(repository, manifest.upstream.path), "rev-parse", "HEAD"],
    {encoding: "utf8"},
  ).trim();

  assert.equal(revision, manifest.upstream.commit);
});

test("records the example matrix with executable evidence and boundaries", () => {
  const required = [
    "upstream-basic",
    "upstream-jsx-ssr",
    "upstream-body-limit",
    "upstream-request-id",
    "upstream-secure-headers",
    "tinytsx-context-variables",
    "tinytsx-bounded-map",
    "tinytsx-json-body",
    "tinytsx-nested-profile",
    "published-zod-openapi",
    "hono-node-server-entry",
    "tinytsx-serve-entry",
    "tinytsx-environment",
    "tinytsx-user-auth",
    "upstream-serve-static",
    "tinytsx-sqlite-owner",
    "tinytsx-sqlite-callback-transaction",
    "tinytsx-sqlite-wal-load",
    "tinytsx-sqlite-idempotency",
    "tinytsx-sqlite-rollback-load",
    "upstream-blog",
    "tinytsx-actors-messages",
    "tinytsx-actors-restart",
    "tinytsx-actors-supervision",
    "tinytsx-actors-multi-load",
    "upstream-durable-objects-counter",
  ];
  assert.deepEqual(manifest.matrix.map(row => row.id), required);
  for (const row of manifest.matrix) {
    assert.ok(["unchanged-upstream", "official-doc-derived-published-packages", "official-doc-derived-local-tracer", "tinytsx-local", "tinytsx-local-with-pinned-test262", "unchanged-upstream-tracer", "upstream-contract-with-tinytsx-adapter"].includes(row.provenance));
    assert.ok(row.entry.length > 0);
    assert.ok(row.imports.length > 0);
    assert.ok(row.apis.length > 0);
    assert.ok(row.firstUnsupportedBoundary.length > 0);
    assert.equal(JSON.stringify(row).includes('"pending"'), false, `${row.id} has pending evidence`);
    for (const layer of [row.intake, row.nativeCompile, row.httpBehavior, row.referenceBehavior]) {
      assert.ok(layer.status !== undefined || layer.appleArm64 !== undefined);
      if (typeof layer.evidence === "string") {
        assert.ok(statSync(path.join(repository, layer.evidence)), layer.evidence);
      }
    }
  }
});

test("makes every alpha example gate reachable from release verification", () => {
  assert.match(releaseSource, /run\("npm", \["test"\]\)/);
  const directReleaseScripts = [
    "test",
    ...[...releaseSource.matchAll(/run\("npm", \["run", "([^"]+)"\]/g)]
      .map(match => match[1]),
  ];
  const reachable = reachableScripts(directReleaseScripts, workspace.scripts);

  for (const row of manifest.matrix) {
    assert.ok(row.releaseGates.native.length > 0, `${row.id} has no native release gate`);
    if (row.referenceBehavior.status === "not-applicable") {
      assert.deepEqual(row.releaseGates.reference, [], `${row.id} declares a reference gate`);
    } else {
      assert.ok(row.releaseGates.reference.length > 0, `${row.id} has no reference release gate`);
    }
    for (const script of [...row.releaseGates.native, ...row.releaseGates.reference]) {
      assert.equal(typeof workspace.scripts[script], "string", `${row.id}: missing script ${script}`);
      assert.ok(reachable.has(script), `${row.id}: ${script} is not reached by release:verify`);
    }
  }
});

test("prepares the published Hono fixture before frontend tests", () => {
  assert.equal(
    workspace.scripts["prepare:node-server-fixture"],
    "npm ci --prefix tests/compat/node-server",
  );
  assert.match(
    workspace.scripts["test:frontend"],
    /^npm run prepare:node-server-fixture && /,
  );
});

test("prepares the pinned Stytch auth fixture before its intake audit", () => {
  assert.equal(
    workspace.scripts["prepare:stytch-auth-fixture"],
    "npm ci --prefix tests/compat/stytch-auth",
  );
  assert.match(
    workspace.scripts["test:hono-intake"],
    /^npm run prepare:stytch-auth-fixture && /,
  );
});

test("pins the explicit upstream Hono behavior allowlist", () => {
  for (const item of manifest.behaviorAllowlist) {
    assert.equal(item.evidenceMode, "native-derived");
    const upstream = readFileSync(path.join(repository, item.source), "utf8");
    for (const selector of item.selectors) assert.ok(upstream.includes(selector), selector);
    statSync(path.join(repository, item.nativeEvidence));
  }
});

test("pins the complete basic source and its upstream behavior test", () => {
  const source = readFileSync(path.join(repository, manifest.basic.entry), "utf8");
  const upstreamTest = readFileSync(path.join(repository, manifest.basic.test), "utf8");
  const registrations = [...source.matchAll(/\b(?:app|book)\.(?:get|post)\s*\(/g)];

  assert.equal(registrations.length, manifest.basic.expectedRoutes);
  assert.match(source, /app\.use\('\*', poweredBy\(\)\)/);
  assert.match(source, /app\.get\('\/', \(c\) => c\.text\('Hono!!'\)\)/);
  assert.match(upstreamTest, /expect\(res\.status\)\.toBe\(200\)/);
  assert.match(upstreamTest, /expect\(res\.headers\.get\('x-powered-by'\)\)\.toBe\('Hono'\)/);
});

test("pins the complete jsx-ssr source graph and behavior targets", () => {
  const jsxSsr = manifest.jsxSsr;
  const sources = Object.fromEntries(jsxSsr.files.map(file => [
    file,
    readFileSync(path.join(repository, file), "utf8"),
  ]));
  const entry = sources[jsxSsr.entry];
  const registrations = [...entry.matchAll(/\bapp\.get\s*\(/g)];

  assert.equal(registrations.length, jsxSsr.expectedRoutes);
  assert.match(entry, /app\.get\('\/post\/:id\{\[0-9\]\+\}'/);
  assert.match(entry, /posts\.find\(\(post\) => post\.id == id\)/);
  assert.match(entry, /c\.html\(<Top posts=\{posts\} \/>\)/);
  assert.match(sources["vendor/hono-examples/jsx-ssr/src/pages/top.tsx"], /props\.posts\.map/);
  assert.match(sources["vendor/hono-examples/jsx-ssr/src/pages/page.tsx"], /<Page|props\.post\.body/);
  assert.match(sources["vendor/hono-examples/jsx-ssr/src/components/Layout.tsx"], /html`<!DOCTYPE html>/);
  assert.deepEqual(jsxSsr.behavior.root.contains, [
    "<!DOCTYPE html>",
    "<h2>Posts</h2>",
    "こんにちは",
  ]);
  assert.equal(jsxSsr.behavior.missingPost.status, 404);
});

function reachableScripts(roots, scripts) {
  const reachable = new Set();
  const queue = [...roots];
  while (queue.length > 0) {
    const script = queue.shift();
    if (reachable.has(script)) continue;
    assert.equal(typeof scripts[script], "string", `release invokes missing script ${script}`);
    reachable.add(script);
    for (const match of scripts[script].matchAll(/npm run ([\w:-]+)/g)) queue.push(match[1]);
  }
  return reachable;
}
