# TinyTSX

TinyTSX is an ahead-of-time compiler for a deliberately restricted subset of
TypeScript, TSX, and Hono. It turns supported backend applications into small
native ARM64 HTTP servers with bounded resources and no JavaScript engine in
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
- statically compiled AArch64 application code at runtime;
- no V8, JavaScriptCore, QuickJS, JIT, or runtime JS parser;
- bounded request arenas, queues, actor mailboxes, and database results;
- default-deny environment, filesystem, and persistence capabilities;
- one native executable with no npm runtime dependency;
- approximately 6–9 MiB warm RSS in the current benchmark matrix.

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

The current version is `0.1.0-alpha.1`. Clean Apple ARM64 and native Linux
ARM64 release verification passes for the frozen candidate recorded in
[`doc/BACKLOG.md`](doc/BACKLOG.md). Publishing the Git tag and release assets is
a separate action and has not been performed yet.

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
| Linux ARM64 / `aarch64-unknown-linux-gnu` | Native build and execution |
| macOS-to-Linux cross-host output | Assembly inspection only |
| x86-64, Windows, iOS, WebAssembly | Not supported as application targets |

Final linking and execution require a host matching the selected target.

## Build from source

### Prerequisites

- an Apple Silicon Mac with Xcode Command Line Tools, or a native Linux ARM64
  host with Clang and libcurl development files;
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
--emit-asm                 Retain generated AArch64 assembly
--alias <specifier=path>   Runtime source alias
--api <specifier=path>     Declaration overlay
--binding <name=value>     Explicit native resource binding
--allow-env <name>         Permit one environment value
--allow-read <root>        Permit filesystem/database reads
--allow-write <root>       Permit database writes
```

`tinytsx run` combines compilation and execution for development. Every build
also writes a machine-readable `<output>.build.json` report.

## Backend standard library

TinyTSX exposes a small protected backend API rather than emulating Node.js:

| Module | Purpose |
| --- | --- |
| `tinytsx:env` | Immutable, explicitly permitted startup environment values |
| `tinytsx:fs` | Capability-scoped bounded UTF-8 file reads |
| `tinytsx:sqlite` | Single-owner bounded SQLite operations and transactions |
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
  compile time;
- unsupported dynamic lifetime or identity requirements fail compilation.

This model reduces runtime state, but it is not an operating-system sandbox.
Deploy the generated executable with normal process, filesystem, network, and
container isolation.

## Performance

The current results support a footprint claim, not a general speed claim.

The response-checked Stytch TODO benchmark uses eight TinyTSX workers and
bounded create/list/complete/delete cycles:

| Metric | TinyTSX | Bun |
| --- | ---: | ---: |
| Warm RSS | 8.16 MiB | 66.38 MiB |
| Throughput, concurrency 8 | 15,905 req/s | 23,359 req/s |
| Throughput, concurrency 64 | 17,367 req/s | 23,049 req/s |
| p99, concurrency 8 | 1.624 ms | 0.939 ms |
| p99, concurrency 64 | 50.026 ms | 8.365 ms |

Across the wider sustained matrix, TinyTSX generally uses much less resident
memory but often has lower throughput, higher CPU/syscall pressure, and worse
tail latency than Bun. One large warm-cache response is faster in the current
measurements, while failure-heavy SQLite rollback is substantially slower.

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
- x86-64 or Windows targets.

The detailed compatibility table is the source of truth:
[`doc/COMPATIBILITY.md`](doc/COMPATIBILITY.md).

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
