# Implementation status

Last updated: 2026-07-14

## Current state

The repository began with the product README only. Stable contract documents and
this persistent project record are being established as Milestone 0.

## Verified capabilities

- Compact Cargo workspace with compiler and bootstrap runtime binaries.
- Pinned TypeScript frontend package and TinyTSX SDK declarations.
- Static TSX example matching the first deliverable.

Verification:

```bash
rtk cargo check --workspace
rtk npm install --prefix frontend
```

## Active slice

Milestones 0–2: compile the static example through JSON HIR and Apple arm64
assembly into a native bootstrap HTTP server, then verify it with a real request.

## Resume point

Read `README.md`, the root contract documents, and `doc/BACKLOG.md`. Continue the
first unchecked item. Run the verification commands recorded here before moving
an item to the verified list.
