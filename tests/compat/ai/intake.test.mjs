import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import path from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {auditCompatibility} from "../../../frontend/dist/src/compatibility-audit.js";

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const manifest = JSON.parse(readFileSync(
  path.join(repository, "tests/compat/ai/manifest.json"),
  "utf8",
));
const lock = JSON.parse(readFileSync(
  path.join(repository, "tests/compat/ai/package-lock.json"),
  "utf8",
));

test("pins the exact AI SDK source and published dependency graph", () => {
  const revision = execFileSync(
    "git",
    ["-C", path.join(repository, manifest.upstream.path), "rev-parse", "HEAD"],
    {encoding: "utf8"},
  ).trim();
  assert.equal(revision, manifest.upstream.commit);

  for (const [name, expected] of Object.entries(manifest.packages)) {
    const installed = lock.packages[`node_modules/${name}`];
    assert.equal(installed?.version, expected.version, name);
    if (expected.integrity !== undefined) {
      assert.equal(installed?.integrity, expected.integrity, name);
    }
  }
});

test("imports the installed AI SDK Core package", async () => {
  const installed = await import("ai");
  assert.equal(typeof installed.generateText, "function");
  assert.equal(typeof installed.streamText, "function");
});

test("audits the exact source graph with no unresolved runtime imports", () => {
  const report = auditCompatibility(path.join(repository, manifest.smokeEntry), {
    root: repository,
    aliases: runtimeAliases(),
  });
  assertAudit(report, manifest.audit);
});

test("audits the pinned OpenAI-compatible provider graph", () => {
  const report = auditCompatibility(path.join(repository, manifest.providerEntry), {
    root: repository,
    aliases: {
      ...runtimeAliases(),
      hono: path.join(repository, "vendor/hono/src/index.ts"),
    },
  });
  assertAudit(report, manifest.providerAudit);
});

function assertAudit(report, expected) {
  const requirements = Object.fromEntries(report.requirements.map(requirement => [
    requirement.feature,
    requirement.occurrences,
  ]));
  const builtins = Object.fromEntries(report.builtins.map(builtin => [
    builtin.name,
    builtin.occurrences,
  ]));

  assert.deepEqual(report.diagnostics, []);
  assert.deepEqual(report.statistics, {
    modules: expected.modules,
    sourceBytes: expected.sourceBytes,
    sourceLines: expected.sourceLines,
  });
  for (const [feature, occurrences] of Object.entries(expected.requirements)) {
    assert.equal(requirements[feature], occurrences, feature);
  }
  for (const [name, occurrences] of Object.entries(expected.builtins)) {
    assert.equal(builtins[name], occurrences, name);
  }
  assert.deepEqual({
    constantBindings: report.staging.constantBindings,
    constantSpreads: report.staging.constantSpreads,
    runtimeSpreads: report.staging.runtimeSpreads,
    closedComputedAccesses: report.staging.closedComputedAccesses,
    runtimeComputedAccesses: report.staging.runtimeComputedAccesses,
  }, expected.staging);
}

function runtimeAliases() {
  return Object.fromEntries(Object.entries(manifest.runtimeAliases).map(([name, target]) => [
    name,
    path.join(repository, target),
  ]));
}
