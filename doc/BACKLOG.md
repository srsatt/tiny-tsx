# Backlog

Items are ordered. A checked item must have evidence in `doc/STATUS.md` or its
commit message.

## Milestones 0–2

- [x] Add compact Cargo/npm workspace, SDK declarations, and static example.
- [ ] Define versioned, source-located JSON HIR shared by frontend and compiler.
- [ ] Collect TypeScript diagnostics and validate the static TinyTSX subset.
- [ ] Lower static TSX and component calls into coalesced HTML operations.
- [ ] Add frontend positive and negative tests.
- [ ] Implement `tinytsx check` and `--emit-hir`.
- [ ] Emit deterministic Apple arm64 assembly and expose `--emit-asm`.
- [ ] Implement the single-worker bootstrap HTTP runtime.
- [ ] Assemble and link a native Mach-O executable through the Rust toolchain.
- [ ] Implement `tinytsx build`, output selection, and temporary artifacts.
- [ ] Add a real HTTP end-to-end test and report executable size.
- [ ] Update README with exact working commands.

## Next slice

- [ ] Dynamic component props and request query lookup.
- [ ] HTML text and quoted-attribute escaping.
- [ ] Fixed request arena and recoverable request OOM.
- [ ] Fixed native worker pool and bounded dispatch queue.
