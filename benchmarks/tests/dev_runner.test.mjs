import assert from "node:assert/strict";
import test from "node:test";

import {parseTimingLine, summarizeSamples} from "../scripts/run_dev.mjs";

test("parses every compiler-reported reload stage", () => {
  assert.deepEqual(parseTimingLine(
    "TinyTSX dev: reload timings: frontend=11ms codegen=2ms assembly=3ms " +
      "link=401ms shutdown=7ms startup=23ms total=447ms",
  ), {
    frontendMs: 11,
    codegenMs: 2,
    assemblyMs: 3,
    linkMs: 401,
    shutdownMs: 7,
    startupMs: 23,
    totalMs: 447,
  });
  assert.equal(parseTimingLine("TinyTSX dev: generation 2 started"), null);
});

test("summarizes retained samples with deterministic percentiles", () => {
  const samples = [
    {totalMs: 30, observedMs: 35},
    {totalMs: 10, observedMs: 15},
    {totalMs: 20, observedMs: 25},
    {totalMs: 40, observedMs: 45},
  ];

  assert.deepEqual(summarizeSamples(samples), {
    totalMs: {min: 10, median: 25, p95: 40, max: 40},
    observedMs: {min: 15, median: 30, p95: 45, max: 45},
  });
});
