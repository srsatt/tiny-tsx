# Compatibility program

TinyTSX is working toward ahead-of-time compilation of the published
`hono/tiny` package. Compatibility is evidence-driven and deliberately narrower
than general JavaScript compatibility.

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
