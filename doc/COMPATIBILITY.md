# Compatibility program

TinyTSX is working toward ahead-of-time compilation of the published Hono
package, beginning with `hono/tiny` and the first route from the upstream basic
example. Compatibility is evidence-driven and deliberately narrower than
general JavaScript compatibility.

## Pinned inputs

| Input | Pin | Purpose |
| --- | --- | --- |
| Hono | `vendor/hono`, tag `v4.12.30`, commit `b2ae3a2204a48ce15a26448fd746d39745eb1837` | Upstream TypeScript source and Hono behavior |
| Hono examples | `vendor/hono-examples`, commit `3b0b62875a0e1265763fea1c6388866d5697ef81` | Complete upstream basic application and selected behavior test |
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

The basic example's `/entry/:id` shape is the first request-dependent route.
One closed `:name` segment becomes a native matcher and `c.req.param('name')`
becomes a request-time text value. Literal and parameter chunks write directly
to the bounded response buffer, including Hono-compatible decoding of valid
percent-encoded UTF-8 groups. Optional, constrained, and non-terminal catch-all
patterns remain outside this named-parameter slice.

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

Terminal wildcard matching now covers the exact `/api/*` fallback from the
basic example. Native tests pin Hono's behavior that the pattern matches `/api`,
`/api/`, and deeper paths. The generated handler returns Hono's explicit status
404 and text body; unmatched non-API paths still use the bootstrap 404. Optional
and constrained patterns remain pending.

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

The basic example's exact `basicAuth` options are also specialized from upstream
source. Closed `in` checks and `users.unshift()` build the credential list; HIR
retains it as a Basic Authorization request guard. The zero-dependency runtime
parses and compares the borrowed header without constructing a JavaScript
Request, Headers, RegExp, Uint8Array, TextDecoder, Promise, or crypto object.
Native HTTP tests cover missing and correct credentials plus the complete
example's custom-error ordering: rejected auth logs `Error`, returns the custom
500 response, retains outer `X-Powered-By`, and correctly omits downstream
`X-Response-Time`.

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
fully consumed during application specialization; standalone throw and all
try/catch syntax remain rejected.

The complete example's deliberate `@ts-ignore` route returns a truthy string
instead of a `Response`. Hono stores that invalid value in the Context and its
two enclosing post-`next()` middleware paths fail while finalizing it. The
evaluator preserves the three observed Bun/Hono TypeError lines, invokes the
installed upstream error closure, and emits the final 500 response without
powered-by or timing headers. A complete-source native E2E verifies this exact
failure ordering; it is a pinned Hono/Bun compatibility specialization rather
than general runtime type-error or Promise rejection support.

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

The allowlisted Test262 array-spread source is parsed by the intake suite and
its closed literal `[...[3, 4, 5]]` is folded by a frontend test. The complete
Test262 program is still not executed natively, so this is staging evidence, not
an ECMAScript conformance claim.

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
Test262 program. Test262 HIR v2 retains the numeric binding, empty-header
`for (;;)` loop, pre-increment threshold, thrown numeric completion, catch-value
guard, and post-catch counter guard. Generated Apple-arm64 code performs all 101
iterations, transfers the thrown value into the catch check, and returns failure
if either upstream guard would construct `Test262Error`. This is executable
evidence for the complete closed loop/throw/catch program, not yet general
exception objects, stack unwinding, arbitrary loop bodies, or `try/finally`.

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

Generated string expressions now reference staged string blobs. Reachable named
functions can accept up to four required string parameters and return string
literals, parameters, imported string constants, or another direct function
call. Direct-call arguments may use the same expression forms. The arm64 backend
passes each string as a pointer/length register pair (`x0`/`x1` through
`x6`/`x7`) and returns a string in `x0`/`x1`. Call arguments and parameters are
spilled into a bounded native frame when nested evaluation requires it.

This does not introduce a JavaScript call stack or object model. Optional,
default, and rest parameters, locals, branches, closures, arrays, and records
remain outside this executable function slice.

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
intrinsic. Closed static response headers now lower through a bounded native
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
That is dynamic collection behavior rather than record field semantics. It is
not a generic `Map`, and it is not yet wired into application-generated
`URLSearchParams` objects. The distinction prevents successful closed WPT
inputs from being misreported as compile-time record folding or a production
Web API implementation.

## Compatibility order

1. ESM runtime graph loading and aggregate diagnostics.
2. Functions as values, closures, records, arrays, and ordinary control flow.
3. Restricted classes, fields, inheritance, and object identity.
4. Rest/spread forms used by `hono/tiny`.
5. RegExp and required String, Array, Object, Map, and encoding operations.
6. Request, Response, Headers, and URL native APIs.
7. Exceptions, Promise, async/await, and the native task executor.
8. Middleware, request bodies, and broader Hono conformance.

The order may change when the module audit proves that a smaller dependency
frontier unlocks a useful end-to-end slice.
