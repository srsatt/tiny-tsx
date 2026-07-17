import {cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {spawn, spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const version = "0.1.0-alpha.1";
const target = process.platform === "darwin" && process.arch === "arm64"
  ? "aarch64-apple-darwin"
  : process.platform === "linux" && process.arch === "arm64"
    ? "aarch64-unknown-linux-gnu"
    : undefined;
const allowDirty = process.argv.includes("--allow-dirty");

if (target === undefined) fail(`release archives require native AArch64, got ${process.platform}/${process.arch}`);
if (!allowDirty) {
  const status = run("git", ["status", "--porcelain"], {encoding: "utf8"}).stdout.trim();
  if (status !== "") fail(`release verification requires a clean tree:\n${status}`);
  run("npm", ["test"]);
  run("npm", ["run", "test:zod-openapi-reference"]);
  run("npm", ["run", "test:zod-openapi"]);
  const generated = run("git", ["status", "--porcelain"], {encoding: "utf8"}).stdout.trim();
  if (generated !== "") fail(`release suites changed tracked files:\n${generated}`);
}

run("npm", ["run", "build:frontend"]);
run("cargo", ["build", "--release", "-p", "tinytsx"]);

const releaseRoot = path.join(root, "dist", "release");
const name = `tinytsx-${version}-${target}`;
const staging = path.join(releaseRoot, name);
rmSync(staging, {recursive: true, force: true});
mkdirSync(path.join(staging, "bin"), {recursive: true});
mkdirSync(path.join(staging, "lib", "tinytsx"), {recursive: true});
cpSync(path.join(root, "target", "release", "tinytsx"), path.join(staging, "bin", "tinytsx"));

const resources = path.join(staging, "lib", "tinytsx");
for (const file of ["Cargo.toml", "Cargo.lock", "LICENSE", "CHANGELOG.md", "THIRD_PARTY_NOTICES.md"]) {
  cpSync(path.join(root, file), path.join(resources, file));
}
for (const directory of ["compiler", "runtime", "sdk", "doc"]) {
  cpSync(path.join(root, directory), path.join(resources, directory), {
    recursive: true,
    filter: source => !source.split(path.sep).includes("target"),
  });
}
mkdirSync(path.join(resources, "frontend"), {recursive: true});
for (const file of ["package.json", "package-lock.json"]) {
  cpSync(path.join(root, "frontend", file), path.join(resources, "frontend", file));
}
cpSync(path.join(root, "frontend", "dist"), path.join(resources, "frontend", "dist"), {recursive: true});
cpSync(
  path.join(root, "frontend", "node_modules", "typescript"),
  path.join(resources, "frontend", "node_modules", "typescript"),
  {recursive: true},
);

const versionOutput = run(path.join(staging, "bin", "tinytsx"), ["--version"], {encoding: "utf8"}).stdout.trim();
if (!versionOutput.startsWith(`tinytsx ${version};`)) fail(`unexpected version output: ${versionOutput}`);

const smoke = mkdtempSync(path.join(tmpdir(), "tinytsx-release-smoke-"));
try {
  const entry = path.join(smoke, "server.tsx");
  const binary = path.join(smoke, "server");
  cpSync(path.join(root, "examples", "static-page", "server.tsx"), entry);
  run(path.join(staging, "bin", "tinytsx"), [
    "build", entry, "--output", binary, "--port", "39480", "--release",
  ], {env: {...process.env}});
  const report = JSON.parse(readFileSync(`${binary}.build.json`, "utf8"));
  if (report.compilerVersion !== version || report.hirVersion !== 2 || report.runtimeAbiVersion !== 1) {
    fail("installed build report version fields do not match the release");
  }
  await verifyServer(binary, 39480);
} finally {
  rmSync(smoke, {recursive: true, force: true});
}

mkdirSync(releaseRoot, {recursive: true});
const archive = path.join(releaseRoot, `${name}.tar.gz`);
rmSync(archive, {force: true});
run("tar", ["-czf", archive, "-C", releaseRoot, name]);
const checksum = run("shasum", ["-a", "256", archive], {encoding: "utf8"}).stdout.split(/\s+/)[0];
writeFileSync(`${archive}.sha256`, `${checksum}  ${path.basename(archive)}\n`);
writeFileSync(path.join(releaseRoot, `${name}.manifest.json`), `${JSON.stringify({
  schemaVersion: 1,
  version,
  target,
  archive: path.basename(archive),
  sha256: checksum,
  versionOutput,
  layout: {binary: "bin/tinytsx", resources: "lib/tinytsx"},
  prerequisites: ["Node.js", "Cargo/Rust", "Clang", "target linker", "libcurl"],
}, null, 2)}\n`);
process.stdout.write(`${archive}\n${checksum}\n`);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {cwd: root, stdio: options.encoding ? "pipe" : "inherit", ...options});
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed${result.stderr ? `:\n${result.stderr}` : ""}`);
  return result;
}

async function verifyServer(binary, port) {
  const server = spawn(binary, [], {stdio: ["ignore", "pipe", "pipe"]});
  try {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (server.exitCode !== null) fail(`installed smoke server exited with ${server.exitCode}`);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`);
        const body = await response.text();
        if (response.status !== 200 || !body.includes("Hello from TinyTSX")) {
          fail(`installed smoke response mismatch: ${response.status} ${body}`);
        }
        return;
      } catch {
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    fail("installed smoke server did not start");
  } finally {
    server.kill("SIGTERM");
  }
}

function fail(message) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}
