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
- [ ] Add the exact-source Bun compatibility runtime after dynamic TSX lands.
- [ ] Benchmark dynamic escaping, request arenas, and the native worker pool.
- [ ] Run controlled, longer-duration release comparisons before publishing claims.

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
- [ ] Add native Test262 execution; syntax intake alone is not conformance.
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
- [ ] Add optional, constrained, and additional multi-segment route patterns plus
      broader request-dependent handler bodies.
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
- [ ] Compile the remaining basic-example middleware, including `basicAuth`
      and `etag`.
- [ ] Compile the required rest/spread operations.
- [ ] Add a native RegExp backend and allowlisted Test262 cases.
- [ ] Add the general Request, Response, Headers, URL, and encoding native APIs.
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
- [ ] Execute selected Web Platform Tests through the native compiler/runtime;
      declaration-level and derived testing are not conformance.
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
- [ ] Dynamic component props and request query lookup.
- [ ] HTML text and quoted-attribute escaping.
- [ ] Fixed request arena and recoverable request OOM.
- [ ] Fixed native worker pool and bounded dispatch queue.
- [ ] Add request parsing and response equivalence cases beyond the static page.
