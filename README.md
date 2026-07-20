# TinyTSX

TinyTSX is an ahead-of-time compiler for a deliberately restricted subset of
TypeScript, TSX, and Hono. It turns supported backend applications into small
native ARM64 or x86-64 HTTP servers with bounded resources and no JavaScript engine in
the generated executable.

> TypeScript syntax. First-class TSX. Native machine code. Bounded request
> memory. No JavaScript engine.

TinyTSX is an experimental developer preview. It is not a general TypeScript
compiler, a JavaScript runtime, or a drop-in replacement for Node.js, Bun, or
the complete Hono ecosystem.

## Why TinyTSX?

JavaScript runtimes offer excellent compatibility and performance, but every
service also carries a dynamic language engine, garbage collector, and runtime
package environment. TinyTSX explores a different trade-off for small backend
services:

- familiar TypeScript, TSX, and selected Hono APIs at development time;
- statically compiled ARM64 or x86-64 application code at runtime;
- no V8, JavaScriptCore, QuickJS, JIT, or runtime JS parser;
- bounded request arenas, queues, actor mailboxes, and database results;
- an event-driven connection reactor backed by fixed reusable executors;
- default-deny environment, filesystem, and persistence capabilities;
- one native executable with no npm runtime dependency;
- approximately 1.9 MiB warm RSS for the closed Hono JSX target and 6 MiB for
  the complete Hono basic target with external Fetch linked.

The compiler rejects reachable behavior outside its supported subset instead
of falling back to interpretation.

## Example

```ts
import { serve } from '@hono/node-server'
import { Hono } from 'hono'

const app = new Hono()

app.get('/', context => context.text('Hello from TinyTSX'))

serve({
  fetch: app.fetch,
  port: 3000,
})
```

Compile it into a native server:

```sh
tinytsx build server.ts --output server --release
./server
curl http://127.0.0.1:3000/
```

The generated `server` process does not load Node.js, Bun, or a JavaScript
engine.

## Project status

The current source version is `0.1.0-alpha.1`. Clean Apple ARM64 and native
Linux ARM64 release verification has passed for the implemented alpha
contract. The repository history was subsequently rewritten to replace the
author identity, so fresh same-commit archives and manifests must be generated
before publishing a Git tag or release assets. No release has been published
yet; [`doc/RELEASE_CHECKLIST.md`](doc/RELEASE_CHECKLIST.md) tracks that gate.

The executable compatibility matrix currently includes:

- complete pinned Hono `basic` and `jsx-ssr` applications;
- `@hono/node-server` and the Hono-neutral `tinytsx:serve` entrypoint;
- selected Hono middleware such as body limits, request IDs, CORS, secure
  headers, Basic Auth, ETag, pretty JSON, and response timing;
- request-time TSX with escaping, route/query/header values, bounded JSON
  bodies, and finite text streaming;
- `@hono/zod-openapi` for one pinned route/schema subset;
- capability-scoped environment and UTF-8 file reads;
- bounded in-memory and on-disk SQLite, prepared statements, and atomic
  callback transactions;
- lightweight local actors, copied bounded messages, restart intensity,
  one-for-one supervision, and SQLite-backed counter persistence;
- the unchanged backend modules from a pinned Hono Stytch TODO example through
  a credential-free session boundary and explicit SQLite KV binding.

Every supported row has native, reference, packaging, or compatibility
evidence. See [`doc/ALPHA.md`](doc/ALPHA.md),
[`doc/COMPATIBILITY.md`](doc/COMPATIBILITY.md), and
[`doc/HONO.md`](doc/HONO.md) for the exact contract and first unsupported
boundary.

## Supported targets

| Target | Status |
| --- | --- |
| Apple Silicon / `aarch64-apple-darwin` | Native build and execution |
| Intel macOS / `x86_64-apple-darwin` | Native build and execution |
| Linux ARM64 / `aarch64-unknown-linux-gnu` | Native build and execution |
| Linux x86-64 / `x86_64-unknown-linux-gnu` | Native build and execution |
| Other cross-host combinations | Assembly inspection only |
| Windows, iOS, WebAssembly | Not supported as application targets |

Final linking normally requires a matching host. Apple Silicon can also link
the Intel macOS target when Rust's `x86_64-apple-darwin` standard library is
installed; the resulting binary runs through Rosetta 2.

## Build from source

### Prerequisites

- macOS with Xcode Command Line Tools, or Linux with Clang and libcurl
  development files, on ARM64 or x86-64;
- a recent Node.js and npm installation;
- a recent stable Rust toolchain with Cargo;
- Git with submodule support.

Bun is used only for reference tests and benchmarks. It is not required to
compile or run a TinyTSX server.

### Build the compiler

```sh
git clone --recurse-submodules https://github.com/srsatt/tiny-tsx.git
cd tiny-tsx

npm ci --prefix frontend
npm run build:frontend
cargo build --release -p tinytsx
export TINYTSX_HOME="$PWD"
```

The compiler is now available at `target/release/tinytsx`:

```sh
./target/release/tinytsx --version
./target/release/tinytsx --list-builtins
```

`TINYTSX_HOME` points a source-built optimized compiler at the repository's
frontend, SDK, runtime crates, and pinned compatibility resources. An installed
release archive discovers the equivalent `lib/tinytsx` directory beside its
`bin/tinytsx` automatically.

### Run a repository example

Install the examples' compile-time packages and build the Hono server:

```sh
npm ci --prefix examples

./target/release/tinytsx build \
  examples/hono-node-server/server.ts \
  --output dist/hono-server \
  --release

./dist/hono-server
```

Then request it from another terminal:

```sh
curl -i http://127.0.0.1:3000/
```

[`examples/README.md`](examples/README.md) lists the packaged Hono, file,
SQLite, actor, and Stytch TODO examples with their exact build commands.

## CLI

```text
tinytsx check <entry.tsx> [options]
tinytsx build <entry.tsx> [options]
tinytsx run <entry.tsx> [options]
tinytsx dev <entry.tsx> [options] [--restart-timeout-ms 2000]
tinytsx test262 <case.js> [--output path]
tinytsx wpt <case.js> [--output path]
tinytsx --list-builtins
tinytsx --version
```

Common build options include:

```text
--output <path>            Output executable
--target <triple>          Native target
--port <number>            Static server port
--workers <count>          Fixed HTTP worker count
--request-memory <bytes>   Per-request arena size
--release                  Optimized runtime build
--emit-hir                 Retain typed HIR JSON
--emit-asm                 Retain generated target assembly
--alias <specifier=path>   Runtime source alias
--api <specifier=path>     Declaration overlay
--binding <name=value>     Explicit native resource binding
--asset <name=directory>   Embed one bounded static asset directory
--bind <name=/abs/path>    Runtime value for run/dev deploy-time bindings
--allow-env <name>         Permit one environment value
--allow-read <root>        Permit filesystem/database reads
--allow-write <root>       Permit database writes
```

`tinytsx run` performs one build and starts it. `tinytsx dev` keeps the
TypeScript frontend and native runtime cache warm, watches the reachable module
graph, and replaces the child server after a successful rebuild. A failed edit
leaves the last known-good server running. SQLite and files survive a reload;
actors, workers, connections, and other process-local state restart. Every
successful reload reports frontend, code generation, assembly, link, shutdown,
startup, and total edit-to-listening time. Every build also writes a
machine-readable `<output>.build.json` report.

The default `--workers 1` is intentional. It is fastest for the measured closed
CPU-bound Hono routes; increase it only after a blocking-I/O or compute-heavy
workload shows a benefit.

## ESLint syntax preflight

The repository includes `eslint-plugin-tinytsx` for fast editor feedback
without invoking the compiler. From a source checkout, install it into an
application together with ESLint's TypeScript parser:

```sh
npm install --save-dev eslint typescript-eslint \
  ./packages/eslint-plugin-tinytsx
```

Configure the rule for TypeScript and TSX application files:

```js
// eslint.config.mjs
import tinytsx from 'eslint-plugin-tinytsx'
import tseslint from 'typescript-eslint'

export default [{
  files: ['**/*.{ts,tsx}'],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {ecmaFeatures: {jsx: true}},
  },
  plugins: {tinytsx},
  rules: {'tinytsx/no-unsupported-syntax': 'error'},
}]
```

The rule catches locally identifiable unsupported constructs such as runtime
code generation, generators, dynamic imports, dynamic computed access,
TypeScript runtime namespaces/enums, and unsupported
intrinsic JSX attributes. It intentionally permits async/await, classes,
loops, arrays, records, closures, and spread because TinyTSX supports bounded
forms that require compiler analysis. Ambient `.d.ts` declarations are ignored.

Linting is a preflight, not a compatibility proof. Run `tinytsx check` before
building: only the compiler can validate compile-time closure, the pinned Hono
and Web API surface, resource bounds, capabilities, imports, and lifetimes.
The complete rule and configuration reference is in
[`packages/eslint-plugin-tinytsx/README.md`](packages/eslint-plugin-tinytsx/README.md).

## Backend standard library

TinyTSX exposes a small protected backend API rather than emulating Node.js:

| Module | Purpose |
| --- | --- |
| `tinytsx:env` | Immutable, explicitly permitted startup environment values |
| `tinytsx:fs` | Capability-scoped bounded UTF-8 file reads |
| `tinytsx:sqlite` | Single-owner bounded SQLite operations, transactions, and deploy-time read-only databases |
| `tinytsx:assets` | Deterministic binary asset stores with MIME, ETag, HEAD, and SPA fallback support |
| `tinytsx:actors` | Lightweight local actors on a fixed native executor pool |
| `tinytsx:serve` | Hono-neutral native HTTP entrypoint |

These module names are compiler-protected and cannot be shadowed by
`node_modules`. Their ownership, limits, and failure behavior are documented in
[`doc/STANDARD_LIBRARY.md`](doc/STANDARD_LIBRARY.md),
[`doc/PERSISTENCE.md`](doc/PERSISTENCE.md), and
[`doc/ACTORS.md`](doc/ACTORS.md).

## Resource and security model

TinyTSX is designed around explicit bounds rather than a general managed heap:

- request-time dynamic values live in a fixed request arena;
- request out-of-memory is isolated and recoverable;
- HTTP and application executors use bounded queues;
- actor mailboxes and copied messages have fixed limits;
- SQLite owners serialize access and bound parameters, rows, and result bytes;
- filesystem, database, and environment access is denied unless granted at
  compile time; deploy-time read-only database paths must also be bound before
  the listener starts;
- unsupported dynamic lifetime or identity requirements fail compilation.

This model reduces runtime state, but it is not an operating-system sandbox.
Deploy the generated executable with normal process, filesystem, network, and
container isolation.

For a database owned by another service, declare only its capability name at
build time and supply the absolute path at deployment:

```ts
import {openReadonlyDatabase} from "tinytsx:sqlite";

const database = openReadonlyDatabase("AIR_DB");
const readings = database.prepare("SELECT recorded_at, co2 FROM readings");
```

```sh
tinytsx build server.ts --binding AIR_DB=sqlite-ro --output dist/server
./dist/server --bind AIR_DB=/srv/air/readings.db
```

`tinytsx run` and `tinytsx dev` accept the same `--bind` pair and forward it to
every generated process. Missing, duplicate, unknown, relative, absent, or
unsafe bindings fail before the HTTP listener opens. Read-only statements expose
only `all()` and `get()`; write operations fail compilation.

To embed a Vite output directory, name the store in source and bind its bytes at
build time:

```ts
import {openAssets} from "tinytsx:assets";

const web = openAssets("WEB", {index: "index.html", spaFallback: true});
app.get("*", context => web.fetch(context.req.raw));
```

```sh
tinytsx build server.ts --asset WEB=web/dist --output dist/server
```

The directory is traversed deterministically and becomes part of the executable;
it is not read at runtime. Symbolic links and non-regular files are rejected.
One store is limited to 1,024 files, 4 MiB per file, and 16 MiB total. Exact
paths, `HEAD`, MIME types, stable ETags/304, index routing, and optional SPA
fallback are supported; traversal never falls back to the index.

## Performance

The current response-checked M5 Max comparison uses one TinyTSX worker, one Bun
server process, keep-alive, and three five-second samples:

| Workload | Warm RSS, Tiny/Bun | RPS c8, Tiny/Bun | RPS c64, Tiny/Bun | p99 c64, Tiny/Bun |
| --- | ---: | ---: | ---: | ---: |
| Complete Hono basic | 6.03 / 123.61 MiB | 159,254 / 133,619 | 207,084 / 150,446 | 0.537 / 0.896 ms |
| Closed Hono JSX SSR | 1.89 / 123.78 MiB | 158,740 / 99,255 | 207,873 / 102,656 | 0.513 / 1.184 ms |

Startup medians are 13.13ms versus Bun's 26.75ms for basic and 11.93ms versus
26.37ms for JSX. Both reports pass the repository's core performance gate.
This supports a strong claim for the exact AOT-closed applications, not a
general AOT-versus-JIT claim. Request-time file reads are close but still below
Bun, and SQLite/actor mailbox paths remain explicit optimization targets.

See [`doc/PERFORMANCE.md`](doc/PERFORMANCE.md) and
[`benchmarks/README.md`](benchmarks/README.md) for protocols, raw reports, and
limitations. The results are localhost measurements of exact allowlisted
applications, not a generic AOT-versus-JIT comparison.

## How it works

```text
TypeScript / TSX / pinned Hono source
                 |
                 v
       TypeScript type checking
                 |
                 v
    module loading + partial evaluation
                 |
                 v
        validated typed TinyTSX HIR
                 |
                 v
     Apple/Linux AArch64 assembly
                 |
                 v
  native TinyTSX HTTP/runtime libraries
                 |
                 v
        native ARM64 executable
```

JSX lowers directly to response-writer operations; it does not create React
elements or a virtual DOM. Closed initialization code is evaluated at compile
time, while admitted request-dependent behavior becomes typed HIR and native
code. The native bootstrap runtime supplies bounded HTTP, file, SQLite, actor,
and selected Web API operations.

The compiler itself is written in Rust. The TypeScript frontend uses the pinned
TypeScript compiler API during the build. User application code is emitted as
readable AArch64 assembly and is not lowered through a JavaScript VM or custom
bytecode interpreter.

## Compatibility policy

TinyTSX follows an executable allowlist:

- TypeScript accepting a program does not mean TinyTSX can execute it.
- DOM declarations do not imply that a Web API exists at runtime.
- A supported Hono example does not imply blanket Hono compatibility.
- An npm package is supported only for the pinned source and behavior listed in
  the compatibility manifests.
- unsupported reachable behavior must produce a compile-time diagnostic.

The repository pins Hono, selected Hono examples, Test262, and Web Platform
Test sources. Intake tests verify revisions and source digests; native and
reference tests verify only the behavior explicitly promoted into the matrix.

## Known limitations

The alpha does not provide:

- general TypeScript or ECMAScript execution;
- arbitrary npm package compatibility;
- Node.js, Deno, or Bun platform APIs;
- a general garbage-collected object heap;
- arbitrary classes, Promises, closures, collections, or async scheduling;
- complete Request, Response, Fetch, URL, streams, or encoding APIs;
- WebSockets, TLS termination, compression, subprocesses, or raw sockets;
- general SQLite callbacks, values, or concurrent connection semantics;
- distributed actors;
- live Stytch, JWT/JWK, or OAuth integration;
- Windows and other unlisted native targets.

The detailed compatibility table is the source of truth:
[`doc/COMPATIBILITY.md`](doc/COMPATIBILITY.md).

The standalone `tinytsx test262` allowlist runner still emits direct ARM64
assembly and is not part of x86-64 application-target support. Its intake/HIR
tests remain portable; native Test262 execution is skipped on x86-64 hosts.
The standalone `tinytsx wpt` runner emits portable C and executes on all four
supported native targets.

## Development

Useful verification commands:

```sh
# Frontend/compiler behavior
npm run test:frontend

# Rust compiler and runtimes
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings

# Hono/Test262/WPT intake and native evidence
npm run test:hono-intake
npm run test:test262-native
npm run test:wpt-native

# Complete repository suite
npm test

# Clean release verification and archive smoke tests
npm run release:verify
```

The complete suite builds and launches many native servers and can take several
minutes. Bun is required for the reference-test portions of `npm test`.

## Repository layout

```text
compiler/          Rust CLI, HIR, and AArch64 code generation
frontend/          TypeScript module loader, evaluator, and HIR frontend
runtime/           Native HTTP/bootstrap, worker, SQLite, and optional WASM code
sdk/               Type declarations for TinyTSX built-ins
examples/          Runnable supported applications
packages/          Developer tooling, including eslint-plugin-tinytsx
tests/compat/      Hono, Test262, WPT, native, and package evidence
benchmarks/        TinyTSX/Bun harness and retained reports
vendor/            Pinned upstream compatibility inputs
doc/               Contracts, decisions, backlog, and implementation evidence
tools/             Release packaging and verification
```

Start with [`doc/ALPHA.md`](doc/ALPHA.md) for the public contract,
[`doc/BACKLOG.md`](doc/BACKLOG.md) for planned work, and
[`doc/DECISIONS.md`](doc/DECISIONS.md) for design decisions.

## Contributing

Issues and focused pull requests are welcome. New compatibility claims should
start with a pinned real application or upstream behavior test and include:

1. the exact source and behavior being admitted;
2. a compile-time diagnostic for the first unsupported boundary;
3. native success and bounded-failure tests;
4. reference behavior where portable semantics can be compared;
5. documentation that keeps the claim narrower than general JavaScript or Hono
   compatibility.

Please keep generated code and compiler specializations small and focused.

## License

TinyTSX is available under the [MIT License](LICENSE).

Maintained by `srsatt <srsatt@gmail.com>`.
