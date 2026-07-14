# Implementation status

Last updated: 2026-07-14

## Current state

Milestones 0–2 are complete for the static-page vertical slice. The compiler
produces and serves a native Mach-O executable from the example TSX source.

## Verified capabilities

- Compact Cargo workspace with compiler and bootstrap runtime binaries.
- Pinned TypeScript frontend package and TinyTSX SDK declarations.
- Static TSX example matching the first deliverable.
- Versioned JSON HIR with source spans, components, GET handler, HTML operations,
  interned static strings, and build statistics.
- Official TypeScript frontend validates the initial static subset and coalesces
  the example page into one 53-byte HTML fragment.
- Frontend coverage includes static and nested components plus rejection of
  `any`, classes, async functions, computed properties, and event attributes.
- Rust `tinytsx check` drives the build-time frontend, validates HIR v1, and can
  print readable HIR or deterministic Apple arm64 assembly.
- Assembly uses native component functions, the documented writer helper, static
  bytes in `__TEXT,__const`, and a global `tinytsx_handle_get` entrypoint.
- Apple clang assembles generated text and Cargo/rustc links the object into the
  single-worker Rust bootstrap runtime. No generated application code passes
  through LLVM, JavaScript, WebAssembly, or an interpreter.
- The bootstrap runtime handles GET over HTTP/1.1, emits required headers, closes
  each connection, and renders through a bounded writer using the ABI status.
- `tinytsx build` supports the first-slice build options, emitted HIR/assembly,
  temporary preservation, stripping, and a machine-readable build report.
- `tinytsx run` builds and starts the resulting executable.
- Native E2E coverage checks Mach-O magic, starts the executable, sends a real
  TCP request, and asserts the complete 200 response and 53-byte HTML body.
- A stripped release build measured 393,920 bytes on the development machine.

Verification:

```bash
rtk cargo check --workspace
rtk npm install --prefix frontend
rtk npm test --prefix frontend
rtk node frontend/dist/src/cli.js examples/static-page/server.tsx
rtk cargo test --workspace
rtk cargo clippy --workspace --all-targets -- -D warnings
rtk cargo run -q -p tinytsx -- check examples/static-page/server.tsx --emit-asm
rtk cargo run -q -p tinytsx -- build examples/static-page/server.tsx --port 3017 --output dist/static-server --release --emit-hir --emit-asm
rtk curl -i --max-time 5 http://127.0.0.1:3017/
```

## Active slice

Milestone 3: add typed dynamic component props, request query lookup, nullish
coalescing, and correct HTML text/attribute escaping.

## Resume point

Read `README.md`, the root contract documents, and `doc/BACKLOG.md`. Begin with
dynamic component props and extend the HIR before changing code generation. Run
the verification commands recorded here before moving an item to verified.
