import {spawn, spawnSync} from "node:child_process";
import {mkdir, mkdtemp, readFile, rm, writeFile} from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {performance} from "node:perf_hooks";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const timingPattern = /reload timings: frontend=(\d+)ms codegen=(\d+)ms assembly=(\d+)ms link=(\d+)ms shutdown=(\d+)ms startup=(\d+)ms total=(\d+)ms/;

export function parseTimingLine(line) {
  const match = timingPattern.exec(line);
  if (match === null) return null;
  const values = match.slice(1).map(Number);
  return {
    frontendMs: values[0],
    codegenMs: values[1],
    assemblyMs: values[2],
    linkMs: values[3],
    shutdownMs: values[4],
    startupMs: values[5],
    totalMs: values[6],
  };
}

export function summarizeSamples(samples) {
  const metrics = Object.keys(samples[0] ?? {}).filter(key => key.endsWith("Ms"));
  return Object.fromEntries(metrics.map(metric => {
    const values = samples.map(sample => sample[metric]).sort((left, right) => left - right);
    const middle = Math.floor(values.length / 2);
    const median = values.length % 2 === 0
      ? (values[middle - 1] + values[middle]) / 2
      : values[middle];
    return [metric, {
      min: values[0],
      median,
      p95: values[Math.max(0, Math.ceil(values.length * 0.95) - 1)],
      max: values.at(-1),
    }];
  }));
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  await main();
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const compiler = path.resolve(root, options.compiler);
  const scenarios = [simpleScenario(), await honoScenario()];
  const results = [];
  for (const scenario of scenarios) {
    process.stdout.write(`Benchmarking ${scenario.name} (${options.iterations} retained reloads)\n`);
    results.push(await runScenario(compiler, scenario, options.iterations));
  }

  const report = {
    schemaVersion: 1,
    measuredAt: new Date().toISOString(),
    source: {
      commit: git("rev-parse", "HEAD"),
      dirty: git("status", "--porcelain") !== "",
    },
    compiler: {
      path: path.relative(root, compiler),
      version: run(compiler, ["--version"]),
    },
    host: {
      platform: process.platform,
      architecture: process.arch,
      release: os.release(),
      cpu: os.cpus()[0]?.model ?? "unknown",
    },
    iterations: options.iterations,
    thresholds: {
      simpleObservedMedianMs: options.simpleThresholdMs,
      honoObservedMedianMs: options.honoThresholdMs,
    },
    scenarios: results,
  };
  const prefix = path.resolve(root, options.outputPrefix);
  await mkdir(path.dirname(prefix), {recursive: true});
  await writeFile(`${prefix}.json`, `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(`${prefix}.md`, markdown(report));
  process.stdout.write(`${path.relative(root, `${prefix}.json`)}\n${path.relative(root, `${prefix}.md`)}\n`);

  if (options.check) {
    checkThreshold(results[0], options.simpleThresholdMs);
    checkThreshold(results[1], options.honoThresholdMs);
  }
}

async function runScenario(compiler, scenario, iterations) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tinytsx-dev-benchmark-"));
  const port = await availablePort();
  const entry = await scenario.prepare(directory);
  const child = spawn(compiler, ["dev", entry, "--port", String(port), ...scenario.arguments], {
    cwd: directory,
    env: {...process.env, TINYTSX_HOME: root},
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", chunk => output += chunk);
  child.stderr.on("data", chunk => output += chunk);
  try {
    await waitForOutput(() => output, "TinyTSX dev: watching", child, 30_000);
    await waitForBody(port, scenario.initialBody, child, () => output);
    const samples = [];
    for (let iteration = 0; iteration <= iterations; iteration++) {
      const offset = output.length;
      const expectedBody = await scenario.mutate(directory, iteration);
      const started = performance.now();
      const timings = await waitForTimings(() => output.slice(offset), child, 30_000);
      await waitForBody(port, expectedBody, child, () => output);
      const observedMs = Number((performance.now() - started).toFixed(3));
      if (iteration > 0) samples.push({generation: iteration + 2, ...timings, observedMs});
    }
    return {
      name: scenario.name,
      source: scenario.source,
      samples,
      summary: summarizeSamples(samples),
    };
  } finally {
    await stop(child);
    await rm(directory, {recursive: true, force: true});
  }
}

function simpleScenario() {
  return {
    name: "simple-transitive-module",
    source: "generated two-module Request/Response server",
    arguments: [],
    initialBody: "initial",
    async prepare(directory) {
      await writeFile(path.join(directory, "message.ts"), 'export const MESSAGE = "initial";\n');
      const entry = path.join(directory, "server.ts");
      await writeFile(entry, [
        'import {MESSAGE} from "./message.js";',
        "export function GET(_request: Request): Response {",
        "  return Response.text(MESSAGE);",
        "}",
        "",
      ].join("\n"));
      return entry;
    },
    async mutate(directory, iteration) {
      const value = `reload-${iteration}`;
      await writeFile(path.join(directory, "message.ts"), `export const MESSAGE = "${value}";\n`);
      return value;
    },
  };
}

async function honoScenario() {
  const sourcePath = path.join(root, "vendor/hono-examples/basic/src/index.ts");
  const source = await readFile(sourcePath, "utf8");
  const aliases = [
    ["hono", "vendor/hono/src/index.ts", "tests/compat/hono/api.d.ts"],
    ["hono/basic-auth", "vendor/hono/src/middleware/basic-auth/index.ts", "tests/compat/hono/basic-auth-api.d.ts"],
    ["hono/etag", "vendor/hono/src/middleware/etag/index.ts", "tests/compat/hono/etag-api.d.ts"],
    ["hono/powered-by", "vendor/hono/src/middleware/powered-by/index.ts", "tests/compat/hono/powered-by-api.d.ts"],
    ["hono/pretty-json", "vendor/hono/src/middleware/pretty-json/index.ts", "tests/compat/hono/pretty-json-api.d.ts"],
  ];
  return {
    name: "pinned-hono-basic",
    source: "vendor/hono-examples/basic/src/index.ts",
    initialBody: "Hono!!",
    arguments: aliases.flatMap(([name, implementation, api]) => [
      "--alias", `${name}=${path.join(root, implementation)}`,
      "--api", `${name}=${path.join(root, api)}`,
    ]),
    async prepare(directory) {
      const entry = path.join(directory, "index.ts");
      await writeFile(entry, source);
      return entry;
    },
    async mutate(directory, iteration) {
      await writeFile(path.join(directory, "index.ts"), `${source}\n// dev benchmark generation ${iteration}\n`);
      return "Hono!!";
    },
  };
}

async function waitForOutput(getOutput, expected, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    ensureRunning(child, getOutput);
    if (getOutput().includes(expected)) return;
    await delay(25);
  }
  throw new Error(`timed out waiting for ${expected}\n${getOutput()}`);
}

async function waitForTimings(getOutput, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    ensureRunning(child, getOutput);
    const timings = parseTimingLine(getOutput());
    if (timings !== null) return timings;
    await delay(25);
  }
  throw new Error(`timed out waiting for reload timings\n${getOutput()}`);
}

async function waitForBody(port, expected, child, getOutput) {
  const deadline = Date.now() + 30_000;
  let actual = "";
  while (Date.now() < deadline) {
    ensureRunning(child, getOutput);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, {headers: {connection: "close"}});
      actual = await response.text();
      if (response.status === 200 && actual === expected) return;
    } catch {
      // The current generation can close while the next listener starts.
    }
    await delay(25);
  }
  throw new Error(`timed out waiting for HTTP body ${JSON.stringify(expected)}; got ${JSON.stringify(actual)}\n${getOutput()}`);
}

function ensureRunning(child, getOutput) {
  if (child.exitCode !== null || child.signalCode !== null) {
    throw new Error(`dev process exited (${child.exitCode ?? child.signalCode})\n${getOutput()}`);
  }
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  terminate(child, "SIGTERM");
  await Promise.race([
    new Promise(resolve => child.once("exit", resolve)),
    delay(2_000),
  ]);
  if (child.exitCode === null && child.signalCode === null) terminate(child, "SIGKILL");
}

function terminate(child, signal) {
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function markdown(report) {
  const lines = [
    "# TinyTSX dev reload benchmark",
    "",
    `- Measured: ${report.measuredAt}`,
    `- Source: \`${report.source.commit}\` (${report.source.dirty ? "dirty" : "clean"})`,
    `- Host: ${report.host.cpu}; ${report.host.platform}/${report.host.architecture}`,
    `- Compiler: \`${report.compiler.version}\``,
    `- Retained reloads: ${report.iterations} per scenario`,
    "",
    "| Scenario | Metric | Median | p95 | Min | Max |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
  ];
  for (const scenario of report.scenarios) {
    for (const [metric, values] of Object.entries(scenario.summary)) {
      lines.push(`| ${scenario.name} | ${metric} | ${values.median} ms | ${values.p95} ms | ${values.min} ms | ${values.max} ms |`);
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function checkThreshold(scenario, threshold) {
  const actual = scenario.summary.observedMs.median;
  if (actual > threshold) {
    throw new Error(`${scenario.name} observed median ${actual}ms exceeds ${threshold}ms`);
  }
}

function parseOptions(args) {
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const options = {
    compiler: "target/release/tinytsx",
    iterations: 7,
    outputPrefix: `.tinytsx/benchmarks/dev-${timestamp}`,
    simpleThresholdMs: 1_500,
    honoThresholdMs: 2_500,
    check: false,
  };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--compiler") options.compiler = value(args, ++index, argument);
    else if (argument === "--iterations") options.iterations = positive(value(args, ++index, argument));
    else if (argument === "--output-prefix") options.outputPrefix = value(args, ++index, argument);
    else if (argument === "--simple-threshold-ms") options.simpleThresholdMs = positive(value(args, ++index, argument));
    else if (argument === "--hono-threshold-ms") options.honoThresholdMs = positive(value(args, ++index, argument));
    else if (argument === "--check") options.check = true;
    else throw new Error(`unknown option: ${argument}`);
  }
  return options;
}

function value(args, index, option) {
  if (args[index] === undefined) throw new Error(`${option} requires a value`);
  return args[index];
}

function positive(input) {
  const result = Number.parseInt(input, 10);
  if (!Number.isInteger(result) || result < 1) throw new Error(`expected a positive integer: ${input}`);
  return result;
}

function git(...args) {
  return run("git", args);
}

function run(command, args) {
  const result = spawnSync(command, args, {cwd: root, encoding: "utf8"});
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
