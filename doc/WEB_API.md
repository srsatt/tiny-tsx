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
| `Request` | standard DOM declaration | borrowed method, path, and raw query ABI views; allocation-free form-decoded query-name presence predicate |
| `Response` | standard DOM declaration | bounded body writer, explicit status, optional HTML/text/JSON content-type IDs; closed `new Response(string or null, { status, headers })` AOT fast path |
| `Headers` | standard DOM declaration | closed construction/cloning; bounded request-header borrowing and response-header storage with case-insensitive lookup/replacement; one request-local Request ID header |
| `fetch` | standard DOM declaration | one closed URL string; request-time GET; `.status` only; Apple system libcurl transport |
| `URL` / `URLSearchParams` | standard DOM declaration | native WPT-only bounded ordered pairs, form decoding/serialization, mutation, lookup, and live query linkage for selected URL cases; application API pending |
| `crypto.randomUUID()` | standard DOM declaration | request-time version-4 UUID for a prepared SQLite parameter or the default Hono Request ID policy |
| body and stream types | standard DOM declaration | borrowed request bytes with a 64 KiB transport ceiling; closed Hono `bodyLimit()` guard over `Content-Length`; general body/stream objects pending |
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

The pinned Hono `bodyLimit()` middleware lowers to a per-route guard over the
already buffered borrowed request-body view. A closed integer maximum from 0
through 65,536 bytes selects Hono's default `413 Payload Too Large` response;
the normal handler runs only when the body length is at most that maximum. The
transport still owns framing and rejects unsupported transfer encoding with
400 before application dispatch. Custom `onError`, dynamic limits, streaming
reads, and chunked bodies are not implemented. The native default response uses
Fetch's WPT-derived `text/plain;charset=UTF-8` for its string body. Bun 1.3.13
omits that inferred header on the same `new Response(string)` path, so the
reference test records the runtime difference rather than redefining the Web
contract.

The pinned Hono `requestId()` middleware specializes one matched policy per
compiled route. Its default `X-Request-Id`/255-byte configuration and closed
non-empty token header names up to 128 bytes with closed limits from 1 through
1,024 bytes are admitted. Incoming IDs must be non-empty ASCII alphanumeric,
underscore, hyphen, or equals bytes within the configured limit; missing,
invalid, and oversized input is replaced by a lowercase UUIDv4. The selected
value is installed before the response is rendered and is reused by both
`c.get('requestId')` and the response header.

An accepted value remains a borrowed view into the request header table for the
synchronous dispatch lifetime. A generated UUID is copied into fixed,
writer-owned dynamic-header storage and remains valid through response
serialization. Writing the body copies either view into the bounded response
arena before the request ends. No value enters a general Context map or managed
heap. Custom generators, empty/dynamic header names, dynamic/out-of-range
limits, and multiple matching policies fail compilation; other Context keys
remain unsupported.

Closed ETag middleware uses a second dedicated request predicate. SHA-1 is
computed by the AOT frontend for immutable response bytes; the native runtime
only compares borrowed `If-None-Match` values and selects the precompiled 304
response. Streaming bodies, arbitrary digest functions, and runtime Web Crypto
remain pending.

The bounded blog tracer implements `crypto.randomUUID()` according to the
[Web Cryptography Level 2 algorithm](https://www.w3.org/TR/WebCryptoAPI/#Crypto-method-randomUUID):
16 bytes come from the operating-system cryptographic random source, the
version and variant bits are set to 4 and 2, and the result uses 36 lowercase
ASCII characters. Runtime and native HTTP tests require the UUID shape and two
successive values to differ. The current request-time value may flow directly
into prepared SQLite parameters; it is not yet a general reusable JavaScript
string, and `getRandomValues`, `subtle`, arbitrary Web Crypto, and secure-context
policy are not implemented.

The executable Hono route evaluates the upstream `Context.text()` condition and
reaches `new Response(text)` with a closed string at compile time. A closed
`new Response(body, { headers: { ... } })` also carries static headers into HIR
and the native response writer. This preserves body, status, content type, and
bounded static headers. It is not a general runtime `Response` or `Headers`
implementation: dynamic bodies, runtime-selected header names, arbitrary
dynamic header values, general init objects, iteration, body consumption, and
streams remain pending.

The [Fetch `BodyInit` extraction
algorithm](https://fetch.spec.whatwg.org/#bodyinit-safely-extract) assigns
`text/plain;charset=UTF-8` to a string body, while a `ReadableStream` has no
inferred type. Response initialization retains an explicit `Content-Type` from
`ResponseInit` and only synthesizes the body type when that header is absent.
The pinned upstream
`fetch/api/response/response-init-contenttype.any.js` file records those exact
assertions. Hono's post-`next()` `Context.header()` path constructs
`new Response(c.res.body, c.res)`: the stream itself adds no new type, while the
original response header supplied as init remains. TinyTSX therefore preserves
`text/plain;charset=UTF-8`. Bun 1.3.13 omits the original string-body header and
its HTTP adapter emits `application/octet-stream`; that measured Bun deviation
is visible in the benchmark contract and is not copied into TinyTSX.

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

The selected `fetch/api/response/response-init-contenttype.any.js` source is
also pinned by revision and digest. Its string-body default and explicit-header
retention are classified as `native-derived`: the exact Hono response-time
middleware forces the finalized-response stream clone and native HTTP asserts
the retained text type. Blob, buffer, FormData, URLSearchParams, and standalone
ReadableStream construction in the upstream file remain outside the native
claim.

The complete pinned `url/urlsearchparams-get.any.js`,
`url/urlsearchparams-has.any.js`, and
`url/urlsearchparams-stringifier.any.js` sources are classified as `native`.
`tinytsx wpt <case> --output <binary>` parses the untouched upstream JavaScript
and lowers all 20 `test(...)` bodies and 70 assertions into typed sequential WPT
HIR v3. Each callback receives fresh bounded storage for 64 ordered name/value
pairs, 256 bytes per name or value, and a 16 KiB serialization buffer. Native
operations construct, append, delete, retrieve, test presence, and stringify
without a JavaScript runtime; reassignment resets the same callback-local slot.

The executed behavior includes source-order preservation, empty names and
values, missing names, first-value lookup for duplicates, deletion by name or
name/value pair, and Web IDL string conversion for the closed `null`, numeric,
and `undefined` arguments in the upstream sources. An explicit `undefined`
optional second argument is treated as omitted. Form parsing converts `+` to
space, decodes valid percent triplets, and preserves malformed escapes for
reserialization. Form serialization uses uppercase UTF-8 percent bytes and
covers spaces, plus, percent, NUL, newlines, and a non-BMP character. The live
`URL.searchParams` cases retain the original untouched URL and reserialize its
complete query after linked mutation. The allowlist-driven `test:wpt-native`
command builds all three Mach-O executables and treats any failed assertion as
a non-zero process result.

This runner is semantic evidence for those three complete source files, not yet
the application-facing `URLSearchParams` class. It does not currently
replace malformed UTF-8 with U+FFFD, accept dynamic inputs, expose object
identity/iteration, or implement general URL parsing and normalization.
Application-generated Request/URL objects continue to use their separate
borrowed query view rather than constructing this collection. Its query-name
predicate now applies the same `+` and valid-percent-triplet decoding while
comparing directly against the generated key without allocation. Native Hono
HTTP coverage proves `%70retty` selects upstream `prettyJSON()` behavior.

The pinned Hono `poweredBy()` middleware now executes symbolically from upstream
source. Its post-handler `res.headers.set('X-Powered-By', 'Hono')` effect lowers
through this same native header path and is verified over a real HTTP request.

The pinned Hono `prettyJSON()` middleware likewise executes from upstream
source. Its default `pretty` key becomes a native query-presence branch; response
body parsing/stringification remains a closed AOT transformation rather than a
general native `Response.json()` implementation.

Native API behavior belongs in the dedicated runtime tests. Selected Web
Platform Tests progress from exact-source intake, to native-derived coverage,
to execution of the complete upstream JavaScript as the language surface
becomes available. A green TypeScript check alone never counts as Web API
conformance.
