# Optional WebAssembly profile

WebAssembly is an optional application-worker capability, not part of the
default TinyTSX bootstrap and not a replacement for the TypeScript AOT compiler.
The first profile proves a bounded loader and execution contract before adding a
JavaScript-facing `WebAssembly` API.

## Backend decision

`tinytsx-runtime-wasm` has no default external dependency. Enabling its
`interpreter` feature selects exactly `wasmi@1.1.0` with its `std` feature and
without its WAT parser. The interpreter is the first backend because it is
portable, starts without a platform JIT, supports deterministic fuel metering,
and exposes explicit store resource limits. An AOT backend can be evaluated
later for hot, trusted modules without changing the profile ABI.

This feature is absent from `tinytsx-runtime-bootstrap`. A normal TinyTSX build
therefore does not compile, link, initialize, or distribute the interpreter.

References:

- <https://docs.rs/wasmi/1.1.0/wasmi/struct.Engine.html>
- <https://docs.rs/wasmi/1.1.0/wasmi/struct.Config.html>
- <https://docs.rs/wasmi/1.1.0/wasmi/struct.StoreLimitsBuilder.html>

## First profile contract

The API is deliberately smaller than the Web standard:

```rust
invoke_i32(module_bytes, export_name, i32_argument, limits) -> i32
```

The profile requires:

- a core WebAssembly module no larger than 64 KiB by default;
- no imports, which also means no WASI, filesystem, sockets, clocks, random
  source, environment, or host callbacks;
- one typed exported function with signature `i32 -> i32`;
- at most one instance and one linear memory, no tables, and at most 1 MiB per
  linear memory by default;
- 100,000 fuel units by default, with execution trapping when exhausted;
- memory64, multi-memory, reference types, tail calls, and custom page sizes
  disabled in the first engine configuration.

Every limit is explicit and nonzero. Module-size and import checks happen before
instantiation. Store limits apply while instantiating and growing resources.

## Isolation and lifecycle

Future TypeScript syntax should load a compile-time-known module into one
logical application worker. The module instance, linear memory, fuel counter,
and backend store belong to that worker and are never shared with HTTP
executors or another logical worker. Messages cross the existing copied-value
boundary. Terminating the worker drops the whole instance and memory domain.

The first crate-level fixture does not yet connect this API to Hono or
`WebAssembly.Module`. That integration requires a source-level ownership and
message ABI rather than exposing backend handles through JavaScript objects.

## Executed fixture

The embedded 59-byte fixture has SHA-256
`a54806e8dc463aa5fa65a762f02479da78c62804651c7f6fb28b7a29495a4cbf` and is
equivalent to:

```wat
(module
  (memory (export "memory") 1 2)
  (func (export "add_one") (param i32) (result i32)
    local.get 0
    i32.const 1
    i32.add))
```

The feature-gated test executes `add_one(41) == 42`. Adjacent tests reject the
same module below its one-page memory requirement, reject all imports, reject an
oversized module, and stop an infinite loop by exhausting fuel. The default-
feature test proves the same public call returns `BackendDisabled` without an
interpreter backend.

Run both profiles with:

```bash
rtk cargo test -p tinytsx-runtime-wasm
rtk npm run test:wasm
```

## Promotion gates

Before exposing Web-standard syntax:

1. pin a source-level module declaration and ownership rule;
2. define bounded byte/string message transfer through the application pool;
3. decide whether each invocation reuses an isolated instance or creates a
   disposable one;
4. add cancellation and deadline propagation in addition to fuel;
5. benchmark interpreter startup, RSS, and execution against native code;
6. design an explicit host-import allowlist before enabling any import or WASI
   capability.
