# Backlog

Items are ordered. A checked item must have evidence in `doc/STATUS.md` or its
commit message.

## Milestones 0–2

- [x] Add compact Cargo/npm workspace, SDK declarations, and static example.
- [x] Define versioned, source-located JSON HIR shared by frontend and compiler.
- [x] Collect TypeScript diagnostics and validate the static TinyTSX subset.
- [x] Lower static TSX and component calls into coalesced HTML operations.
- [x] Add frontend positive and negative tests.
- [x] Implement `tinytsx check` and `--emit-hir`.
- [x] Emit deterministic Apple arm64 assembly and expose `--emit-asm`.
- [x] Implement the single-worker bootstrap HTTP runtime.
- [x] Assemble and link a native Mach-O executable through the Rust toolchain.
- [x] Implement `tinytsx build`, output selection, and temporary artifacts.
- [x] Add a real HTTP end-to-end test and report executable size.
- [x] Update README with exact working commands.

## Benchmark evidence

- [x] Add an idiomatic Bun static server with equivalent response semantics.
- [x] Add repeated startup, RSS, throughput, and latency measurement via `oha`.
- [x] Retain machine-readable samples and a readable static preview report.
- [x] Run the complete pinned 34-module Hono application through TinyTSX and
      the real Bun/Hono runtime with response-contract validation.
- [x] Record repeated complete-app startup, idle/post-warm-up RSS, throughput,
      and latency samples through concurrency 128.
- [x] Run the exact pinned JSX SSR source on TinyTSX and Bun with byte-identical
      root HTML, then record startup, RSS, and load through concurrency 64.
- [ ] Resolve the Hono response-clone Content-Type difference with direct
      Web-platform evidence and an explicit compatibility decision.
- [x] Implement HTTP/1.1 keep-alive and rerun equivalent transport tests.
- [x] Implement the bounded native worker pool and benchmark 1/2/4/8 workers.
- [ ] Benchmark dynamic escaping, request arenas, route parameters, JSON/query
      branches, and representative response sizes.
- [x] Record repeated eight-worker keep-alive previews for request-time nested
      JSX escaping and finite `streamText()` against Bun.
- [ ] Add CPU, syscall, allocation, peak-RSS, and first-launch instrumentation.
- [ ] Run controlled, longer-duration release comparisons before publishing claims.

## Workers, AI, and managed memory

- [x] Define native executor versus logical worker terminology, lifecycle,
      isolation, message ownership, overload, and shutdown contracts.
- [x] Add a zero-dependency reusable native worker-pool crate with a bounded
      FIFO queue, worker-local state, panic recovery, and draining shutdown.
- [x] Make the HTTP bootstrap consume the shared pool and enable `--workers N`.
- [x] Prove concurrent request execution, deterministic saturation 503, response
      isolation, and recovery after overload.
- [x] Benchmark equivalent Hono workloads with 1/2/4/8 workers, reporting RSS,
      throughput, median/p99 latency, and queue saturation behavior.
- [ ] Implement compile-time-known module Workers as syntax sugar over isolated
      mailboxes and a separate application task pool.
- [ ] Pin an exact AI SDK Core revision and run the Hono-style syntax/type/source
      intake against `ai`, `@ai-sdk/provider`, `@ai-sdk/provider-utils`, its
      gateway dependency, and the selected schema dependency.
- [x] Record the exact `ai@7.0.28` candidate revision/manifest, Core-only scope,
      deterministic fake-model target, test layers, and worker/GC exit gates.
- [ ] Compile a deterministic AI SDK Core test with a fake model and no network,
      credentials, or provider package before attempting streaming/provider I/O.
- [ ] Inventory Promise, async iterator, Web Streams, AbortSignal, encoding,
      Fetch, URL, crypto, timer, and persistent-heap gaps from that exact graph.
- [x] Define static, request, worker, message, and managed-heap lifetimes plus
      the evidence threshold for starting a collector integration spike.
- [ ] Add escape classification, heap ABI descriptors, roots, safepoints/stack
      maps, and write-barrier sites before selecting a precise collector.
- [ ] Compare an established conservative collector and a precise per-worker
      collector/toolkit; do not implement a production GC from scratch.

## Next slice

- [x] Load relative ESM runtime graphs for TypeScript, TSX, and JavaScript source.
- [x] Emit an aggregate compatibility report instead of stopping at the first
      unsupported Hono construct.
- [x] Pin an exact-source `hono/tiny` smoke application and continuously audit
      its reachable modules.
- [x] Add the Test262 pin, allowlist, provenance validation, and syntax-intake
      runner contract.
- [x] Add focused native host API conformance tests and a dedicated test command.
- [x] Type-check the entire pinned Hono runtime graph against TypeScript's
      standard DOM and DOM iterable declarations without handwritten global
      Request/Response replacements.
- [x] Compile a relative ESM component through HIR, assembly, native linking,
      and a real HTTP test.
- [x] Route the pinned bare `hono/tiny` import through the compiling frontend and
      preserve its exact-source unsupported boundary as capabilities advance.
- [ ] Resolve bare package imports and combine runtime source with package
      declarations in the compiling frontend.
- [x] Allow a type-only `api.d.ts` alias while retaining the upstream package
      source as the runtime compilation graph.
- [x] Add a first-route tracer for the full `hono` entry used by the upstream
      basic example, alongside the smaller `hono/tiny` tracer.
- [x] Pin the upstream `honojs/examples` revision and intake its complete basic
      source and behavior test rather than only the first route.
- [x] Add an allowlist-driven native Test262 compiler/runner and execute the
      exact `typeof undefined` case as a standalone Mach-O program.
- [x] Execute the complete six-assertion Test262 `typeof bigint` case, including
      closed `BigInt(...)` conversion and `Object(...)` boxing categories.
- [x] Execute the complete Test262 infinite `for (;;)` case through 101 native
      pre-increments, numeric throw/catch completion, and final counter checks.
- [x] Execute the complete pinned `Array.prototype.unshift` Test262 case with a
      bounded dense numeric array, source-ordered mutation, length results, and
      out-of-range `undefined` checks.
- [ ] Promote the remaining syntax-only Test262 cases only as their complete
      assertion programs become executable.
- [ ] Compile function values, closures, records, arrays, and ordinary loops.
- [x] Keep compile-time closed records distinct from dynamic `Map` values in
      staging, HIR terminology, tests, and the documented object model.
- [ ] Implement bounded native `Map` storage for genuinely dynamic keys.
- [x] Add a conservative AOT staging pass for imported closed constants,
      constant array/object spread, and closed-value destructuring rest.
- [x] Classify every reachable Hono spread/rest site as constant or runtime and
      prove the method-table spread folds to seven static method names.
- [ ] Use TypeScript record layouts to specialize request-time closed-shape
      object rest such as Hono's `optionsWithoutStrict`.
- [x] Feed staged values into a typed HIR constant pool and deterministic native
      read-only data blobs.
- [x] Preserve `undefined` and arbitrary-precision bigint staged constants and
      add their allowlisted Test262 syntax cases.
- [ ] Add constant `symbol` values and preserve signed zero, `NaN`, and
      infinities before claiming complete ECMAScript primitive constants.
- [x] Lower reachable named functions with up to four required string
      parameters, imported direct calls, and staged string constants through
      native code generation.
- [x] Emit native text response metadata and verify the Hono basic route body
      and content type through a real HTTP request.
- [ ] Expand ordinary functions to locals, branches, closures, additional
      native types, and general typed expressions and statements.
- [x] Lower closed constructor string fields and an immediate class method call
      through the ordinary function HIR and native calling convention.
- [ ] Compile the restricted class semantics required by `hono/tiny`.
- [ ] Specialize Hono's constant method-name computed assignments into closed
      class fields without enabling arbitrary dynamic object properties.
- [x] Prove the constructor's closed `forEach` assignment enumerates exactly
      `get`, `post`, `put`, `delete`, `options`, `patch`, and `all`, and admit
      that site while retaining diagnostics for dynamic computed keys.
- [ ] Replace whole-module forbidden-syntax rejection with reachability from
      default-exported application initialization and request dispatch.
- [x] Recognize a constructed default application, preserve its ordered
      top-level calls, and select it before validating unused imported methods.
- [x] Resolve the constructed binding through runtime imports/re-exports and
      preserve the derived/base class constructor chain with source spans and
      ordered operation kinds.
- [x] Execute the traced constructor and registration calls against upstream
      class/function source to produce an immutable compile-time route artifact.
- [x] Symbolically execute Hono/HonoBase default parameters, field initializers,
      `super`, the closed method loop, assignments, destructuring,
      `Object.assign`, conditionals, closures, and router construction.
- [x] Invoke the installed `get` closure and execute its `#addRoute` effects.
- [x] Lower one evaluated static GET route and its upstream `Context.text`
      response into HIR and path-checked native request dispatch.
- [x] Generalize native dispatch to multiple ordered static GET routes.
- [x] Dispatch closed POST routes by request method and preserve explicit HTTP
      status plus Hono text/JSON content types.
- [x] Add non-empty `:name` route segments, request-time `c.req.param(name)`,
      percent decoding, and streamed text interpolation.
- [x] Add terminal `*` route matching, including the base path and deeper
      segments, and compile the basic example's `/api/*` 404 fallback.
- [ ] Add optional and additional multi-segment route patterns plus
      broader request-dependent handler bodies.
- [x] Match Hono's `:id{[0-9]+}` route slice natively and specialize a finite
      closed-record `Array.find` into exact response routes plus a 404 fallback.
- [ ] Add optional parameters, general constraints, and non-terminal catch-alls;
      the native constraint backend currently admits only `[0-9]+`.
- [x] Compose same-method/path handlers into one ordered route and apply closed
      post-`next()` response effects.
- [x] Lower the request-query-dependent response branch in
      `app.get('/api/posts', prettyJSON(), handler)`.
- [x] Compile upstream `Context.redirect('/')` with status 302, `Location`, an
      empty body, and no content type.
- [x] Borrow bounded request headers and stream the basic example's
      `c.req.header('User-Agent')` value through native text output.
- [x] Apply closed post-handler middleware and compile upstream `poweredBy()`
      through native response-header emission.
- [x] Evaluate multiple constructed Hono bindings and mount nested applications
      through upstream `route()`, `basePath()`, `#clone()`, and `#addRoute`.
- [x] Compile the basic example's closed `/hello/*` async middleware and static
      post-`next()` response header.
- [x] Lower an explicitly installed Hono `notFound()` handler into ordered GET
      and POST native fallback dispatch.
- [x] Route a closed thrown `Error` through an explicitly installed Hono
      `onError()` handler, including native `console.error` output.
- [x] Compile the basic example's exact `Date.now()` response-time middleware
      into a bounded runtime-formatted header, including composition with
      `prettyJSON()` response clones.
- [x] Compile the basic example's closed `basicAuth` configuration into a native
      request guard, including authorized, rejected, and custom-error behavior.
- [x] Compile the basic example's closed `etag` response into an AOT SHA-1 tag
      and native `If-None-Match` 200/304 dispatch.
- [x] Compile the exact `await fetch('https://example.com/').status` route into
      a request-time native fetch expression, with focused ABI and HTTP E2E
      coverage.
- [x] Preserve Hono's deliberately invalid truthy handler return through its
      installed error path, then compile/build the complete pinned 110-line
      basic application as one native executable.
- [x] Verify the complete executable against the upstream basic root contract,
      including powered-by and response-time middleware, and provide a single
      reproducible build command.
- [ ] Generalize Fetch to Request/init inputs, response bodies and headers,
      abort/timeout semantics, and portable non-macOS host transports.
- [ ] Compile the required rest/spread operations.
- [ ] Add a native RegExp backend and allowlisted Test262 cases.
- [ ] Add the general Request, Response, Headers, Fetch, URL, and encoding
      native APIs.
- [x] Add bounded static response headers with HTTP validation,
      case-insensitive replacement, and wire emission.
- [x] Lower closed `JSON.stringify`, `Headers`, `Object.entries`, array binding,
      and `for...of` semantics used by Hono `Context.json/#newResponse`.
- [x] Intake a pinned Web Platform Test for `Headers.set()` casing and connect
      it to focused native-derived ABI evidence.
- [x] Intake the pinned WPT `ResponseInit.status` source and connect its closed
      201 case to native-derived Hono E2E evidence.
- [x] Intake the pinned WPT `URLSearchParams.has(name)` source and connect its
      one-argument presence case to focused native query ABI evidence.
- [x] Add an allowlist-driven native WPT compiler/runner and execute every
      assertion in the complete pinned `URLSearchParams.get()` source.
- [x] Promote the complete pinned `URLSearchParams.has()` source by adding
      false assertions, ordered append/delete mutation, Web IDL string
      coercion, and the two-argument `has`/`delete` semantics it exercises.
- [x] Execute the complete pinned `URLSearchParams` stringifier WPT with form
      `+`/percent decoding, UTF-8 percent serialization, malformed escape
      preservation, and live mutation of the selected linked URL cases.
- [ ] Add invalid UTF-8 replacement semantics and direct upstream parser
      evidence before claiming the complete form-urlencoded parser.
- [x] Share native form-decoding semantics with application Request query lookup,
      then cover encoded query names through the Hono HTTP path.
- [ ] Add exceptions, Promise, async/await, and a bounded native task executor.
- [x] Add the pinned Test262 throw-statement and Error-message cases to the
      syntax allowlist; native Test262 execution remains pending.
- [x] Admit async/await handlers when application initialization fully stages
      them without creating a native Promise or suspended task.
- [x] Reproduce the pinned basic example's selected root-route status and
      `X-Powered-By: Hono` assertions through a native HTTP E2E.
- [ ] Run broader upstream Hono behavior tests as features become available.
- [x] Run the pinned first-route source under Bun and TinyTSX, require equivalent
      responses, and persist a repeated exploratory comparison.
- [ ] Repeat the exact-source comparison once request-dependent handlers and
      keep-alive HTTP are available.
- [x] Lower request query values and closed fallbacks through dynamic component
      props into request-time native JSX.
- [x] Match Bun/Hono HTML escaping for decoded request values in JSX text and
      quoted attributes, including nested component markup.
- [x] Compile pinned upstream `hono/streaming` `streamText()` and emit bounded
      HTTP/1.1 chunks without collecting the whole body.
- [ ] Add request-dependent stream chunks, `sleep`, cancellation, backpressure,
      and disconnect propagation; the first executable slice is finite and
      statically planned.
- [x] Fixed request arena and recoverable request OOM.
- [x] Fixed native worker pool and bounded dispatch queue.
- [ ] Add request parsing and response equivalence cases beyond the static page.
