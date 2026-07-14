# Implementation status

Last updated: 2026-07-14

## Current state

Milestones 0–2 are complete for the static-page vertical slice. The compiler
produces and serves a native Mach-O executable from the example TSX source.

## Verified capabilities

- Compact Cargo workspace with compiler and bootstrap runtime binaries.
- Pinned TypeScript frontend package and TinyTSX SDK declarations.
- Static TSX example matching the first deliverable.
- Versioned JSON HIR with source spans, components, GET handler, HTML operations,
  interned static strings, and build statistics.
- Official TypeScript frontend validates the initial static subset and coalesces
  the example page into one 53-byte HTML fragment.
- Frontend coverage includes static and nested components plus rejection of
  `any`, classes, async functions, computed properties, and event attributes.
- Rust `tinytsx check` drives the build-time frontend, validates HIR v1, and can
  print readable HIR or deterministic Apple arm64 assembly.
- Assembly uses native component functions, the documented writer helper, static
  bytes in `__TEXT,__const`, and a global `tinytsx_handle_get` entrypoint.
- Apple clang assembles generated text and Cargo/rustc links the object into the
  single-worker Rust bootstrap runtime. No generated application code passes
  through LLVM, JavaScript, WebAssembly, or an interpreter.
- The bootstrap runtime handles GET over HTTP/1.1, emits required headers, closes
  each connection, and renders through a bounded writer using the ABI status.
- `tinytsx build` supports the first-slice build options, emitted HIR/assembly,
  temporary preservation, stripping, and a machine-readable build report.
- `tinytsx run` builds and starts the resulting executable.
- Native E2E coverage checks Mach-O magic, starts the executable, sends a real
  TCP request, and asserts the complete 200 response and 53-byte HTML body.
- A stripped release build measured 393,920 bytes on the development machine.
- The static benchmark harness verifies equivalent TinyTSX/Bun responses, then
  records all repeated `oha` samples plus startup-to-first-response and idle RSS.
- The initial three-run preview found essentially equal static throughput. Its
  material difference was footprint: TinyTSX measured 5.64 ms startup and
  1.78 MiB idle RSS versus Bun at 12.87 ms and 31.53 MiB. This is exploratory
  evidence only; it does not cover dynamic rendering or keep-alive HTTP.
- Hono and Test262 are shallow Git submodules pinned respectively to Hono
  `v4.12.30` (`b2ae3a22`) and Test262 `f2d14356`.
- The frontend can traverse runtime-only ESM graphs, skip type-only edges, report
  unresolved imports together, and audit the complete reachable Hono source.
- The pinned `hono/tiny` smoke graph currently contains 17 runtime modules and
  3,117 source lines. The audit records classes, private fields, accessors,
  closures, loops, rest/spread, RegExp, exceptions, async/await, and required
  built-ins without pretending they compile yet.
- The same smoke entry now enters the normal compiling frontend through a pinned
  bare-import alias. Compilation traverses into upstream Hono and currently stops
  at `vendor/hono/src/preset/tiny.ts:11` with `TINY1002` for its class declaration;
  a regression test preserves that frontier.
- Relative ESM components now compile through multi-module HIR into the native
  server; a second real HTTP E2E test verifies the imported component output.
- Test262 intake validates the pin, provenance metadata, and parsing of four
  allowlisted class, loop, RegExp, and async cases. These are explicitly
  syntax-only and are not semantic conformance results.
- The dedicated native API suite currently covers Request method/path/query
  views and exact-fit, OOM, and invalid response-writer behavior.

Verification:

```bash
rtk cargo check --workspace
rtk npm install --prefix frontend
rtk npm test --prefix frontend
rtk node frontend/dist/src/cli.js examples/static-page/server.tsx
rtk cargo test --workspace
rtk cargo clippy --workspace --all-targets -- -D warnings
rtk cargo run -q -p tinytsx -- check examples/static-page/server.tsx --emit-asm
rtk cargo run -q -p tinytsx -- build examples/static-page/server.tsx --port 3017 --output dist/static-server --release --emit-hir --emit-asm
rtk curl -i --max-time 5 http://127.0.0.1:3017/
rtk npm run test:benchmarks
rtk npm run audit:hono
rtk npm run try:compile:hono  # expected TINY1002 until class lowering lands
rtk npm run test:test262-intake
rtk npm run test:native-api
rtk python3 benchmarks/scripts/run_static.py --duration 2 --runs 3 --startup-runs 5 --concurrency 1,8,32 --output-prefix benchmarks/results/2026-07-14-m5-max-static-preview
```

## Active slice

Compatibility substrate: resolve bare package imports with declarations, then
lower ordinary function values, closures, records, arrays, and loops into a
general typed HIR. Test262 cases move from syntax intake to native execution only
when their complete semantics are implemented.

## Resume point

Read `README.md`, `doc/COMPATIBILITY.md`, and `doc/BACKLOG.md`. Run
`npm run audit:hono` to see the pinned requirement frontier. Begin with bare
package resolution and the general typed HIR; do not special-case Hono routing.
Run the verification commands recorded here before moving an item to verified.
