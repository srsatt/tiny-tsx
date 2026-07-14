# Compatibility program

TinyTSX is working toward ahead-of-time compilation of the published Hono
package, beginning with `hono/tiny` and the first route from the upstream basic
example. Compatibility is evidence-driven and deliberately narrower than
general JavaScript compatibility.

## Pinned inputs

| Input | Pin | Purpose |
| --- | --- | --- |
| Hono | `vendor/hono`, tag `v4.12.30`, commit `b2ae3a2204a48ce15a26448fd746d39745eb1837` | Upstream TypeScript source and Hono behavior |
| Test262 | `vendor/test262`, commit `f2d1435644797268dca1f7988cad5a4e89ccd8d2` | Allowlisted ECMAScript semantics |

Both inputs are shallow Git submodules whose gitlinks record the exact revision.
Test262 cases admitted to execution must preserve their upstream path and
metadata in the allowlist; its BSD license remains available in the submodule.

## Test layers

1. **Compiler intake** loads the complete runtime module graph and reports all
   unsupported constructs with stable diagnostics.
2. **Test262 execution** compiles and runs only cases present in the allowlist.
   Parse-only probes are tracked separately and do not count as conformance.
3. **Native API tests** exercise Request, Response, Headers, URL, encoding, and
   later streaming behavior directly at the native ABI boundary.
4. **Hono tests** start with exact-source applications and selected upstream
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
`hono/tiny`. `tests/compat/hono/basic-smoke.ts` preserves its first `GET /`
route as a second tracer. That graph reaches 27 runtime modules, 4,177 lines,
and 117,684 source bytes. It selects the same constructed-application root. The
complete 110-line basic example and its middleware imports remain future intake
work; this first-route tracer is not presented as full example compatibility.

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
numbers, bigint, booleans, undefined, null, arrays, and records. It resolves
imported top-level constants, folds constant array/object spread, and
materializes object/array rest when the source is a compile-time closed value.
Each spread or rest site is classified as `constant` or `runtime` in the Hono
compatibility report.

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
private `#addRoute`. The evaluator retains one closed route and observes one
router insertion. The single static GET artifact now enters HIR and native
path dispatch; multiple and dynamic routes remain pending. The trace and
evaluator contract are recorded in
`doc/APPLICATION_INITIALIZATION.md`.

The allowlisted Test262 array-spread source is parsed by the intake suite and
its closed literal `[...[3, 4, 5]]` is folded by a frontend test. The complete
Test262 program is still not executed natively, so this is staging evidence, not
an ECMAScript conformance claim.

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

The native response uses status 200 and `text/plain; charset=UTF-8`, matching the
pinned Hono `Context.text()` contract. The first Hono basic route's `"Hono!!"`
body is compiled through the general string-function path and checked through a
real HTTP request. The exact-source Hono E2E reaches the same HIR response
operation by evaluating upstream `Context.text()` and the standard
`new Response(text)` fast path; it does not depend on the temporary source
intrinsic. General Response construction remains pending.

Closed records and dynamic maps are separate compiler concepts. A record has a
known layout and may use direct field offsets; a map has runtime membership and
requires bounded dynamic lookup. `new Map(...)` is deliberately not staged as a
record. The detailed rules are recorded in `doc/OBJECT_MODEL.md`.

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
