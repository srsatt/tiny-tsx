import {createWriteStream, mkdirSync, readFileSync, readdirSync, writeFileSync} from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawn} from "node:child_process";
import {fileURLToPath} from "node:url";

import {pickRunnableTasks, selectTaskIds, validateTasks} from "./test-runner-lib.mjs";
import {profiles, tasks} from "./test-plan.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = parseOptions(process.argv.slice(2));
const byId = validateTasks(tasks);

if (options.help) {
  process.stdout.write(`Usage: node tools/test.mjs [options]\n\n` +
    `  --profile <name>  Test profile (default: default)\n` +
    `  --suite <id>      Run one suite and its prerequisites; repeatable\n` +
    `  --jobs <count>    Maximum parallel tasks (default: min(CPUs, 4))\n` +
    `  --list            List profiles and suites\n` +
    `  --help            Show this help\n`);
  process.exit(0);
}

if (options.list) {
  for (const [name, ids] of Object.entries(profiles)) {
    process.stdout.write(`${name}: ${ids.length} suites\n`);
  }
  process.stdout.write("\nSuites:\n");
  for (const task of tasks.filter(task => !task.hidden)) process.stdout.write(`  ${task.id}\n`);
  process.exit(0);
}

const roots = options.suites.length > 0 ? options.suites : profiles[options.profile];
if (roots === undefined) throw new Error(`unknown test profile: ${options.profile}`);
const selected = selectTaskIds(tasks, roots);
const runTasks = tasks.filter(task => selected.has(task.id));
const runId = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const logDirectory = path.join(root, ".tinytsx", "test-logs", runId);
mkdirSync(logDirectory, {recursive: true});

const children = new Set();
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    interrupted = true;
    terminateAll(signal);
  });
}

const startedAt = Date.now();
process.stdout.write(
  `TinyTSX tests: ${roots.length} suites, ${runTasks.length - roots.length} prerequisites, ` +
  `${options.jobs} jobs\nLogs: ${path.relative(root, logDirectory)}\n`,
);

const pending = new Set(selected);
const completed = new Set();
const running = new Map();
const results = [];
let failure;

while ((pending.size > 0 || running.size > 0) && failure === undefined && !interrupted) {
  const activeResources = new Set(
    [...running.values()].flatMap(({task}) => task.resources ?? []),
  );
  if (running.size > 0) activeResources.add("runner:active");
  if ([...running.values()].some(({task}) => task.exclusive)) {
    activeResources.add("runner:exclusive");
  }
  const ready = pickRunnableTasks(
    runTasks,
    pending,
    completed,
    activeResources,
    options.jobs - running.size,
  );
  for (const task of ready) {
    pending.delete(task.id);
    const promise = runTask(task).then(result => ({task, result}));
    running.set(task.id, {task, promise});
  }
  if (running.size === 0) {
    failure = new Error(`test plan is blocked with ${pending.size} pending task(s)`);
    break;
  }

  const {task, result} = await Promise.race([...running.values()].map(value => value.promise));
  running.delete(task.id);
  results.push(result);
  if (result.ok) {
    completed.add(task.id);
  } else {
    failure = new Error(`${task.id} failed`);
    terminateAll("SIGTERM");
  }
}

if (interrupted && failure === undefined) failure = new Error("test run interrupted");
if (running.size > 0) await Promise.allSettled([...running.values()].map(value => value.promise));

const summary = {
  schemaVersion: 1,
  profile: options.suites.length > 0 ? null : options.profile,
  suites: roots,
  jobs: options.jobs,
  startedAt: new Date(startedAt).toISOString(),
  durationMs: Date.now() - startedAt,
  passed: results.filter(result => result.ok).map(result => result.id),
  failed: results.filter(result => !result.ok).map(result => result.id),
  pending: [...pending],
};
writeFileSync(path.join(logDirectory, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);

if (failure !== undefined) {
  process.stderr.write(`\nFAIL ${failure.message} (${formatDuration(Date.now() - startedAt)})\n`);
  process.exit(1);
}
process.stdout.write(`\nPASS ${roots.length} suites (${formatDuration(Date.now() - startedAt)})\n`);

async function runTask(task) {
  const taskStarted = Date.now();
  const label = task.hidden ? `prepare ${task.id.slice("setup:".length)}` : task.id;
  const logPath = path.join(logDirectory, `${safeName(task.id)}.log`);
  const log = createWriteStream(logPath, {flags: "w"});
  process.stdout.write(`▶ ${label}\n`);
  let outcome = {code: 0, signal: null};
  for (const specification of task.commands) {
    const expanded = expandCommand(specification);
    log.write(`$ ${[expanded.command, ...expanded.args].join(" ")}\n`);
    outcome = await runCommand(expanded, log);
    if (outcome.code !== 0 || outcome.signal !== null) break;
  }
  await new Promise(resolve => log.end(resolve));
  const durationMs = Date.now() - taskStarted;
  const ok = outcome.code === 0 && outcome.signal === null;
  if (ok) {
    process.stdout.write(`✓ ${label} ${formatDuration(durationMs)}\n`);
  } else {
    process.stderr.write(`✗ ${label} ${formatDuration(durationMs)} — ${path.relative(root, logPath)}\n`);
    process.stderr.write(`${tail(logPath, 30)}\n`);
  }
  return {id: task.id, ok, durationMs, code: outcome.code, signal: outcome.signal};
}

function runCommand(specification, log) {
  return new Promise(resolve => {
    const child = spawn(specification.command, specification.args, {
      cwd: root,
      env: {...process.env, TINYTSX_TEST_RUNNER: "1"},
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.add(child);
    child.stdout.pipe(log, {end: false});
    child.stderr.pipe(log, {end: false});
    child.once("error", error => {
      log.write(`${error.stack ?? error}\n`);
      children.delete(child);
      resolve({code: 1, signal: null});
    });
    child.once("exit", (code, signal) => {
      children.delete(child);
      resolve({code: code ?? 1, signal});
    });
  });
}

function terminateAll(signal) {
  for (const child of children) terminate(child, signal);
}

function terminate(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error.code !== "ESRCH") throw error;
  }
}

function expandCommand(specification) {
  const args = [...(specification.args ?? [])];
  for (const pattern of specification.globs ?? []) args.push(...expandGlob(pattern));
  return {command: specification.command, args};
}

function expandGlob(pattern) {
  const directory = path.resolve(root, path.dirname(pattern));
  const basename = path.basename(pattern);
  const expression = new RegExp(`^${basename
    .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
    .replaceAll("*", ".*")}$`);
  const matches = readdirSync(directory)
    .filter(entry => expression.test(entry))
    .sort()
    .map(entry => path.relative(root, path.join(directory, entry)));
  if (matches.length === 0) throw new Error(`glob matched no files: ${pattern}`);
  return matches;
}

function tail(file, lines) {
  return readFileSync(file, "utf8").trimEnd().split("\n").slice(-lines).join("\n");
}

function safeName(value) {
  return value.replaceAll(/[^a-zA-Z0-9_.-]/g, "-");
}

function formatDuration(milliseconds) {
  return milliseconds < 1_000 ? `${milliseconds}ms` : `${(milliseconds / 1_000).toFixed(1)}s`;
}

function parseOptions(args) {
  const parsed = {
    profile: "default",
    suites: [],
    jobs: Math.min(4, os.availableParallelism()),
    list: false,
    help: false,
  };
  const environmentJobs = Number.parseInt(process.env.TINYTSX_TEST_JOBS ?? "", 10);
  if (Number.isInteger(environmentJobs) && environmentJobs > 0) parsed.jobs = environmentJobs;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === "--profile") parsed.profile = requiredValue(args, ++index, argument);
    else if (argument === "--suite") parsed.suites.push(requiredValue(args, ++index, argument));
    else if (argument === "--jobs") parsed.jobs = positiveInteger(requiredValue(args, ++index, argument));
    else if (argument === "--list") parsed.list = true;
    else if (argument === "--help" || argument === "-h") parsed.help = true;
    else throw new Error(`unknown test-runner option: ${argument}`);
  }
  return parsed;
}

function requiredValue(args, index, option) {
  const value = args[index];
  if (value === undefined || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

function positiveInteger(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`jobs must be a positive integer: ${value}`);
  return parsed;
}
