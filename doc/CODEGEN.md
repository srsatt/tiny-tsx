# Code generation architecture

Code generation consumes validated HIR and emits readable textual assembly for
four native targets:

- `aarch64-apple-darwin` using Mach-O syntax and Apple symbol spelling;
- `aarch64-unknown-linux-gnu` using ELF syntax and ELF symbol spelling;
- `x86_64-apple-darwin` using Clang's Mach-O x86-64 lowering;
- `x86_64-unknown-linux-gnu` using Clang's ELF x86-64 lowering.

Final linking is native-host except that Apple Silicon can link Intel macOS
artifacts when its Rust standard library is installed. Any host may inspect
another target with `check --target <triple> --emit-asm`; unsupported link
combinations fail before frontend compilation.

## Module boundaries

```text
compiler/src/codegen/
  mod.rs                  public target entrypoints and options
  assembly.rs             target-neutral text sink and emission macros
  aarch64.rs              AArch64 writer, dialect, instructions, frame planning
  aarch64_backend/
    mod.rs                shared AArch64 orchestration and exported config ABI
    functions.rs          component and value-function emission
    handlers.rs           request dispatch, guards, headers, and middleware
    response.rs           response and request-time text emission
    values.rs             closed value-expression emission
    data.rs               constant labels and byte directives
    tests.rs              shared Apple characterization tests
  constant_data.rs        target-neutral staged-value serialization
  macos_arm64.rs          thin Mach-O dialect adapter
  linux_arm64.rs          thin ELF dialect adapter
  portable_c.rs           shared portable-source orchestration and HTTP lowering
  portable_c/
    values.rs             scalar functions, control flow, loops, and exceptions
    sqlite.rs             prepared statements, transactions, and result lowering
    application.rs        worker/actor configuration and calls
  x86_64.rs               Clang adapter from portable C to target assembly
  x86_64_tests.rs         shared Linux/macOS x86 characterization tests
```

`asm_line!` and `asm_write!` are the only formatting interface target adapters
should use. They hide the infallible `String` formatting detail and remove
repeated `writeln!(...).unwrap()` plumbing from instruction selection.

`aarch64.rs` owns architecture and object-format spelling: immediate
construction, prologue/epilogue emission, request-context preservation, bounded
frame sizing, symbol prefixes, address relocations, visibility, and sections.
The shared backend owns instruction selection and runtime ABI lowering. The two
thin adapters select the Apple or ELF dialect.

Ordinary value functions use a fixed two-word scalar ABI plus the `x2` abrupt-
completion flag. Strings occupy pointer/length words; finite numbers occupy the
first word as unboxed IEEE-754 bits; booleans use `0`/`1` in the first word.
Non-string scalars clear the second word. Static HIR types select the
interpretation, so adding numeric/boolean parameters, results, operations, and
branches does not introduce a boxed JavaScript value or managed heap.

There is deliberately no open-ended target trait. AArch64 keeps its direct,
closed dialect. Both x86-64 object formats share a portable generated-C backend
and let Clang perform target instruction selection, while the TinyTSX compiler
still emits and preserves the resulting textual assembly. Runtime ABI calls,
bounded values, functions, request expressions, SQLite, workers, and actors are
lowered once for both x86 targets.

## Adding a target

1. For another AArch64 object format, extend the closed dialect with its section,
   symbol, visibility, call, and address-relocation spelling.
2. For another architecture, either add a sibling direct backend or reuse the
   portable-source backend when its C ABI contract is sufficient; keep its
   instruction and frame rules out of `aarch64.rs`.
3. Reuse `Assembly` and constant-data encoding only when their contracts match.
4. Add explicit target parsing, HIR retargeting, assembler/linker selection,
   build-report identity, and native-host validation.
5. Keep tests outside production modules.
6. Prove emitted assembly with the target assembler and prove final linking and
   execution on a native host.

For refactors that should not change generated code, compare emitted assembly
byte-for-byte before and after the change. The representative commands are:

```bash
rtk cargo run -q -p tinytsx -- check examples/static-page/server.tsx \
  --target aarch64-apple-darwin --emit-asm
rtk cargo run -q -p tinytsx -- check tests/compat/hono/dynamic-jsx-smoke.tsx \
  --alias hono=vendor/hono/src/index.ts \
  --api hono=tests/compat/hono/api.d.ts \
  --target aarch64-unknown-linux-gnu --emit-asm
```
