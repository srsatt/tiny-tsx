# Hono alpha coverage

The authoritative coverage inventory is
`tests/compat/hono/docs-matrix.json`. It was reviewed against the official
[Hono documentation](https://hono.dev/docs/) and
[`llms-full.txt`](https://hono.dev/llms-full.txt) on 2026-07-17. The intake test
requires an explicit status, first unsupported boundary, and evidence path for
every recorded guide, helper, middleware, and core API row.

`native-pass` always means the bounded behavior stated in that row, never the
whole named Hono API. The current native rows are Basic Auth, Body Limit,
Request ID, bounded CORS, ETag, Powered By, Pretty JSON, the `html` helper,
finite text streaming, and the admitted JSX slice. Core Hono, Context,
HonoRequest, routing, middleware composition, validation, presets, and Node.js
startup remain `partial` because only their listed tracers compile.

The beta history tracer promotes one additional existing Hono request surface:
`context.req.query("name") ?? "fallback"` may flow directly into a prepared
SQLite parameter. A static non-empty name is limited to 128 UTF-8 bytes and the
decoded value/fallback to 256 bytes. `Number(...)` around that exact expression
binds a signed integer when the fallback and request value are JavaScript-safe
integers. Missing values use the compiled fallback; malformed UTF-8, malformed
integers, overflow, or exceeded bounds return 400. This is not a general query
object, dynamic key, floating-point parser, or arbitrary numeric expression.

The official-doc review pulls only two new middleware capabilities into the
alpha critical path:

1. Body Limit, as part of bounded JSON request bodies for the blog tracer.
2. CORS, for the same portable blog/API contract.

The transport and request API now provide the bounded body foundation: a
64-KiB cap and statically selected `HonoRequest.json()` fields used by prepared
SQLite parameters or one closed primitive `Context.json()` response. The latter
preserves string escaping, finite numbers, booleans, and null while rejecting
missing or structured selected fields with 400; it does not create a general
runtime body object. The pinned upstream `bodyLimit()` factory runs unchanged for
a closed integer `maxSize` from 0 through 64 KiB and its default 413 response.
The guard applies to `Content-Length` requests before the handler executes;
multiple closed guards use the smallest limit. Custom `onError`, dynamic or
larger limits, bodies without a supported length, and chunked transfer encoding
remain rejected boundaries. Hono `put()` and `delete()` join the existing
closed `get()` and `post()` route slice.

The pinned upstream `requestId()` factory also runs unchanged with its default
UUID generator. One matched policy per compiled route may use the defaults or
closed `headerName` and `limitLength` options: the header must be a non-empty
HTTP token of at most 128 UTF-8 bytes, and the accepted incoming ID limit must
be from 1 through 1,024 bytes. A valid non-empty ASCII word/hyphen/equals value
is reused; missing, invalid, or oversized input is replaced by UUIDv4. The same
request-local value is exposed through `c.get('requestId')` and the response
header. Custom generators, empty or dynamic options, multiple matching
policies, and replacement of the reserved `requestId` slot remain rejected
boundaries.

General Context variables have a separate fixed-key AOT slice. A route may use
1–16 static non-empty UTF-8 keys of at most 128 bytes with bounded primitive or
supported request-time string values. Pre-`next()` middleware and its handler
share the request-local slots; repeated `set` replaces and a missing `get`
returns `undefined`. Direct identifier and closed string-literal `Context.var`
reads resolve those same slots. Dynamic keys, structured/escaping values,
`Context.var` assignment/destructuring/enumeration, and general `Map` identity,
iteration, or deletion remain unsupported.

The upstream CORS factory now supplies a bounded native slice for closed
`origin: "*"` options. Normal responses receive the declared allow-origin,
credentials, and expose headers; generated OPTIONS routes return 204 with
closed allow-method/header/max-age values. The blog adapter pins Content-Type
preflight under both TinyTSX and Bun/Hono. Origin arrays/functions, dynamic
method functions, reflected request headers, and non-wildcard Vary behavior are
outside this row.

The review was refreshed after compiling the packaged examples against the
published `hono@4.12.30` JavaScript distribution. The closed CORS, Body Limit,
and Request ID specializations accept both the pinned source forms and the
exact published package forms; this does not admit arbitrary compiled
middleware. No other documented guide, helper, middleware, or core API was
added to the contract by the refresh.

All other missing helpers and middleware are explicitly post-alpha or out of
scope. In particular, alpha does not need compression, cache storage,
WebSockets, JWT/JWK, proxying, SSG, platform adapter detection, or Bun/Node
runtime compatibility merely because Hono documents them.

The post-candidate real-world tracer executes the unchanged backend half of the
pinned Hono `stytch-auth` example. Its nested `/api` graph uses bounded CORS,
selected JSON bodies, no-argument route-parameter record access, and local/
remote auth middleware order. Automated tests replace credentials and network
calls with one deterministic non-empty session-cookie boundary; they do not
claim JWT validation or live `@hono/stytch-auth` compatibility. The exact
`TodoService` class and array operations run through an explicit SQLite KV
adapter. Apple native, Linux assembly, Bun/Hono, installed-archive, and checked
load evidence are pinned by `examples-manifest.json`; native Linux archive
execution remains the final target gate.

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
