# Record and map model

TinyTSX treats closed records and dynamic maps as different native types. They
must not share a generic JavaScript object representation.

## Records

A record has a compiler-known field set and field order. Eligible sources
include closed object literals, `as const` values, and values whose TypeScript
type proves a closed shape. The compiler may assign fixed offsets, lower property
access to direct loads, and specialize rest/spread to field projection.

Records do not permit adding or deleting fields at runtime. A computed access is
valid only when the key can be reduced to a known field. Prototype mutation and
property descriptors are outside this representation.

The constant pool represents `undefined`, `null`, booleans, finite numbers,
explicit negative zero/`NaN`/positive and negative infinity, bigint, strings,
compile-time symbols, arrays, and records. A symbol has a bounded canonical ID
and optional description; aliases retain the same ID while distinct `Symbol()`
calls receive different IDs. This is immutable AOT data and Test262 identity
evidence, not a runtime symbol object, property-key model, registry, or general
non-finite arithmetic implementation.

## Arrays

A closed array used during application initialization can be a staged constant,
including folded spread from other closed arrays. A runtime array is a different
representation: it has an ordered numeric index space and mutable length, but it
is neither a fixed-field record nor a key/value map.

The native Test262 runner currently proves one deliberately bounded runtime
form: up to 16 dense numeric elements with zero- or one-argument `unshift`,
returned length, indexed reads, and out-of-range `undefined`. That isolated test
representation does not yet make arrays available to compiled applications.
Sparse elements, arbitrary values, identity, other mutators, iteration, and
runtime spread remain separate semantics. Closed spread may still fold during
AOT staging without implying any of those runtime capabilities.

## Maps

A map has runtime keys, runtime membership, and object identity. Explicit
`Map<K, V>` construction, index signatures with unknown keys, or operations that
mutate an unknown property set require map semantics. These values need bounded
native storage, dynamic lookup, and explicit process/request lifetime rules.

The staging evaluator never converts `new Map(...)` into a record. Current tests
prove that a closed object literal is staged while an adjacent `Map` binding is
left for runtime lowering. Hono uses both models: many option/header objects can
be records, while `Context.#var` is an actual `Map` and must stay dynamic unless
whole-program analysis proves a fixed-key specialization.

That fixed-key specialization now exists for the first Hono Context-variable
slice. One route may use 1–16 statically named slots; middleware and handlers
share their request-local values, replacement is permitted, and missing lookup
returns `undefined`. The compiler lowers the already-supported bounded scalar
or request-string value directly into the response graph. No map object,
membership table, or process-persistent state is emitted. Dynamic keys,
iteration, `size`, `has`, `delete`, `clear`, and identity still require the
future bounded native map representation. Direct identifier and closed
string-literal `Context.var` reads resolve the same fixed slots; assignment,
destructuring, enumeration, and escape of that view remain rejected.

Borrowed request state is modeled separately from both. For example,
`c.req.query('pretty')` produces a request-time query predicate, not a record
field and not a `Map` lookup. That distinction lets AOT code branch on presence
without claiming that the query value was known during compilation. The
predicate decodes `+` and valid percent triplets during its allocation-free
comparison; this adds form semantics to the borrowed view without turning it
into an owned `URLSearchParams` object.

The WPT-only `URLSearchParams` representation is a third collection model. It
owns a bounded ordered list of name/value views at native runtime, preserves
duplicate names, and supports append plus selective deletion. Sequential WPT
HIR operations mutate it after construction, so it is not a closed record. It
also lacks the arbitrary key/value types and identity contract of a generic
`Map`, and it is not yet connected to application Request or URL values. Keeping
that boundary explicit prevents standards-test specialization from silently
changing the compiler's object model.

The stringifier WPT deepens this representation without changing that boundary.
Each pair now owns bounded decoded bytes, and serialization is derived from the
current ordered state. A linked WPT URL slot points to the same pair collection,
so append/delete can invalidate and regenerate its query. This is explicit
native object linkage for the selected test lifetime, not permission to treat
ordinary records as mutable objects or to claim a general `URL` identity model.

## Declaration overlays

An `api.d.ts` overlay may expose a narrower, compiler-supported type surface to
an application import. It is type information only. Runtime graph resolution
still loads and compiles the pinned upstream implementation, so an overlay must
never replace Hono routing, context, middleware, or Web API behavior.

Middleware overlays are split by package entrypoint. The focused
`pretty-json-api.d.ts` declaration exposes only the tested options and handler
shape while runtime resolution still loads Hono's pinned middleware source.
The same rule permits selected Hono methods to receive narrower custom
declarations: the override describes a supported type surface but cannot bypass
execution of the upstream method implementation.
