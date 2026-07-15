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

Borrowed request state is modeled separately from both. For example,
`c.req.query('pretty')` produces a request-time query predicate, not a record
field and not a `Map` lookup. That distinction lets AOT code branch on presence
without claiming that the query value was known during compilation.

## Declaration overlays

An `api.d.ts` overlay may expose a narrower, compiler-supported type surface to
an application import. It is type information only. Runtime graph resolution
still loads and compiles the pinned upstream implementation, so an overlay must
never replace Hono routing, context, middleware, or Web API behavior.

Middleware overlays are split by package entrypoint. The focused
`pretty-json-api.d.ts` declaration exposes only the tested options and handler
shape while runtime resolution still loads Hono's pinned middleware source.
