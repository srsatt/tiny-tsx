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
- [x] Compile a relative ESM component through HIR, assembly, native linking,
      and a real HTTP test.
- [x] Route the pinned bare `hono/tiny` import through the compiling frontend and
      assert that the first unsupported boundary is the upstream Hono class.
- [ ] Resolve bare package imports and combine runtime source with package
      declarations in the compiling frontend.
- [x] Allow a type-only `api.d.ts` alias while retaining the upstream package
      source as the runtime compilation graph.
- [x] Add a first-route tracer for the full `hono` entry used by the upstream
      basic example, alongside the smaller `hono/tiny` tracer.
- [ ] Pin the upstream `honojs/examples` revision and intake its complete basic
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
- [x] Lower reachable named zero-parameter string functions, imported direct
      calls, and staged string constants through native code generation.
- [x] Emit native text response metadata and verify the Hono basic route body
      and content type through a real HTTP request.
- [ ] Expand ordinary functions to parameters, locals, branches, closures, and
      general typed expressions and statements.
- [ ] Compile the restricted class semantics required by `hono/tiny`.
- [ ] Compile the required rest/spread operations.
- [ ] Add a native RegExp backend and allowlisted Test262 cases.
- [ ] Add Request, Response, Headers, URL, and encoding native APIs.
- [ ] Add exceptions, Promise, async/await, and a bounded native task executor.
- [ ] Run selected upstream Hono behavior tests as features become available.
- [ ] Run the exact source under Bun and TinyTSX and compare responses.
- [ ] Dynamic component props and request query lookup.
- [ ] HTML text and quoted-attribute escaping.
- [ ] Fixed request arena and recoverable request OOM.
- [ ] Fixed native worker pool and bounded dispatch queue.
- [ ] Add request parsing and response equivalence cases beyond the static page.
