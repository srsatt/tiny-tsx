# TinyTSX beta release checklist

Release: `0.1.0-beta.1`

Current decision: **READY TO TAG.** TinyTSX candidate `91e235a` passes the
four-target native matrix and archive inspection. Air-quality application
candidate `628ae2d` passes Linux ARM64 packaging, live Raspberry Pi deployment,
rollback, and the enforced TinyTSX/Bun comparison. No beta tag or release has
been created.

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
- [x] Native servers remain loopback-only by default and accept an explicit
      deployment IP through `TINYTSX_LISTEN_HOST`.
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

- [x] Apple ARM64 completes `release:verify` at the final candidate commit.
- [x] Intel macOS completes `release:verify` at the same candidate commit.
- [x] Linux ARM64 completes `release:verify` at the same candidate commit.
- [x] Linux x86-64 completes `release:verify` at the same candidate commit.
- [x] All four jobs finish without generated tracked changes.

Evidence: [beta release run 29759036385](https://github.com/srsatt/tiny-tsx/actions/runs/29759036385)
at `91e235a9ad778d4d6a8465571ae843aab1cca569`.

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

- [x] Both Apple archives have valid checksums, manifests, installed layouts,
      and outside-checkout HTTP smoke evidence.
- [x] Both Linux archives have the same evidence.
- [x] All manifests identify one source commit, HIR 2, runtime ABI 1, built-in
      schema 1, and the pinned Hono/Test262 revisions.

## Air-quality deployment

- [x] Apple behavior and performance artifacts identify both repository commits.
- [x] Build the application natively on Linux ARM64 from the exact candidate
      commit and retain the application/compiler provenance manifest.
- [x] Deploy it beside `luft-control` using only the read-only absolute database
      binding and verify current/history/assets against the live service-owned DB.
- [x] Record Pi startup, RSS, RPS, p99, service installation, rollback, and Bun
      control evidence without publishing private host paths or credentials.

Evidence: [application run 29760100220](https://github.com/srsatt/tinytsx-air-quality/actions/runs/29760100220)
at application `628ae2d76f0a9572c400f707b8cdbe2f12114593` and TinyTSX
`91e235a9ad778d4d6a8465571ae843aab1cca569`. The checksum-verified AArch64
ELF serves the live current/history/assets contract under a hardened systemd
unit. The final snapshot-isolated LAN comparison records TinyTSX/Bun startup
114/757 ms, RSS 9.63/48.42 MiB, c8 RPS 157.72/162.73 with p99 89.64/78.85 ms,
and c64 RPS 199.26/191.24 with p99 693.18/655.94 ms. The previous release was
rolled back, health-checked, and the final candidate restored successfully.

## Release decision

- [x] Every open item above is checked at the exact candidate commits.
- [x] The TinyTSX and air-quality repositories are clean and identify the tested
      commits in their retained artifacts.
- [x] All four archives and manifests are collected together.
- [x] No release note claims general TypeScript, ECMAScript, Web API, Node, Bun,
      Deno, Hono, npm, actor, SQLite, AI SDK, or GC compatibility.

Only after this section is green may a separate release action create and push
`v0.1.0-beta.1`.
