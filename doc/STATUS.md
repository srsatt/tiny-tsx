# Implementation status

Last updated: 2026-07-17

## Current state

Milestones 0–2 are complete for the static-page vertical slice. The compiler
produces and serves a native Mach-O executable from the example TSX source.

## Alpha implementation evidence

### Tag-ready two-target candidate (2026-07-17)

- The final clean source commit completed `npm run release:verify` on native
  Apple arm64 and native Linux arm64. Both schema-v2 manifests record the same
  source commit with `source.dirty == false`; their generated `.sha256` files
  remain the authoritative artifact digests.
- Both archives build and execute outside the checkout and package the focused
  Hono, `@hono/node-server`, `tinytsx:serve`, Zod/OpenAPI, file, SQLite, and
  actor sources. The release candidate is ready for a separate tag-and-publish
  action; no tag was created here.
- Verification: workspace Clippy with warnings denied, the repeated benchmark
  artifacts, and `npm run release:verify` on both native targets.

### Native Linux release and portable allowlists (2026-07-17)

- A clean `aarch64` Linux VM running kernel 6.8 under Apple Virtualization
  Framework executed the same `npm run release:verify` contract with Rust
  1.96.0, Node 22, Bun 1.3.13, Clang, and libcurl. The VM used native arm64
  containers, not QEMU architecture emulation.
- The first native run found a real release blocker: the dedicated Test262 and
  WPT wrappers still rejected non-macOS hosts after the main compiler gained
  Linux support. Test262 now emits target-selected Mach-O or ELF AArch64
  assembly; both HIR validators retarget to the native host; the executable
  tests assert Mach-O or ELF magic as appropriate.
- Focused native Linux evidence executes all four Test262 programs and all three
  WPT programs. The subsequent full run passed Hono basic/JSX,
  `@hono/node-server`, `tinytsx:serve`, Zod/OpenAPI success/rejection/document
  behavior, release-profile failures, and all four installed-resource tests.
- The verified Linux archive checksum from commit `9d67c26` is
  `0a28b080de2f8adb4f5225123d9aa63d26b865b08a35bfadb0a05a34f663e969`;
  its target is `aarch64-unknown-linux-gnu` and its installed smoke binary is an
  ELF AArch64 executable. A final two-target pass will replace this interim
  artifact after schema-v2 manifests bind both archives to one exact commit.
- Release manifests now include the clean source commit, and the GitHub Actions
  job rejects a manifest whose commit differs from `GITHUB_SHA`.

### Repeated alpha release benchmark (2026-07-17)

- The final controlled comparison uses the Hono basic control, one persistent
  counter owner, and one in-memory SQLite owner on the same commit and machine:
  eight TinyTSX workers, keep-alive, five startup samples, and three five-second
  samples at concurrency 1/8/32/64. Response equivalence is checked before
  measurements are accepted and every raw sample is retained.
- TinyTSX stays at 6.59–7.86 MiB warm RSS versus Bun at 70.39–123.61 MiB. Its
  self-contained executable is 2.23 MiB; Bun's shareable runtime is 60.15 MiB.
  Repeated startup is close at 22.62–23.80 ms versus 20.32–21.36 ms.
- TinyTSX reaches 0.41–0.69x Bun throughput at concurrency 32–64. The actor
  route is 12–13% below TinyTSX's Hono control at concurrency 8–64; the SQLite
  route is 23–26% below it at concurrency 32–64. These are route-level deltas,
  not isolated operation costs.
- Concurrency-64 p99 is 36.96–46.33 ms for TinyTSX versus 0.82–1.22 ms for Bun,
  retaining connection fairness as the measured optimization priority. The
  summary and raw artifacts are under
  `benchmarks/results/2026-07-17-m5-max-alpha-*`.
- Verification: `npm run test:benchmarks` (17/17) plus all three controlled
  equivalence-checked benchmark runs.

### Installed alpha example and failure gates (2026-07-17)

- Every Hono example-manifest row names native and reference scripts reachable
  from `release:verify`; intake rejects missing scripts, unexplained pending
  states, and local adapters that pretend to be Cloudflare/Node references.
- The archive ships a pinned npm project containing runnable Hono,
  `@hono/node-server`, Hono-neutral `tinytsx:serve`, `@hono/zod-openapi`, file,
  SQLite, and actor sources. The installed-resource gate copies that project
  outside the checkout, installs its compile-time packages, then builds and
  executes release servers with the archived compiler and resources.
- The installed release servers cover success/default-404 behavior, Zod path
  rejection and OpenAPI output, filesystem denial and recovery, malformed JSON,
  SQLite and actor post-disposal recovery, request-arena exhaustion, and HTTP
  worker overload/recovery. Release-profile native suites separately prove
  deterministic application/mailbox saturation and SQLite writer contention.
- SIGINT and SIGTERM now stop the nonblocking accept loop, reject no new work,
  drain accepted HTTP jobs, and exit with status zero. Accepted sockets are
  explicitly returned to blocking mode so the bounded I/O timeout and overload
  behavior remain portable on Apple and Linux.
- The exact published `hono@4.12.30` CORS JavaScript shape is admitted alongside
  the pinned TypeScript source shape. This closed specialization fixed an
  installed-package failure without broadening arbitrary middleware execution.
- Verification: `npm run test:frontend` (91/91),
  `npm run test:release-runtime` (68/68), the focused compiler saturation E2E,
  and `npm run release:package` including installed release tests (4/4).

### Installable alpha archive (2026-07-17)

- Workspace, frontend, and SDK versions are `0.1.0-alpha.1`. `tinytsx
  --version` reports compiler, HIR 2, runtime ABI 1, host target, built-in schema,
  and pinned Hono/Hono-examples/Test262 revisions; native build reports carry
  the same version boundary.
- Release binaries find read-only assets at `../lib/tinytsx` or an explicit
  `TINYTSX_HOME`. Release builds no longer discover the source checkout through
  `CARGO_MANIFEST_DIR`; debug builds retain that convenience for development.
- `npm run release:verify` requires a clean tree, runs the root and
  `@hono/zod-openapi` native/reference gates, rejects generated tracked changes,
  stages the installed layout, builds and executes an application from a
  temporary directory, then writes an archive, SHA-256, and JSON manifest.
- The verified Apple-arm64 archive is 5.1 MiB; its generated manifest and
  `.sha256` file carry the artifact-specific digest. Linux-arm64 archive
  execution remains an open platform gate.
- `.github/workflows/release.yml` assigns the same clean release gate to native
  `macos-14` and `ubuntu-24.04-arm` runners and uploads each target archive,
  checksum, and manifest. The workflow definition is present and YAML-validated;
  a successful remote Linux run is still required before the Linux artifact is
  marked verified.

### Fetch-standard response content type (2026-07-17)

- The Fetch BodyInit algorithm and pinned WPT
  `response-init-contenttype.any.js` establish that a string response starts
  with `Content-Type: text/plain;charset=UTF-8`, while a stream adds no inferred
  type and explicit init headers remain authoritative.
- Hono's exact post-`next()` response-time path turns the finalized response
  body into a stream but supplies the prior response as init, so the original
  text type remains. The renamed native response-time E2E exercises that path
  and asserts both the content type and numeric timing header.
- Bun 1.3.13 was reproduced with no header on `new Response("Hono!!")`; its HTTP
  adapter subsequently emits `application/octet-stream`. TinyTSX keeps the
  Web-standard value, while the benchmark harness records Bun's target-specific
  deviation rather than declaring the wire responses identical.
- Verification: `npm run test:wpt-intake`, the focused compiler E2E, and
  `npm run test:benchmarks`.

### Persistent counter actor (2026-07-17)

- `spawn(..., {persistence: {database, key}})` connects the bounded `i64`
  counter to a capability-scoped SQLite owner. Startup loads the saved value or
  creates it from the compile-time initial state; messages persist before the
  in-memory value advances.
- The native Hono tracer reaches 2, terminates, restarts the same binary at 2,
  and advances to 3. Its Linux-arm64 output passes Clang assembly. The original
  capability-free in-memory actor behavior remains unchanged.
- Verification: `npm run test:frontend` (86/86),
  `npm run test:actors-native` (4/4), `cargo test --workspace`, and
  `cargo clippy --workspace --all-targets -- -D warnings`.

### On-disk SQLite capability and restart (2026-07-17)

- `new Database("state.db")` now requires one matching canonical
  `--allow-read`/`--allow-write` root. Non-static, absolute, empty, dot, parent,
  undeclared, or ambiguous-root paths fail compilation with `TINY1510` or
  `TINY1511`; `:memory:` remains capability-free.
- Generated configuration exposes each resolved database path to its single
  application-worker owner. Build reports record read and write roots, while
  the application receives no ambient filesystem API.
- `examples/hono-sqlite/persistent.ts` proves schema creation, prepared JSON
  insertion, query, process termination, restart, and retained data on Apple
  arm64. Its static transaction endpoints prove a failed two-statement batch
  rolls back completely and a successful batch commits atomically. The
  disk-backed program also assembles for Linux arm64.
- Runtime symlink-replacement/sidecar races, prepared/callback transactions, and
  HTTP-level contention load are post-alpha. Core native evidence holds a
  competing writer through the bounded busy timeout and proves the second
  connection recovers after the lock is released; the persistent counter actor
  is covered separately above.
- Verification: `npm run test:frontend` (85/85),
  `npm run test:sqlite-native` (4/4), `cargo test --workspace`, and
  `cargo clippy --workspace --all-targets -- -D warnings`.

### Pinned Hono blog response contract (2026-07-17)

- The `tinytsx:sqlite` adapter now matches the pinned upstream blog's list,
  create, get, update, and delete success envelopes. Missing GET returns the
  upstream JSON error envelope with 404; missing PUT and DELETE return an empty
  204 and perform no mutation.
- The compiler lowers `if (!await statement.get(...)) return response` as one
  bounded first-row existence guard. The generated server performs the guard
  before SQLite actions and supports only a direct effect-free missing branch;
  this does not claim general dynamic JavaScript branching.
- Bun/Hono with `bun:sqlite` pins the portable behavior. Native Apple-arm64 HTTP
  covers found and missing CRUD paths, malformed input and SQL recovery, while
  the same generated handler assembles for Linux arm64.
- Verification: `npm run test:frontend` (84/84),
  `npm run test:sqlite-reference` (3/3), `npm run test:sqlite-native` (2/2),
  `cargo test -p tinytsx-runtime-bootstrap` (51/51), `cargo test -p tinytsx`,
  and `cargo clippy --workspace --all-targets -- -D warnings`.

### Environment capability (2026-07-17)

- `tinytsx:env` is native on the declared Apple-arm64 and Linux-arm64 targets.
  `get()` and `require()` accept static portable names; `--allow-env <name>` is
  required independently for each referenced value and missing permission fails
  compilation with `TINY1501`.
- The generated object enumerates only referenced names. The bootstrap runtime
  snapshots those names before opening the listener, retains no ambient host
  environment API, accepts at most 64 names, and bounds each UTF-8 value to 4096
  bytes. Build reports record the sorted environment permission set.
- The Hono + `@hono/node-server` example at `examples/hono-env/server.ts` proves
  typed `context.env.NAME` and explicit built-in access share the same present,
  missing, oversized, and compile-time-denial behavior. The typed binding also
  runs in the SQLite blog adapter and assembles for Linux arm64. It is recorded
  as the ninth row in the executable Hono example matrix.
- Verification: `npm run test:frontend` (84/84), `npm run test:env-native`
  (3/3), `cargo test --workspace`, and
  `cargo clippy --workspace --all-targets -- -D warnings`.

### Filesystem capability (2026-07-17)

- `tinytsx:fs` is native for bounded UTF-8 `readTextFile()` calls. Source paths
  are static normalized relative paths, `--allow-read <root>` is default-deny,
  roots are canonicalized and embedded, and per-call `maxBytes` is capped at
  1 MiB. The build report records canonical roots and whether filesystem
  application workers are active.
- Reads run on the fixed application executor, not an HTTP executor. The runtime
  canonicalizes each target, rejects root/symlink escape and non-files,
  performs a bounded read, validates UTF-8, and returns owned bytes for copying
  into the request arena. Unit evidence covers missing paths, directories,
  traversal, symlink escape, invalid UTF-8, overflow, and replacement between
  calls.
- The pinned upstream Hono `serve-static` landing runs unchanged natively. The
  `examples/hono-static/server.ts` adapter preserves that landing and serves its
  two pinned text assets through the public built-in, with native missing and
  too-small-limit recovery. Linux-arm64 output passes Clang assembly.
- Verification: `npm run test:frontend` (81/81), `npm run test:fs-native`
  (3/3), `cargo test --workspace`, and
  `cargo clippy --workspace --all-targets -- -D warnings`.

### Earlier evidence (2026-07-16)

- Bare scoped/unscoped imports resolve through nearest-package `node_modules`,
  `exports` conditions and wildcards, with `module`/`main` fallback. Protected
  compiler built-ins win over aliases and packages.
- `tinytsx:serve` and the compatible `@hono/node-server` entry contract support
  `serve(app)` plus a closed source-level port without requiring a default
  export. Native E2E coverage proves the source port and an explicit CLI port
  override.
- The pinned `@hono/zod-openapi@1.5.1`, Hono 4.12.30, and Zod 4.4.3 npm graph
  type-checks and resolves all 113 runtime modules without aliases. TinyTSX
  executes the published `OpenAPIHono` class-expression chain and lowers the
  official-style `createRoute` application.
- Native HTTP matches the Bun reference for `GET /users/1212121`, the Zod
  `min(3)` rejection at `/users/x`, and the complete `/doc` OpenAPI JSON. HIR
  retains the path validation as a bounded native guard; schema/document work
  remains compile-time-only and requires no managed heap or JavaScript engine.
- `tests/compat/hono/examples-manifest.json` now records the alpha example
  matrix as executable data: provenance, entry/import/API surface, intake,
  Apple/native and Linux-assembly state, HTTP/reference evidence, and the first
  unsupported boundary for eight completed or planned tracers. The Hono intake
  suite validates every row and referenced evidence path.
- The official Hono guide/helper/middleware review is persisted in
  `tests/compat/hono/docs-matrix.json` and summarized in `doc/HONO.md`. It
  records 24 middleware, 15 helper, seven guide, and six core API rows plus
  deployment/architecture rows. Only Body Limit and CORS are pulled into the
  alpha middleware plan; all other gaps are explicitly bounded or deferred.
- The Hono example manifest also contains the exact upstream behavior
  allowlist for Basic, Basic Auth, ETag, Powered By, Pretty JSON, and text
  streaming. Each row is labeled native-derived rather than direct execution.
- All alpha backend specifiers now resolve as protected SDK modules:
  `tinytsx:env`, `tinytsx:fs`, `tinytsx:sqlite`, and `tinytsx:actors`, alongside
  the native `tinytsx:serve`. Packages and aliases cannot shadow them. The
  frontend resolution test compiles one module importing all four declarations.
- `tinytsx --list-builtins` emits versioned JSON with each built-in's status,
  Apple/Linux targets, permission flags, and compiled default limits. All five
  bounded alpha modules are now `native`; absent operations remain unsupported.
  `doc/STANDARD_LIBRARY.md` defines versioning, default-deny capability
  separation, recoverable errors, blocking/executor rules, bounded ownership,
  close/dispose semantics, and post-alpha OS modules. `declared` intentionally
  does not yet mean a native implementation.
- `tinytsx:actors` now has a deliberately narrow native counter surface. One
  compile-time `spawn` site owns an `i64` on the fixed application executor;
  `ask`, FIFO `tell`, and idempotent `stop`/`dispose` use a mailbox bounded to
  1–64 messages without creating one native thread per actor. The Hono tracer
  covers increment/decrement, tell-before-ask ordering, repeated stop, a
  recoverable post-stop request, Apple-arm64 execution, and Linux-arm64
  assembly. `doc/ACTORS.md` records the local-only boundary and missing
  structured-message, timeout, supervision, and scale work; a separate
  SQLite-backed specialization proves counter persistence across restart.
- The SQLite foundation is pinned and reproducible: the focused
  `tinytsx-runtime-sqlite` crate uses `rusqlite` 0.40.1, bundled
  `libsqlite3-sys` 0.38.1, and the SQLite 3.53.2 amalgamation. Its bounded core
  covers prepared values, result row/byte limits, malformed SQL recovery, and
  null/integer/finite-real/text/blob mapping. The native alpha integration
  lowers memory or capability-scoped disk owners, closed `exec` effects,
  prepared `run`/`all`/`get` with up to 16 selected route or bounded JSON-body
  values, bounded JSON results, and idempotent close through that worker. The
  transport retains at most 64 KiB and returns 400/413 for malformed,
  unsupported, missing, or oversized body input. Its Hono test proves
  create/list/get/update/delete over GET/POST/PUT/DELETE, SQL-error recovery,
  post-close failure, Apple execution, and Linux-arm64 assembly; a Bun/Hono
  `bun:sqlite` test pins the same local adapter contract. Static-SQL
  transactions, disk capabilities/restart, and the persistent counter are now
  native; typed execute results and prepared/callback transactions are
  post-alpha.
- Typed Hono `Bindings` string fields now lower through the immutable
  `tinytsx:env` snapshot and exact `--allow-env` capability. The blog adapter's
  `context.env.TINYTSX_BLOG_NAME` matches Bun/Hono; denied, missing, invalid,
  oversized, Apple execution, and Linux assembly paths are covered. Platform
  resource bindings and general mutable environment objects remain outside the
  slice.
- `crypto.randomUUID()` now supplies request-time blog IDs from the native OS
  cryptographic random source. The runtime sets the version-4 and RFC variant
  bits, formats lowercase ASCII, and binds the value directly into prepared
  SQLite parameters. ABI and native HTTP tests prove shape and successive-value
  uniqueness; Bun/Hono is the reference. Arbitrary UUID string reuse and the
  rest of Web Crypto remain unsupported.
- The pinned upstream `cors()` factory now lowers for closed wildcard-origin
  options. Native normal responses and generated OPTIONS 204 preflights cover
  static allow-method/header/expose/credentials/max-age values. The SQLite blog
  adapter's Content-Type preflight matches Bun/Hono on Apple execution and its
  Linux-arm64 output assembles. Dynamic/non-wildcard origins, callback options,
  and arbitrary reflected request headers remain unsupported.
- Verification: `npm run test:frontend` (83/83),
  `npm run test:zod-openapi-reference` (1/1),
  `npm run test:zod-openapi` (2/2),
  `npm run test:hono-intake` (7/7),
  `cargo test --manifest-path runtime/bootstrap/Cargo.toml
  request_path_segment_minimum_length_counts_percent_decoded_bytes` (1/1),
  `cargo test -p tinytsx` (53/53),
  `cargo test -p tinytsx builtins` (1/1),
  `npm run test:actors-native` (2/2),
  `cargo test -p tinytsx-runtime-bootstrap` (51/51),
  `cargo test -p tinytsx-runtime-sqlite` (4/4),
  `npm run test:sqlite-reference` (3/3),
  `npm run test:sqlite-native` (2/2), and
  `cargo clippy --workspace --all-targets -- -D warnings`.

## Verified capabilities

- Compact Cargo workspace with compiler and bootstrap runtime binaries.
- Pinned TypeScript frontend package and TinyTSX SDK declarations.
- Standard DOM and DOM iterable declarations type-check the pinned Hono runtime
  graph with zero TypeScript diagnostics; the SDK now contains only TinyTSX
  scalar/JSX additions rather than replacement Web API classes.
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
- Codegen now uses target-neutral `asm_line!`/`asm_write!` emission, shared
  AArch64 frame helpers, shared functions/handlers/responses/values/data
  lowering, and thin Mach-O/ELF dialect adapters. Codegen tests live in separate
  files.
  The static-page and dynamic-Hono assembly remained byte-identical across the
  refactor (SHA-256 `eefa808f...75daf` and `e17ddcf3...a9fb`).
- `--target` accepts `aarch64-apple-darwin` and
  `aarch64-unknown-linux-gnu` for `check`, `build`, and emitted HIR. Static and
  dynamic-Hono Linux assembly both pass Clang's AArch64 assembler and produce
  ELF64/AArch64 objects. Final `build` linking is enabled on a matching native
  host; cross-host linking is rejected before frontend compilation. The Apple
  target still builds, serves, and reports its canonical target unchanged.
- Apple clang assembles generated text and Cargo/rustc links the object into the
  fixed-worker Rust bootstrap runtime. No generated application code passes
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
- The complete pinned 34-module Hono application now runs through both TinyTSX
  and the real Bun/Hono runtime. Five 5-second samples at concurrency
  1/8/32/64/128 show TinyTSX at 0.97–0.99x Bun throughput. Median startup is
  9.77 ms versus 19.91 ms; idle RSS is 5.84 MiB versus 41.73 MiB; post-warm-up
  RSS is 6.09 MiB versus 70.41 MiB. Both plateau near 31k requests/second under
  connection-close HTTP. The Fetch/WPT decision for the visible Bun response
  Content-Type deviation and ordered next experiments are recorded in
  `doc/PERFORMANCE.md`.
- Hono and Test262 are shallow Git submodules pinned respectively to Hono
  `v4.12.30` (`b2ae3a22`) and Test262 `f2d14356`.
- The complete upstream Hono basic example is pinned as a third shallow
  submodule at `3b0b6287`. Intake checks its 110-line source, 16 route
  registrations, and selected root-route status/powered-by behavior test.
- The frontend can traverse runtime-only ESM graphs, skip type-only edges, report
  unresolved imports together, and audit the complete reachable Hono source.
- The pinned `hono/tiny` smoke graph currently contains 17 runtime modules and
  3,117 source lines. The audit records classes, private fields, accessors,
  closures, loops, rest/spread, RegExp, exceptions, async/await, and required
  built-ins without pretending they compile yet.
- The same smoke entry now enters the normal compiling frontend through a pinned
  bare-import alias. Compilation selects `new Hono()`, its ordered `app.get(...)`
  call, and the default export before scanning unused imported method bodies.
  Both constructors and the installed `get` closure execute symbolically. The
  upstream `#addRoute` path produces one closed `GET /` route and one router
  insertion. Its retained handler evaluates through upstream `Context.text`
  and `new Response(text)`, then lowers into path-checked native HIR.
- A second tracer imports the full `hono` entry and preserves the upstream basic
  example's first route. Its graph contains 27 modules, 4,177 lines, and 117,684
  bytes and selects the same constructed application root; the separate pinned
  complete-source regression now covers the entire basic application.
- Application imports can use a narrow `api.d.ts` declaration alias while the
  compiler independently loads real upstream Hono runtime source. An invalid
  route-path test proves the overlay participates in TypeScript checking.
- Relative ESM components now compile through multi-module HIR into the native
  server; a second real HTTP E2E test verifies the imported component output.
- Test262 intake validates the pin, provenance metadata, and parsing of fourteen
  allowlisted class, loop, RegExp, async, array-spread, primitive, function,
  throw, Error, `Date.now`, subtraction, record-membership, and array-unshift
  cases. Evidence mode is explicit per case. The exact `typeof undefined` case
  lowers both upstream assertions into Test262 HIR, builds as a standalone
  native Mach-O executable, and exits successfully after native comparisons.
  The complete six-assertion `typeof bigint` case now does the same while
  covering BigInt conversion and Object boxing categories. The complete
  `for/S12.6.3_A1.js` case now executes 101 native pre-increments, exits its
  infinite loop through numeric throw completion, verifies the caught value,
  and checks final state. The complete `Array.prototype.unshift` case executes
  three source-ordered calls against a bounded dense numeric array and verifies
  returned lengths, signed element movement, out-of-range `undefined`, and final
  length. The complete array-spread/apply case copies three values into a
  distinct native argument buffer and checks callback argument length/order and
  call count. The complete subtraction case executes five checks using runtime
  local and closed record-property slots. The complete record-membership case
  compares the queried property bytes against its native field-name table. The
  direct string throw/catch case compares the caught bytes and final catch flag.
  The complete `Date.now()` type case calls the portable host clock and verifies
  successful numeric-category completion from a link-register-safe standalone
  entry. The complete class-constructor case checks constructor/prototype
  identity, standard descriptor flags, construction count, and instance
  prototype in bounded native storage. The complete Error case copies its own
  bounded message bytes and verifies the standard property descriptor. The
  complete RegExp case runs independent bounded native literal-alternative
  searches for `test` and `exec` presence. The complete module-function case
  proves hoisted initialization, direct call, non-global ownership, mutable
  reassignment, and declaration no-op behavior. The complete async-function case
  creates and verifies its native Promise brand. All fourteen allowlisted cases
  now execute their complete assertions natively; none relies on syntax-only
  evidence.
- The dedicated native API suite currently covers Request method/path/query
  views, allocation-free form-decoded query-name presence, elapsed-header
  formatting, and exact-fit, OOM, and invalid response-writer behavior. Query
  tests cover valid ASCII/UTF-8 percent bytes, `+` as space, literal percent,
  and malformed escapes. A native upstream `prettyJSON()` HTTP E2E proves the
  encoded key `%70retty` selects pretty output.
- Direct WPT execution now parses the complete pinned URLSearchParams get, has,
  and stringifier files, lowers all 20 test bodies and 70 assertions into
  sequential WPT HIR v3, builds three standalone native Mach-O executables, and
  runs them without a JavaScript runtime. Callback-local native state has 64
  ordered pairs, 256 bytes per component, and a 16 KiB output buffer. Behavior
  covers lookup/mutation, closed Web IDL coercions, form decoding and uppercase
  UTF-8 serialization, malformed escapes, NUL/newlines, and selected live URL
  query linkage. This is WPT-runner evidence, not yet an application-facing
  `URLSearchParams` class or complete invalid-UTF-8 parser.
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
- The Test262 array-spread case now executes its complete callback/apply
  assertion program natively; the claim remains restricted to one bounded dense
  numeric spread rather than general iterator or application-code support.
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
- The first post-alpha function-control-flow slice adds initialized `const`
  string locals plus strict string equality/inequality branches. Native AArch64
  compares pointer/length strings by length and bytes; the dedicated E2E executes
  unequal and equal paths through nested functions.
- Closed local arrow/function values now lambda-lift direct-parent immutable
  string captures into explicit HIR/native parameters. The Apple HTTP E2E and
  Linux assembly test cover both a captured outer parameter and local without a
  heap closure; escaping identity and transitive captures remain unsupported.
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
- Diagnostic filtering is limited to the exact `Response.html` and
  `Response.text` intrinsic property accesses. A regression test proves unknown
  Response statics remain `TS2339`. `doc/WEB_API.md` separates declaration
  availability from executable native conformance.
- The application-entry analyzer records a default binding, named constructor,
  constructor arguments, and ordered top-level method calls. The pinned basic
  trace is `app = new Hono(); app.get("/", function); export default app`.
- Runtime-source resolution follows imports, local re-exports, export aliases,
  and inheritance without consulting the declaration overlay. The full Hono
  trace resolves `vendor/hono/src/hono.ts:Hono` followed by
  `vendor/hono/src/hono-base.ts:Hono`, with both constructor operation sequences
  pinned by a regression test.
- Constructor evaluation produces 21 closed fields with zero issues for full
  Hono. Tests pin base/private state, route storage, handler closures, all seven
  HTTP method closures, `getPath`, and symbolic `SmartRouter` construction.
- Application initialization invokes the retained upstream `get` closure,
  resolves imported `mergePath` and private `#addRoute`, and records one closed
  route plus one symbolic router insertion with zero issues.
- The full-package `basic-smoke.ts` tracer now builds as a native Mach-O server.
  Its E2E verifies `GET /` returns `Hono!!` with the pinned Hono content type and
  `GET /missing` returns 404. Compiler `--alias` and `--api` options preserve the
  runtime/declaration split through native builds.
- Ordered static Hono routes now compile together. A native two-route E2E
  verifies `/` and `/hello`, including the upstream `mergePath` behavior that
  prevents doubled separators.
- A closed non-empty `:name` route segment now compiles to native matching.
  `c.req.param(name)` lowers to request-time text, and template/string
  concatenation streams percent-decoded parameter bytes into the bounded writer.
  A native E2E verifies `/entry/:id` with encoded space and slash data.
- Multiple top-level Hono instances now participate in initialization. Upstream
  `route()`, `basePath()`, `#clone()`, the closed child-route `map`, and
  `#addRoute` mount `/book` and `/book/:id`; both are verified over native HTTP.
  The complete-source evaluator now retains 22 routes across 34 modules.
- Generated dispatch now compares both request method and path. Native E2Es
  serve the nested text `POST /book` route and Hono's closed
  `POST /api/posts` JSON response with status 201 and exact `application/json`.
- Receiver-class-aware method evaluation reaches upstream `Context.#newResponse`.
  Closed `JSON.stringify`, Headers construction, `Object.entries`, array binding,
  and `for...of` cover the JSON response path. A pinned WPT Response-init source
  records native-derived evidence for only the closed 201 status case.
- Terminal wildcard dispatch matches the base, trailing slash, and deeper path.
  A native E2E compiles the basic example's `/api/*` fallback and verifies its
  explicit status 404, Hono body, and text content type.
- Same-method/path registrations now compose into one ordered route. Earlier
  staged async handlers can run post-`next()` effects; a native E2E verifies a
  response-header mutation. The complete evaluator now reports one GET
  `/api/posts` route with its compact JSON body instead of duplicate routes.
- The pinned upstream `prettyJSON()` factory and async middleware now compile
  into a request-query presence branch. Native HTTP returns compact JSON without
  `pretty` and indented JSON for a bare `?pretty`; the complete 34-module basic
  trace retains 21 routes.
- Closed RegExp testing, `String(...)`, nullish assignment, and closed call
  spread now carry upstream `Context.redirect('/')` into native HTTP. The
  response is `302 Found` with `Location: /`, an empty body, and no content type.
- Request heads now expose at most 64 borrowed name/value views. Generated code
  performs case-insensitive lookup and streams the basic example's `User-Agent`
  value; missing headers format as JavaScript `undefined`. Unsupported dynamic
  middleware effects are transactional, so they cannot corrupt an otherwise
  lowerable response.
- The exact `/hello/*` custom async middleware now matches `/hello`, clones the
  finalized response through upstream Context code, and emits
  `X-message: This is addHeader middleware!` over native HTTP. A focused
  rollback test still protects responses from unsupported raw clock values.
- An explicitly installed upstream `notFound()` closure now becomes ordered
  terminal GET/POST fallback handlers. Native HTTP serves the basic example's
  `Custom 404 Not Found` body and status; the global closed `poweredBy()` effect
  is retained in the complete symbolic response.
- Unknown property access is now conservative rather than becoming
  `undefined`, preventing unsupported runtime values from being miscompiled as
  static text.
- Closed throw completion now reaches an explicitly installed upstream
  `onError()` closure. The basic `/error` route serves `Custom Error Message`
  with status 500 and logs `Error: Error has occurred` to native stderr per
  request. Separately, ordinary functions now propagate bounded thrown strings
  through the native `x2` completion flag and consume them in same-function
  `try/catch`; uncaught handler completion is rejected before code generation.
- The exact response-time middleware now lowers `Date.now() - start` into an
  elapsed-header HIR recipe. Generated code measures around the native response,
  and a native E2E verifies numeric `X-Response-Time: <n>ms` output. The timing
  header also survives `prettyJSON()` cloning of a query-conditional body. The
  complete 34-module trace retains 21 symbolic registrations.
- The pinned `Date.now()` Test262 case now executes its complete type assertion
  natively through the target host clock. The reference-based numeric
  subtraction case executes all five checks natively against bounded local and
  closed record-property slots.
- Closed `basicAuth` options now execute through upstream Hono factory code and
  lower into a native Basic Authorization request guard. The dependency-free
  runtime parses Base64 credentials from borrowed headers. Native E2Es cover 401
  rejection, successful protected routing, and the complete example's custom
  error/middleware order. The 34-module initialization trace now has zero
  diagnostics.
- The exact closed ETag route now receives its upstream SHA-1 tag at AOT time.
  Native dispatch returns the tagged 200 response or an empty tagged 304 for a
  matching `If-None-Match`; weak and list matching have focused ABI coverage.
- The exact `/fetch-url` route now retains a request-time
  `fetch('https://example.com/').status` expression through upstream async Hono
  handling. The Apple runtime uses system libcurl without a Cargo/npm package,
  and native HTTP verifies `https://example.com/ is 200`.
- The deliberate `/type-error` route now preserves Hono's truthy non-Response
  finalization failure. Native code emits the three observed Bun/Hono TypeError
  lines, returns `Custom Error Message` with status 500, and omits powered-by
  and timing headers. The complete 34-module trace has zero issues, closes all
  16 concrete route responses, and lowers them plus GET/POST installed fallbacks
  into 18 native handlers. Its focused Mach-O E2E is green.
- The complete pinned 34-module application now has a whole-program Mach-O E2E
  for the upstream root contract: status 200, `Hono!!`, the exact Hono content
  type, powered-by, and numeric response-time headers. The same executable also
  serves `/hello` and the installed custom not-found handler. The reproducible
  developer entrypoint is `npm run build:hono-basic-example`.
- The exact pinned four-module Hono JSX SSR application now compiles unchanged
  through 31 upstream runtime modules. Closed component props/children,
  TypeScript JSX whitespace, escaping, tagged `html`, Unicode, captured local
  closures, `Array.map`, and finite `Array.find` all evaluate at AOT time.
- The five closed posts become five exact native response routes. The original
  `:id{[0-9]+}` pattern remains as a numeric 404 fallback, and an emitted Hono
  wildcard preserves `404 Not Found` for paths outside the constraint. Bun
  fixtures and a native Mach-O E2E pin byte-identical root and `/post/1` HTML
  plus missing numeric and nonnumeric 404 behavior.
- A separate request-time Hono JSX route now carries a form-decoded query value
  and closed fallback through nested component props. Native HIR distinguishes
  raw nested markup from escaped dynamic text, and the arena writer matches Bun
  for missing, empty, and encoded `&<>"'` values in text and attributes.
- The pinned upstream `hono/streaming` `streamText()` path now evaluates through
  33 runtime modules into three ordered closed chunks. Native HTTP emits and
  flushes real chunk framing; a 1-byte arena serves the 19-byte stream, proving
  the body is not collected there. The first slice is capped at 16 chunks and
  does not yet implement backpressure, cancellation, `sleep`, or SSE.
- The JSX SSR benchmark validates Bun's 881-byte root response before sampling.
  On the M5 Max run TinyTSX started in 7.14 ms versus 19.32 ms, used 5.83/5.98
  MiB idle/warm RSS versus Bun's 42.03/98.19 MiB, and delivered 0.90–1.14x
  Bun throughput across concurrency 1–64.
- Async/await entry handlers are accepted only when application initialization
  fully stages them. Native Promise/suspension semantics remain unimplemented.
- Static `Response` headers lower into a bounded eight-entry native writer with
  HTTP token/value validation, case-insensitive replacement, and wire emission.
  A pinned WPT `Headers.set()` casing source is tracked as native-derived
  evidence; the upstream JavaScript is not yet executed.
- Closed matching middleware can run around a static handler. The evaluator
  invokes upstream Hono's actual `poweredBy()` factory and async closure, applies
  its post-handler header effect, and a native E2E reproduces the selected
  upstream root-route status and `X-Powered-By: Hono` assertions.
- Closed object literals are records with compile-time fields; explicit `Map`
  construction remains unstaged dynamic work. The two models and declaration-
  overlay boundary are persisted in `doc/OBJECT_MODEL.md`.
- `tinytsx-runtime-worker` is a zero-dependency HTTP-agnostic runtime crate. Its
  fixed native pool provides a preallocated bounded FIFO queue, nonblocking
  submission with job recovery, stable worker-local state, per-job panic
  containment, and close/drain/join shutdown. Six unit tests prove invalid
  configuration, true two-thread progress, saturation/closed behavior, local
  state, panic recovery, and draining.
- Generated objects now export the configured worker count, and the CLI accepts
  every positive `--workers N`. The bootstrap creates that many native executor
  threads and a queue of 64 waiting connections per worker. Its single
  acceptor submits owned streams without blocking; saturation returns a bounded
  `server overloaded` HTTP 503. The overload path consumes a request head for at
  most 10 ms and half-closes its response so unread TCP bytes cannot hide the
  status behind a reset.
- A focused two-worker pinned-Hono E2E keeps one executor blocked on a partial
  root request while the other returns `/hello`, then validates the root reply,
  occupies both executors plus all 128 queue slots, observes the next connection's
  503, releases the sockets, and receives a later 200. It also asserts the build
  report's worker count/runtime feature and passed three consecutive runs.
- The first one-worker `oha -c 64` attempt proved that eight waiting slots were
  too shallow for the existing comparison: 123 requests received the intended
  503 and the harness rejected the sample. The bound is now 64 per worker, which
  covers the current maximum client concurrency without becoming unbounded;
  overload remains covered at the new 128-slot two-worker boundary.
- The existing equivalence-gated TinyTSX/Bun harness now accepts a positive
  `--workers` count, emits it into a distinct release executable, records it in
  JSON/Markdown, and labels the connection-close limitation explicitly. A unit
  test pins forwarding of the selected count into the native build command.
- The pinned 31-module Hono JSX SSR root has a 1/2/4/8-worker baseline with
  byte-equivalence gates and three samples at concurrency 1/8/32/64. Warm RSS
  moved from 6.05 to 6.41 MiB, while concurrency-64 throughput was
  31.5k/29.8k/29.2k/30.1k requests/s. More workers did not improve this
  connection-close, single-acceptor, pre-rendered workload; the combined report
  explicitly requires keep-alive and request-time rendering before conclusions.
- AI SDK Core is pinned at `ai@7.0.28` commit `36496942`, with a reproducible
  published install selecting gateway 4.0.20, provider 4.0.3, provider-utils
  5.0.10, and Zod 3.25.76. Published declarations type-check with the exact
  upstream Node/JSON-schema development types. The source audit reaches 609
  modules and 64,774 lines with zero unresolved runtime imports. The pinned
  `generateText`/`MockLanguageModelV4` plus Hono consumer now passes under Bun
  and compiles through 662 upstream/runtime modules into native HIR. The native
  arm64 build is 1,051,560 bytes, reports no JavaScript engine and GC disabled,
  and a real `/ai` request returns the exact 27-byte deterministic response.
  The current Zod boundary is intentionally limited to the known-valid tracer;
  invalid-schema equivalence is still open. A second Bun/native compiler test
  passes the mutually exclusive `prompt` and `messages`, executes the upstream
  `InvalidPromptError` inheritance chain, and lowers the installed Hono error
  handler to the matching status-500 message.
- HIR and native build reports now contain executed allocation evidence rather
  than inferring memory safety from a constant result. The deterministic AI
  target reports 753 sites: 752 compile-time, one static response, 229 with
  aliases, one response escape, and no managed sites. The Rust validator
  recomputes those totals, `managedHeapRequired` is false, and focused tests
  keep AI SDK generated IDs compile-time and non-escaping.
- A pinned deterministic `streamText` Hono consumer now passes under Bun and
  TinyTSX. The tracer consumes the configured `MockLanguageModelV4` readable
  stream, preserves `Hello` and ` from streaming AI` as two HIR/native chunks,
  and returns `text/plain; charset=utf-8`. The 1,052,552-byte native binary
  served the exact 23-byte body over chunked HTTP. Its report has 101 sites: 78
  compile-time, 13 static, 10 request-lifetime, 34 with aliases, 23 response
  escapes, and no managed sites; GC remains disabled.
- HTTP/1.1 connections now stay on one executor for up to 100 requests or five
  idle seconds. A 16 KiB parser preserves pipelined bytes, consumes validated
  bodies up to 1 MiB, rejects duplicate Content-Length/transfer encoding, and
  closes deterministically on framing or application failures.
- Every HTTP executor now allocates its configured response arena once and
  reuses the same pointer for subsequent requests. Native Hono E2E covers two
  pipelined routes, body framing, the 100-request cap, malformed/oversized close,
  saturation recovery, and an 8-byte arena that serves a normal response,
  returns OOM for a larger route, then serves a normal request again.
- Arena-only light lambdas are now the default memory decision. Persistent
  managed heaps and GC are optional compatibility profiles triggered only by an
  executed escaping graph, not assumed roadmap endpoints.
- The keep-alive Hono JSX matrix proves worker scaling at concurrency 64:
  23.8k/43.0k/70.9k/102.8k requests/s for 1/2/4/8 workers, while warm RSS stays
  at 5.91/5.97/6.08/6.30 MiB. Eight workers reach 1.04x the paired Bun
  throughput there, but TinyTSX p99 is 26.3 ms versus Bun's 1.25 ms because
  excess persistent connections wait behind a worker's bounded turn.
- Eight-worker request-time previews are now retained for dynamic JSX and
  finite streaming. TinyTSX stays near 6.1 MiB warm versus Bun at 99.7/154.6
  MiB, but reaches 0.72–0.79x Bun RPS for JSX and 0.72–0.90x for streaming at
  concurrency 8–64. TinyTSX p99 remains 30–44 ms at c64, confirming connection
  fairness is still the main tail problem. Bun collects the finite stream to a
  19-byte Content-Length response while TinyTSX preserves three wire chunks.
- The reusable runtime crate now layers bounded logical-worker mailboxes over
  the native executor pool. Tests prove per-worker FIFO ordering and isolated
  state, parallel execution across logical workers, returned ownership on
  overload, queued-message cancellation on termination, panic recovery, and
  draining shutdown.
- A compile-time-known `new Worker(new URL(...), {type: 'module'})` now lowers
  through typed HIR into a separate bounded application pool. The first
  `await worker.request(string)` subset compiles a default
  `input.toUpperCase()` worker, copies messages across the pool boundary, caps
  them at 4 KiB, and reports application saturation as HTTP 503. Native Hono
  E2E covers fallback, `+`, and percent-decoded messages with two application
  executors. Build reports distinguish HTTP executors, application executors,
  and logical workers.
- The one-logical-worker Bun comparison records 7.22 ms startup and 6.48 MiB
  warm RSS for TinyTSX versus 19.78 ms and 111.45 MiB for Bun. TinyTSX reaches
  0.74–0.76x Bun throughput at concurrency 8–64; c64 p99 is 36.38 ms versus
  1.45 ms. This measures copied request/reply overhead and the existing HTTP
  connection-affinity tail, not parallelism across several logical workers.
- `@ai-sdk/openai-compatible@3.0.10` is locked and audited with the pinned Hono
  and Core graph: 656 modules, 2,264,407 bytes, 71,709 lines, and zero unresolved
  runtime imports. Bun and TinyTSX both execute the unchanged local-provider
  consumer and send the exact bearer token, model, messages, and prompt.
- The native provider transport runs on one logical provider per application
  executor, uses bounded owned messages, reuses a curl handle/HTTP connection,
  and copies decoded assistant text into the request arena. A regression test
  pins connection reuse after sustained load exposed ephemeral-port exhaustion.
- The provider build reports 66 allocation sites: 65 compile-time, one request,
  22 aliased, one response escape, and zero managed sites. It keeps GC disabled
  and confirms that this real I/O path still does not justify a collector.
- Repeated zero-delay provider benchmarks record TinyTSX/Bun startup at
  12.64/48.98 ms with one worker and 14.08/48.57 ms with eight. TinyTSX warm RSS
  is 8.34/10.03 MiB versus Bun at 255.27/251.80 MiB. Eight provider workers
  reach 43.4–46.1k requests/s at concurrency 8–64, or 2.37–2.87x the paired Bun
  result; one worker saturates near 12.3k and retains the known tail problem.
  The provider performs no inference, so these are transport/framework results.
- `tinytsx-runtime-wasm` defines a separate optional interpreter profile without
  changing default bootstrap dependencies. Exact `wasmi@1.1.0` execution is
  feature-gated, admits no imports or WASI, caps module bytes, linear memory,
  instances, memories, tables, and fuel, and exposes only a typed `i32 -> i32`
  invocation ABI.
- The pinned 59-byte no-WASI fixture executes `add_one(41) == 42`. Tests also
  reject imports and oversized modules, fail one-page memory instantiation
  below 64 KiB, stop an infinite loop at its fuel bound, and prove the default
  profile reports `BackendDisabled`. The profile is not yet exposed through
  TypeScript `WebAssembly` syntax or linked into generated applications.

Verification:

```bash
rtk cargo check --workspace
rtk npm install --prefix frontend
rtk npm test --prefix frontend
rtk node frontend/dist/src/cli.js examples/static-page/server.tsx
rtk cargo test --workspace
rtk cargo clippy --workspace --all-targets -- -D warnings
rtk cargo test -p tinytsx-runtime-worker
rtk cargo run -q -p tinytsx -- check examples/static-page/server.tsx --emit-asm
rtk cargo run -q -p tinytsx -- check examples/static-page/server.tsx --target aarch64-unknown-linux-gnu --emit-asm
rtk cargo test -p tinytsx codegen::
rtk cargo test -p tinytsx --test codegen_targets
rtk cargo run -q -p tinytsx -- check examples/staged-constants/server.tsx --emit-hir
rtk cargo run -q -p tinytsx -- build examples/static-page/server.tsx --port 3017 --output dist/static-server --release --emit-hir --emit-asm
rtk curl -i --max-time 5 http://127.0.0.1:3017/
rtk npm run test:benchmarks
rtk npm run audit:hono
rtk npm run try:compile:hono  # emits single-route HIR
rtk npm run audit:hono-basic
rtk npm run try:compile:hono-basic  # emits full-package single-route HIR
rtk npm run build:hono-basic-example
rtk npm run audit:hono-jsx-ssr
rtk npm run try:compile:hono-jsx-ssr
rtk npm run build:hono-jsx-ssr-example
rtk cargo run -q -p tinytsx -- build tests/compat/hono/basic-smoke.ts --alias hono=vendor/hono/src/index.ts --api hono=tests/compat/hono/api.d.ts --output dist/hono-basic
rtk npm run test:test262-intake
rtk npm run test:test262-native
rtk npm run test:hono-intake
rtk npm run test:wpt-intake
rtk npm run test:wpt-native
rtk npm run test:native-api
rtk npm run test:ai-intake
rtk npm run test:ai-reference
rtk npm run build:ai-hono
rtk npm run build:ai-hono-stream
rtk npm run test:ai-provider-native
rtk npm run test:wasm
rtk npm run benchmark:hono-ai-provider
rtk python3 benchmarks/scripts/run_static.py --duration 2 --runs 3 --startup-runs 5 --concurrency 1,8,32 --output-prefix benchmarks/results/2026-07-14-m5-max-static-preview
rtk python3 benchmarks/scripts/run_static.py --workload hono-basic --duration 1 --runs 3 --startup-runs 5 --concurrency 1,8 --output-prefix benchmarks/results/2026-07-15-m5-max-hono-preview
rtk npm run benchmark:hono-jsx-ssr
```

## Active slice

Deterministic `generateText`, finite `streamText`, the first real local
OpenAI-compatible provider path are complete through HIR, native linking, real
HTTP responses, sustained load, and executed escape reports. The optional WASM
profile and bounded no-WASI fixture are also complete at the crate boundary.
The active AI slice is deterministic multi-step/tool-call behavior; invalid Zod
behavior is an independent promotion gate. Neither current path justifies a GC.
Connection fairness remains a measured optimization target.

## Resume point

Read `doc/AI_COMPATIBILITY.md`, `doc/MEMORY_MANAGEMENT.md`, and
`doc/WASM.md`. Run `rtk npm run test:ai-intake`,
`rtk npm run test:ai-reference`, `rtk npm run test:ai-provider-native`, and
`rtk npm run test:wasm`. Add deterministic multi-step/tool-call behavior next,
keeping invalid-Zod behavior separate. Do not start a collector spike without
an executed managed escape.
