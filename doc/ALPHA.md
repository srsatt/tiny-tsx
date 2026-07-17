# TinyTSX 0.1.0-alpha.1

This developer preview compiles the allowlisted server-side TypeScript/Hono
matrix into an AArch64 native HTTP server without a JavaScript engine in the
produced application.

The archive contains `bin/tinytsx`, read-only compiler resources, documentation,
and runnable source examples under `lib/tinytsx`. The compiler finds that
directory relative to its executable;
`TINYTSX_HOME` may explicitly override it. Building applications requires Node
with the bundled TypeScript package, Cargo/Rust, Clang, a target linker, and the
target system's libcurl development/runtime support. SQLite is statically
provided by the pinned bundled amalgamation.

Run `tinytsx --version` for compiler, HIR/runtime ABI, target, and compatibility
revisions. Run `tinytsx --list-builtins` for the exact standard-library surface
and bounds. `doc/COMPATIBILITY.md` is the supported Hono/Web/language matrix;
`doc/STANDARD_LIBRARY.md`, `doc/PERSISTENCE.md`, and `doc/ACTORS.md` define
capabilities, ownership, limits, and known gaps. `doc/RELEASE_CHECKLIST.md`
defines the two-target verification and no-go conditions for tagging.

Apple-arm64 archives must execute on Apple arm64. Linux-arm64 archives must be
built and executed on Linux arm64; cross-assembled ELF output from macOS is not
a substitute. No x86 native target is claimed in this alpha.

On-disk SQLite paths are scoped to matching canonical read/write roots. Current
post-alpha runtime hardening additionally requires a service-owned protected
directory, securely creates the main file, and rejects unsafe or symlinked main
and sidecar names. The published alpha must still be deployed with a root that
untrusted same-UID code cannot mutate; see `doc/PERSISTENCE.md`.

## Supported alpha contract

The source language is an explicit AOT allowlist, not JavaScript with fallback.
It includes the pinned closed Hono initialization graphs, relative/bare ESM
resolution, typed server JSX, closed records/arrays used by those graphs,
request-selected strings, bounded JSON fields, selected async middleware, and
the exact Test262 cases listed in `doc/COMPATIBILITY.md`. Unsupported reachable
syntax fails compilation; the produced server never interprets JavaScript.

The executable Hono matrix consists of the pinned complete `basic` and
`jsx-ssr` examples plus the published-package `@hono/zod-openapi`, static-file,
blog/SQLite, prepared callback-transaction, environment, bounded Body Limit,
bounded Request ID, and
local/persistent-counter tracers recorded in
`tests/compat/hono/examples-manifest.json`.
`@hono/node-server` and `tinytsx:serve` share one AOT entry contract. This does
not claim the rest of Node server lifecycle, TLS, event, or platform-adapter
behavior.

The Web API allowlist covers the Request/Response/Headers behavior exercised by
that matrix, selected route/query/header reads, bounded JSON input and a closed
`Content-Length` body guard,
`crypto.randomUUID()`, one bounded request-local ID policy, one closed
fetch-status path on Apple, finite text streaming, and the WPT-derived behavior
in `doc/WEB_API.md`. TypeScript DOM type availability is not evidence that an
unlisted runtime API exists.

The protected backend modules are:

- `tinytsx:env`: at most 64 static names, 4 KiB UTF-8 per immutable value;
- `tinytsx:fs`: static UTF-8 text reads, 4 KiB paths and 1 MiB files;
- `tinytsx:sqlite`: one serialized owner, 64 KiB static SQL, 16 admitted public
  parameters per call, 1–16 prepared callback-transaction steps with at most 64
  aggregate parameters, 1,024 result rows, 1 MiB results, and one-second busy
  timeout;
- `tinytsx:actors`: compile-time counter actors with 1–64 mailbox entries,
  optional SQLite-backed counter persistence, and one bounded non-persistent
  restart-intensity form;
- `tinytsx:serve`: one compile-time fetch application and closed port.

Environment and filesystem/database access are default-deny. Use
`--allow-env`, `--allow-read`, and `--allow-write`; compiler rejections use the
stable diagnostic catalog in `doc/STANDARD_LIBRARY.md`. Requests use bounded
arenas, HTTP/application executors have fixed queues, saturation is recoverable,
and no feature relies on a garbage collector or finalizer.

Known non-goals include general TypeScript/ECMAScript, arbitrary npm execution,
Node/Deno/Bun compatibility, blanket Hono/Web API support, x86 targets, dynamic
SQLite values/results, general actors, WebSockets, compression, JWT/JWK,
subprocesses, sockets, and a managed heap. The exact first unsupported boundary
for each admitted Hono documentation row lives in
`tests/compat/hono/docs-matrix.json`.

## Getting started

```sh
tar -xzf tinytsx-0.1.0-alpha.1-aarch64-apple-darwin.tar.gz
export TINYTSX_HOME="$PWD/tinytsx-0.1.0-alpha.1-aarch64-apple-darwin/lib/tinytsx"
export PATH="$PWD/tinytsx-0.1.0-alpha.1-aarch64-apple-darwin/bin:$PATH"
mkdir hello && cd hello
npm init -y
npm install hono @hono/node-server
cat > server.ts <<'TS'
import {serve} from '@hono/node-server'
import {Hono} from 'hono'

const app = new Hono()
app.get('/', context => context.text('Hello from TinyTSX'))
serve({fetch: app.fetch, port: 3000})
TS
tinytsx build server.ts --output server --release
./server
curl http://127.0.0.1:3000/
```

Use `tinytsx:serve` instead of `@hono/node-server` when the application wants
the same native server entrypoint without the Hono package namespace.

Focused examples for both entrypoints, Body Limit, Request ID,
`@hono/zod-openapi`, file reads, SQLite, and local/persistent actors ship in
`$TINYTSX_HOME/examples`.
Copy that directory to a writable project and follow its `README.md`; the
archive release gate runs those sources against their pinned npm packages
before publication. See the capability documents before granting files,
environment values, SQLite, or persistent actors.
