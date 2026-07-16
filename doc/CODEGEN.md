# Code generation architecture

Code generation consumes validated HIR and emits readable textual assembly. The
current implementation has one target adapter, Apple arm64, but its reusable
parts no longer depend on Darwin sections, symbols, or runtime ABI names.

## Module boundaries

```text
compiler/src/codegen/
  mod.rs                  public target entrypoints and options
  assembly.rs             target-neutral text sink and emission macros
  aarch64.rs              reusable AArch64 instructions and frame planning
  constant_data.rs        target-neutral staged-value serialization
  macos_arm64/
    mod.rs                Apple target orchestration and exported config ABI
    functions.rs          component and value-function emission
    handlers.rs           request dispatch, guards, headers, and middleware
    response.rs           response and request-time text emission
    values.rs             closed value-expression emission
    data.rs               Mach-O constant sections and byte directives
    tests.rs              Apple target characterization tests
```

`asm_line!` and `asm_write!` are the only formatting interface target adapters
should use. They hide the infallible `String` formatting detail and remove
repeated `writeln!(...).unwrap()` plumbing from instruction selection.

`aarch64.rs` owns only architecture-level behavior that another AArch64 target
can reuse: immediate construction, prologue/epilogue emission, request-context
preservation, and bounded frame sizing. Mach-O sections, Apple symbol spelling,
runtime ABI calls, response lowering, and static-data labels remain in the
`macos_arm64` adapter.

There is deliberately no generic target trait yet. A second backend should be
added as a sibling adapter with an explicit entrypoint in `codegen/mod.rs`.
Shared behavior should move upward only when two adapters need the same concept;
this keeps the interface based on demonstrated reuse rather than predictions.

## Adding a target

1. Add a sibling adapter directory named for the OS and architecture.
2. Define its section syntax, symbol visibility, calling convention, runtime
   ABI mapping, value lowering, and static-data representation inside it.
3. Reuse `Assembly`, constant-data encoding, and architecture helpers only when
   their contracts match the new target.
4. Add a public entrypoint and explicit target selection without changing the
   existing Apple entrypoint.
5. Keep adapter tests in a separate `tests.rs` and shared-module tests in
   sibling `*_tests.rs` files.
6. Add emitted-assembly characterization tests plus assemble/link and native
   runtime tests for the target.

For refactors that should not change generated code, compare emitted assembly
byte-for-byte before and after the change. The representative commands are:

```bash
rtk cargo run -q -p tinytsx -- check examples/static-page/server.tsx --emit-asm
rtk cargo run -q -p tinytsx -- check tests/compat/hono/dynamic-jsx-smoke.tsx \
  --alias hono=vendor/hono/src/index.ts \
  --api hono=tests/compat/hono/api.d.ts --emit-asm
```
