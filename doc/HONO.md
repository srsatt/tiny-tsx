# Hono alpha coverage

The authoritative coverage inventory is
`tests/compat/hono/docs-matrix.json`. It was reviewed against the official
[Hono documentation](https://hono.dev/docs/) and
[`llms-full.txt`](https://hono.dev/llms-full.txt) on 2026-07-17. The intake test
requires an explicit status, first unsupported boundary, and evidence path for
every recorded guide, helper, middleware, and core API row.

`native-pass` always means the bounded behavior stated in that row, never the
whole named Hono API. The current native rows are Basic Auth, Body Limit,
bounded CORS, ETag, Powered By, Pretty JSON, the `html` helper, finite text
streaming, and the admitted JSX slice. Core Hono, Context, HonoRequest, routing,
middleware composition, validation, presets, and Node.js startup remain
`partial` because only their listed tracers compile.

The official-doc review pulls only two new middleware capabilities into the
alpha critical path:

1. Body Limit, as part of bounded JSON request bodies for the blog tracer.
2. CORS, for the same portable blog/API contract.

The transport and request API now provide the bounded body foundation: a
64-KiB cap and statically selected `HonoRequest.json()` fields used by prepared
SQLite parameters. The pinned upstream `bodyLimit()` factory runs unchanged for
a closed integer `maxSize` from 0 through 64 KiB and its default 413 response.
The guard applies to `Content-Length` requests before the handler executes;
multiple closed guards use the smallest limit. Custom `onError`, dynamic or
larger limits, bodies without a supported length, and chunked transfer encoding
remain rejected boundaries. Hono `put()` and `delete()` join the existing
closed `get()` and `post()` route slice.

The upstream CORS factory now supplies a bounded native slice for closed
`origin: "*"` options. Normal responses receive the declared allow-origin,
credentials, and expose headers; generated OPTIONS routes return 204 with
closed allow-method/header/max-age values. The blog adapter pins Content-Type
preflight under both TinyTSX and Bun/Hono. Origin arrays/functions, dynamic
method functions, reflected request headers, and non-wildcard Vary behavior are
outside this row.

The review was refreshed after compiling the packaged examples against the
published `hono@4.12.30` JavaScript distribution. The closed CORS and Body Limit
specializations accept both the pinned source forms and the exact published
package forms; this does not admit arbitrary compiled middleware. No other
documented guide, helper, middleware, or core API was added to the contract by
the refresh.

All other missing helpers and middleware are explicitly post-alpha or out of
scope. In particular, alpha does not need compression, cache storage,
WebSockets, JWT/JWK, proxying, SSG, platform adapter detection, or Bun/Node
runtime compatibility merely because Hono documents them.

The separate example matrix in `tests/compat/hono/examples-manifest.json`
records the complete tracer allowlist with provenance, imports/APIs, intake,
native/assembly state, HTTP/reference evidence, and the first unsupported
boundary. Every row names native and reference scripts reached by
`release:verify`, with intentionally local adapters explicitly marked
not-applicable instead of pending. The local environment tracer combines Hono,
`@hono/node-server`, and
the bounded `tinytsx:env` startup snapshot. The static tracer executes the
pinned upstream landing unchanged, then uses the public `tinytsx:fs` built-in
to serve the pinned text assets through application workers. Its
`behaviorAllowlist` names the exact upstream behavior files and selectors used
as native-derived evidence.

Run `npm run test:hono-intake` to validate both matrices and every referenced
evidence path.
