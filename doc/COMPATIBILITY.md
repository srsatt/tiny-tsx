# Compatibility program

TinyTSX is working toward ahead-of-time compilation of the published Hono
package, beginning with `hono/tiny` and the first route from the upstream basic
example. Compatibility is evidence-driven and deliberately narrower than
general JavaScript compatibility.

## Pinned inputs

| Input | Pin | Purpose |
| --- | --- | --- |
| Hono | `vendor/hono`, tag `v4.12.30`, commit `b2ae3a2204a48ce15a26448fd746d39745eb1837` | Upstream TypeScript source and Hono behavior |
| Hono examples | `vendor/hono-examples`, commit `3b0b62875a0e1265763fea1c6388866d5697ef81` | Complete upstream basic and JSX SSR applications plus selected behavior contracts |
| Hono Zod OpenAPI | `@hono/zod-openapi@1.5.1`, `hono@4.12.30`, `zod@4.4.3`, npm lock in `tests/compat/zod-openapi` | Published package resolution, path validation, typed request data, and generated OpenAPI document tracer |
| Test262 | `vendor/test262`, commit `f2d1435644797268dca1f7988cad5a4e89ccd8d2` | Allowlisted ECMAScript semantics |
| WPT | selected source at revision `08e168922e0c0d42250335a40e679fa5123489df` | Web API behavior provenance; not a full submodule |

Both inputs are shallow Git submodules whose gitlinks record the exact revision.
Test262 cases admitted to execution must preserve their upstream path and
metadata in the allowlist; its BSD license remains available in the submodule.

## Test layers

1. **Compiler intake** loads the complete runtime module graph and reports all
   unsupported constructs with stable diagnostics.
2. **Test262 execution** compiles and runs only cases present in the allowlist.
   Parse-only probes are tracked separately and do not count as conformance.
3. **WPT execution** compiles and runs only complete selected upstream files.
   Derived ABI coverage remains labeled separately from direct execution.
4. **Native API tests** exercise Request, Response, Headers, URL, encoding, and
   later streaming behavior directly at the native ABI boundary.
5. **Hono tests** start with exact-source applications and selected upstream
   behavior cases. TinyTSX and Bun responses are compared byte-for-byte where
   the standards permit it.

Every new language or API feature should enable at least one focused unit test,
one allowlisted standards case when available, and one Hono case when Hono uses
that behavior.

## First exact-source target

```ts
import { Hono } from 'hono/tiny'

const app = new Hono()
app.get('/', (c) => c.text('Hello from Hono'))

export default app
```

The compiler must consume upstream Hono code. It may recognize the host contract
that the default export exposes `fetch(Request): Response | Promise<Response>`,
but it must not replace Hono's router or context implementation.

The initial compiling probe resolves the bare import to the pinned submodule,
passes its first class declaration and the closed computed method-table write at
`src/hono-base.ts:130`. The compiler now recognizes `new Hono()`, the ordered
`app.get(...)` call, and the default export before validating unused imported
methods. Runtime resolution follows the full package's `index.ts` re-export to
`hono.ts:Hono` and then its `HonoBase` import. It reports `TINY1400` at the
application export if constructor evaluation encounters an unsupported effect.
The pinned basic source completes both constructors and the actual installed
`get` closure without issues. Upstream `#addRoute` produces one closed `GET /`
route and one router insertion. The retained handler then follows upstream
`Context.text` into `new Response(text)`; that route and response now lower to
path-checked native HIR.

The upstream basic example imports the full `hono` entry rather than
`hono/tiny`. The complete 110-line application and its selected behavior test
are pinned in `vendor/hono-examples` and checked by the Hono intake suite. The
manifest records all 16 `app`/`book` GET and POST registrations. The focused
`tests/compat/hono/basic-smoke.ts` remains a fast first-route tracer, while the
complete upstream file now compiles to 18 native handlers: its 16 concrete
registrations plus installed GET/POST not-found fallbacks.

A two-route tracer compiles the basic example's `/` and `/hello` registrations
into ordered exact-path native dispatch. A separate tracer evaluates the actual
upstream `poweredBy()` factory and middleware closure, lowers its post-handler
header mutation, and reproduces the selected upstream test's root status and
`X-Powered-By: Hono` behavior over native HTTP. The complete basic application
now builds as one native Mach-O application. This is evidence for that pinned
program, not a claim that broader route patterns or arbitrary Hono applications
are supported.

## Exact JSX SSR target

The complete four-module `jsx-ssr` example at the pinned examples revision now
compiles unchanged. The type-only Hono overlays describe the first-class API
boundary while runtime evaluation continues through pinned upstream Hono
source. The supported slice includes:

- typed component props and children across ESM modules;
- intrinsic attributes, TypeScript-compatible JSX whitespace normalization,
  escaping, tagged `html` templates, and Unicode;
- closed records and arrays, captured local closures, `Array.map`, and finite
  `Array.find` selection by one route parameter;
- Hono `Context.html()` and `Context.notFound()` responses; and
- the numeric `:id{[0-9]+}` route constraint.

The evaluator turns the five closed post records into five exact native post
routes, retains a constrained numeric 404, and emits a Hono-compatible wildcard
404 for paths outside the constraint. This is finite AOT specialization, not
dynamic native array storage or a general regular-expression engine. Bun
fixtures and the native Mach-O E2E require byte-identical root and `/post/1`
HTML plus both 404 behaviors. Reproducible entrypoints are
`npm run audit:hono-jsx-ssr`, `npm run try:compile:hono-jsx-ssr`, and
`npm run build:hono-jsx-ssr-example`.

Request-time JSX is now a separate executable compatibility slice rather than
an inference from that closed SSR page. `c.req.query('name') ?? 'World'` flows
through a nested component into both quoted-attribute and text positions. HIR
retains the lookup, fallback, and escaping mode; the native arena writer
form-decodes the selected value and escapes `&`, `<`, `>`, `"`, and `'`. Bun
reference tests and native HTTP E2E require byte-identical output for missing,
empty, and encoded hostile values. This proves bounded dynamic JSX rendering,
but does not make the JSX response itself streaming.

The pinned `hono/streaming` `streamText()` helper now supplies a separate real
streaming slice. TinyTSX evaluates its 33-module upstream graph, including
`TransformStream`, Hono's `StreamingApi`, async callback, `TextEncoder`, and
`Context.newResponse`, into three ordered finite chunks. Native HTTP writes
proper `Transfer-Encoding: chunked` framing and flushes each chunk. A 1-byte
request-arena E2E still serves the 19-byte body, proving it is not first
collected in the arena, while Bun pins the decoded body and Hono headers.

This is bounded AOT streaming, not a complete Streams implementation: at most
16 chunks are retained, the admitted writes are closed strings, and `sleep`,
backpressure, cancellation, disconnect propagation, arbitrary `ReadableStream`
pipelines, and SSE remain outside the slice.

The basic example's `/entry/:id` shape is the first request-dependent route.
One closed `:name` segment becomes a native matcher and `c.req.param('name')`
becomes a request-time text value. Literal and parameter chunks write directly
to the bounded response buffer, including Hono-compatible decoding of valid
percent-encoded UTF-8 groups. A terminal `:remaining{.*}` now matches an empty
tail or any number of slash-separated segments; `c.req.param('remaining')`
writes the complete decoded tail without allocating a request string. Trailing
optional parameters are specialized into finite routes. Non-trailing optionals,
non-terminal catch-alls, and constraints beyond exact `[0-9]+` and terminal
`.*` remain outside the slice.

Nested application initialization now follows the actual upstream `route()`
implementation. The compiler constructs the second `book` binding, retains its
routes, executes Hono's clone/base-path logic and closed `routes.map(...)`, and
adds `/book` plus `/book/:id` to the parent route storage. Both GET routes are
served by a native E2E. Native method-plus-path dispatch now also serves the
nested `POST /book` response.

The second closed POST slice follows upstream `Context.json()` and
`#newResponse()` for `/api/posts`. Closed JSON serialization, Headers
construction, `Object.entries`, array destructuring, and `for...of` produce
`{"message":"Created!"}`, status 201, and exact `application/json` over native
HTTP. The selected WPT Response-init source is retained as native-derived
provenance for only this status-propagation case, not full Response conformance.

Native method dispatch now also admits the exact upstream Hono `put()` and
`delete()` registration paths used by the pinned blog contract. The local
SQLite adapter exercises create, list, get, update, and delete through upstream
Hono routing. A Bun/Hono plus `bun:sqlite` test pins the same response bodies and
statuses. This evidence covers four closed HTTP methods, not arbitrary Hono
`on()` method sets, HEAD/OPTIONS synthesis, or a general native router.

The adapter now also matches the pinned blog's `{posts, ok}`, `{post, ok}`, and
`{ok}` success envelopes. A bounded `Statement.get()` presence guard executes
before route effects: a missing GET returns `{error: "Not Found", ok: false}`
with status 404, while missing PUT and DELETE return an empty 204 and skip their
SQLite mutation. This is one first-row SQLite existence branch with a direct,
effect-free missing response, not general runtime JavaScript conditionals or
arbitrary result inspection.

`Statement.run()` now exposes the first closed SQLite mutation result. Its
immutable `RunResult` has only `changes: number` and
`lastInsertRowId: string | null`; the row ID is decimal text to preserve every
signed SQLite `i64` exactly. Zero changed rows produce `null`; a nonzero change
returns SQLite's connection-local last-insert row ID. The in-memory owner
tracer captures an insert result, executes a later delete in a separate stable
action slot, and returns
the original `{"changes":1,"lastInsertRowId":"1"}`. The multi-module
user-auth tracer returns the same inserted-row fields and a zero-change update
as `{"changes":0,"lastInsertRowId":null}`. Apple native HTTP, Linux-arm64
assembly, and the installed archive cover this boundary. This is fixed
per-action response lowering, not general result-object identity, mutation,
iteration, storage, or dynamic property access.

The first prepared callback transaction admits one zero-argument async block
with 1–16 awaited `Statement.run` expression statements belonging to the same
database. It carries at most 64 aggregate parameters and 65,536 aggregate SQL
bytes as one owner message. The native Hono tracer commits an item plus its
audit row, then makes the second write of another request violate a uniqueness
constraint and proves the first write was rolled back; a later transaction
still succeeds. Apple arm64 executes these paths and Linux arm64 assembles the
same descriptor ABI. Queries, callback values, visible step results, control
flow, nested or mixed-database transactions, and an interactive transaction
object remain unsupported.

The first request-body slice retains at most 64 KiB and recognizes
`await c.req.json()` when statically selected fields flow into a prepared SQLite
call or one closed `Context.json()` response. The SQLite ABI binds up to 16
route/body string, finite-number, or null values without interpolation and
continues to reject boolean or structured parameters. The response ABI selects
non-empty field names up to 128 UTF-8 bytes and preserves JSON string escaping,
finite numbers, booleans, and null. Malformed input, a missing selected field,
or a selected array/object returns 400; a fully framed application-level 400
keeps HTTP/1.1 reusable, while an oversized transport body returns terminal
413. This does not construct a general runtime record, implement dynamic keys,
arrays/nested objects, mutation, coercion/defaults, or expose whole-object
identity.

The pinned upstream Hono `bodyLimit()` factory now compiles unchanged from both
its TypeScript source and the published `hono@4.12.30` JavaScript package. One
or more closed integer limits from 0 through 64 KiB become a native request-body
guard; the smallest applicable limit wins. A body at the limit reaches the
handler, while a larger `Content-Length` body returns Hono's default status 413
and `Payload Too Large` body. Raw native HTTP proves the rejected response keeps
the connection framed for a following pipelined request. Custom `onError`,
dynamic/out-of-range limits, streaming/no-length requests, and chunked transfer
encoding remain unsupported. TinyTSX applies the pinned Fetch/WPT string-body
content type; Bun 1.3.13 returns the same status/body without that header.

The pinned upstream Hono `requestId()` factory now compiles unchanged from both
its TypeScript source and published `hono@4.12.30` JavaScript. One matched
policy per route supports the default generator and either default options or a
closed non-empty HTTP-token header name up to 128 bytes with a closed incoming
limit from 1 through 1,024 bytes. Apple native and Bun/Hono behavior accept a
valid ASCII word/hyphen/equals value, replace missing, empty, invalid, or
oversized input with UUIDv4, and expose the exact selected bytes through both
the response header and `c.get('requestId')`. Linux-arm64 output assembles and
the installed archive builds and executes the packaged default example.

Accepted input stays borrowed from the request through synchronous dispatch;
generated UUID bytes live in fixed writer-owned storage through serialization.
The response body copies the selected view into its bounded writer, so this
does not add general string identity or a managed heap.
Stable `TINY1403` diagnostics reject custom generators, missing middleware,
empty/dynamic options, out-of-range limits, and multiple matching policies.
The `requestId` slot remains compiler-owned and cannot be replaced through the
bounded general Context-variable slice below.

Pinned Hono `Context.set/get` now has a separate fixed-key specialization based
on `src/context.ts` and its upstream `c.set() and c.get()` test at commit
`b2ae3a2204a48ce15a26448fd746d39745eb1837`. From 1 through 16 statically named
non-empty UTF-8 keys of at most 128 bytes become request-local AOT slots. Values
may be `undefined`, `null`, boolean, finite number, closed string, or an already
supported bounded request-time string. Repeated `set` replaces the slot and a
missing `get` yields `undefined`.

Direct `context.var.name` and closed string-literal `context.var["name"]` reads
resolve the same slots without materializing the source getter's object. A
missing property is `undefined`. Dynamic computed access, assignment,
destructuring, spread/rest, enumeration, identity, and method calls remain
compile-time errors.

The shared tracer stores a closed prefix before `next()` in matched middleware,
then stores and reads a route parameter in the handler. Apple native HTTP proves
32 concurrent requests cannot observe each other's values; Linux arm64
assembles the path-segment ABI and Bun/Hono executes the same source. Dynamic,
empty, or oversized keys, structured/escaping values, more than 16 slots,
general `new Map()`, identity, iteration, deletion, and mutation after response
escape remain unsupported.

The pinned upstream CORS factory now lowers for closed wildcard-origin options.
Normal responses carry the configured static headers, while compiler-generated
OPTIONS handlers return Hono's 204 preflight with closed allow-method,
allow-header, expose-header, credentials, and max-age values. The SQLite blog
adapter fixes `Content-Type` as its admitted request header and matches the same
Bun/Hono preflight. Origin callbacks/arrays, non-wildcard origin matching,
dynamic method callbacks, and arbitrary request-header reflection remain
outside this specialization.

The blog adapter's ID path now evaluates `crypto.randomUUID()` at request time,
sets the Web Crypto version/variant bits over 16 bytes from the Apple or Linux
OS cryptographic random source, and binds the lowercase UUID as prepared SQLite
text. Native tests require two generated IDs to differ and match the version-4
shape; Bun/Hono uses its real Web API as the behavior reference. The value is
currently lowerable only as a prepared parameter, not as a general reusable
runtime JavaScript string or broader Crypto implementation.

Typed Hono `Bindings` now map closed `c.env.NAME` reads to the same immutable
startup snapshot as `tinytsx:env.require("NAME")`. HIR retains the static name
and required flag; compilation fails with `TINY1501` without an exact
`--allow-env NAME`, and missing/invalid/oversized values use the recoverable
runtime error path. The SQLite blog adapter and Bun/Hono reference both expose
the typed blog name. This is a string environment binding, not Cloudflare KV,
D1, R2, Durable Object, arbitrary object, mutation, or ambient enumeration.

Terminal wildcard matching now covers the exact `/api/*` fallback from the
basic example. Native tests pin Hono's behavior that the pattern matches `/api`,
`/api/`, and deeper paths. The generated handler returns Hono's explicit status
404 and text body; unmatched non-API paths still use the bootstrap 404. Optional
trailing parameters now expand at compile time into every finite prefix, so
`/api/:version/animal/:type?` serves both the present value and the staged
missing value without a dynamic router. Non-trailing optionals, multi-segment
captures, and constraints other than `[0-9]+` remain pending.

Hono registrations that share a method and path now retain handler-chain order.
The compiler emits only the terminal route and applies earlier post-`next()`
effects around its response; a native E2E verifies the response header mutation.
This collapses the complete example's two GET `/api/posts` entries into one
route. The actual upstream `prettyJSON()` middleware now evaluates its query
condition, `Response.json()`, `JSON.stringify(..., space)`, and response clone.
HIR records a query-presence conditional, and native HTTP E2E verifies compact
JSON without `?pretty` and two-space JSON with a bare `?pretty` key. This is the
default query-name/presence path only, not general URL parsing or arbitrary
runtime JSON transformation.

The basic example's `Context.redirect('/')` route also compiles from upstream
source. Closed `String(...)`, the ASCII RegExp test, nullish assignment, and
closed variadic spread reach Hono's response construction. Native HTTP preserves
status 302 and `Location: /` while omitting `Content-Type` for the null body.
This is closed compile-time RegExp evaluation, not a native RegExp backend.

The basic example's `/user-agent` route now lowers `c.req.header('User-Agent')`
to a request-time expression. The bootstrap parses at most 64 borrowed header
views, matching names case-insensitively, and generated code streams the value
directly into the response writer. Missing headers preserve template-literal
`undefined`; general mutable Request/Headers objects are not claimed.

The exact `/hello/*` custom middleware also compiles. Its wildcard matches the
base `/hello` route, its async post-`next()` call follows Hono's finalized
response clone, and the static `X-message` mutation reaches native HTTP. A
failed surrounding middleware effect is rolled back independently rather than
partially mutating the supported response.

The exact global response-time middleware also compiles without replacing Hono.
`Date.now()` values remain symbolic until native dispatch, subtraction becomes a
bounded elapsed-millisecond value, and the template suffix stays static. Native
code brackets the response body and the runtime formats a numeric
`X-Response-Time: <n>ms` value in writer-owned storage. A composition tracer
proves the header survives Hono's `prettyJSON()` clone of a query-conditional
body. The complete 34-module evaluation now retains 21 routes, closes 16
concrete responses, applies timing to the 15 successful/non-finalization paths,
and reports no initialization diagnostics.

The clone's `Content-Type` follows Fetch rather than Bun-specific server
behavior. Fetch assigns `text/plain;charset=UTF-8` to a string `BodyInit`; when
Hono later constructs `new Response(c.res.body, c.res)`, the stream adds no
inferred type but the init headers retain the original text type. The pinned
WPT `response-init-contenttype.any.js` source and the focused native
response-time E2E enforce that decision. Bun 1.3.13 omits the initial string
type and consequently serves `application/octet-stream`; benchmarks keep that
reference difference explicit instead of treating it as portable Hono
behavior.

The basic example's exact `basicAuth` options are also specialized from upstream
source. Closed `in` checks and `users.unshift()` build the credential list; HIR
retains it as a Basic Authorization request guard. The zero-dependency runtime
parses and compares the borrowed header without constructing a JavaScript
Request, Headers, RegExp, Uint8Array, TextDecoder, Promise, or crypto object.
Native HTTP tests cover missing and correct credentials plus the complete
example's custom-error ordering: rejected auth logs `Error`, returns the custom
500 response, retains outer `X-Powered-By`, and correctly omits downstream
`X-Response-Time`.

The post-alpha user-auth tracer links configuration, authentication, storage,
and the server from separate local modules. It combines one required typed
environment binding, the pinned static Basic Auth guard, a custom Hono error
handler, a closed HttpOnly/SameSite cookie marker, and an on-disk SQLite audit
row retained across process restart. Closed prepared parameters now include
bounded strings, safe integers, finite reals, booleans, and null without
constructing a runtime JavaScript array or record.
Apple native HTTP and Linux-arm64 assembly are release-gated. This does not add
dynamic credentials or session IDs, password hashing, signed cookies, expiry,
or a general policy engine.

The pinned `hono/cookie` helper now runs unchanged for closed `setCookie`
name/value pairs with its default path or one explicit static path. Hono's real
serializer exercises bounded closed `encodeURIComponent`, string addition
assignment, and `Headers.append`; native HTTP returns the exact upstream
`Set-Cookie` values. A statically named `getCookie` reads the bounded borrowed
request header, normalizes spaces/tabs, decodes valid percent-encoded UTF-8, and
uses a closed missing fallback without constructing a cookie record. Repeated
closed `setCookie` calls preserve both response values, and the unchanged
`deleteCookie` helper returns the named request value while emitting an empty
cookie with `Max-Age=0`. All-cookie objects, dynamic attributes, prefixes,
signing, and session policy are not yet native.

The exact `/etag/cached` middleware now specializes the closed response bytes
to Hono's default SHA-1 entity tag. HIR retains both the normal response and its
304 branch; the native borrowed-header predicate implements wildcard, weak-tag,
and comma-list matching. Native HTTP reproduces the upstream tag
`"90ea638841fff3c326fc22cbd156f1146ac0ac02"` and an empty 304 response for a
matching `If-None-Match`. This is not general Web Crypto or streaming digest.

The exact async `/fetch-url` handler now remains staged through `await` while
`fetch('https://example.com/')` becomes a request-time native operation. Reading
`.status` and interpolating it emits the actual upstream HTTP status, and the
native E2E reproduces `https://example.com/ is 200`. On the current Apple target,
the bootstrap uses the OS-provided libcurl boundary, follows redirects, discards
the response body, and applies a ten-second timeout. This adds no Cargo or npm
package dependency, but the generated executable does dynamically depend on the
macOS system libcurl. It is not general Fetch, Promise scheduling, Response body
access, cancellation, or a portable transport implementation.

When source explicitly calls `app.notFound(handler)`, the evaluator reads the
installed upstream `#notFoundHandler` closure and lowers its response after all
registered routes. Native dispatch emits ordered GET and POST `/*` fallbacks,
preserving the custom 404 status/body. Default Hono fallback synthesis remains
separate from explicit application behavior.

When source explicitly installs `onError()`, a closed thrown `Error` is carried
as abrupt completion into that upstream closure. Closed Error stringification
feeds `console.error`, HIR records the request-time stderr line, and native code
logs it before returning the custom 500 response. This admits only exceptions
fully consumed during application specialization. It remains separate from the
ordinary native string-exception function subset described below.

The complete example's deliberate `@ts-ignore` route returns a truthy string
instead of a `Response`. Hono stores that invalid value in the Context and its
two enclosing post-`next()` middleware paths fail while finalizing it. The
evaluator preserves the three observed Bun/Hono TypeError lines, invokes the
installed upstream error closure, and emits the final 500 response without
powered-by or timing headers. A focused native E2E verifies this exact
failure ordering; it is a pinned Hono/Bun compatibility specialization rather
than general runtime type-error or Promise rejection support.

## Package resolution, serving, and Zod OpenAPI

Runtime imports now resolve ordinary scoped and unscoped packages from the
nearest `node_modules` directory. Resolution understands package `exports`,
condition objects, wildcard subpaths, and `module`/`main` fallbacks. Compiler
built-ins are selected before application aliases or packages and therefore
cannot be shadowed from `node_modules`. This closes package loading; it does not
mean that every successfully resolved package can be lowered.

`tinytsx:serve` is the Hono-neutral source API for selecting a fetch application
and optional closed port. `@hono/node-server` resolves to the same compile-time
host adapter, so the documented `serve(app)` and
`serve({ fetch: app.fetch, port })` entry shapes do not require a JavaScript
server in the produced executable. This is an AOT entry contract only; the
alpha does not claim the complete `@hono/node-server` event, TLS, connection, or
shutdown API.

The pinned `@hono/zod-openapi` tracer resolves 113 published runtime modules
without aliases and executes the actual `OpenAPIHono -> Hono` class chain. The
admitted source subset currently covers:

- `z.object`, `z.string`, `z.number`, closed `.min(...)`, and `.openapi(...)`
  examples/reference metadata;
- `createRoute` with a closed GET path, path-parameter schema, JSON response
  schema, and closed response description;
- `app.openapi`, `c.req.valid('param')`, dynamic path data in `c.json`, and
  the default Zod rejection for the pinned string minimum-length constraint;
- `app.doc` with a closed OpenAPI 3.0 configuration, component schemas,
  parameters, responses, and `$ref` generation.

The Bun reference and native HTTP suites pin the success response, the `id`
minimum-length rejection, and the complete generated `/doc` JSON. Schema and
document construction happen during AOT evaluation; the native server contains
neither a JavaScript engine nor Zod. This evidence does not cover arbitrary Zod
effects/refinements/transforms, request bodies, query/header/cookie validation,
custom hooks, OpenAPI 3.1, or the rest of the Zod/OpenAPI surface. The native
minimum-length guard currently counts percent-decoded path bytes and is proven
only for the ASCII identifier contract in the tracer; general JavaScript
UTF-16 string-length parity remains unsupported.

### Type-only API overlay

The compiling frontend accepts `--api <specifier>=<api.d.ts>` independently of
the runtime `--alias`. The application is type-checked against the narrow API,
while every runtime source module still comes from pinned upstream Hono. A
negative test proves an invalid route path is rejected by the overlay, and the
valid smoke tests then continue into upstream source through the closed computed
method table.

This separation is a compile-time contract only. It does not authorize replacing
Hono methods or Web APIs with different behavior. The initial overlay exposes
only the route/context surface used by the current tracers and grows with tested
native semantics.

Package-entry overlays may intentionally narrow or refine selected Hono method
declarations when the compiler has evidence for that surface. They remain
type-only: each method call must still execute the pinned upstream source and
reach a tested HIR/native behavior. An overlay is never a license to substitute
a compiler-owned Hono implementation.

The runtime graph itself is type-checked against the pinned TypeScript
`lib.dom.d.ts` and `lib.dom.iterable.d.ts`. TinyTSX no longer declares competing
global Request/Response classes. The temporary `Response.html` and
`Response.text` compiler intrinsics are handled as two exact diagnostic/lowering
exceptions; unknown Response properties still fail TypeScript checking. The
type/runtime boundary and current native coverage are recorded in
`doc/WEB_API.md`.

## Staging and static specialization

Whole-program AOT compilation should partially evaluate the actual upstream
Hono initialization path. Calls such as `app.get('/', handler)` normally happen
at module initialization with a literal route and a statically known handler.
The resulting application graph can therefore become immutable native data:
ordered route patterns, precompiled matchers, and native function pointers. This
is an optimization of compiled Hono behavior, not a replacement Hono router.

Closed-shape spread and rest operations should also be specialized. Constant
array spread can be folded, and object rest over a known record can become direct
field initialization without a runtime copy. This does not imply support for
general dynamic spread; cases whose source shape or values are unknown still
need runtime semantics or an explicit unsupported diagnostic. Test262 cases only
count as conformant when their observable behavior executes correctly, even if
a Hono program succeeds because specialization removed the dynamic operation.

Route registration through `app.get()` is process initialization and is usually
static. Request context lookup through `c.get()` is different: it is request-
local state. When all context keys are known, the compiler may assign fixed
slots instead of using a hash map. Computed keys require a real dynamic map or
remain unsupported until that implementation exists.

The intended lifetime stages are:

1. compile time: module initialization and route graph partial evaluation;
2. process lifetime: immutable route tables and application constants;
3. request lifetime: Request, Context, headers, and fixed-key slots in the
   bounded request arena;
4. async lifetime: only values that survive suspension enter async frames or
   longer-lived storage.

Partial evaluation must preserve behavior for the accepted program. If route
registration depends on runtime input, environment-dependent branching, or
other unknown effects, the compiler must retain runtime initialization or reject
the program rather than silently treating it as static.

### Implemented staging boundary

The frontend now has a conservative closed-value evaluator for strings,
finite numbers, bigint, booleans, undefined, null, arrays, and records. It resolves
imported top-level constants, folds constant array/object spread, and
materializes object/array rest when the source is a compile-time closed value.
Each spread or rest site is classified as `constant` or `runtime` in the Hono
compatibility report.

These constants cover every ECMAScript primitive category except `symbol`, but
number constants still exclude signed-zero identity, `NaN`, and infinities.
Those cases need explicit HIR encodings and Test262 evidence rather than being
silently normalized by JSON.

For pinned Hono `v4.12.30`, the current audit finds 19 constant bindings. It
folds the array spread at `src/hono-base.ts:128` into:

```text
["get", "post", "put", "delete", "options", "patch", "all"]
```

The other 17 spread/rest sites remain runtime work. This includes the object
rest over constructor `options` at line 170: its type may permit a later
closed-shape field projection, but its value is not a compile-time constant.
The compiler records that distinction instead of treating all spread syntax as
equivalent.

The constructor's `allMethods.forEach(...)` is also analyzed as a closed
initialization loop. Its `this[method]` assignment is classified as one closed
computed write with seven exact keys: `get`, `post`, `put`, `delete`, `options`,
`patch`, and `all`. The compiling validator admits this site. The remaining 98
computed accesses in the `hono/tiny` graph stay classified as runtime and retain
their unsupported boundary.

This is specialization evidence feeding a deliberately narrow native route.
The default-exported app is now the compile root, so unused methods such as
`route()` do not set the frontier. Hono's constructor chain completes
symbolically with 21 fields, then the installed `get` closure executes through
private `#addRoute`. The evaluator retains closed routes and observes their
router insertions. Multiple ordered static GET artifacts and non-empty named
segments now enter HIR and native path dispatch; broader dynamic patterns remain
pending. The trace and
evaluator contract are recorded in
`doc/APPLICATION_INITIALIZATION.md`.

The allowlisted Test262 array-spread source now runs as a complete native
assertion program. The frontend validates the exact callback/apply shape and
lowers `[...[3, 4, 5]]` into a bounded dense-array spread operation. The native
program copies source elements into a distinct argument buffer, verifies
`arguments.length`, all three argument values in order, and the final callback
count. This is evidence for that exact closed numeric spread/apply program; it
does not claim general iterators, arrays, function apply, or runtime spread in
ordinary application code.

The complete pinned subtraction/GetValue program also runs natively. Its four
numeric bindings—including two closed record-property slots—are initialized in
bounded stack storage. All five source-ordered checks load literal, local, and
property operands at runtime, subtract, and branch to a failing process status
on mismatch. This is exact integer/GetValue evidence; ordinary application
functions still lack general numeric parameters, locals, and return values.

The complete pinned closed-record membership program constructs a bounded
field-name table in the native artifact and compares the queried property bytes
against it at runtime before checking the expected boolean. It proves the exact
own-field `in` assertion; prototype traversal, deletion, dynamic records, and
ordinary application-code membership remain outside the claim.

The direct string throw/catch Test262 program now executes natively as well. It
compares the thrown and caught message bytes, mutates the callback-local catch
flag, and verifies final state before returning success. Together with the
ordinary function E2E, this is bounded string abrupt-completion evidence—not
general Error-object or exception-unwinding conformance.

The complete pinned `Date.now()` Test262 program now executes natively. Its
exact `typeof Date.now() === "number"` assertion calls the target host's
`clock_gettime` symbol and fails if the call does not succeed. The standalone
Test262 entry preserves its AArch64 frame and link registers across host calls
on both success and failure paths. This proves the numeric return category and
portable host-call ABI for this exact assertion; it does not claim ECMAScript
epoch-millisecond precision, monotonicity, clock adjustment, or general `Date`
objects.

The complete pinned class-constructor Test262 program also executes natively.
The bounded assertion frame gives the class, prototype, prototype constructor,
and constructed instance explicit identities; generated code verifies the
constructor-body prototype observation, `C === C.prototype.constructor`, the
standard configurable/enumerable/writable descriptor flags, one constructor
execution, and the final instance prototype. This complements the ordinary
closed-class method slice but does not claim inheritance, dynamic class values,
arbitrary instances, or a general property-descriptor object model.

The complete pinned `Error/message_property.js` program constructs a bounded
native Error record with an owned copy of its message bytes. Generated code
reads that property back and compares it byte-for-byte, then verifies the
standard writable, non-enumerable, configurable descriptor flags. This proves
the exact constructor/helper observations in the upstream program; ordinary
application Error objects, stacks, subclasses, causes, and general descriptor
reflection remain unsupported.

The complete pinned RegExp `test`/`exec` program now executes through a
dependency-free native matcher. The frontend admits bounded ASCII literal
alternatives, and generated AArch64 searches the runtime input bytes twice—once
for `test()` and once for `exec() !== null`—before comparing the presence
results required by the upstream assertion. The current `/1|12/` evidence does
not cover flags, escapes, character classes, quantifiers, captures, Unicode,
match arrays, `lastIndex`, or ordinary application RegExp values.

The complete pinned module-function binding program now executes natively. A
bounded module slot is initialized with the function identity before source
evaluation, its direct call result is compared byte-for-byte, and a separate
global-ownership slot remains absent through every upstream check. Assignment
changes the module slot to `null`, and generated code proves that reaching the
hoisted declaration does not initialize it again. This is evidence for the
exact local mutable function-binding lifecycle, not general live bindings,
cycles, dynamic imports, or arbitrary mutable application values.

The complete pinned async-function expression program now executes natively.
Invocation synchronously creates a bounded native Promise-branded record, and
the generated assertion checks the `instanceof Promise` observation. The empty
function has no settlement value or reactions to run, so this evidence does not
claim fulfillment/rejection queues, `.then`, error propagation, cancellation,
ordinary async functions, or `await` scheduling.

The allowlisted `language/expressions/typeof/undefined.js` case is the first
`mode: native` Test262 entry. `tinytsx test262 <case> --output <binary>` parses
the untouched upstream source and lowers its two top-level
`assert.sameValue(...)` calls into typed Test262 HIR. The Apple arm64 backend
emits a standalone `_main` that compares the lowered actual and expected bytes
and returns a failing process status on the first mismatch. The allowlist-driven
runner builds and executes the Mach-O file without a JavaScript runtime. This is
semantic evidence for the two `typeof undefined`/`typeof void 0` assertions
only; other cases remain explicitly `mode: syntax` until their entire assertion
program is supported.

The complete six-assertion `language/expressions/typeof/bigint.js` case is also
`mode: native`. Its closed semantic evaluator distinguishes a BigInt literal,
`BigInt(0n)`, and `BigInt(0)` as primitive `bigint` values, then classifies
`Object(BigInt(...))` and `Object(0n)` as boxed `object` values. All six
resulting `typeof` strings are checked by the generated native executable. This
does not yet provide runtime arbitrary-precision arithmetic or a persistent
BigInt object representation; it is the complete observable behavior required
by this exact test.

The complete `language/statements/for/S12.6.3_A1.js` case is the third native
Test262 program. Test262 HIR v3 retains the numeric binding, empty-header
`for (;;)` loop, pre-increment threshold, thrown numeric completion, catch-value
guard, and post-catch counter guard. Generated Apple-arm64 code performs all 101
iterations, transfers the thrown value into the catch check, and returns failure
if either upstream guard would construct `Test262Error`. This is executable
evidence for the complete closed loop/throw/catch program, not yet general
exception objects, stack unwinding, arbitrary loop bodies, or `try/finally`.

The complete `Array/prototype/unshift/S15.4.4.13_A1_T1.js` case is the fourth
native Test262 program. Its source lowers to ordered Test262 HIR v3 operations:
three `unshift` calls and eight result, element, or length guards. Generated
Apple-arm64 code owns a 16-element dense numeric array in a bounded stack frame,
shifts existing elements at runtime, preserves signed values, returns the new
length, and treats indices at or beyond length as `undefined`. The executable
runs every upstream guard without JavaScript. This is evidence for that complete
no-argument/one-argument `unshift` program, not generic application arrays,
sparse elements, arbitrary values, other mutators, or runtime spread.

### Typed constant materialization

Closed staged bindings now enter HIR v2 as source-located, tagged constants.
Undefined, null, boolean, finite number, bigint, string, array, and record values
retain their type and recursive structure. The Rust compiler validates the pool
and emits each constant as a deterministic, eight-byte-aligned blob in the
Mach-O read-only data section. The encoding is recorded in
`doc/CONSTANT_DATA.md`.

The pinned Hono staging test now proves that `allMethods` reaches this final HIR
shape as an array of seven typed strings. This happens below the whole-program
compile boundary. The exact-source Hono probe now continues through route HIR,
native assembly/linking, and a real HTTP E2E for its first static route.
A separate compilable staged-constants example passes frontend lowering, Rust
HIR parsing, native assembly/linking, and a real HTTP test.

Generated scalar expressions now use statically typed string, finite-number, or
boolean values. Reachable named functions can accept up to four required scalar
parameters and return literals, parameters, imported constants, or another
direct function call. Function bodies may declare initialized `const` scalar
locals and end in a strict same-type equality/inequality branch whose paths
return supported expressions. Numbers additionally support addition and
subtraction, including numeric results passed through nested calls. Direct-call
arguments may use the same forms. Booleans support literals, staged constants,
parameters/results, immutable locals, and strict equality branches.

The arm64 backend passes each scalar in a fixed two-word register pair
(`x0`/`x1` through `x6`/`x7`). Strings use pointer/length; numbers use unboxed
IEEE-754 bits; booleans use `0`/`1` in the first word. Runtime string equality
compares length and bytes, numeric arithmetic/comparison uses AArch64 floating-point
instructions. Call arguments, parameters, and branch operands spill into a
bounded native frame only when nested evaluation requires it. The Apple HTTP
E2E and Linux assembler gate execute numeric parameters, immutable locals,
addition, subtraction, a numeric-returning helper, and numeric/boolean branches
that select string results.

An ordinary function may also contain one closed numeric `for` loop: a `let`
accumulator initialized from a safe integer literal, a `let` index with a static
start and exclusive bound, postfix index increment, one fixed `+=` accumulator
step, and a terminal return of that accumulator. The compiler rejects more than
4,096 iterations and results outside the safe-integer range. Generated AArch64
executes a real bounded back-edge and returns the numeric result through the
same scalar ABI. Apple HTTP and Linux assembly cover the result flowing into a
second function. Dynamic bounds, arbitrary mutation, `break`, `continue`, nested
loops, and general loop bodies remain unsupported.

Initialized local `const` bindings may hold an arrow or function expression and
call it within the declaring function. Direct-parent string parameters and
immutable string locals referenced by that function value are lambda-lifted:
the frontend adds them as explicit HIR parameters and passes their values at the
call site. This gives closed callbacks native execution without allocating a
closure object. Explicit parameters plus captures remain bounded to four
pointer/length values.

Ordinary native functions may throw a supported string expression from a
terminal branch or function body and catch it in a same-function `try/catch`.
The native function ABI returns the string in `x0`/`x1` and a completion flag in
`x2`; direct calls propagate abrupt completion without evaluating later
arguments. A catch stores the thrown pointer/length pair in bounded frame space
and exposes it through its catch binding. The compiler analyzes the complete
function graph and rejects any handler whose response may end with an uncaught
exception. `finally`, rethrowing/escaping catch values, Error objects, stack
traces, arbitrary thrown types, and async rejection remain unsupported.

Exception syntax is now checked after reachability for ordinary entry modules:
unused functions may contain unsupported exception forms without blocking a
build, while reachable functions must lower to the explicit HIR above. Other
whole-module forbidden-syntax checks have not yet moved to this model.

This does not introduce a JavaScript call stack or object model. Mutable locals,
truthiness/logical operators, non-finite numbers, signed-zero/NaN identity, coercion,
optional/default/rest parameters, escaping or identity-observable closures,
transitive captures, arrays, and records remain outside this executable
function slice.

### Closed class slice

A restricted class expression can now use required string parameter properties
as closed fields and invoke a method immediately on a freshly constructed value.
The frontend devirtualizes that method into the ordinary function HIR, passing
closed fields before explicit method arguments. This preserves the native
record-style representation: no heap object, prototype table, dynamic property
set, or object identity is created.

TypeScript `any` annotations are no longer rejected merely for appearing in
erased upstream declarations. Every reachable runtime value must still acquire
a concrete supported HIR representation; for example, an `any` function
parameter is rejected by string-function lowering. Inheritance, persistent
instances, mutable fields, private fields, and virtual dispatch remain pending.

### Text response bridge

The SDK's static `Response.text(string)` is a temporary TinyTSX compiler
intrinsic, not a Web-standard `Response` method. It gives the current GET
entrypoint an expressible lowering target before the required Web constructor
path exists. HIR v2 records a tagged text response, and ABI v2 carries HTTP status and
content type from generated code to the runtime.

The native Hono response uses status 200 and `text/plain;charset=UTF-8`, matching
the observed `new Response(text)`/Bun wire behavior. The first Hono basic route's `"Hono!!"`
body is compiled through the general string-function path and checked through a
real HTTP request. The exact-source Hono E2E reaches the same HIR response
operation by evaluating upstream `Context.text()` and the standard
`new Response(text)` fast path; it does not depend on the temporary source
intrinsic.

The complete pinned 34-module basic application now has a whole-program native
regression for its published upstream root contract. The generated Mach-O
server returns status 200, `Hono!!`, `text/plain;charset=UTF-8`,
`X-Powered-By: Hono`, and a numeric `X-Response-Time`; the same executable also
serves `/hello` and its installed custom not-found handler. This complements the
focused route/middleware tests without replacing them.

Closed static response headers now lower through a bounded native
writer. The writer validates names and values, replaces names
case-insensitively, and emits custom headers on the wire. The upstream
`poweredBy()` middleware uses this path to produce `X-Powered-By: Hono`. The
response-time middleware uses a separate bounded runtime-formatted value path
while preserving the same header validation and eight-entry limit. The
pinned WPT casing source is connected to native-derived ABI coverage, but is
not yet executed as JavaScript. General Response and Headers construction
remains pending.

Closed records and dynamic maps are separate compiler concepts. A record has a
known layout and may use direct field offsets; a map has runtime membership and
requires bounded dynamic lookup. `new Map(...)` is deliberately not staged as a
record. The detailed rules are recorded in `doc/OBJECT_MODEL.md`.

The bounded Hono Context-variable slice is a whole-program fixed-key
specialization between those models: source Hono uses `Map`, but the compiler
proves the complete key set and emits request-local slots. It neither changes
record mutability nor exposes a general application `Map`.

Request query state is neither model: it is a borrowed request view lowered to
an allocation-free form-decoding predicate. The `prettyJSON()` trace therefore
does not turn a query string into a compile-time record or introduce a generic
dynamic map. Valid percent triplets and `+` are decoded while comparing each
name; native Hono HTTP coverage proves `%70retty` reaches the same upstream
middleware branch as `pretty`.

The native WPT runner adds a second, deliberately isolated representation: a
bounded ordered runtime pair collection used by the complete pinned
`urlsearchparams-get.any.js`, `urlsearchparams-has.any.js`, and
`urlsearchparams-stringifier.any.js`. Sequential WPT HIR constructs and resets
callback-local slots, preserves duplicates and first-value lookup, appends
ordered pairs, deletes by name or name/value pair, decodes form input, and
serializes current state. The selected URL-linked cases keep a distinct URL
slot pointing at the same parameter collection so native mutation updates its
query serialization.

Four URLSearchParams rows from the unchanged pinned
`urlencoded-parser.any.js` are additionally retained as native-derived
evidence and execute through a project-owned equivalent case. After plus and
percent decoding, invalid UTF-8 is replaced by U+FFFD using maximal subparts:
`%FE%FF` and `%FF%FE` produce two replacements, `%C2` one replacement, and
`%C2x` a replacement followed by `x`. The 256-byte component bound applies to
the expanded UTF-8 bytes; overflow rejects the pair. The same runtime executes
on Apple arm64 and compiles freestanding for Linux arm64.

This does not change Hono request decoding. Pinned Hono `tryDecode()` preserves
an invalid percent group such as `%A4%A2`, and the bootstrap path-parameter test
continues to pin that behavior separately from Web form parsing.
That is dynamic collection behavior rather than record field semantics. It is
not a generic `Map`, and it is not yet wired into application-generated
`URLSearchParams` objects. The distinction prevents successful closed WPT
inputs from being misreported as compile-time record folding or a production
Web API implementation.

### Copied actor values

The post-alpha `tinytsx:actors` surface admits one exact value-mailbox behavior
that replaces `context.state` with its message and returns
`JSON.stringify(context.state)`. Its type may be a primitive, bounded array, or
closed record, including nested combinations within the documented depth and
byte limits. This reuses compile-time record and array knowledge; it does not
make those values dynamic JavaScript objects at runtime.

Frontend lowering serializes each closed message to canonical JSON and records
a message-lifetime escape. The native runtime immediately copies the generated
static bytes into an owned mailbox message, moves that buffer into actor-owned
state, and clones the reply for the request writer. Apple-arm64 HTTP tests prove
primitive, array, and nested-record paths; Linux-arm64 assembly exercises the
same ABI. Dynamic request-derived values, spreads, cycles, object identity,
transfer, arbitrary actor behavior, and value persistence remain unsupported.

Actor waits now have one bounded transport cancellation path. During
`actor.ask()`, the HTTP executor polls the connection's pending socket error at
10-millisecond intervals. The SQLite-backed counter tracer holds an external
write lock, sends an increment, hard-resets that client, and proves a one-worker
static health route responds before the lock is released. Releasing the lock
then makes the accepted increment visible, so disconnect detaches only the
waiter and preserves FIFO effects. Clean TCP half-close is not treated as
cancellation, and this does not add Web `AbortSignal`, message retraction,
interruptible actor behavior, or cancellation for SQLite, fetch, or files.

The first bounded restart shape extends only the native counter specialization.
An initial `if (message === <integer>) throw Error(<closed string>)` precedes
the existing checked state update and string reply. Closed restart options
allow 1–16 resets in a 1–60,000 ms rolling window. Generic worker tests prove
panic reinitialization, isolation from another actor, and termination when the
window is exhausted. Apple Hono HTTP proves two failures reset state 1 to 0 and
a third terminates the actor; Linux arm64 assembles the same configuration.
This does not evaluate general failure branches or add persistence recovery,
backoff, manual restart, supervisors, links, monitors, registries, snapshots,
or distributed actors.

## Compatibility order

1. ESM runtime graph loading and aggregate diagnostics.
2. Broader/escaping function values and closures, records, arrays, and ordinary
   control flow.
3. Restricted classes, fields, inheritance, and object identity.
4. Rest/spread forms used by `hono/tiny`.
5. RegExp and required String, Array, Object, Map, and encoding operations.
6. Request, Response, Headers, and URL native APIs.
7. Error objects, broader exceptions, Promise, async/await, and the native task
   executor.
8. Middleware, request bodies, and broader Hono conformance.

The order may change when the module audit proves that a smaller dependency
frontier unlocks a useful end-to-end slice.

## Next package target

After keep-alive and request-time Hono JSX expose the missing async/allocation
paths, the next package intake is Vercel AI SDK Core. The candidate upstream pin,
deterministic fake-model vertical slice, expected Web API/task requirements, and
collector decision boundary are defined in `doc/AI_COMPATIBILITY.md`. AI UI/RSC,
live provider calls, and a TinyTSX-specific facade are not part of the first
slice.
