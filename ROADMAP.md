# TinyTSX Roadmap

The detailed product roadmap remains in `README.md`. This file records the
implementation sequence and completion gates.

1. Project definition: stable specification, language and ABI documents, SDK
   declarations, static example, and build skeleton.
2. Frontend and HIR: TypeScript diagnostics, subset validation, static TSX
   lowering, source spans, `check`, and `--emit-hir`.
3. Static native server: deterministic Apple arm64 assembly, bootstrap HTTP
   runtime, native link, `build`, `--emit-asm`, and real HTTP E2E test.
4. Compatibility substrate: published ESM module graphs, aggregate diagnostics,
   pinned Hono audit, and allowlisted Test262/native API test runners.
5. Core language: closures, records, arrays, loops, restricted classes, and the
   rest/spread forms required by `hono/tiny`.
6. Dynamic rendering: component props, query lookup, nullish coalescing, text
   and attribute escaping.
7. Native platform: RegExp plus Request, Response, Headers, URL, and encoding.
8. Asynchronous execution: exceptions, Promise, async/await, and a bounded task
   executor.
9. Hono conformance: exact-source native server, selected upstream behavior
   tests, and Bun response equivalence.
10. Bounded requests and workers: fixed arenas, deterministic OOM, bounded
    queue, isolated workers, and concurrency tests.
11. Repeatable benchmark, binary analysis, and profile-guided size work.
12. Conditional TSX and restricted list loops.

Only milestones with their verification gates passing are marked complete in
`doc/STATUS.md`.
