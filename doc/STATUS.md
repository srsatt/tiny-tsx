# Implementation status

Last updated: 2026-07-15

## Current state

Milestones 0–2 are complete for the static-page vertical slice. The compiler
produces and serves a native Mach-O executable from the example TSX source.

## Verified capabilities

- Compact Cargo workspace with compiler and bootstrap runtime binaries.
- Pinned TypeScript frontend package and TinyTSX SDK declarations.
- Static TSX example matching the first deliverable.
- Versioned JSON HIR with source spans, native string functions, tagged GET
  responses, components, HTML operations, interned strings, typed staged
  constants, and build statistics.
- Official TypeScript frontend validates the initial static subset and coalesces
  the example page into one 53-byte HTML fragment.
- Frontend coverage includes static and nested components, closed class method
  lowering, and rejection of unsupported component props, inheritance, async
  functions, computed properties, and event attributes.
- Rust `tinytsx check` drives the build-time frontend, validates HIR v2, and can
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
- Native E2E coverage checks Mach-O magic, starts each executable, sends a real
  TCP request, and asserts complete HTML or text responses.
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
  bare-import alias. Compilation passes the exported preset class and its closed
  method-table assignment, then stops at `vendor/hono/src/hono-base.ts:224` with
  `TINY1003` for an async closure in the unused `route()` method. A regression
  test preserves this whole-module syntax frontier.
- A second tracer imports the full `hono` entry and preserves the upstream basic
  example's first route. Its graph contains 27 modules, 4,177 lines, and 117,684
  bytes; compilation passes `vendor/hono/src/hono.ts` and reaches the same async
  closure in `HonoBase.route()`. This is not yet the complete basic example.
- Application imports can use a narrow `api.d.ts` declaration alias while the
  compiler independently loads real upstream Hono runtime source. An invalid
  route-path test proves the overlay participates in TypeScript checking.
- Relative ESM components now compile through multi-module HIR into the native
  server; a second real HTTP E2E test verifies the imported component output.
- Test262 intake validates the pin, provenance metadata, and parsing of eight
  allowlisted class, loop, RegExp, async, array-spread, primitive, and function
  cases. These are explicitly syntax-only and are not semantic conformance
  results.
- The dedicated native API suite currently covers Request method/path/query
  views and exact-fit, OOM, and invalid response-writer behavior.
- A conservative AOT staging pass now evaluates imported closed arrays and
  records, folds constant spread, and materializes rest values when their source
  is compile-time closed. The compatibility audit exposes constant versus
  runtime decisions for every reachable Hono spread/rest site.
- On pinned Hono, staging finds 19 constant bindings and folds the method array
  at `hono-base.ts:128` to the six HTTP methods plus `all`. The remaining 17
  spread/rest sites are explicitly retained as runtime or later type-layout
  specialization work.
- The same staging pass classifies HonoBase's `this[method]` constructor write as
  one closed computed access with seven exact method keys. The other 98 computed
  accesses in the `hono/tiny` graph remain runtime work. Dynamic computed access
  continues to receive `TINY1004`.
- The Test262 array-spread case has its closed literal consumed by the staging
  test, without claiming execution of the full case.
- Closed staged values now lower into a canonical HIR constant pool with tagged
  undefined, null, boolean, number, bigint, string, array, and record values.
  HIR validation checks their IDs, modules, shapes, depth, and statistics.
- The arm64 backend serializes those constants into deterministic read-only
  blobs. `examples/staged-constants/server.tsx` passes the complete native build
  and HTTP E2E path, while the Hono test proves its seven-method array reaches
  the same typed HIR representation.
- Reachable named string functions now lower across ESM modules with up to four
  required string parameters. Expressions can return literals, parameters,
  staged string constants, or nested direct calls. Native code passes and
  returns pointer/length register pairs, uses bounded stack frames for argument
  evaluation, and rejects recursion.
- Closed classes can expose required string parameter properties to an immediate
  method call. The call is devirtualized into ordinary HIR with no heap object or
  prototype runtime; inheritance and persistent identity remain unsupported.
- Erased `any` annotations in upstream TypeScript no longer fail global syntax
  validation. Reachable runtime values still require a concrete supported HIR
  type, so this does not introduce dynamic `any` semantics.
- HIR/ABI v2 adds tagged text responses and explicit HTTP status/content type
  metadata. A native E2E compiles the Hono basic route body `Hono!!` through the
  general function path and verifies `text/plain; charset=UTF-8` over TCP.
- Static `Response.text(string)` is currently a compiler intrinsic, not a Web-
  standard method. It is the temporary source bridge to the response operation
  that compiled Hono `Context.text()` will use after class lowering.
- Closed object literals are records with compile-time fields; explicit `Map`
  construction remains unstaged dynamic work. The two models and declaration-
  overlay boundary are persisted in `doc/OBJECT_MODEL.md`.

Verification:

```bash
rtk cargo check --workspace
rtk npm install --prefix frontend
rtk npm test --prefix frontend
rtk node frontend/dist/src/cli.js examples/static-page/server.tsx
rtk cargo test --workspace
rtk cargo clippy --workspace --all-targets -- -D warnings
rtk cargo run -q -p tinytsx -- check examples/static-page/server.tsx --emit-asm
rtk cargo run -q -p tinytsx -- check examples/staged-constants/server.tsx --emit-hir
rtk cargo run -q -p tinytsx -- build examples/static-page/server.tsx --port 3017 --output dist/static-server --release --emit-hir --emit-asm
rtk curl -i --max-time 5 http://127.0.0.1:3017/
rtk npm run test:benchmarks
rtk npm run audit:hono
rtk npm run try:compile:hono  # expected TINY1003 at hono-base.ts:224
rtk npm run audit:hono-basic
rtk npm run try:compile:hono-basic  # expected TINY1003 at hono-base.ts:224
rtk npm run test:test262-intake
rtk npm run test:native-api
rtk python3 benchmarks/scripts/run_static.py --duration 2 --runs 3 --startup-runs 5 --concurrency 1,8,32 --output-prefix benchmarks/results/2026-07-14-m5-max-static-preview
```

## Active slice

Compatibility substrate: extend the executable function slice with locals,
record property access, and branches, then add closures, native record/array
layouts, and loops. Type-layout specialization should handle closed
request-time records without pretending their values are compile-time constants.
Test262 cases move from syntax intake to native execution only when their
complete semantics are implemented.

## Resume point

Read `README.md`, `doc/COMPATIBILITY.md`, and `doc/BACKLOG.md`. Run
`npm run audit:hono-basic` to see the full-package requirement frontier. Extend
default-exported app initialization and use its reachable functions to drive
validation; do not reject unused Hono methods or special-case its routing. Run
the verification commands recorded here before moving an item to verified.
