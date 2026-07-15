import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {test} from "node:test";
import {fileURLToPath} from "node:url";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const manifest = JSON.parse(readFileSync(
  path.join(repository, "tests/compat/hono/examples-manifest.json"),
  "utf8",
));

test("uses the pinned Hono examples revision", () => {
  const revision = execFileSync(
    "git",
    ["-C", path.join(repository, manifest.upstream.path), "rev-parse", "HEAD"],
    {encoding: "utf8"},
  ).trim();

  assert.equal(revision, manifest.upstream.commit);
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
