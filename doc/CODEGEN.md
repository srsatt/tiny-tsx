# Code generation architecture

Code generation consumes validated HIR and emits readable textual assembly for
two AArch64 targets:

- `aarch64-apple-darwin` using Mach-O syntax and Apple symbol spelling;
- `aarch64-unknown-linux-gnu` using ELF syntax and ELF symbol spelling.

Final linking is native-host only. Either host may inspect the other target with
`check --target <triple> --emit-asm`; `build` rejects a non-host target before
compilation rather than silently producing a partial executable.

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
```

`asm_line!` and `asm_write!` are the only formatting interface target adapters
should use. They hide the infallible `String` formatting detail and remove
repeated `writeln!(...).unwrap()` plumbing from instruction selection.

`aarch64.rs` owns architecture and object-format spelling: immediate
construction, prologue/epilogue emission, request-context preservation, bounded
frame sizing, symbol prefixes, address relocations, visibility, and sections.
The shared backend owns instruction selection and runtime ABI lowering. The two
thin adapters select the Apple or ELF dialect.

There is deliberately no open-ended target trait. The second concrete target
showed that a closed AArch64 dialect is the required seam. A future architecture
should add its own backend rather than forcing non-AArch64 instructions through
this interface.

## Adding a target

1. For another AArch64 object format, extend the closed dialect with its section,
   symbol, visibility, call, and address-relocation spelling.
2. For another architecture, add a sibling backend and keep its instruction and
   frame rules out of `aarch64.rs`.
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
