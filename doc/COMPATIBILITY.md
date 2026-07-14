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

The initial compiling probe resolves the bare import to the pinned submodule and
currently reaches `src/preset/tiny.ts:11`, where it reports `TINY1002` because
class lowering has not landed. This expected failure is a tested compatibility
frontier, not a passing Hono result.

The upstream basic example imports the full `hono` entry rather than
`hono/tiny`. `tests/compat/hono/basic-smoke.ts` preserves its first `GET /`
route as a second tracer. That graph reaches 27 runtime modules, 4,177 lines,
and 117,684 source bytes, and currently stops at the upstream class in
`src/hono.ts:16`. The complete 110-line basic example and its middleware imports
remain future intake work; this first-route tracer is not presented as full
example compatibility.

### Type-only API overlay

The compiling frontend accepts `--api <specifier>=<api.d.ts>` independently of
the runtime `--alias`. The application is type-checked against the narrow API,
while every runtime source module still comes from pinned upstream Hono. A
negative test proves an invalid route path is rejected by the overlay, and the
valid smoke tests then continue into upstream source until class lowering.

This separation is a compile-time contract only. It does not authorize replacing
Hono methods or Web APIs with different behavior. The initial overlay exposes
only the route/context surface used by the current tracers and grows with tested
native semantics.

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
compile boundary: the exact-source Hono probe still stops at its first upstream
class, so no claim is made that a Hono executable is produced yet. A separate
compilable staged-constants example passes frontend lowering, Rust HIR parsing,
native assembly/linking, and a real HTTP test.

Generated string expressions now reference staged string blobs. Reachable named
zero-parameter functions can return string literals, imported string constants,
or another direct function call. The arm64 backend emits those calls as native
functions and returns pointer/length string views; it does not introduce a
JavaScript call stack or object model. Parameters, locals, branches, closures,
arrays, and records remain outside this first executable function slice.

### Text response bridge

The SDK's static `Response.text(string)` is a temporary TinyTSX compiler
intrinsic, not a Web-standard `Response` method. It gives the current GET
entrypoint an expressible lowering target before constructor and class support
exist. HIR v2 records a tagged text response, and ABI v2 carries HTTP status and
content type from generated code to the runtime.

The native response uses status 200 and `text/plain; charset=UTF-8`, matching the
pinned Hono `Context.text()` contract. The first Hono basic route's `"Hono!!"`
body is compiled through the general string-function path and checked through a
real HTTP request. This is response-semantics evidence, not a claim that upstream
Hono compiles: the exact-source probes still stop at their first classes. Once
Hono's class and constructor path lowers, `Context.text()` should reach the same
HIR response operation rather than depend on the temporary source intrinsic.

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
