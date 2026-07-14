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

- [ ] Dynamic component props and request query lookup.
- [ ] HTML text and quoted-attribute escaping.
- [ ] Fixed request arena and recoverable request OOM.
- [ ] Fixed native worker pool and bounded dispatch queue.
- [ ] Add request parsing and response equivalence cases beyond the static page.
