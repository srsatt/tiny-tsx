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
