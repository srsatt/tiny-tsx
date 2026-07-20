# Changelog

## 0.1.0-beta.1

- Cached AOT `tinytsx dev` loop with persistent TypeScript/Cargo state,
  listener-ready hot restart, last-known-good recovery, and stage timings.
- Deploy-time read-only SQLite bindings with no-follow/query-only opens and
  bounded Hono text/safe-integer query parameters.
- Deterministic embedded Vite asset stores with MIME, ETag/304, `HEAD`, index,
  SPA fallback, traversal denial, and cross-target assembly evidence.
- A separate published-Hono/Vite air-quality proof with matching Bun behavior
  and a passing Apple startup/RSS/RPS/p99 comparison.
- First-class Apple/Linux ARM64 and x86-64 release archive jobs and expanded
  ESLint preflight coverage for the complete beta application shape.

This beta remains a bounded backend-platform proof, not general TypeScript,
ECMAScript, Web API, Node, Bun, Deno, Hono, npm, or AI SDK compatibility.

## 0.1.0-alpha.1

First developer preview of TinyTSX's zero-JavaScript native server compiler.

- Pinned Hono source compilation with native `@hono/node-server` and
  `tinytsx:serve` entrypoints.
- Official-style `@hono/zod-openapi` route and OpenAPI document compilation.
- Bounded Web/API, middleware, JSX, worker, environment, filesystem, SQLite,
  and local/persistent counter-actor slices described in `doc/ALPHA.md`.
- Stable `TINY15xx` diagnostics for built-in capabilities, static limits, and
  unsupported SQLite/actor operations. SQLite `run()` returns bounded typed
  changes/row-id results and admits one atomic prepared-write callback
  transaction; actors include bounded deadlines, hard-reset waiter detachment,
  and one explicit restart-intensity form.
- Bounded one-to-four-segment request JSON primitive paths share one response
  and SQLite lowering, including boolean bindings, atomic two-table profile
  persistence, rollback/recovery evidence, and a packaged Hono example.
- Pressure-aware HTTP/1.1 keep-alive turns preserve the bounded sixteen-request
  hot path while short POSIX readiness waits prevent an idle socket from
  starving queued work on a single-worker server.
- Native Apple-arm64 and Linux-arm64 builds, allowlist execution, installed
  archive examples, checksums, and source-commit manifests.

This alpha is deliberately not general TypeScript, ECMAScript, Web API, Node,
Bun, Deno, Hono, or AI SDK compatibility.
