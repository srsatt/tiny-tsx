# Implementation status

Last updated: 2026-07-14

## Current state

The repository began with the product README only. Stable contract documents and
this persistent project record are being established as Milestone 0.

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

Verification:

```bash
rtk cargo check --workspace
rtk npm install --prefix frontend
rtk npm test --prefix frontend
rtk node frontend/dist/src/cli.js examples/static-page/server.tsx
rtk cargo test --workspace
rtk cargo clippy --workspace --all-targets -- -D warnings
rtk cargo run -q -p tinytsx -- check examples/static-page/server.tsx --emit-asm
```

## Active slice

Milestones 0–2: compile the static example through JSON HIR and Apple arm64
assembly into a native bootstrap HTTP server, then verify it with a real request.

## Resume point

Read `README.md`, the root contract documents, and `doc/BACKLOG.md`. Continue the
first unchecked item. Run the verification commands recorded here before moving
an item to the verified list.
