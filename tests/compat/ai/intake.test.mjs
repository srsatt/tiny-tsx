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
    aliases: Object.fromEntries(Object.entries(manifest.runtimeAliases).map(([name, target]) => [
      name,
      path.join(repository, target),
    ])),
  });
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
    modules: manifest.audit.modules,
    sourceBytes: manifest.audit.sourceBytes,
    sourceLines: manifest.audit.sourceLines,
  });
  for (const [feature, occurrences] of Object.entries(manifest.audit.requirements)) {
    assert.equal(requirements[feature], occurrences, feature);
  }
  for (const [name, occurrences] of Object.entries(manifest.audit.builtins)) {
    assert.equal(builtins[name], occurrences, name);
  }
  assert.deepEqual({
    constantBindings: report.staging.constantBindings,
    constantSpreads: report.staging.constantSpreads,
    runtimeSpreads: report.staging.runtimeSpreads,
    closedComputedAccesses: report.staging.closedComputedAccesses,
    runtimeComputedAccesses: report.staging.runtimeComputedAccesses,
  }, manifest.audit.staging);
});
