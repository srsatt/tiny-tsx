# TinyTSX Roadmap

The detailed product roadmap remains in `README.md`. This file records the
implementation sequence and completion gates.

1. Project definition: stable specification, language and ABI documents, SDK
   declarations, static example, and build skeleton.
2. Frontend and HIR: TypeScript diagnostics, subset validation, static TSX
   lowering, source spans, `check`, and `--emit-hir`.
3. Static native server: deterministic Apple arm64 assembly, bootstrap HTTP
   runtime, native link, `build`, `--emit-asm`, and real HTTP E2E test.
4. Dynamic rendering: component props, query lookup, nullish coalescing, text
   and attribute escaping.
5. Bounded requests: fixed arena, deterministic 503 on OOM, recovery test.
6. Native worker pool: bounded queue, configurable workers, isolated arenas.
7. Bun compatibility and response equivalence.
8. Repeatable benchmark and binary analysis suite.
9. Profile-guided tiny runtime and realistic size gates.
10. Conditional TSX and restricted list loops.

Only milestones with their verification gates passing are marked complete in
`doc/STATUS.md`.

