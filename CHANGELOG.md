# Changelog

## 0.1.0-alpha.1

First developer preview of TinyTSX's zero-JavaScript native server compiler.

- Pinned Hono source compilation with native `@hono/node-server` and
  `tinytsx:serve` entrypoints.
- Official-style `@hono/zod-openapi` route and OpenAPI document compilation.
- Bounded Web/API, middleware, JSX, worker, environment, filesystem, SQLite,
  and local/persistent counter-actor slices described in `doc/ALPHA.md`.
- Apple-arm64 native builds and Linux-arm64 code generation. Linux execution
  requires the Linux release archive built and verified by Linux CI.

This alpha is deliberately not general TypeScript, ECMAScript, Web API, Node,
Bun, Deno, Hono, or AI SDK compatibility.
