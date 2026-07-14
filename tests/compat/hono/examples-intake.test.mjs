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
