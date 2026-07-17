# TinyTSX 0.1.0-alpha.1

This developer preview compiles the allowlisted server-side TypeScript/Hono
matrix into an AArch64 native HTTP server without a JavaScript engine in the
produced application.

The archive contains `bin/tinytsx` and read-only resources under
`lib/tinytsx`. The compiler finds that directory relative to its executable;
`TINYTSX_HOME` may explicitly override it. Building applications requires Node
with the bundled TypeScript package, Cargo/Rust, Clang, a target linker, and the
target system's libcurl development/runtime support. SQLite is statically
provided by the pinned bundled amalgamation.

Run `tinytsx --version` for compiler, HIR/runtime ABI, target, and compatibility
revisions. Run `tinytsx --list-builtins` for the exact standard-library surface
and bounds. `doc/COMPATIBILITY.md` is the supported Hono/Web/language matrix;
`doc/STANDARD_LIBRARY.md`, `doc/PERSISTENCE.md`, and `doc/ACTORS.md` define
capabilities, ownership, limits, and known gaps.

Apple-arm64 archives must execute on Apple arm64. Linux-arm64 archives must be
built and executed on Linux arm64; cross-assembled ELF output from macOS is not
a substitute. No x86 native target is claimed in this alpha.

Known security boundary: on-disk SQLite paths are lexically scoped to matching
read/write roots, but runtime symlink replacement and SQLite sidecar-file races
remain unresolved. Do not grant a database root writable by untrusted users.

## Getting started

```sh
tar -xzf tinytsx-0.1.0-alpha.1-aarch64-apple-darwin.tar.gz
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
the same native server entrypoint without the Hono package namespace. See the
capability documents before adding files, environment values, SQLite, or
persistent actors.
