# Project records

This directory is the persistent working record for implementation sessions.
The root specification files describe stable contracts; files here may change
as work progresses.

- `STATUS.md` records verified current state and exact resume instructions.
- `BACKLOG.md` is the ordered, checkable work queue.
- `DECISIONS.md` records implementation decisions that are too operational for
  the stable specification but important for future changes.
- `COMPATIBILITY.md` defines the pinned Hono, Test262, and native API
  conformance program.
- `PERFORMANCE.md` records measured TinyTSX/Bun results, limitations, and the
  ordered performance roadmap.
- `WORKERS.md` defines the reusable native executor, logical Worker API, and
  isolation/overload contracts.
- `MEMORY_MANAGEMENT.md` classifies value lifetimes and defines the decision
  boundary for adopting a garbage collector.
- `AI_COMPATIBILITY.md` records the candidate AI SDK Core pin, deterministic
  first slice, expected capability audit, and worker/GC integration gates.

Update status and backlog in the same commit as the work they describe. Do not
mark a capability complete until its listed verification has run successfully.
