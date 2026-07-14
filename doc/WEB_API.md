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
| `Request` | standard DOM declaration | borrowed method, path, and query ABI views |
| `Response` | standard DOM declaration | bounded body writer, status, HTML/text/JSON content-type IDs; closed `new Response(string, { headers })` AOT fast path |
| `Headers` | standard DOM declaration | bounded response-header storage, validation, case-insensitive replacement, and wire emission for statically known values |
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

The executable Hono route evaluates the upstream `Context.text()` condition and
reaches `new Response(text)` with a closed string at compile time. A closed
`new Response(body, { headers: { ... } })` also carries static headers into HIR
and the native response writer. This preserves body, status, content type, and
bounded static headers. It is not a general runtime `Response` or `Headers`
implementation: dynamic bodies and header names/values, general init objects,
iteration, cloning, body consumption, and streams remain pending.

The native writer currently holds at most eight custom headers. It validates
HTTP token names, rejects values containing NUL, CR, or LF, and implements
case-insensitive replacement. The selected upstream WPT source is
`tests/compat/wpt/upstream/headers-casing.any.js`, pinned by revision and digest
in `tests/compat/wpt/manifest.json`. Its `Headers.set()` casing assertion is
classified as `native-derived`: focused ABI tests cover that behavior, but the
WPT JavaScript itself is not yet compiled and executed. This is evidence for a
narrow behavior, not a claim of Headers or WPT conformance.

The pinned Hono `poweredBy()` middleware now executes symbolically from upstream
source. Its post-handler `res.headers.set('X-Powered-By', 'Hono')` effect lowers
through this same native header path and is verified over a real HTTP request.

Native API behavior belongs in the dedicated runtime tests. Selected Web
Platform Tests should progress from exact-source intake, to native-derived
coverage, to execution of the upstream JavaScript as the language surface
becomes available. A green TypeScript check alone never counts as Web API
conformance.
