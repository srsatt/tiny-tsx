# Web API boundary

TinyTSX uses TypeScript's pinned `lib.dom.d.ts` and `lib.dom.iterable.d.ts` as
the build-time type contract for Web-standard APIs. The project does not keep a
second handwritten global `Request` or `Response` declaration. This lets the
pinned Hono runtime graph type-check against the same constructor, property, and
method shapes used by ordinary TypeScript Web applications.

Type availability is not a runtime implementation claim. Each reachable API
still needs a native lowering or runtime helper plus focused behavior coverage.
The current boundary is:

| API | Type contract | Native behavior |
| --- | --- | --- |
| `Request` | standard DOM declaration | borrowed method, path, and raw query ABI views; exact query-name presence predicate |
| `Response` | standard DOM declaration | bounded body writer, explicit status, optional HTML/text/JSON content-type IDs; closed `new Response(string or null, { status, headers })` AOT fast path |
| `Headers` | standard DOM declaration | closed construction/cloning; bounded request-header borrowing and response-header storage with case-insensitive lookup/replacement |
| `fetch` | standard DOM declaration | one closed URL string; request-time GET; `.status` only; Apple system libcurl transport |
| `URL` / `URLSearchParams` | standard DOM declaration | pending |
| body and stream types | standard DOM declaration | pending |
| encoding types | standard DOM declaration | pending |

`Response.html(element)` and `Response.text(string)` are temporary compiler
intrinsics used by the pre-Hono GET entrypoint. They are not Web-standard static
methods and are not declared in the SDK. The frontend suppresses only the exact
TypeScript missing-property diagnostic for these two recognized calls before
lowering them. Unknown properties such as `Response.missing` remain normal
TypeScript errors.

Hono's application-facing types remain in `tests/compat/hono/api.d.ts`. That
overlay narrows the imported package surface for application type checking but
does not replace upstream runtime source or Web-standard declarations.

The exact basic-example `fetch('https://example.com/')` call is retained as a
request-time expression. The runtime follows redirects, discards all response
bytes, and exposes only the numeric status used by the handler. Focused ABI
coverage uses an offline local HTTP peer; the native Hono E2E exercises the
actual HTTPS URL and expects status 200. The Apple executable dynamically links
the OS-provided libcurl while adding no Cargo/npm package. Request/init objects,
methods other than GET, body/header access, rejection values, cancellation, and
portable transports remain pending.

The focused Hono overlay now exposes `HonoRequest.header(name)`. The runtime
request is not a JavaScript `Headers` object: it is a bounded table of views into
the request head, valid only during dispatch. The supported response expression
performs case-insensitive lookup and writes the found bytes, or `undefined` when
the header is absent.

The Basic Authorization guard uses the same borrowed header table through a
dedicated ABI predicate. It implements the exact closed credentials required by
the pinned Hono example without claiming general runtime `Request.headers`,
`TextDecoder`, Base64, RegExp, Promise, or Web Crypto objects.

Closed ETag middleware uses a second dedicated request predicate. SHA-1 is
computed by the AOT frontend for immutable response bytes; the native runtime
only compares borrowed `If-None-Match` values and selects the precompiled 304
response. Streaming bodies, arbitrary digest functions, and runtime Web Crypto
remain pending.

The executable Hono route evaluates the upstream `Context.text()` condition and
reaches `new Response(text)` with a closed string at compile time. A closed
`new Response(body, { headers: { ... } })` also carries static headers into HIR
and the native response writer. This preserves body, status, content type, and
bounded static headers. It is not a general runtime `Response` or `Headers`
implementation: dynamic bodies, runtime-selected header names, arbitrary
dynamic header values, general init objects, iteration, body consumption, and
streams remain pending.

An explicit no-content-type ABI value supports Hono's closed redirect response.
The HTTP writer emits `302 Found`, `Location`, and `Content-Length: 0` without
inventing `application/octet-stream` or another `Content-Type` header.

Hono's closed `Context.json({ message: 'Created!' }, 201)` path now executes
through upstream `JSON.stringify`, `setDefaultContentType`, `#newResponse`,
`Headers`, `Object.entries`, and its `for...of` loop. HIR carries status 201 and
the exact `application/json` content type into native POST dispatch. This is a
closed AOT path; arbitrary runtime JSON graphs and general Headers iteration are
not implemented.

The native writer currently holds at most eight custom headers. It validates
HTTP token names, rejects values containing NUL, CR, or LF, and implements
case-insensitive replacement. The response-time slice additionally formats one
elapsed millisecond value plus a static suffix into 256 bytes of writer-owned
storage; it does not provide a general dynamic string or Headers implementation.
The selected upstream WPT source is
`tests/compat/wpt/upstream/headers-casing.any.js`, pinned by revision and digest
in `tests/compat/wpt/manifest.json`. Its `Headers.set()` casing assertion is
classified as `native-derived`: focused ABI tests cover that behavior, but the
WPT JavaScript itself is not yet compiled and executed. This is evidence for a
narrow behavior, not a claim of Headers or WPT conformance.

The selected `fetch/api/response/response-init-001.any.js` source is pinned at
the same WPT revision. Only its status-propagation idea for the closed 201 case
is marked native-derived. The wider status/statusText/default/SameObject cases
in that file are not executed or claimed.

The selected `url/urlsearchparams-has.any.js` source is also pinned by revision
and digest. Its one-argument name-presence idea is marked native-derived for the
query ABI helper: focused tests cover absent, bare, empty, valued, and exact-name
matching. TinyTSX does not yet construct `URLSearchParams`, percent-decode query
names, or implement the two-argument overload, append, and delete cases in that
source.

The pinned Hono `poweredBy()` middleware now executes symbolically from upstream
source. Its post-handler `res.headers.set('X-Powered-By', 'Hono')` effect lowers
through this same native header path and is verified over a real HTTP request.

The pinned Hono `prettyJSON()` middleware likewise executes from upstream
source. Its default `pretty` key becomes a native query-presence branch; response
body parsing/stringification remains a closed AOT transformation rather than a
general native `Response.json()` implementation.

Native API behavior belongs in the dedicated runtime tests. Selected Web
Platform Tests should progress from exact-source intake, to native-derived
coverage, to execution of the upstream JavaScript as the language surface
becomes available. A green TypeScript check alone never counts as Web API
conformance.
