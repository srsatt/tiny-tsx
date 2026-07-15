# Implementation status

Last updated: 2026-07-15

## Current state

Milestones 0–2 are complete for the static-page vertical slice. The compiler
produces and serves a native Mach-O executable from the example TSX source.

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
- The complete pinned 34-module Hono application now runs through both TinyTSX
  and the real Bun/Hono runtime. Five 5-second samples at concurrency
  1/8/32/64/128 show TinyTSX at 0.97–0.99x Bun throughput. Median startup is
  9.77 ms versus 19.91 ms; idle RSS is 5.84 MiB versus 41.73 MiB; post-warm-up
  RSS is 6.09 MiB versus 70.41 MiB. Both plateau near 31k requests/second under
  connection-close HTTP. The response Content-Type difference and ordered next
  experiments are recorded in `doc/PERFORMANCE.md`.
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
  length. The other ten cases remain syntax-only and are not conformance results.
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
  request. General try/catch and runtime exceptions remain unsupported.
- The exact response-time middleware now lowers `Date.now() - start` into an
  elapsed-header HIR recipe. Generated code measures around the native response,
  and a native E2E verifies numeric `X-Response-Time: <n>ms` output. The timing
  header also survives `prettyJSON()` cloning of a query-conditional body. The
  complete 34-module trace retains 21 symbolic registrations.
- The pinned Test262 syntax allowlist now also includes `Date.now()` returning a
  number and reference-based numeric subtraction. These are intake provenance,
  not native Test262 execution claims.
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
rtk python3 benchmarks/scripts/run_static.py --duration 2 --runs 3 --startup-runs 5 --concurrency 1,8,32 --output-prefix benchmarks/results/2026-07-14-m5-max-static-preview
rtk python3 benchmarks/scripts/run_static.py --workload hono-basic --duration 1 --runs 3 --startup-runs 5 --concurrency 1,8 --output-prefix benchmarks/results/2026-07-15-m5-max-hono-preview
rtk npm run benchmark:hono-jsx-ssr
```

## Active slice

The complete Hono basic and JSX SSR milestones are implemented. The next Hono
slice should preserve request-time (not finite closed) values through escaped
JSX text and attributes, bounded response writes, and native record projection.
That creates the first genuinely dynamic SSR benchmark. Keep fixed-layout
records separate from dynamic `Map`; do not infer generic arrays, maps, regexps,
or Promise semantics from the finite specialization. In parallel, performance
work should resolve response-clone content type, add HTTP keep-alive, and then
implement the fixed worker pool before broader claims.

## Resume point

Read `README.md`, `doc/COMPATIBILITY.md`, `doc/PERFORMANCE.md`, and
`doc/BACKLOG.md`. Run `npm run test:hono-jsx-reference`,
`npm run try:compile:hono-jsx-ssr`, and the focused native JSX SSR E2E before
changing the evaluator. Start with request-time escaped JSX values or HTTP
keep-alive, depending on whether compatibility or benchmark fidelity is the
active slice. Preserve upstream Hono source execution and keep finite route
specialization explicit in diagnostics and documentation.
