# Implementation decisions

## D-001: Build-time frontend process

The Rust CLI invokes the repository's compiled Node.js frontend for `check` and
`build`. Node.js and TypeScript are build dependencies only and are absent from
the application executable. JSON on stdout is the frontend/compiler boundary;
diagnostics go to stderr.

## D-002: Link generated objects through rustc

The compiler invokes `clang` to assemble textual Apple arm64 assembly, then asks
Cargo/rustc to link the generated object into the bootstrap runtime. This keeps
Rust standard-library link details with Rust while preserving the required
direct TSX-to-assembly application path.

## D-003: Static-first writer ABI

Even the static vertical slice renders through `tinytsx_handle_get` and the
writer ABI. It does not return a Rust string or embed the page in runtime source.
Dynamic escaping and arenas can therefore extend the implementation without
changing generated application semantics.

## D-004: Native language runtime, never a JavaScript engine

TinyTSX may link focused native support for strings, collections, regular
expressions, exceptions, promises, and Web APIs. It must not embed a JavaScript
parser, bytecode interpreter, JIT, `eval`, dynamic code loading, or a fallback
JavaScript execution path. Supported ECMAScript behavior is compiled ahead of
time and unsupported behavior remains a compile-time diagnostic.

## D-005: Compile upstream Hono instead of cloning its interface

The compatibility target is the upstream `hono/tiny` implementation, initially
pinned as a Git submodule at tag `v4.12.30` and commit `b2ae3a22`. Hono routing,
context, and middleware logic must come from that upstream source. TinyTSX-
specific intrinsics are limited to the host boundary and native implementations
of standardized built-ins and Web APIs. The pin is a reproducible compiler
target, not permission to replace Hono with a separate implementation.

## D-006: Allowlisted, provenance-preserving conformance

ECMAScript coverage grows through an explicit allowlist of Test262 cases pinned
to one upstream revision. Syntax intake, native execution, and expected
rejection are reported separately; a parsed case is never called conformant.
Web API behavior and Hono behavior use their own suites. An exact-source Hono
fixture must run under both Bun and TinyTSX before response equivalence is
claimed.

## D-007: Closed records are not dynamic maps

Closed object literals and type-proven fixed shapes use record layouts with
compiler-known fields. Explicit `Map` values, unknown index signatures, and
runtime property-set mutation require separate bounded dynamic storage. An AOT
specialization may replace a fixed-key map use with slots only when whole-
program analysis proves the observable semantics; staging must never relabel a
general map as a record.

## D-008: Logical workers reuse fixed native executors

The public `Worker` concept is an isolated mailbox and module context scheduled
on a fixed native executor. Creating or terminating a logical worker does not
create or terminate an operating-system thread. HTTP consumes the same generic,
zero-dependency pool library but remains a distinct pool from future application
workers until nested scheduling can prove freedom from starvation and deadlock.

## D-009: Copy messages and isolate future heaps per worker

Supported worker messages cross the isolation boundary by value. Object
identity and mutable heaps are not shared. Static data and request arenas remain
the default memory strategies; collector integration starts only after an
exact-source compatibility case proves a persistent escaping graph is required.
TinyTSX will evaluate established collectors/toolkits and will not build a
production tracing collector from scratch in the worker milestone.

## D-010: Probe AI SDK Core with a deterministic model first

The first AI framework target is upstream Vercel AI SDK Core, not its UI/RSC
layers or a handwritten compatible facade. Pin the source and reachable
workspace dependencies, then execute `generateText` against a deterministic
fake model before adding streaming or real provider I/O. Network access,
credentials, provider availability, and schema-generation breadth must not be
prerequisites for the first native behavior test.

## D-011: Light lambdas are arena-only by default

The default deployment profile uses immutable executable data plus bounded
request, message, and logical-worker arenas. A lambda that cannot keep its
observable state within those ownership domains is rejected until an explicit
compatibility profile supports it. GC is not an assumed destination: only an
executed cyclic/aliased escaping graph can justify a collector spike, and any
result remains isolated per worker rather than becoming a shared process heap.

## D-012: Share AArch64 lowering through a closed object-format dialect

Code generation uses a target-neutral assembly sink, reusable architecture
helpers, and explicit OS/architecture adapters. Adding Linux arm64 demonstrated
that instruction selection and runtime ABI lowering are shared, while sections,
symbol prefixes, visibility, and address relocations vary by object format.
Those differences use a closed Apple/ELF dialect rather than a speculative
general target trait. A future non-AArch64 target gets a separate backend.

## D-013: Keep HTTP ownership separate and specialize linked facilities

Actors remain an opt-in standard-library abstraction and never mediate the core
HTTP request pipeline. HTTP descriptor shards own their connections and reuse a
hot connection locally; actor, SQLite, provider, and filesystem execution keep
their explicit ownership boundaries. The compiler links only facilities
reached by the program, including independent network and filesystem features.
One HTTP worker remains the default because it is fastest for measured closed
routes; `--workers` is a workload-specific concurrency knob, not an automatic
core-count setting.

## D-014: Development uses cached AOT hot restart

`tinytsx dev` remains an ahead-of-time compiler. It keeps the TypeScript
frontend session and Cargo runtime artifacts warm, regenerates the complete
application object, and links a generation-specific executable. The previous
child continues serving while compilation runs; an invalid edit never replaces
it. A successful edit gracefully restarts the process, so explicit external
persistence survives while process-local actors, workers, and connections do
not.

Development mode does not load dynamic libraries, patch native functions, run
JavaScript in the application process, or preserve values across code
generations. Stable-listener proxying and module-level native object reuse need
separate evidence and remain post-beta.

## D-015: External SQLite uses named deploy-time read-only bindings

Databases owned by another service are not embedded as host paths during
compilation. Source calls `openReadonlyDatabase` with a static name, compilation
declares that name as `sqlite-ro`, and deployment supplies one absolute path via
`--bind`. The process validates every declared name and opens every target
read-only before the HTTP listener starts.

This is separate from the existing read/write `Database` capability. The
read-only type exposes prepared `all`/`get` queries but no mutation API, and the
runtime still applies the service-owned, no-follow SQLite path policy. Dynamic
binding lookup, optional bindings, path defaults, database creation, and
write escalation are outside the beta contract.

## D-016: Frontend assets are deterministic executable data

The beta deployment artifact is self-contained: a statically named
`tinytsx:assets` store is paired with one build-time `--asset` directory. The
compiler validates a closed file tree, sorts normalized paths, computes MIME
and ETag metadata, and emits all bytes into the target object. Runtime asset
responses therefore need no filesystem capability, allocator, cache, or
application-worker hop.

Symlinks, special files, traversal, missing indexes, and exceeded file/byte
limits fail closed. Exact paths, `HEAD`, conditional ETag requests, index
routing, and an explicitly selected SPA fallback are the beta surface. Runtime
directory mounting, compression negotiation, range requests, mutable assets,
and general static-file middleware remain separate work.
