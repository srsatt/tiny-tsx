# TinyTSX alpha release checklist

Release: `0.1.0-alpha.1`

Current decision: **NO-GO until native Linux-arm64 verification is complete.**
Cross-assembled Linux output is useful compiler evidence but cannot replace
building, installing, and executing the archive on Linux arm64.

This checklist prepares a release candidate; it does not create or push a tag.
Run it from the exact commit intended for `v0.1.0-alpha.1`.

## Contract and source

- [x] Workspace, frontend, and SDK versions are `0.1.0-alpha.1`.
- [x] `CHANGELOG.md`, `doc/ALPHA.md`, compatibility/capability matrices, known
      limitations, licenses, and third-party notices are present.
- [x] The Hono documentation audit has no unqualified compatibility claim and
      every admitted row names executable evidence.
- [x] The complete pinned Hono examples and focused file, SQLite, and actor
      examples are packaged.
- [x] `@hono/zod-openapi`, `@hono/node-server`, and Hono-neutral
      `tinytsx:serve` have reference, native HTTP, installed-resource, and
      Linux-assembly gates appropriate to their contracts.
- [x] The repeated Hono control, actor, and SQLite TinyTSX/Bun benchmark and raw
      samples are committed under `benchmarks/results/2026-07-17-m5-max-alpha-*`.
- [x] Post-alpha syntax, Web, Hono, actor, SQLite, OS, and managed-memory work
      remains explicitly outside this release.

## Clean native verification

For each native target, start from a clean recursive checkout and install the
declared prerequisites. The release command rejects a dirty tree and runs the
Rust, frontend, Hono, Test262/WPT allowlists, native APIs, Zod/OpenAPI,
release-runtime failures, installed examples, and archive smoke build.

```sh
npm ci --prefix frontend
npm run release:verify
```

- [x] Apple arm64 has completed the clean `release:verify` contract.
- [ ] Linux arm64 has completed the clean `release:verify` contract on a native
      `ubuntu-24.04-arm` or equivalent host.
- [ ] The exact release-candidate commit has completed both native jobs without
      generated tracked changes.

## Artifact inspection

Perform these checks independently for both target names:

- `aarch64-apple-darwin`
- `aarch64-unknown-linux-gnu`

```sh
target=aarch64-apple-darwin # repeat with aarch64-unknown-linux-gnu
base="dist/release/tinytsx-0.1.0-alpha.1-$target"
test -f "$base.tar.gz"
test -f "$base.tar.gz.sha256"
test -f "$base.manifest.json"
(cd dist/release && shasum -a 256 -c "$(basename "$base.tar.gz.sha256")")
jq -e --arg target "$target" '
  .schemaVersion == 1 and
  .version == "0.1.0-alpha.1" and
  .target == $target and
  (.versionOutput | startswith("tinytsx 0.1.0-alpha.1;")) and
  .layout.binary == "bin/tinytsx" and
  .layout.resources == "lib/tinytsx"
' "$base.manifest.json"
tar -tzf "$base.tar.gz" | grep '/bin/tinytsx$'
tar -tzf "$base.tar.gz" | grep '/lib/tinytsx/examples/README.md$'
```

- [x] Apple archive checksum, manifest, version output, installed layout, and
      outside-checkout HTTP smoke have been verified.
- [ ] Linux archive checksum, manifest, version output, installed layout, and
      outside-checkout HTTP smoke have been verified.
- [ ] Both artifact manifests identify the same source contract, HIR 2, runtime
      ABI 1, built-in schema 1, and pinned compatibility revisions.

The generated archive checksums belong in the uploaded `.sha256` files and
manifests. Do not copy a checksum into this tracked document: changing the
document would change the archive being attested.

## Release decision

Before tagging, confirm all of the following:

- [ ] Every alpha exit gate in `doc/BACKLOG.md` is checked.
- [ ] Both native archives are downloadable together with their `.sha256` and
      manifest files.
- [ ] The limitations in `doc/ALPHA.md` match the shipped compiler diagnostics
      and executable tests.
- [ ] No release note claims general TypeScript, ECMAScript, Node, Bun, Deno,
      Web API, Hono, actor, SQLite, AI SDK, or GC compatibility.
- [ ] The release commit is clean and is the commit verified by both native
      jobs.

Only after this section is green may a separate release action create
`v0.1.0-alpha.1`.

