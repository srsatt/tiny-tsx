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
- [ ] Add native Test262 execution; syntax intake alone is not conformance.
- [ ] Compile function values, closures, records, arrays, and ordinary loops.
- [x] Add a conservative AOT staging pass for imported closed constants,
      constant array/object spread, and closed-value destructuring rest.
- [x] Classify every reachable Hono spread/rest site as constant or runtime and
      prove the method-table spread folds to seven static method names.
- [ ] Use TypeScript record layouts to specialize request-time closed-shape
      object rest such as Hono's `optionsWithoutStrict`.
- [ ] Feed staged values into the general typed HIR and native data sections.
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
