# Hono alpha coverage

The authoritative coverage inventory is
`tests/compat/hono/docs-matrix.json`. It was reviewed against the official
[Hono documentation](https://hono.dev/docs/) and
[`llms-full.txt`](https://hono.dev/llms-full.txt) on 2026-07-16. The intake test
requires an explicit status, first unsupported boundary, and evidence path for
every recorded guide, helper, middleware, and core API row.

`native-pass` always means the bounded behavior stated in that row, never the
whole named Hono API. The current native rows are Basic Auth, ETag, Powered By,
Pretty JSON, the `html` helper, finite text streaming, and the admitted JSX
slice. Core Hono, Context, HonoRequest, routing, middleware composition,
validation, presets, and Node.js startup remain `partial` because only their
listed tracers compile.

The official-doc review pulls only two new middleware capabilities into the
alpha critical path:

1. Body Limit, as part of bounded JSON request bodies for the blog tracer.
2. CORS, for the same portable blog/API contract.

All other missing helpers and middleware are explicitly post-alpha or out of
scope. In particular, alpha does not need compression, cache storage,
WebSockets, JWT/JWK, proxying, SSG, platform adapter detection, or Bun/Node
runtime compatibility merely because Hono documents them.

The separate example matrix in `tests/compat/hono/examples-manifest.json`
records nine completed or planned alpha tracers with provenance, imports/APIs,
intake, native/assembly state, HTTP/reference evidence, and the first unsupported
boundary. The local environment tracer combines Hono, `@hono/node-server`, and
the bounded `tinytsx:env` startup snapshot. Its `behaviorAllowlist` names the
exact upstream behavior files and selectors used as native-derived evidence.

Run `npm run test:hono-intake` to validate both matrices and every referenced
evidence path.
