# TinyTSX beta release checklist

Release: `0.1.0-beta.1`

Current decision: **NOT READY TO TAG.** The beta compiler surface and the
separate air-quality application's Apple functional/performance gates pass.
Fresh exact-source archives remain required on all four native targets, and the
air-quality application still needs Raspberry Pi ARM64 deployment evidence.
No beta tag or release has been created.

This checklist prepares a candidate; it does not create or push a tag. Run all
archive gates from the exact commit intended for `v0.1.0-beta.1`.

## Contract and source

- [x] Workspace, SDK, release tooling, ESLint package, and CI versions are
      `0.1.0-beta.1`.
- [x] Cached AOT dev restart, last-known-good recovery, listener readiness, and
      per-stage timings have executable integration coverage.
- [x] Deploy-time read-only SQLite bindings fail before listen and expose no
      mutation API.
- [x] Embedded Vite assets cover deterministic bytes, MIME, ETag/304, `HEAD`,
      SPA fallback, traversal denial, and Linux ARM64 assembly.
- [x] The bounded Hono text/safe-integer history parameters have frontend,
      runtime ABI, Apple native HTTP, ESLint, and Linux ARM64 evidence.
- [x] `tinytsx-air-quality` is a separate repository, compiles published Hono
      without an application declaration overlay, and passes matching
      TinyTSX/Bun behavior.
- [x] The clean Apple two-worker air-quality gate passes: 0.95x/1.02x Bun RPS,
      0.99x/1.04x p99, 0.79x startup, and 0.18x RSS.
- [x] Documentation keeps compatibility claims bounded and names the remaining
      Pi, GC, Web, language, and npm boundaries.

## Clean native verification

For each native target, start from a clean recursive checkout and install the
declared prerequisites. The release command rejects a dirty tree and runs the
Rust/frontend/native/reference suites, installed examples, archive smoke build,
and source-identifying manifest.

```sh
npm ci --prefix frontend
npm ci --prefix examples
npm run release:verify
```

- [ ] Apple ARM64 completes `release:verify` at the final candidate commit.
- [ ] Intel macOS completes `release:verify` at the same candidate commit.
- [ ] Linux ARM64 completes `release:verify` at the same candidate commit.
- [ ] Linux x86-64 completes `release:verify` at the same candidate commit.
- [ ] All four jobs finish without generated tracked changes.

## Artifact inspection

Repeat for `aarch64-apple-darwin`, `x86_64-apple-darwin`,
`aarch64-unknown-linux-gnu`, and `x86_64-unknown-linux-gnu`:

```sh
target=aarch64-apple-darwin
base="dist/release/tinytsx-0.1.0-beta.1-$target"
commit=$(git rev-parse HEAD)
test -f "$base.tar.gz"
test -f "$base.tar.gz.sha256"
test -f "$base.manifest.json"
(cd dist/release && shasum -a 256 -c "$(basename "$base.tar.gz.sha256")")
jq -e --arg target "$target" --arg commit "$commit" '
  .schemaVersion == 2 and
  .version == "0.1.0-beta.1" and
  .target == $target and
  .source.commit == $commit and
  .source.dirty == false and
  (.versionOutput | startswith("tinytsx 0.1.0-beta.1;")) and
  .layout.binary == "bin/tinytsx" and
  .layout.resources == "lib/tinytsx"
' "$base.manifest.json"
tar -tzf "$base.tar.gz" | grep '/bin/tinytsx$'
tar -tzf "$base.tar.gz" | grep '/lib/tinytsx/sdk/builtins/assets.ts$'
```

- [ ] Both Apple archives have valid checksums, manifests, installed layouts,
      and outside-checkout HTTP smoke evidence.
- [ ] Both Linux archives have the same evidence.
- [ ] All manifests identify one source commit, HIR 2, runtime ABI 1, built-in
      schema 1, and the pinned Hono/Test262 revisions.

## Air-quality deployment

- [x] Apple behavior and performance artifacts identify both repository commits.
- [ ] Cross-build the application with the Linux ARM64 candidate archive.
- [ ] Deploy it beside `luft-control` using only the read-only absolute database
      binding and verify current/history/assets against the live service-owned DB.
- [ ] Record Pi startup, RSS, RPS, p99, service installation, rollback, and Bun
      control evidence without publishing private host paths or credentials.

## Release decision

- [ ] Every open item above is checked at the exact candidate commits.
- [ ] The TinyTSX and air-quality repositories are clean and identify the tested
      commits in their retained artifacts.
- [ ] All four archives and manifests are collected together.
- [ ] No release note claims general TypeScript, ECMAScript, Web API, Node, Bun,
      Deno, Hono, npm, actor, SQLite, AI SDK, or GC compatibility.

Only after this section is green may a separate release action create and push
`v0.1.0-beta.1`.
