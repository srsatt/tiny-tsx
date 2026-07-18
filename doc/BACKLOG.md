# Backlog

This is the active, ordered work queue. Detailed completed history and exact
verification commands live in `doc/STATUS.md`; compatibility provenance lives
in `doc/COMPATIBILITY.md`.

A checked item must have evidence in `doc/STATUS.md` or its commit message.
Work top to bottom unless a failed tracer requires pulling one of its explicit
dependencies forward.

For alpha work, “done” means the public API is declared, the native path is
implemented, success and bounded-failure behavior is tested, the compatibility
or capability matrix is updated, and the release suite runs the evidence. A
parser-only or declaration-only implementation is not enough.

The dependency order is intentional:

1. freeze the contract and executable Hono matrix;
2. finish the shared built-in/capability infrastructure;
3. deliver environment and file access through the static-file tracer;
4. deliver the actor core through the counter tracer;
5. build SQLite on the actor ownership model and prove it through the blog;
6. package and verify the release.

New APIs discovered by a tracer are added to its smallest owning slice. They do
not expand alpha automatically: either add an explicit acceptance test here or
record the boundary in `doc/COMPATIBILITY.md` and defer it.

## Alpha definition

The first public milestone is `0.1.0-alpha.1`: an installable developer preview
that can compile and run the documented Hono examples without a JavaScript
engine in the produced server.

Alpha is not a claim of general TypeScript, ECMAScript, Node, Deno, Bun, Web API,
or Hono compatibility. The release must publish an exact supported matrix,
bounded-resource behavior, native prerequisites, and compile-time diagnostics
for unsupported behavior.

The alpha profiles are:

- native Apple arm64 build and execution;
- native Linux arm64 build and execution;
- cross-host AArch64 assembly inspection only;
- arena-only request memory with no managed heap;
- pinned upstream Hono source, not a compiler-owned Hono replacement;
- built-in TinyTSX backend modules with no npm runtime dependency.

## Current implementation slice

The `0.1.0-alpha.1` implementation and release candidate are complete. The
executable example/failure gates, repeated TinyTSX/Bun comparison, installable
Apple/Linux-arm64 archives, portable Test262/WPT allowlists, and schema-v2
source attestation have all passed their clean release contracts. The tag is a
separate release action. New language, Hono, actor, SQLite, Web API, or GC work
belongs to the ordered post-alpha backlog unless it fixes a regression in this
published contract.

Acceptance criteria are, in order:

- [x] Resolve the Hono response-clone `Content-Type` difference from Fetch/WPT
  evidence and update the affected native/reference contract;
- [x] Finish and test stable `TINY15xx` diagnostics for unavailable built-ins,
  denied capabilities, exceeded alpha limits, and unsupported actor/SQLite
  operations;
- [x] Audit `doc/ALPHA.md`, `doc/COMPATIBILITY.md`,
  `doc/STANDARD_LIBRARY.md`, `doc/PERSISTENCE.md`, `doc/ACTORS.md`, the Hono
  manifests, `--list-builtins`, and the getting-started path so none describes
  already-shipped disk, transaction, or persistent-counter work as missing or
  implies an example exercises more than it does;
- [x] Give every row in `tests/compat/hono/examples-manifest.json` an explicit
  release gate and make intake fail when the referenced script is missing or is
  not reached by `release:verify`;
- [x] Close the matrix's remaining evidence: Linux-arm64 assembly for
  `@hono/zod-openapi`, `@hono/node-server`, and `tinytsx:serve`; native success
  and failure HTTP paths for `tinytsx:serve`; the pinned Node/Hono reference for
  `@hono/node-server`; and an explicit tested-reference or not-applicable
  decision for the local durable-object counter adapter;
- [x] Exercise release-build startup and graceful shutdown, malformed input,
  request-memory exhaustion, worker/actor saturation, filesystem denial,
  SQLite contention, and post-disposal recovery through named release gates;
- [x] Package the focused Hono, file, SQLite, and actor examples and publish one
  archive-based getting-started path that links each runnable example without
  claiming the hello path exercises those features;
- [x] Complete one successful isolated native Linux-arm64 release run on the
  configured CI runner or an equivalent arm64 Linux host, install the resulting
  archive outside the checkout, and retain its checksum, artifact manifest,
  version report, and HTTP-contract evidence;
- [x] Repeat the controlled TinyTSX/Bun release benchmark and publish startup,
  idle/warm RSS, throughput, median/p99 latency, binary size, and the measured
  actor/SQLite overhead;
- [x] After the Linux and benchmark artifacts land, rerun the complete
  clean-tree exit suite and produce a tag-ready `0.1.0-alpha.1` checklist
  without creating the tag.

Runtime SQLite directory/sidecar-race hardening, prepared/callback transactions,
general actor messages, actor-scale/fairness work, and the combined user-auth
example were explicitly post-alpha. Later sections record the disk ownership,
bounded value-message, scale/fairness, and auth work that has since landed;
typed `Statement.run()` results and the exact prepared-write callback have also
landed; broader callback forms and the explicitly documented OS-sandbox
boundaries remain open.

### Release handoff

Publishing `0.1.0-alpha.1` remains a separate release action: attach both
already-verified archives, checksums, and schema-v2 manifests, then create
`v0.1.0-alpha.1` from the attested commit. Do not mix that action with later
implementation work; any source change creates a new candidate that must repeat
both native gates.

The goal is complete only when:

- `npm run release:verify` passes from clean Apple- and Linux-arm64 checkouts at
  the same source commit;
- both archives install outside the checkout and build/run their smoke
  applications from installed resources;
- repeated control, actor, and SQLite benchmark artifacts plus the final
  checklist are committed, while the tag is deliberately left for a separate
  release action.

## Alpha critical path

### A0 — Freeze the developer-preview contract

- [x] Add `doc/ALPHA.md` with the supported syntax, Hono/Web API matrix, native
      targets, standard-library modules, limits, security model, prerequisites,
      non-goals, and known incompatibilities.
- [x] Resolve bare package imports and package declarations so documented Hono
      applications do not require long `--alias`/`--api` command lines.
- [x] Define built-in module resolution for `tinytsx:env`, `tinytsx:fs`,
      `tinytsx:sqlite`, and `tinytsx:actors`; built-ins must not be resolved from
      `node_modules` or shadowed by application packages.
- [x] Add stable diagnostic codes for unavailable built-ins, missing native
      capabilities, denied paths, exceeded limits, and unsupported actor or
      SQLite operations.
- [x] Decide and document the alpha compatibility policy: additive APIs are
      allowed between alpha releases; breaking changes require release notes and
      an alpha-version increment.

### A1 — Broaden the executable Hono matrix

- [x] Add a machine-readable example matrix recording source provenance,
      required imports/APIs, intake status, native compile status, HTTP behavior
      coverage, Bun/reference coverage, and the first unsupported boundary.
- [x] Keep the complete pinned `basic` and `jsx-ssr` applications as mandatory
      release gates on every supported native target.
- [x] Compile and execute the pinned upstream `serve-static` landing application,
      then extend it with `tinytsx:fs` using the pinned assets as the file API
      tracer.
- [x] Use the pinned upstream `blog` routes and behavior as the CRUD contract for
      a Hono + `tinytsx:sqlite` example. Clearly distinguish any TinyTSX binding
      adapter from unchanged upstream source.
- [x] Add bounded JSON request bodies and closed-shape JSON parsing required by
      the blog tracer, with native success, malformed-input, and limit tests.
- [x] Add the minimum upstream Hono CORS middleware behavior required by the
      blog tracer and compare its portable response headers with Bun.
- [x] Add bounded `crypto.randomUUID()` support with Web-platform evidence and
      native format/uniqueness tests.
- [x] Connect permitted environment values to typed Hono bindings for the blog
      configuration path; keep denied and missing bindings explicit.
- [x] Use the pinned upstream `durable-objects` counter behavior as the contract
      for a Hono + `tinytsx:actors` counter example. Do not claim Cloudflare API
      compatibility unless the upstream source itself runs unchanged.
- [x] For every alpha example, build a native server, exercise success and error
      HTTP paths, compare portable behavior with Bun or another declared
      reference, and assemble the Linux-arm64 output in cross-host tests.
- [x] Resolve the known Hono response-clone Content-Type difference with direct
      Web-platform evidence and pin the decision in every affected contract.
- [x] Replace the open-ended “broader Hono tests” task with an explicit allowlist
      of upstream Hono behavior files exercised by the alpha matrix.

### A2 — Define the TinyTSX backend standard library

- [x] Add `doc/STANDARD_LIBRARY.md` defining built-in-module versioning,
      capability permissions, error types, blocking rules, resource ownership,
      bounds, target support, and the distinction from Web-standard APIs.
- [x] Keep built-in declarations in the shipped SDK and implementations in
      focused zero-JavaScript native runtime modules. Applications must not need
      npm packages to use them.
- [x] Add `tinytsx --list-builtins` or equivalent machine-readable capability
      output, including target availability and compiled limits.
- [x] Define a common disposable-resource contract (`close`/`dispose`) for file,
      SQLite, and actor handles without requiring a general garbage collector.
- [x] Define how potentially blocking filesystem and database work uses the
      application executor rather than blocking an HTTP executor.
- [x] Record candidates for post-alpha OS modules (path utilities, signals,
      subprocesses, sockets) without adding them to the alpha gate.
- [x] Freeze the alpha built-in surface to `tinytsx:env`, `tinytsx:fs`,
      `tinytsx:sqlite`, and `tinytsx:actors`. Any additional OS API requires a
      tracer, capability model, bounds, target matrix, and an explicit backlog
      change.

### A3 — Add environment input and bounded file reading

- [x] Specify and declare read-only `tinytsx:env` access with explicit
      `--allow-env <name>` capabilities, missing-value behavior, UTF-8 rules,
      maximum value length, and immutable startup snapshots.
- [x] Connect permitted environment values to typed Hono bindings and cover
      missing/denied configuration without exposing the entire host environment.

- [x] Specify and declare `tinytsx:fs` with an alpha-minimum text-file read API;
      reserve binary buffers, directory mutation, watching, and writes for later
      unless an alpha example proves they are required.
- [x] Add explicit `--allow-read <root>` capabilities. Default-deny request-time
      filesystem access, canonicalize paths before permission checks, and keep
      environment and filesystem capabilities separate.
- [x] Define deterministic behavior for missing files, directories, invalid
      UTF-8, symlinks, traversal attempts, permission denial, and concurrent
      replacement.
- [x] Enforce configurable maximum path and file sizes, copy results into a
      documented ownership domain, and return recoverable errors on overflow.
- [x] Add native unit tests, permission/security tests, request-time Hono tests,
      and Apple/Linux target coverage.
- [x] Run the Hono static-file tracer through the public built-in rather than a
      test-only runtime intrinsic.

### A4 — Promote logical workers into lightweight actors

- [x] Add `doc/ACTORS.md` defining actor identity, state ownership, mailbox
      ordering, ask/reply, tell, stop, failure, restart, supervision boundary,
      fairness, and shutdown. State explicitly that actors are local and are not
      one operating-system thread each.
- [x] Specify, declare, and implement the first `tinytsx:actors` surface as a
      compile-time-known signed-integer counter with a typed `CounterActorRef`,
      bounded `ask`, bounded fire-and-forget `tell`, and idempotent `stop`.
      General typed behaviors remain gated by structured message copying below.
- [x] Reuse the existing fixed application executor and logical-worker mailbox;
      spawning or stopping an actor must not create or destroy a native thread.
- [x] Define actor-local counter state without a managed heap and reject
      behavior/state that escapes the supported native `i64` lifetime contract.
- [x] Define bounded stopped, mailbox/application saturation, handler-panic, and
      overflow behavior for the counter specialization; document that timeout,
      caller cancellation, automatic restart, supervision, and drain-on-stop are
      not part of this alpha.
- [x] Run the Hono counter tracer through the public actor API as an explicit
      local adapter to the pinned durable-objects behavior.
- [x] Persist one actor variant through `tinytsx:sqlite` after the bounded disk
      owner and transaction core are green.

### A5 — Add bounded SQLite persistence

- [x] Pin a SQLite revision and choose a reproducible linking policy. Prefer a
      vendored/static alpha artifact with license and provenance records so
      applications do not depend on an undeclared host SQLite installation.
- [x] Specify and declare the bounded alpha `tinytsx:sqlite` subset: static
      database open/close, prepared positional binding, bounded query rows,
      closed effects, and static-SQL transaction batches. Typed general execute
      results and callback transactions remain post-alpha.
- [x] Finish the in-memory prepared-parameter slice described above before
      adding transactions or on-disk databases; keep request JSON decoding in
      the bounded bootstrap/runtime boundary rather than a general JS object
      heap.
- [x] Define the alpha value mapping for `null`, integer, finite number, text,
      and blob; reject unsupported dynamic values at compile time.
- [x] Make each connection single-owner and serialize its operations through the
      A4 actor mailbox instead of sharing a native handle across HTTP executors.
- [x] Require explicit read/write filesystem capabilities for on-disk databases and offer
      `:memory:` for deterministic tests.
- [x] Bound the admitted static SQL, selected parameters, rows, row bytes,
      result bytes, busy wait, and owner mailbox; surface recoverable failures
      without exposing an unbounded statement or operation queue.
- [x] Prove schema creation, insert/select/update/delete, rollback, contention,
      malformed SQL, limit recovery, shutdown, and restart persistence.
- [x] Run the in-memory Hono blog tracer end to end against the public SQLite
      built-in with the pinned success envelopes and missing-record semantics.
- [x] Add the persistent variant of the A4 counter tracer after disk databases
      and transactions are green.

### A6 — Make the alpha release installable

- [x] Remove compile-time source-checkout discovery from the released compiler.
      Define an installed resource layout for frontend JavaScript, TypeScript,
      SDK declarations, runtime link inputs, licenses, and built-in metadata.
- [x] Decide whether alpha bundles the frontend/runtime assets or declares Node,
      TypeScript, Rust, Clang, libcurl, and SQLite as prerequisites. A release
      must fail with actionable diagnostics when a declared prerequisite is
      missing.
- [x] Add `tinytsx --version` and report compiler version, HIR version, target,
      runtime ABI version, built-ins, and pinned compatibility revisions.
- [x] Set the workspace/package version to `0.1.0-alpha.1`, add a changelog and
      third-party notices, and ensure generated reports carry the same version.
- [x] Add a reproducible `release:verify` command that starts from a clean tree,
      builds release artifacts, runs the alpha example matrix, checks reports,
      and fails on uncommitted generated changes.
- [x] Produce an installable Apple-arm64 archive with checksum and explicit
      artifact manifest; build and execute an application from a clean directory
      outside the checkout using only its installed resources.
- [x] Produce and execute the equivalent Linux-arm64 archive on Linux arm64;
      cross-assembly on macOS is not sufficient evidence.
- [x] Add native Apple-arm64 and Linux-arm64 CI/release jobs. Cross-assembled ELF
      evidence does not replace executing the Linux archive on Linux.
- [x] Verify startup, graceful shutdown, malformed input recovery, request OOM,
      worker/actor saturation, filesystem denial, SQLite contention, and clean
      resource disposal in release builds.
- [x] Publish one short getting-started path that installs the archive and builds
      a Hono application; link focused, runnable file, SQLite, and actor examples
      instead of implying the current hello-only snippet exercises them.

## Alpha exit gate

Do not tag `0.1.0-alpha.1` until all of these are true:

- [x] Every A0–A6 item is complete or explicitly moved to post-alpha with the
      alpha contract adjusted so no documented feature depends on it.
- [x] The complete Rust, frontend, Hono, Test262 allowlist, WPT allowlist, native
      API, benchmark-harness, and alpha example suites pass from a clean tree.
- [x] Apple and Linux archives install and execute outside the checkout, and
      their checksums, version output, build reports, and HTTP contracts match
      the release manifest.
- [x] The published compatibility matrix contains no unqualified “supports
      Hono/TypeScript/Web APIs” claim and links every supported row to executable
      evidence.
- [x] Security/resource limits and known issues for files, SQLite, actors,
      network transport, and request memory are documented and tested.
- [x] A repeated release benchmark records startup, idle/warm RSS, throughput,
      median/p99 latency, binary size, and actor/SQLite overhead without making
      claims broader than the measured workloads.

## Ordered post-alpha backlog

### Next development milestone — real-world server stability

This milestone is in progress. The release/tag action above remains separate;
the dated evidence under P1-P3 records what has already landed, while unchecked
items remain part of the post-alpha contract only after their complete native
tests pass.

The objective is to move from the narrow alpha contract to a dependable
server-side subset that can run a broader Hono application under sustained
load. It is not a promise of general JavaScript or npm compatibility.

Work in four tracer-driven slices:

1. close the language/runtime gaps exposed by the remaining native Test262
   programs and the selected Hono application;
2. run a multi-module Hono user-auth/configuration application and promote only
   the Web APIs and Hono behavior it proves necessary;
3. generalize actor messages and harden SQLite ownership/persistence for that
   application;
4. repeat native target, failure, load, and TinyTSX/Bun evidence before naming
   a release candidate.

The milestone is complete only when:

- [ ] every newly admitted language feature has a complete native Test262 or
      project-owned semantic test; syntax-only parsing is not sufficient;
- [ ] the selected Hono application builds and runs on Apple arm64 and Linux
      arm64, with success, malformed-input, denied-capability, overload, and
      shutdown paths in the release suite;
- [ ] actor and SQLite resources remain bounded, disposable, isolated, and
      recoverable under saturation, restart, and persistent-state tests;
- [ ] the compatibility, standard-library, persistence, actor, and performance
      documents describe the same executable contract;
- [ ] controlled TinyTSX/Bun measurements cover startup, RSS, throughput,
      median/p99 latency, CPU, allocation, and sustained-load behavior without
      claims beyond the measured applications.

AI SDK expansion, WASM embedding, distributed actors, and production garbage
collection are research tracks below. They may provide tracers or design
evidence, but they do not block this milestone unless a later backlog change
adds an explicit application acceptance test.

#### Goal handoff

The current stabilization pass has landed the complete twenty-two-case native
Test262 allowlist, the multi-module Hono user-auth tracer, copied structured
actor messages, protected SQLite ownership, eight-actor and two-owner WAL
pressure evidence, invalid UTF-8 form decoding, bounded Hono context variables,
tagged special-number/symbol constants, and the pinned upstream secure-headers
factory plus the bounded local-`Map` tracer. Their implementation and evidence
are recorded under P1-P4. The required-header SQLite idempotency and
full-transaction rollback tracer has also landed with its sustained load
evidence. The Map tracer passes the installed-package gate
and a clean release verification with checksum-valid Apple- and Linux-arm64
archives. The current post-Map head has not yet repeated that clean release
attestation on both native targets. The 2026-07-18 Apple failure was deterministic,
not flaky: awaited unknown effects were discarded, and invalid static SQLite
header names reached Rust HIR validation without a frontend issue. Commit
`9fbc605` now propagates every unsupported awaited effect except the explicit
Hono middleware `next()` marker and validates the static header token before
lowering. The complete clean Apple `release:verify` is green at that commit,
including 141/141 frontend tests, native/reference/workspace suites, installed
examples and failure paths, archive smoke, source attestation, and checksum.
The Linux archive still attests an earlier commit, so a native Linux rerun at
the same current source remains required before this head is called a release
candidate. The bounded root one-for-one supervisor below has now landed through
the public SDK/HIR/native path, Apple HTTP, Linux assembly, Bun/Hono reference,
manifest, and installed-package gates. It deliberately does not widen into
links, monitors, registries, dynamic children, arbitrary behaviors, or
distribution. Clean Apple `release:verify` is green at exact commit `66cec3f`
with schema-v2 `dirty: false` checksum
`9134b383a70fca802fec7fa80ff3dfe4e04d8b396f2918f91347ffad1622a2bd`.
Native Linux still needs to verify that same commit; later source commits need
fresh attestations on both targets.

Do not reopen the completed alpha foundations as broad projects. File reading,
SQLite, and local actors already have public bounded built-ins. Their next work
is API depth and real-application evidence, not a second standard-library
design. Likewise, a new Hono row promotes only the behavior exercised by its
named upstream tracer.

The groomed candidates, in recommended dependency order, are:

1. **SQLite transaction/value depth:** add only the prepared/callback
   transaction and dynamic value forms required by a selected application while
   retaining single-owner, non-interleaving execution.
2. **Release-stability evidence:** finish the named P4 workload families and a
   longer controlled TinyTSX/Bun run only after the selected functional slice
   is green. A new release candidate remains a separate explicitly selected
   goal.

#### Next-goal handoff — nested profile release slice

This is the selected next implementation goal, but this backlog checkpoint is
planning only. Do not treat uncommitted experiments as landed evidence and do
not start or resume implementation until the goal is explicitly set. Once
selected, execute the slice in this order:

1. **P1/P2 — canonical nested request values:** prove the bounded path model in
   frontend, HIR, response, and SQLite-parameter tests before widening the
   runtime surface.
2. **P3 — atomic profile persistence:** run the packaged Hono profile tracer
   through one owner-serialized callback transaction and prove rollback plus
   later connection reuse.
3. **Release integration:** add Apple native HTTP, Linux-arm64 assembly,
   unchanged Bun/Hono reference, manifest, package, and installed-archive
   gates for the same application contract.
4. **P4 — measured workload:** only after functional and failure gates are
   green, add the response-checked nested-profile transaction workload to the
   existing controlled TinyTSX/Bun harness.
5. **Candidate decision:** synchronize compatibility, persistence, status, and
   performance documents, then decide separately whether the resulting commit
   should become a release candidate. Tagging remains a distinct action.

Keep the work reviewable as small commits: bounded path representation and
validation; native traversal; profile persistence and rollback; target/package
gates; benchmark evidence; documentation. Each commit must keep already-landed
top-level request JSON and SQLite behavior green.

#### Selected tracer — bounded prepared transaction callback (landed 2026-07-17)

The next P3 slice is the project-owned
`examples/hono-sqlite/callback-transaction.ts` tracer. It overloads
`Database.transaction` with one zero-argument async callback whose block
contains 1–16 awaited `Statement.run(...)` expression statements. Every
statement must belong to the receiving database. The complete transaction is
one database-owner message with at most 65,536 aggregate SQL bytes and 64
aggregate parameters, so concurrent request work cannot interleave between its
steps.

The success route must commit two prepared writes using bounded route/JSON
parameters. The failure route must make the second write violate a constraint
and prove the first write was rolled back. Apple arm64 executes both paths;
Linux arm64 assembles the same single-message transaction ABI. Frontend and HIR
tests pin the closed shape and limits, the SQLite runtime pins atomic rollback,
and the installed SDK declaration exposes the overload.

This tracer does not admit transaction queries, callback arguments or return
values, visible per-step `RunResult` objects, `Database.exec` inside the
callback, nested transactions, statements from another database, more general
control flow, manual `BEGIN`/`COMMIT`, or an interactive transaction object.
Static-SQL `Database.transaction(sql)` remains supported unchanged. Broader
dynamic values and callback forms require separate tracers.

The complete tracer is now green: frontend and compiler HIR tests pin the
closed shape and aggregate limits; the SQLite core commits or rolls back every
prepared step; Apple native HTTP proves commit, second-step rollback, and
connection reuse; Linux arm64 assembles the descriptor ABI; and the SDK,
manifest, examples, persistence contract, and release matrix expose the same
boundary. The next selected work is the P4 release-stability evidence pass.

#### Selected P4 tracer — sustained five-workload comparison (landed 2026-07-17)

Run the committed benchmark harness on Apple arm64 for `hono-basic`,
`hono-dynamic-jsx`, `hono-stream-text`, `hono-actor`, and `hono-sqlite`. Each
workload uses eight TinyTSX HTTP workers, keep-alive for both targets, five
fresh-process startup samples, and three 15-second load samples at concurrency
8 and 64. Target and concurrency order continue to alternate. Allocator
instrumentation remains disabled so its atomic counters do not perturb the
comparative path.

Retain adjacent JSON and Markdown reports under `benchmarks/results/` with a
`2026-07-17-m5-max-sustained-15s-*-keepalive-w8` prefix. Every sample must keep
success rate 1.0 and pass the existing response/status/header/framing gates.
Report startup, idle/warm/peak RSS, throughput, median/p99 latency, CPU,
syscalls, context switches, faults, threads, and descriptor start/peak/end.
Compare the basic control with request-time escaping, streaming, actor, and
SQLite route costs. Profile only a reproduced regression; do not optimize from
aggregate counters alone.

This matrix is longer controlled evidence for these exact localhost routes,
not a general AOT/JIT claim. It does not close the still-unmeasured file,
non-empty SQLite result, disk I/O, transaction-write, large-response, route-
parameter, JSON-branch, cancellation, or multi-actor workload families. Those
require separate equivalence-checked harness entries before the broad P4 item
can be marked complete.

The selected matrix is green on clean commit `7c1a22c`: all 60 load samples
pass with success rate 1.0, every TinyTSX process returns from 68 peak file
descriptors to its baseline of 4, and the adjacent JSON/Markdown reports retain
all samples. TinyTSX uses 6.30–8.06 MiB warm RSS and reaches 0.40–0.72x Bun
throughput at concurrency 64, while its p99 remains 9.575–15.622 ms versus
Bun's 0.821–1.683 ms. The combined report is
`benchmarks/results/2026-07-17-m5-max-sustained-15s-summary.md`.

The next P4 tracer must come from the unmeasured families above; the sustained
matrix does not promote a general performance claim or close the broad P4
workload item.

#### Selected P4 tracer — optional Hono route parameter workload (landed 2026-07-17)

Add one `hono-route-param` workload around the existing project-owned
`tests/compat/hono/optional-param-smoke.ts` tracer, derived from the pinned Hono
optional-parameter behavior at `vendor/hono` commit
`b2ae3a2204a48ce15a26448fd746d39745eb1837`. TinyTSX and Bun must execute the
same application source. The measured path is
`/api/v1/animal/TinyTSX%20Bench`, and both targets must return status 200,
`application/json`, and the exact decoded body `{"type":"TinyTSX Bench"}`
before startup, RSS, or load samples are accepted.

The harness unit test must pin the source, path, response, scope, and Bun
adapter. A short native smoke must build the release TinyTSX binary, execute the
response gate with keep-alive, retain every sample, and keep the existing Linux
arm64 Hono assembly/release evidence green. Package the workload as a normal
benchmark command and document its exact boundary.

This tracer measures one decoded trailing route parameter plus a bounded JSON
response through the pinned Hono router. The existing native compatibility
suite continues to prove the missing optional branch and overlong 404 branch;
they are not mixed into this throughput point. Catch-all parameters, route
competition, response-size scaling, files, JSON query/body branch mixes,
SQLite writes, cancellation, and multi-actor pressure remain separate P4
tracers.

The tracer is green. The harness test pins the exact source and response
contract; Apple arm64 release execution and Linux-arm64 assembly pass; and all
12 target/concurrency samples in the three-by-15-second keep-alive matrix have
success rate 1.0. TinyTSX reaches 58,997 requests/second (0.42x Bun) at
concurrency 8 and 92,459 (0.57x) at concurrency 64, with 6.38 MiB warm RSS and
9.755 ms concurrency-64 p99. Each TinyTSX run returns from 68 peak descriptors
to 4. The raw evidence is the adjacent
`benchmarks/results/2026-07-17-m5-max-sustained-15s-hono-route-param-keepalive-w8.*`
pair; no general router-performance claim is made.

#### Selected P4 tracer — bounded Hono file-read workload (landed 2026-07-17)

Add one `hono-file-read` workload around the shipped
`examples/hono-static/server.ts` adapter and the pinned 21-byte
`vendor/hono-examples/serve-static/assets/my-file.txt` asset from
`vendor/hono-examples` commit
`3b0b62875a0e1265763fea1c6388866d5697ef81`. TinyTSX must read the file through
`tinytsx:fs.readTextFile` with the exact asset directory granted by
`--allow-read`. Bun must use the same pinned Hono revision and asset bytes with
one request-time `Bun.file(...).text()` route. Both targets must return status
200, `text/plain; charset=UTF-8`, `x-powered-by: Hono`, and the exact 21-byte
body before measurement.

The harness test must pin the source, asset, capability root, response, and Bun
adapter. Existing filesystem gates continue to prove default denial, missing
files, maximum-size failure, Apple execution, Linux-arm64 assembly, and release
packaging. A short equivalence smoke precedes the same three-by-15-second,
concurrency-8/64, eight-worker keep-alive matrix used by the current P4
baseline; all raw samples and descriptor end-states must be retained.

This tracer measures repeated warm page-cache reads of one tiny immutable text
file plus Hono/application-executor overhead. It does not isolate filesystem
syscall cost, control the OS page cache, flush caches, measure cold storage,
large files, concurrent replacement, binary data, writes, directory traversal,
or Bun/TinyTSX primitive parity. Those boundaries must remain explicit in the
report and performance conclusions.

The tracer is green. The harness test pins the asset, capability, source, and
response; the focused filesystem suite passes default denial, Apple execution,
and Linux-arm64 assembly; and all 12 target/concurrency samples in the
three-by-15-second keep-alive matrix have success rate 1.0. TinyTSX reaches
32,015 requests/second (0.54x Bun) at concurrency 8 and 42,969 (0.56x) at
concurrency 64, with 6.97 MiB warm RSS and 20.939 ms concurrency-64 p99. Every
TinyTSX run returns to four descriptors after observed peaks of 70–74. The raw
evidence is the adjacent
`benchmarks/results/2026-07-17-m5-max-sustained-15s-hono-file-read-keepalive-w8.*`
pair; no cold-cache, large-file, or primitive-parity claim is made.

#### Selected P4 tracer — 22 KiB bounded file response (landed 2026-07-17)

Add one `hono-large-file` workload that reads the pinned 22,173-byte
`vendor/hono/src/context.ts` file at Hono commit
`b2ae3a2204a48ce15a26448fd746d39745eb1837` on every request and returns it as
one Hono text response. The focused TinyTSX entry must use
`tinytsx:fs.readTextFile("context.ts", {maxBytes: 32768})` with only
`vendor/hono/src` granted by `--allow-read`; Bun must use the same pinned bytes
through `Bun.file(...).text()`. Both targets must return status 200,
`text/plain; charset=UTF-8`, `x-powered-by: Hono`, content length 22,173, and
byte-identical content before measurement.

The harness test must pin the source asset, exact byte count, capability root,
response, and both focused adapters. Apple arm64 must execute the response gate;
Linux arm64 must assemble the bounded file-read path; and the same
three-by-15-second, concurrency-8/64, eight-worker keep-alive matrix must retain
all raw samples and descriptor end-states.

Together with the 21-byte file tracer, this measures an approximately 1,056x
response-size increase through the same warm-cache file/Hono shape. It does not
control the OS page cache, isolate disk or network copies, cover responses above
32 KiB, stream the file, use binary data, exercise range/compression behavior,
or claim cold-storage performance.

The tracer is green. The harness test pins the 22,173 bytes, capability root,
and focused adapters; Apple arm64 executes the exact response; Linux arm64
assembles the bounded read; and all 12 target/concurrency samples in the
three-by-15-second keep-alive matrix have success rate 1.0. TinyTSX reaches
31,858 requests/second (1.30x Bun) at concurrency 8 and 40,856 (1.78x) at
concurrency 64, with 7.41 MiB warm RSS. Concurrency-64 p99 remains worse at
22.030 ms versus Bun's 5.104 ms. Each TinyTSX run returns from 73 peak
descriptors to 4. The raw evidence is the adjacent
`benchmarks/results/2026-07-17-m5-max-sustained-15s-hono-large-file-keepalive-w8.*`
pair; the result is limited to this exact warm-cache payload shape.

#### Selected P4 tracer — upstream compact/pretty JSON branch pair (landed 2026-07-18)

Add paired `hono-json-compact` and `hono-json-pretty` workloads using the
unchanged pinned 34-module `vendor/hono-examples/basic/src/index.ts` application
at `vendor/hono-examples` commit
`3b0b62875a0e1265763fea1c6388866d5697ef81` and Hono commit
`b2ae3a2204a48ce15a26448fd746d39745eb1837`. Both targets must execute the same
source and middleware graph. The compact path is `/api/posts`; the query-present
path is `/api/posts?pretty`. Bun supplies each exact byte reference before any
sample is accepted; status 200, JSON content type, `x-powered-by: Hono`, numeric
`x-response-time`, body bytes, and framing must agree.

The harness test must pin both paths, the shared entry/adapter, reference-body
capture, middleware aliases, and branch-specific scopes. Apple arm64 must
execute both response gates, the existing complete-source Linux-arm64 assembly
gate must remain green, and each branch must run the same three-by-15-second,
concurrency-8/64, eight-worker keep-alive protocol with all raw samples and
descriptor end-states retained.

This pair measures the upstream query-presence decision plus compact versus
two-space formatted serialization of one closed four-record array. It does not
measure dynamic JSON collections, request-body decoding, arbitrary query-value
comparison, mixed/randomized branch traffic, large JSON, replacers, cycles, or
general middleware branching.

The pair is green. The harness test pins both branches and the shared complete
source; Apple arm64 executes the Bun-captured 129-byte compact and 202-byte
pretty responses; the complete graph assembles for Linux arm64; and all 24
target/concurrency samples have success rate 1.0. At concurrency 8/64, TinyTSX
reaches 0.37x/0.61x Bun on compact JSON and 0.44x/0.79x on pretty JSON. Pretty
formatting lowers TinyTSX throughput by 2.1%/0.3% relative to compact and Bun by
19.4%/23.2%. Every TinyTSX run returns from 68 peak descriptors to 4. The raw
evidence is the adjacent
`benchmarks/results/2026-07-18-m5-max-sustained-15s-hono-json-{compact,pretty}-keepalive-w8.*`
pairs; no dynamic-collection or arbitrary-query claim is made.

#### Selected P4 tracer — idempotent prepared transaction and non-empty result (landed 2026-07-18)

Add one `hono-sqlite-transaction` workload around a project-owned focused Hono
route using pinned Hono commit `b2ae3a2204a48ce15a26448fd746d39745eb1837`
and the shipped `tinytsx:sqlite` callback-transaction surface backed by bundled
SQLite 3.53.2. Every request must perform two fixed-key idempotent prepared
writes in one zero-argument callback transaction, then execute a prepared
`get()` and return the same non-empty closed row. The Bun adapter must use the
same SQL, transaction boundary, Hono route, response bytes, and in-memory
single-connection ownership through `bun:sqlite`.

The harness test must pin the exact entry/adapter, path, two-write transaction,
non-empty body, scope, and limitations. Apple arm64 must execute the response
gate repeatedly and Linux arm64 must assemble the transaction-step ABI. A
short equivalence smoke must precede the standard three-by-15-second,
concurrency-8/64, eight-worker keep-alive run; all response-checked raw samples,
process counters, and descriptor end-states must be retained. The existing
SQLite core and native callback suite remain the failure/disposal evidence for
atomic rollback, connection reuse, ownership, and bounded transaction shape.

This tracer measures one in-memory owner, two idempotent prepared writes in one
atomic owner message, a non-empty prepared row copy, and JSON encoding. It does
not measure disk or WAL I/O, competing connections, rollback frequency,
request-derived values, growing tables, arbitrary transaction callbacks,
visible step results, or SQLite primitive parity. Those remain separate
functional or performance tracers, and this workload cannot close them by
inference.

The tracer is green. The harness contract pins the two source adapters, SQL
shape, exact 41-byte row response, and explicit limitations. Sixteen repeated
Apple-arm64 native requests return the same non-empty row; Linux arm64 assembles
the exact transaction-step ABI; and all 12 target/concurrency samples in the
three-by-15-second keep-alive matrix have success rate 1.0. TinyTSX reaches
32,292 requests/second (0.33x Bun) at concurrency 8 and 52,193 (0.52x) at 64,
with 8.81 MiB warm RSS and 17.293 ms concurrency-64 p99. Every TinyTSX run
returns from 68 peak descriptors to 4. The raw evidence is the adjacent
`benchmarks/results/2026-07-18-m5-max-sustained-15s-hono-sqlite-transaction-keepalive-w8.*`
pair; disk/WAL I/O, competing connections, rollback load, and request-derived
values remain open.

#### Selected P2/P4 tracer — bounded request JSON response values (landed 2026-07-18)

Add one shared project-owned `tests/compat/hono/json-body-smoke.ts` application
against pinned Hono commit `b2ae3a2204a48ce15a26448fd746d39745eb1837`.
Its `POST /json-body` route must read a closed request record through
`context.req.json()` and return selected string, finite-number, boolean, and
null fields through `context.json()` with their JSON types and escaping
preserved. Field names are compile-time non-empty UTF-8 strings bounded to 128
bytes; the existing 64 KiB transport ceiling bounds the complete body.

The runtime must reject malformed JSON, a missing selected field, and a selected
array or object with HTTP 400, reject an oversized body with HTTP 413, and serve
a later valid request on the same keep-alive connection. Frontend/HIR and
bootstrap ABI tests must pin the closed response expression and bounded parser
behavior. Apple arm64 must execute success/failure/recovery paths; Linux arm64
must assemble the exact response ABI; the Hono manifest and Bun reference must
cover the same shared source.

Extend the benchmark harness with explicit method, content type, and fixed body
support, then add `hono-json-body` using one equivalence-checked primitive body.
After a short smoke, retain the standard three-by-15-second concurrency-8/64,
eight-worker keep-alive report with startup, RSS, latency, process counters, and
descriptor recovery. This tracer does not admit dynamic keys, whole-object
identity, arrays/nested objects, body mutation, schema coercion/defaults,
streaming JSON, arbitrary content types, or a general JavaScript object model.
Those require separate tracers.

The functional slice is green. Typed HIR carries each selected field as a
bounded request-time expression; the bootstrap preserves string escaping,
finite numbers, booleans, and null, while missing/malformed/structured input
returns 400. Apple proves the success/failure/limit paths and a valid pipelined
request after application-level 400; Linux assembles the ABI; Bun/Hono reference
tests and the manifest are release-gated. The benchmark harness supports a fixed
POST body and retains all 12 samples from its three-by-15-second concurrency-8/64
run. TinyTSX reaches 58,034 requests/second (0.45x Bun) at concurrency 8 and
90,387 (0.64x) at 64, with 7.34 MiB warm RSS and 9.937 ms concurrency-64 p99.
Every run returns from 68 peak descriptors to 4. The adjacent
`benchmarks/results/2026-07-18-m5-max-sustained-15s-hono-json-body-keepalive-w8.*`
pair retains the exact request contract; broader dynamic JSON remains open.

#### Selected P2 tracer — invalid UTF-8 form decoding (landed 2026-07-18)

Use Web Platform Tests revision
`08e168922e0c0d42250335a40e679fa5123489df`, unchanged source
`url/urlencoded-parser.any.js`, as the parser provenance. Admit the four
`URLSearchParams` rows proving that `%FE%FF` and `%FF%FE` become two U+FFFD
replacement characters, an incomplete `%C2` becomes one replacement, and
`%C2x` becomes U+FFFD followed by `x`. Execute an equivalent project-owned
derived case through the native WPT compiler because the upstream file's
top-level table and `Request.formData()`/`Response.formData()` branches are
outside the bounded WPT frontend.

Implement replacement in the portable, fixed-capacity WPT form decoder after
`+` and percent decoding and before URLSearchParams storage. Valid UTF-8,
malformed percent escapes, order, duplicate names, and existing serialization
must remain unchanged. Expansion must fail at the existing 256-byte component
limit rather than write partial state. This does not add application-facing
`URLSearchParams`, `Request.formData()`, `Response.formData()`, `TextDecoder`,
dynamic input, iteration, or object identity.

Keep Hono route and query decoding separate: pinned Hono revision
`b2ae3a2204a48ce15a26448fd746d39745eb1837` deliberately preserves an
undecodable percent group such as `%A4%A2`, so this tracer must not change the
request-path ABI. Require the unchanged upstream WPT digest, frontend lowering
coverage, Apple-arm64 native execution of the derived replacement case, a
Linux-arm64 compile check for the portable runtime, the complete existing WPT
allowlist, and synchronized compatibility/Web API/status documentation before
checking the P2 item.

The tracer is green. The unchanged upstream source and digest are manifest-
pinned, while a four-test derived source executes the selected rows through the
native WPT compiler. The fixed-capacity C runtime now applies UTF-8 maximal-
subpart replacement after form percent decoding, retains valid UTF-8 and
malformed percent escapes, accepts 85 invalid bytes as 255 replacement bytes,
and rejects 86 invalid bytes before storing a partial pair. The portable smoke
executes on Apple arm64 and compiles as freestanding Linux-arm64 assembly.
Existing bootstrap coverage still proves Hono path parameters preserve an
undecodable percent group, so the two parser contracts remain separate.

#### Selected P3/P4 tracer — eight-actor mutation pressure (landed 2026-07-18)

Add one project-owned `benchmarks/tiny/hono-actor-multi.ts` application with
eight independently spawned signed counter actors. Each actor has one static
`/actor/<n>/tell` route that enqueues `+1` and returns the fixed body `queued`,
plus one `/actor/<n>/read` route that performs a zero-delta ask. Keep actor
selection compile-time closed; this tracer does not add a runtime registry,
dynamic actor array, request-derived message, or new actor API.

The Bun/Hono adapter must use eight independent `Worker`-owned counters so the
comparison retains the existing actor benchmark's ownership model. Extend the
benchmark harness with a response-equivalent URL-file load contract that
cycles all eight tell routes. Before sampling, prove each route mutates only its
own actor; after warm-up and every measured interval, read all actors and require
positive integer state. Any non-200 overload response fails the sample. Record
the exact URL set and postcondition in raw schema-v2 evidence.

Require Apple-arm64 native HTTP isolation/mutation coverage, Linux-arm64
assembly of all eight actor IDs, manifest/package/harness tests, and the normal
three-by-15-second concurrency-8/64 eight-worker keep-alive comparison with
startup, RSS, throughput, latency, process counters, descriptor recovery, and
all-target shutdown. This measures distributed fire-and-forget pressure across
eight local owners; it does not isolate ask/reply cost, mailbox latency,
supervision, restart, persistence, remote actors, or Bun Worker creation cost
from the complete process totals.

The tracer is green. Apple native HTTP proves eight isolated counters and
concurrent mutation; Linux arm64 assembles all eight tell/ask route ABIs; the
Bun/Hono reference proves the same ownership and response contract. All 12
target/concurrency samples in the clean three-by-15-second run are 200-only,
and all 18 warm-up/load state snapshots show progress on every owner. TinyTSX
reaches 38,366 requests/second (0.40x Bun) at concurrency 8 and 76,825 (0.76x)
at 64, with 6.64 MiB warm RSS and 11.806 ms concurrency-64 p99. It returns from
68 peak descriptors to 4. The eight-Worker Bun process uses 120.77 MiB warm RSS
and records a 703.77 MiB median peak under load; this is a whole-process result,
not an isolated Worker allocation claim. The adjacent
`benchmarks/results/2026-07-18-m5-max-sustained-15s-hono-actor-multi-keepalive-w8.*`
pair retains every response sample and actor-state checkpoint.

#### Selected P3/P4 tracer — on-disk WAL contention and savepoint rollback (landed 2026-07-18)

Add one project-owned `benchmarks/tiny/hono-sqlite-wal.ts` application against
pinned Hono commit `b2ae3a2204a48ce15a26448fd746d39745eb1837` and bundled
SQLite 3.53.2. Construct two static `Database("wal-load.db")` values so the
runtime opens two independent owner connections to one capability-scoped file.
Two setup routes must select WAL mode and pin `synchronous=FULL`, a 1,000 ms
busy timeout, and the default 1,000-page automatic checkpoint boundary before
creating one fixed state row.

Each owner gets one response-equivalent load route. In one outer SQLite
transaction, every request must create a savepoint, increment a rollback probe,
roll back to and release the savepoint, then increment a committed progress
counter and return `committed`. Cycling both routes under concurrent load must
therefore contend for the single WAL writer while remaining HTTP 200. After
setup, warm-up, and every measured interval, query the live database and require
WAL mode, a strictly progressing committed counter, and an exactly-zero
rollback probe. Record the main database, WAL, and SHM existence and sizes while
the process is live; reset all three names before every fresh process sample.

The Bun/Hono adapter must use two independent Bun Workers, each owning one
`bun:sqlite` connection to the same target-private file and executing the same
PRAGMAs, transaction boundary, SQL, routes, response bytes, and state queries.
Use separate protected temporary directories for TinyTSX and Bun so neither
target observes the other's database. The harness must retain the exact load
URL set, state postcondition, file samples, startup/RSS/throughput/latency,
process counters, descriptor recovery, and clean disposal in schema-v2 output.

Require frontend/HIR coverage for two same-path database owners, Apple-arm64
native HTTP coverage for setup, concurrent progress, rollback invariance,
restart persistence, bounded busy-timeout failure, and post-contention reuse.
Linux arm64 must assemble both database IDs and the transaction ABI. Add the
focused Bun reference, benchmark harness, Hono example-manifest, package gate,
and synchronized persistence/performance/status documentation before running
the normal short equivalence smoke and three-by-15-second concurrency-8/64,
eight-worker keep-alive comparison.

This tracer measures two connections, real on-disk WAL writes, write-lock
contention, and successful savepoint rollback on every request. It does not
measure failing full-transaction rollback frequency, crash/power-loss
durability, cold storage, WAL growth with automatic checkpointing disabled,
more than two connections, growing tables, request-derived values, arbitrary
transaction callbacks, network filesystems, or cross-process writers. Those
remain separate functional and performance tracers; the broad P3/P4 items stay
unchecked until their other named workload families are proved.

The tracer is green. Frontend HIR retains two owner IDs for the same protected
path; Apple native HTTP proves WAL setup, 32 concurrent alternating writes,
zero rollback-probe leakage, non-empty DB/WAL/SHM files, restart persistence, a
bounded external-writer timeout, and later connection reuse. Linux arm64
assembles both database paths and transaction calls. The two-Worker Bun/Hono
reference passes the same state invariant. All 12 sustained load samples are
200-only and all 18 state/file checkpoints pass. TinyTSX reaches 7,850
requests/second (1.14x Bun) at concurrency 8 and 8,554 (0.58x) at 64, with
8.06 MiB warm RSS; its concurrency-64 p99 rises to 108.839 ms versus Bun at
13.504 ms under the two-writer contention. The adjacent
`benchmarks/results/2026-07-18-m5-max-sustained-15s-hono-sqlite-wal-keepalive-w8.*`
pair retains every response, state, and live-file sample.

Before implementing the next tracer, its selected goal must be copied into the
active goal with: its exact tracer/source revision; admitted and rejected
boundaries; Apple execution and Linux-arm64 evidence; failure, saturation, and
disposal tests as applicable; manifest/declaration/package changes; and
documentation updates.
General JavaScript object identity, blanket Hono compatibility, distributed
actors, production GC, and a new release tag remain out of scope unless
explicitly promoted into a later goal.

#### Selected P1/P2 tracer — bounded Hono context variables (landed 2026-07-18)

Use pinned Hono commit `b2ae3a2204a48ce15a26448fd746d39745eb1837`,
unchanged implementation `src/context.ts`, and the `c.set() and c.get()` case in
`src/context.test.ts` as the semantic provenance. Add one project-owned
`tests/compat/hono/context-variables-smoke.ts` application whose matched custom
middleware stores one closed primitive and whose parameterized route stores one
request-derived string. The route must read both values through `Context.get()`
and return their concatenation, proving that values cross the middleware/handler
boundary but remain isolated to one request.

Admit from 1 through 16 statically named context slots per route. Keys must be
non-empty UTF-8 strings of at most 128 bytes. Values may be `undefined`, `null`,
boolean, finite number, closed string, or an already-supported bounded
request-time string expression. Repeated `set` replaces the prior value and a
missing `get` returns `undefined`. Lower the closed graph to request-local AOT
slots; do not allocate or expose a general JavaScript heap map. Preserve the
existing request-ID middleware policy as one reserved compiler-owned context
value rather than weakening its generator, length, or route-scope checks.

Reject dynamic keys, more than 16 slots, oversized/empty keys, structured or
escaping values, map identity, `new Map()` application values, iteration,
`size`, `has`, `delete`, `clear`, and mutation after a
response escapes. The tracer therefore advances Hono interoperability and the
record-versus-map design, but does not complete the broad bounded-native-`Map`
P1 item or imply general middleware/closure/async semantics.

Require frontend tests for missing, replacement, request-derived, reserved-key,
dynamic-key, key-bound, slot-bound, and structured-value behavior. Apple arm64
must execute repeated and concurrent requests and prove that no value leaks
between requests; Linux arm64 must assemble the same request-local response
ABI. Run an unchanged Bun/Hono reference against the shared tracer. Update the
shipped Hono declaration, example manifest, package gates, compatibility/status
documentation, and release routing before checking any parent P1/P2 item.
Because the slice has no owned native resource or queue, saturation is the
compile-time 16-slot failure and disposal is request completion; native tests
must prove recovery by serving a later valid request after rejected compilation
is tested separately.

The tracer is green. Frontend lowering proves missing lookup, replacement,
request-derived values across a matched pre-`next()` middleware boundary, the
reserved request-ID key, key/value bounds, and the 16-slot ceiling. Apple native
HTTP returns the exact isolated value for 32 concurrent requests and a later
recovery request; Linux arm64 assembles the same path-segment response ABI. The
shared unchanged tracer also passes Bun/Hono, and its native/reference scripts
are reachable through the Hono manifest and release suite. This closes only the
fixed-key `Context.set/get` specialization; general `Map` remains open.

#### Selected P1/P2 tracer — bounded Hono `Context.var` reads (landed 2026-07-18)

Use pinned Hono commit `b2ae3a2204a48ce15a26448fd746d39745eb1837`, the
`var` getter in unchanged `src/context.ts`, and the adjacent `c.var` case in
`src/context.test.ts` as semantic provenance. Extend the shared context-variable
tracer with a second route that reads middleware and handler values through
static `context.var.<name>` property access, including one missing property with
a closed fallback and one request-derived string.

Reuse the existing 1–16 request-local slot ownership, key, value, replacement,
and reserved-`requestId` bounds. Admit only direct identifier property access
and a closed string-literal element access that resolves to an existing or
missing slot; both must lower to the same AOT value as `Context.get`. Do not
materialize Hono's source proxy object or expose it to native code.

Reject dynamic computed keys, assignment through `Context.var`, destructuring,
spread/rest, enumeration, `Object.keys/values/entries`, identity comparison,
method calls, nested access through structured values, and escape into a
closure, actor, worker, SQLite value, or process state. This tracer does not add
a general record, proxy, index signature, or `Map` implementation and cannot
close the broad P1 collection item.

Require frontend success/failure coverage plus the shared declaration and Hono
manifest boundary. Apple arm64 must run repeated concurrent `/context-var/:id`
requests without cross-request leakage; Linux arm64 must assemble the same
request-derived response ABI; Bun/Hono must execute the unchanged shared source.
The release suite must reach both native and reference evidence. Capacity and
disposal remain the already-proved 16-slot compile-time ceiling and request-end
lifetime, so no new queue or owned-resource saturation test is applicable.

The tracer is green. Direct identifier and closed string-literal `Context.var`
reads lower to the same request-local values as `get`, including missing
`undefined` and a route-derived string shared from pre-`next()` middleware.
Frontend diagnostics retain dynamic access, assignment, enumeration, and
destructuring boundaries. Apple native HTTP proves 32 concurrent values on both
access styles and a later recovery request; Linux arm64 assembles the same ABI,
and Bun/Hono passes the shared source. The existing manifest/native/reference
release gates cover the expanded API without adding a map object.

#### Selected P1 tracer — special numbers and constant symbols

Use pinned Test262 commit `f2d1435644797268dca1f7988cad5a4e89ccd8d2`
and execute these four unchanged programs in native mode:

- `test/harness/assert-samevalue-nan.js`;
- `test/harness/assert-notsamevalue-zeros.js`;
- `test/built-ins/Infinity/S15.1.1.2_A1.js`;
- `test/built-ins/Symbol/uniqueness.js`.

Their complete assertions must prove SameValue treats two `NaN` values as the
same, distinguishes `+0` from `-0`, classifies positive infinity as a number
that is neither finite nor `NaN` and equals `Number.POSITIVE_INFINITY`, and
gives every direct `Symbol(description?)` call a unique identity even when the
description repeats.

Add explicit HIR constant tags for negative zero, `NaN`, positive/negative
infinity, and compile-time symbols instead of allowing JSON serialization to
collapse them to `0` or `null`. A symbol carries a canonical compile-time ID and
an optional closed UTF-8 description of at most 256 bytes. Repeated references
to one staged binding retain its ID; separate `Symbol()` calls receive distinct
IDs. Extend `examples/staged-constants/server.tsx` with top-level and nested
values proving all number tags plus shared and distinct symbols reach
deterministic read-only native data.

This slice admits constant construction, identity comparison in the four
Test262 programs, and tagged materialization only. It does not admit symbol
boxing, registry/well-known symbols, symbol property keys, descriptions at
runtime, coercion, enumeration, arithmetic with non-finite values, special
numbers in JSON/SQLite/actors, or general application symbol operations.

Require frontend staging/lowering tests, Rust HIR validation and byte-encoding
tests, Apple-arm64 execution of all four complete Test262 programs and the
staged-constant HTTP example, Linux-arm64 code-generation/assembly evidence,
allowlist/intake/package routing, and synchronized constant-data,
compatibility/status/backlog documentation. Reject oversized descriptions and
malformed/out-of-range symbol tags; the compile-time source-size ceiling is the
applicable saturation boundary, while disposal is not applicable to immutable
read-only constants.

The tracer is green. HIR and the read-only constant-data format retain all four
special-number tags plus bounded symbol identity and descriptions. The staged
example preserves one shared ID across aliases and assigns distinct IDs to
separate calls; it serves through the Apple native HTTP test and assembles for
Linux. All four unchanged Test262 programs compile, link, and execute natively,
bringing the allowlist to eighteen complete native cases. Oversized symbol IDs
and descriptions are rejected. General application symbol operations,
non-finite arithmetic, and bounded native `Map` remained open at this
checkpoint; the later bounded-Map tracer below raises the allowlist to
twenty-two.

#### Selected P2 tracer — upstream secure headers

Pin the next Hono behavior slice to commit
`b2ae3a2204a48ce15a26448fd746d39745eb1837`, unchanged
`src/middleware/secure-headers/secure-headers.ts`, its public index, and these
named upstream behaviors from `src/middleware/secure-headers/index.test.ts`:
`default middleware`, `specific headers disabled`, `should remove x-powered-by
header`, and `should use custom value when overridden`.

Admit `secureHeaders()` and one closed options record containing only the
twelve boolean/string headers in upstream `HEADERS_MAP` plus
`removePoweredBy`. Preserve after-`next()` replacement and case-insensitive
`X-Powered-By` deletion, including the upstream middleware-order difference.
Raise the bounded response-header capacity from eight to sixteen so the ten
default security headers fit with content framing and selected adjacent
middleware; keep names/values closed and retain the existing validation rules.

Reject Content Security Policy, report-only policy, permissions policy,
reporting endpoints, Report-To, `NONCE`, callbacks, dynamic options, and more
than sixteen emitted application headers with stable diagnostics. Those forms
require additional collection/string/callback or request-local semantics and
must not be approximated by a compiler-owned replacement middleware.

Require frontend success/failure and middleware-order coverage, unchanged
upstream TypeScript plus published-package JavaScript intake, Bun/Hono reference
behavior, Apple-arm64 native HTTP execution, Linux-arm64 assembly, Hono manifest
and documentation-matrix routing, installed-release reachability, runtime
exact-fit/overflow header-capacity tests, and synchronized compatibility,
Web-API, status, and backlog documentation. Header storage remains a fixed
per-response value disposed with the request; no queue saturation or GC test is
applicable.

The tracer is green. The unchanged TypeScript and published JavaScript factory
execute through general closed-record/array operations, `Headers.set`, and the
new case-insensitive `Headers.delete` effect. Defaults, disabled/overridden
headers, and both `poweredBy` orderings match Bun/Hono on Apple native HTTP; the
same 12-header route assembles for Linux. Compiler and runtime exact-capacity
tests admit sixteen headers and reject the seventeenth. Manifest, docs matrix,
reference script, package routing, and installed default example are release
gates. A clean `npm run release:verify` completed after this tracer and produced
checksum-valid Apple- and Linux-arm64 alpha archives. CSP,
permissions/reporting policy, nonce callbacks, and dynamic options remain
rejected.

#### Selected P1 tracer — bounded local `Map` (landed 2026-07-18)

Pin the next language-depth slice to Test262 commit
`f2d1435644797268dca1f7988cad5a4e89ccd8d2` and execute these four unchanged
programs in native mode:

- `test/built-ins/Map/prototype/size/returns-count-of-present-values-by-insertion.js`;
- `test/built-ins/Map/prototype/set/append-new-values-normalizes-zero-key.js`;
- `test/built-ins/Map/prototype/size/returns-count-of-present-values-before-after-set-delete.js`;
- `test/built-ins/Map/prototype/get/returns-undefined.js`.

Admit non-escaping `new Map()` values in the Test262 entrypoint, ordinary
functions, and request handlers. Each map owns at most sixteen live entries and
supports `set`, `get`, `has`, `delete`, `clear`, and `size`. Keys and values are
the bounded native primitive subset: `undefined`, `null`, booleans, strings,
finite numbers, the four tagged special-number forms, and compile-time symbols.
Key comparison is `SameValueZero`: all `NaN` keys match, and `-0` is normalized
to `+0`. Replacing a key preserves size, `set` returns the receiver, missing
`get` returns `undefined`, and delete reports whether a live entry existed.

Keep records and maps distinct in HIR and documentation. A closed record is an
immutable AOT layout with compile-time field names; a map is mutable runtime
storage with primitive keys and values. Lower a map to sixteen inline slots
owned by its invocation/request frame and dispose all slots when that frame
returns. Conservatively reject a control-flow path that can perform more than
sixteen distinct insertions, so the admitted slice has no hidden heap growth or
runtime capacity failure.

Reject constructor iterables, escaping/returned/captured maps, module-persistent
maps in applications, object/array/record keys or values, iteration and
`forEach`, dynamic method selection, subclassing, weak collections, more than
sixteen possible live entries, and transport through JSON, SQLite, actors, or
response constants. Those require separate identity, ownership, collection, or
managed-lifetime tracers and must not be approximated as closed records.

Require frontend staging/lowering and stable rejection tests, explicit HIR map
operations and validation, Rust layout/code-generation tests, all four complete
Test262 assertions on Apple arm64, Linux-arm64 code-generation/assembly, a
project-owned request-local Hono route proving per-request isolation and
replacement/deletion behavior, exact sixteen-entry acceptance and seventeenth-
insertion rejection, allowlist/intake/package routing, and synchronized
compatibility/status/backlog documentation before checking the parent P1 item.

The tracer is green. Four unchanged Test262 programs now compile, link, and
execute through explicit bounded Map HIR, bringing the native allowlist to
twenty-two cases. Generated maps own sixteen inline entries, normalize signed
zero and `NaN` keys with `SameValueZero`, preserve `SameValue` for returned
values, and reject a seventeenth live entry; Linux arm64 assembles the same
operations. The shared Hono tracer uses an ordinary helper and a request-local
map to chain and replace `set`, observe `has`/`delete`/`size`, clear a second
map, and return 32 concurrent isolated route values plus a recovery value on
Apple native HTTP; Bun/Hono matches it. Exactly sixteen application entries
compile, constructor iterables reject, the build report records
`request/none`, and no managed heap is required. The installed `hono-map`
example builds and runs from the packaged resources, and a clean
`npm run release:verify` produced checksum-valid Apple- and Linux-arm64 alpha
archives. The parent P1 item is therefore complete within the rejected
boundaries above.

#### Selected P3/P4 tracer — request-header SQLite idempotency and rollback (landed 2026-07-18; Apple release green, Linux rerun pending)

Use a project-owned Hono payment/idempotency application as the next SQLite
transaction/value-depth tracer. A statically named `Idempotency-Key` request
header must flow through `Statement.run([value])` both directly and inside the
already-bounded async callback transaction. The admitted header value is one
through 256 bytes of valid UTF-8, is copied into the SQLite owner message before
request disposal, and retains SQLite `TEXT` semantics. Missing, empty,
oversized, invalid-UTF-8, dynamic-name, structured, optional/fallback, and
escaping header values remain rejected or return a bounded 400 response; they
must not silently bind the JavaScript string `"undefined"`.

The tracer creates a payment row in the first callback step and an audit row in
the second. A pinned uniqueness conflict in the second step must return the
existing application 500 response, roll back the first insert, leave no partial
row, and permit a later successful transaction on the same connection. Require
frontend lowering and stable boundary tests, explicit HIR parameter validation,
runtime ownership/decoding tests, Apple-arm64 native HTTP behavior, Linux-arm64
assembly, a Bun/Hono reference with the same external contract, manifest and
package routing, and synchronized persistence/compatibility/status/backlog
documentation.

After correctness is green, add a controlled disk/WAL failure-load workload
that repeatedly triggers the same full-transaction rollback with a fixed valid
header. Generalize the benchmark verifier to declare the expected 500 response
without treating it as transport corruption, verify zero partial rows plus a
successful recovery commit after every warm-up/load interval, and retain the
normal three 15-second samples at concurrency 8 and 64 for TinyTSX and Bun.
This promotes only required static-name request headers as SQLite values and
failed-transaction load; query/cookie/environment values, arbitrary header
expressions, conflict recovery in application code, cross-process writers,
cancellation, and interactive transaction objects remain separate tracers.

The tracer is green. Frontend and HIR tests retain the explicit request-header
parameter and reject dynamic/invalid names. The bootstrap copies a present
1–256-byte UTF-8 value before posting the owner message and returns 400 for
missing, empty, oversized, or invalid input. Apple native HTTP proves 32
isolated values, second-step rollback, and recovery; Linux arm64 assembles the
same ABI; Bun/Hono matches both the in-memory contract and disk/WAL workload.
All 12 sustained expected-500 samples and 18 recovery/file checkpoints pass
with zero partial rows. TinyTSX reaches 0.01x/0.06x Bun at concurrency 8/64
with 8.05 MiB warm RSS, selecting the failed owner/error path for profiling.
The first clean release rerun after landing this tracer exposed two frontend
boundary gaps: unsupported awaited effects were silently discarded, and static
header-token validity was deferred to Rust HIR validation. Both now reject at
the frontend boundary while preserving Hono's explicit synthetic `await next()`
marker. A clean Apple release rerun at `9fbc605` passes and produces checksum
`2e12572fa861d0e9a55b85fd69390ef9b296d142f76e81de5423455f4a2960a4`.
Treat this as current Apple release evidence only; the Linux archive must still
be regenerated from the same current source before release-candidate status.

#### Selected P3 tracer — bounded root one-for-one supervisor (landed 2026-07-18)

Add one reusable `tinytsx:actors` supervision primitive around the existing
fallible counter behavior. The public source shape is a module-scope
`supervise({strategy: "oneForOne", maxRestarts, withinMs})` value passed as
`ActorOptions.supervisor` to statically spawned children. A program may declare
at most eight supervisors and sixteen children per supervisor. Strategy and
limits are compile-time constants; `maxRestarts` remains 1–16 and `withinMs`
remains 1–60,000 milliseconds. A supervised child cannot also configure its
local `restart` policy or persistence.

The first project-owned Hono tracer has exactly two supervised fallible counter
children plus one ordinary outside counter. Mutate both children, fail the left
child, and prove one-for-one reinitialization resets only the left child. Fail
the right child and prove the same shared root restart window counts that
failure without resetting the left child. The next failure inside the window
must exhaust the root supervisor, return the existing bounded 500 to that
caller, terminate both supervised children and their queued replies, and leave
the outside actor usable. Expired attempts must leave the shared window in a
deterministic worker-runtime test without waiting in HTTP coverage.

Require SDK and built-in manifest declarations; stable frontend diagnostics for
dynamic options, invalid limits/strategy, escaping supervisor values, local
restart plus supervisor, persistence, unsupported behaviors, more than eight
supervisors, and more than sixteen children; explicit HIR supervisor IDs and
cross-reference validation; shared runtime restart accounting and group
termination tests; Apple-arm64 native HTTP behavior; Linux-arm64 assembly; a
Bun/Hono reference for the same external sequence; Hono manifest/package and
installed-release routing; and synchronized actor/compatibility/status/backlog
documentation.

This slice is a static root supervisor and one-for-one failure domain, not a
general Erlang/OTP implementation. Supervisors have no public mailbox or status
API, cannot be nested or dynamically created, and do not add `oneForAll`,
`restForOne`, child specs, manual restart, backoff, links, monitors, registries,
process aliases, persistence snapshots, remote nodes, or distributed identity.
Those require separate tracers after this one is green.

The tracer is green. SDK and built-in-manifest declarations, stable frontend
diagnostics including root/child overflow and escape rejection, HIR IDs and
cross-reference tests, generated AArch64 configuration, bootstrap integration,
shared runtime accounting, group termination, Apple HTTP, Linux assembly, and
the Bun/Hono reference all pass. The Hono matrix routes its native/reference
scripts through the release suite, and the installed archive builds and
executes the packaged example. Clean Apple release verification passes at
`66cec3f`; native Linux verification at the same commit remains required before
naming a two-target release candidate.

#### Selected P1/P2/P3 tracer — bounded nested profile JSON

Use pinned Hono commit `b2ae3a2204a48ce15a26448fd746d39745eb1837`
and a project-owned packaged `examples/hono-nested-json/server.ts` application.
Its `POST /profiles/:id` route accepts exactly this closed request shape:

```ts
interface ProfileInput {
  profile: {
    name: string;
    preferences: {theme: string; alerts: boolean};
  };
  score: number | null;
}
```

Admit static object-only paths with one through four segments, at most sixteen
selected leaf paths per handler, non-empty UTF-8 segment names of at most 128
bytes, at most 512 encoded path bytes, and primitive string/finite-number/
boolean/null leaves. Reuse the existing 64 KiB body bound and cap any selected
string leaf at 4 KiB. Intermediate arrays, leaf arrays/objects, dynamic or
computed names, optional/defaulted fields, whole-object identity, mutation,
destructuring/rest/spread, and paths that escape a handler remain unsupported.

Lower a selected leaf path through one canonical HIR/static-string form used by
both nested `Context.json()` responses and SQLite prepared parameters. Runtime
JSON traversal must parse one valid object document, require every intermediate
object and selected primitive leaf, preserve JSON string/number/boolean/null
encoding, and return the existing bounded 400 for malformed, missing,
wrong-shaped, non-finite, or exceeded input without poisoning keep-alive.

The profile tracer owns an in-memory SQLite database with one user table and
one preferences table. One bounded prepared callback transaction inserts the
route ID plus nested name/score and nested theme/alerts leaves as a single
owner message. A duplicate unique theme must fail the second step and prove the
first insert rolled back; a later distinct request must commit successfully.
`GET /profiles/:id` proves committed and missing state through the public query
API. This promotes nested primitive request paths as SQLite values, not JSON
columns, general structured bindings, or a dynamic object heap.

Require frontend success plus stable failure diagnostics; HIR path/depth/count
validation; bootstrap traversal and SQLite parameter tests; Apple native HTTP
for success, malformed/missing/wrong-shape, second-step rollback, keep-alive
recovery, and later reuse; Linux-arm64 assembly; an unchanged Bun/Hono
reference with `bun:sqlite`; Hono manifest, package, and installed-release
routing; synchronized compatibility/persistence/status docs; then add a
response-checked P4 benchmark row before making performance claims. Do not
widen this tracer to arrays, arbitrary schemas, JSON Schema/Zod validation,
streaming bodies, multipart/form data, GC-backed objects, or general JavaScript
property access.

Acceptance checklist:

- [ ] One canonical bounded path representation is shared by response and
      SQLite lowering, with stable diagnostics for depth, segment, encoded-size,
      selected-leaf-count, and unsupported-shape failures.
- [ ] Bootstrap/runtime tests prove nested primitive traversal, exact JSON
      encoding, SQLite parameter conversion, bounded failures, and request
      recovery without regressing top-level fields.
- [ ] The packaged Hono profile application proves commit, missing lookup,
      second-step rollback, keep-alive recovery, and later successful reuse.
- [ ] Apple native HTTP, Linux-arm64 assembly, unchanged Bun/Hono reference,
      Hono manifest, package, and installed-archive gates all exercise the same
      source-level contract.
- [ ] A response-checked TinyTSX/Bun workload records startup, RSS, throughput,
      median/p99 latency, CPU/process counters, success rate, and resource
      recovery with the tracer limitations stated beside the result.
- [ ] `doc/COMPATIBILITY.md`, `doc/PERSISTENCE.md`, `doc/STATUS.md`, and this
      backlog agree on the landed surface and remaining exclusions.

### P1 — Compatibility and language depth

- [x] Promote remaining syntax-only Test262 cases only when their complete
      assertion programs execute natively.
  - 2026-07-17: the complete pinned array-spread/apply, subtraction/GetValue,
    closed-record membership, direct string throw/catch, `Date.now()` type,
    closed class-constructor, own `Error.message`, and literal-alternative RegExp
    programs were promoted to native mode. Their assertions execute against
    copied arguments, numeric slots, runtime field-name bytes, native abrupt
    completion, the portable host clock, bounded class/error identities, and a
    dependency-free native matcher, a hoisted mutable module-function binding,
    and an async-function Promise brand. All twenty-two allowlisted cases now run
    complete native assertion programs; none remains syntax-only.
- [ ] Expand ordinary functions to locals, branches, closures, additional native
      types, and general typed expressions/statements.
  - 2026-07-17: immutable string locals and strict string-equality branches now
    lower through HIR and execute natively on both branch paths. Mutable locals,
    escaping closures, and general statements remain open.
  - 2026-07-17: required numeric parameters/results, immutable numeric locals,
    finite integer literals/constants, addition/subtraction, nested numeric
    calls, and strict numeric branches now share the unboxed native value ABI.
    Mutation, coercion, and general numeric statements remain open.
  - 2026-07-17: required boolean parameters/results, immutable boolean locals
    and constants, and strict boolean branches now use the same unboxed ABI.
    Truthiness, logical operators, and mutable flags remain open.
  - 2026-07-17: the complete module-function Test262 case now proves pre-
    evaluation initialization, direct call behavior, mutable reassignment, and
    non-global ownership. General mutable ordinary locals remain open.
- [ ] Compile function values, closures, records, arrays, ordinary loops, the
      restricted class semantics required by `hono/tiny`, and required runtime
      rest/spread operations.
  - 2026-07-17: closed local arrow/function values can capture direct-parent
    immutable strings and are lambda-lifted into native calls. Escaping identity,
    nested/transitive captures, and dynamic function selection remain open.
  - 2026-07-17: the complete pinned class-constructor program now executes all
    constructor, prototype, descriptor, and instance assertions natively; the
    ordinary application slice remains restricted to closed immediate use.
  - 2026-07-17: ordinary functions now admit one closed numeric `for` shape with
    a local accumulator, postfix index increment, static exclusive bound, and
    fixed additive step. The compiler caps it at 4,096 iterations; dynamic
    bounds, `break`/`continue`, nested loops, and arbitrary bodies remain open.
- [x] Implement bounded native `Map`, constant `symbol`, signed zero, `NaN`, and
      infinities with complete semantics evidence.
  - 2026-07-18: statically named Hono `Context.set/get` values now specialize to
    1–16 request-local AOT slots with replacement and missing-`undefined`
    behavior; direct static `Context.var` reads resolve the same slots. Dynamic
    membership, assignment through the view, identity, construction, iteration,
    deletion, and general native `Map` remain open.
  - 2026-07-18: explicit constant tags now preserve negative zero, `NaN`, both
    infinities, and bounded compile-time symbol identities/descriptions. Four
    pinned Test262 programs prove `SameValue`, finiteness/classification, and
    symbol uniqueness in native code; the staged-constant example reaches
    read-only Apple data and Linux assembly. Runtime symbol operations,
    non-finite arithmetic remained open after this constant-only slice.
  - 2026-07-18: four complete pinned Map programs now execute native
    insertion/size, signed-zero `SameValueZero`, deletion, missing lookup, and
    clear semantics in sixteen inline slots. A separate request-local Hono map
    proves replacement, chaining, membership, deletion, exact capacity,
    concurrent isolation, Apple/Linux targets, and Bun parity without a managed
    heap. Constructor iterables, escaping identity, iteration, dynamic
    request-derived keys, and collection transport remain separate proposals.
- [ ] Replace whole-module forbidden-syntax rejection with request/initialization
      reachability and specialize remaining closed-shape Hono object rest.
  - 2026-07-17: exception syntax is no longer rejected module-wide. Unreachable
    exception code is ignored, while reachable functions must lower to the
    native string-completion subset. Other forbidden syntax remains open.
- [ ] Add native RegExp, exceptions, Promise/async scheduling, and additional
      allowlisted Test262 coverage.
  - 2026-07-17: ordinary native functions can throw strings across direct calls
    and consume them in same-function `try/catch`; uncaught completion is a
    compile error. The exact Test262 Error constructor now owns a bounded copied
    message with standard descriptor flags; general Error objects, finally,
    Promise, and async remain open.
  - 2026-07-17: the exact Test262 RegExp case now executes two independently
    generated bounded ASCII literal-alternative searches and compares native
    `test`/`exec` presence results. Flags, captures, Unicode, and ordinary
    application RegExp remain open.
  - 2026-07-17: invoking the exact empty async-function Test262 expression now
    creates and verifies a bounded Promise-branded native result. Settlement,
    reactions, rejection, scheduling, and ordinary `await` remain open.

### P2 — Web and Hono breadth

- [x] Add a multi-module user-auth/configuration example covering environment
      input, middleware, error handling, and persistent state without network
      credentials in the automated suite.
  - 2026-07-17: `examples/hono-user-auth` separates typed configuration, the
    pinned Hono Basic Auth middleware, and SQLite ownership across local modules.
    Its Apple native test covers required environment input, rejected and
    accepted authentication, a closed HttpOnly/SameSite session marker, custom
    error handling, and a row retained across process restart; the same source
    assembles for Linux arm64. The tracer also promoted bounded closed
    string/integer/real/boolean/null prepared values.
- [ ] Generalize Request, Response, Headers, Fetch, URL, encoding, request bodies
      beyond the alpha JSON subset, abort/timeout, and portable non-macOS
      transports.
  - 2026-07-17: the real pinned `hono/cookie` `setCookie` helper now executes for
    closed name/value and default or explicit path. Closed `encodeURIComponent`,
    string `+=`, and `Headers.append` are reusable evaluator operations. A
    statically named `getCookie` now parses the borrowed request header with
    whitespace, percent decoding, and a closed missing fallback. The unchanged
    `deleteCookie` path returns the deleted value and emits `Max-Age=0`, while
    repeated `setCookie` calls preserve both response values. All-cookie objects,
    dynamic attributes, prefixes, and signing remain open.
  - 2026-07-18: a closed `Context.json()` response may select bounded primitive
    fields from `await Context.req.json()`. String escaping, finite numbers,
    booleans, null, malformed/missing/structured rejection, the transport limit,
    safe application-400 keep-alive recovery, and Apple/Linux native paths are
    release-gated. Dynamic keys, whole-object identity, arrays/nested objects,
    mutation, coercion/defaults, and streaming JSON remain open.
- [x] Compile the pinned upstream Hono `bodyLimit` middleware unchanged for a
      closed literal `maxSize` and its default error response.
  - Admit `Content-Length` request bodies within the existing 64 KiB transport
    ceiling, reject exceeded bodies with the upstream status/body/content type,
    and preserve keep-alive framing after either result.
  - Reject custom `onError`, dynamic or out-of-range limits, and chunked request
    bodies with stable documented boundaries until separate tracers require
    them.
  - Require upstream Bun/Hono reference tests, Apple-arm64 native HTTP behavior,
    Linux-arm64 assembly, manifest/intake coverage, and installed-release
    reachability.
  - 2026-07-17: closed 0–65,536-byte limits lower from pinned TypeScript and
    published-package JavaScript. Exact/exceeded Apple HTTP, pipelined recovery,
    chunked rejection, Linux assembly, custom/invalid diagnostics, Bun/Hono
    status/body reference behavior, and the installed archive example are all
    release-gated. TinyTSX follows the pinned Fetch/WPT string-body content type;
    Bun 1.3.13's missing header remains an explicit reference difference.
- [x] Compile the pinned upstream Hono `requestId` middleware unchanged for its
      default UUID generator and closed configuration.
  - Pin the tracer to Hono revision
    `b2ae3a2204a48ce15a26448fd746d39745eb1837`,
    `src/middleware/request-id/request-id.ts`, and the named behavior cases in
    `src/middleware/request-id/index.test.ts`; do not substitute a
    compiler-owned middleware implementation.
  - Admit `requestId()` and closed options with a non-empty static header name
    and a static 1–1,024-byte limit. Accept only non-empty incoming ASCII
    alphanumeric, underscore, hyphen, and equals IDs within that limit;
    otherwise generate UUIDv4 with the already-supported Web API.
  - Preserve one request-local value across middleware state,
    `c.get('requestId')`, and the emitted response header without adding a
    general dynamic context map or managed heap. Document whether accepted
    input is borrowed and where generated/header bytes are owned.
  - Reject custom generators, empty or dynamic header names, dynamic or
    out-of-range limits, and multiple conflicting policies with stable
    compile-time diagnostics. One route-scoped policy is admitted when exactly
    one closed policy matches the compiled route.
  - Require unchanged upstream TypeScript and published-package JavaScript
    intake, Bun/Hono reference tests, Apple-arm64 native HTTP behavior for
    generated/accepted/replaced IDs, Linux-arm64 assembly, manifest/intake
    coverage, installed-release reachability, and compatibility/Web API
    documentation before checking this item.
  - 2026-07-17: the pinned TypeScript and published `hono@4.12.30` JavaScript
    factories lower with the default or one closed non-empty header/limit
    configuration. Apple HTTP and Bun/Hono tests accept valid IDs and replace
    missing, invalid, or oversized values with UUIDv4; the same request-local
    bytes reach the response header and `c.get('requestId')`. Linux-arm64 output
    assembles, the installed archive executes the default example, and stable
    diagnostics reject custom generators, missing middleware, and conflicting
    policies. Accepted bytes remain request-borrowed through dispatch; generated
    bytes live in bounded writer-owned storage, with no context map or heap.
- [ ] Add optional/multi-segment route parameters, general constraints,
      non-terminal catch-alls, and broader request-dependent handlers.
  - 2026-07-17: one or more contiguous trailing `:name?` parameters now expand
    into a finite native route set. Present values use the borrowed path segment;
    absent values remain staged `undefined`. The pinned terminal
    `:remaining{.*}` shape also captures an empty or slash-containing tail and
    writes it with bounded percent decoding on Apple and Linux arm64.
    Non-trailing optionals, non-terminal catch-alls, and general constraints
    remain open.
- [x] Add invalid UTF-8 replacement semantics with upstream parser evidence.
  - 2026-07-18: four rows from pinned WPT `url/urlencoded-parser.any.js` now
    execute through a provenance-linked derived native case. `%FE%FF` and
    `%FF%FE` produce two U+FFFD values; incomplete/interrupted `%C2` produces
    one replacement and preserves following ASCII. Fixed-capacity overflow,
    valid UTF-8, malformed escapes, Apple execution, and Linux-arm64 portable
    compilation are release-gated. This is WPT-runtime evidence only;
    application `URLSearchParams` and form-data APIs remain open under the
    general Web API item.
- [ ] Add request-dependent stream chunks, sleep, cancellation, backpressure,
      and disconnect propagation.
- [ ] Continue expanding the explicit upstream Hono behavior allowlist and
      example matrix; never replace it with a blanket compatibility claim.
  - 2026-07-18: pinned `secureHeaders()` defaults and closed boolean/string
    overrides now execute through the unchanged upstream factory. Apple HTTP,
    Linux assembly, Bun/Hono, published JavaScript, installed-release, and
    sixteen-header capacity evidence are gated; CSP, permissions/reporting,
    nonce callbacks, and dynamic options remain outside the allowlist.

### P3 — Actors and persistence depth

- [x] Extend actor message copying to an explicit structured subset of
      primitives, closed records, and bounded arrays; preserve isolation and
      reject unsupported identity/transfer semantics.
  - 2026-07-17: the exact replace-state/JSON-stringify value mailbox accepts
    closed primitive, bounded-array, and closed-record initial state and
    messages. Frontend and HIR validators enforce depth, shape, string/name, and
    4 KiB payload limits; stable diagnostics reject dynamic/exceeded input. The
    runtime copies static bytes into mailbox-owned storage, moves them into
    actor state, clones replies, and executes primitive/array/record Hono routes
    on Apple arm64 while assembling the same ABI for Linux arm64. Identity,
    transfer, cycles, request-derived messages, arbitrary behaviors, and value
    persistence remain explicitly unsupported.
- [ ] Define actor timeout, caller cancellation, drain-on-stop, automatic
      restart, and supervision behavior, then prove handler isolation and panic
      recovery beyond the counter specialization.
  - 2026-07-17: stop is explicitly active-finish/queued-cancel, and abandoning
    a reply detaches only the waiter without retracting accepted FIFO effects.
    Generic runtime tests also prove isolated state, panic containment with a
    later successful message, and cross-actor parallelism. General
    deadlines/cancellation and broader supervision remain open.
  - 2026-07-17: `ask(message, {timeoutMs})` now accepts a static 1–60,000 ms
    deadline across the SDK, HIR, Apple/Linux code generation, and runtime. A
    deterministic blocked-handler test proves timeout detaches the waiter
    without retracting the accepted FIFO message; the public Hono tracer proves
    a successful bounded ask. Clean-close/general-signal cancellation and
    broader supervision remain open after the hard-reset slice below.
  - 2026-07-17: a hard client reset now detaches an `actor.ask()` HTTP waiter at
    the next 10-millisecond socket-error poll without retracting its accepted
    mailbox message. The one-worker SQLite-backed tracer holds an external write
    lock, resets the blocked requester, serves a static health route before the
    lock is released, then observes the detached increment. Generic worker tests
    pin cancelled and timed-out waiters; Apple HTTP and Linux assembly remain in
    `test:actors-native`. Clean TCP half-close, arbitrary `AbortSignal` sources,
    cancellation of SQLite/fetch/file operations, message retraction, and
    broader supervision remain outside this tracer.
  - 2026-07-17: the source tree now admits one exact non-persistent counter
    behavior whose first statement throws a closed `Error` for one
    compile-time integer sentinel, followed by the existing checked counter
    update/reply. A closed `restart: {maxRestarts, withinMs}` policy allows 1–16
    initializer resets in a 1–60,000 ms rolling window; each failed caller gets
    the existing internal-error envelope, queued messages continue against the
    reset initial state, and the next failure beyond the limit terminates that
    actor and cancels its queue. Generic worker tests prove reset, cross-actor
    isolation, and intensity termination; stable `TINY1520` diagnostics reject
    unsupported forms. The named Hono tracer executes on Apple arm64 and
    assembles for Linux arm64, and the SDK, manifest, and compatibility docs pin
    the same boundary. Persistent restart recovery, backoff, manual restart,
    broader supervision, links, monitors, registries, snapshots, and
    distributed identity remain separate.
  - 2026-07-18: the static root one-for-one supervisor is landed through the
    public `supervise(...)` source contract, compiler/native ABI, Apple/Linux
    behavior, Bun/Hono reference, and installed-package gate. It shares a
    bounded rolling restart budget across registered children, reinitializes
    only the failed child while the budget remains, terminates the group when
    exhausted, and leaves outside actors usable. General timeouts/cancellation,
    drain variants, arbitrary behaviors, nested/dynamic trees, and observation
    APIs remain open, so this broad item stays unchecked.
- [x] Measure 1,000 and 10,000 idle/local actors, publish bytes per actor and
      thread count, and prove cross-actor parallelism and fairness under a hot
      mailbox before raising the documented actor-count limit.
  - 2026-07-17: idle mailboxes no longer preallocate all 64 message slots. A
    native structural test creates and disposes 10,000 actors with zero idle
    deque capacity and two fixed executors. A five-run M5 Max release probe now
    records 131.07 bytes/actor at 1,000 and 139.26 bytes/actor at 10,000 after
    subtracting the 1.75 MiB zero-actor RSS; OS thread count stays at four for
    all three process configurations. The runtime already proves cross-actor
    parallelism, and an eight-message scheduling quantum now has deterministic
    one-executor evidence that a cold actor runs before a 64-message hot backlog
    completes. The subsequent repeated hot-mailbox P4 run retains throughput,
    latency, CPU, syscall, context-switch, allocation, and peak-RSS evidence.
- [x] Harden on-disk SQLite opens against symlink replacement and path races
      across compilation, startup, and sidecar-file creation.
  - 2026-07-17: all runtime connections add SQLite's native
    `SQLITE_OPEN_NOFOLLOW`; a Unix regression test proves a symlink replacing
    the database file is rejected. The runtime now also requires a service-owned
    protected directory, securely precreates a missing database at mode `0600`,
    validates sticky/writable ancestors, and rejects unsafe, symlinked, or
    hard-linked main, journal, WAL, and SHM names before and after open. The
    pinned VFS applies `O_NOFOLLOW` to every file class. This closes cross-UID
    path/sidecar replacement under ordinary Unix permissions; same-UID mutation, unusual
    ACLs, mount changes, and non-Unix filesystem semantics remain explicit OS
    sandbox boundaries rather than in-process guarantees.
- [ ] Add bounded prepared-parameter/callback transactions, typed execute
      results, and broader dynamic SQLite values without allowing operations to
      interleave on one connection.
  - 2026-07-17: prepared `run`/`all`/`get` parameters now accept bounded closed
    string, safe-integer, finite-real, boolean, and null literals in addition to
    route/JSON/UUID values.
  - 2026-07-17: `Statement.run()` now returns an immutable two-field result;
    `changes` is numeric and `lastInsertRowId` is an exact decimal string or
    null. Fixed per-handler result slots preserve single-owner ordering without
    a general heap. Broader dynamic values, arbitrary result operations, and
    callback transaction shapes remain open.
  - 2026-07-17: one zero-argument async callback may contain 1–16 awaited
    same-database `Statement.run` expressions, bounded to 64 aggregate
    parameters and 65,536 aggregate SQL bytes. Generated code posts every step
    as one owner message; core and Apple Hono tests prove commit, second-step
    rollback, and later connection reuse, while Linux arm64 assembles the same
    ABI. Queries, callback values, visible step results, control flow, nesting,
    mixed databases, `Database.exec` steps, and broader dynamic values remain
    open.
  - 2026-07-18: a required statically named request header now contributes a
    copied 1–256-byte UTF-8 `TEXT` parameter to prepared calls and callback
    transactions. The idempotency tracer proves concurrent isolation,
    second-step rollback, and same-owner recovery on Apple, Linux, and
    Bun/Hono. Optional/fallback headers, query/cookie/environment values,
    structured values, and arbitrary expressions remain open, so this broad
    item stays unchecked.
- [ ] Add actor supervision trees, restart intensity, monitors/links, registries,
      persistence snapshots, and remote/distributed actors only from separate
      evidence-driven proposals.

### P4 — Performance evidence

- [ ] Benchmark dynamic escaping, arenas, route parameters, JSON/query branches,
      response sizes, files, SQLite, and actors under representative load.
  - 2026-07-17: the actor slice now has an uninstrumented eight-worker
    keep-alive matrix with five startup and three five-second load samples at
    concurrency 1/8/32/64, plus a separate allocation-instrumented three-run
    concurrency-64 probe. TinyTSX reaches 0.68x Bun at concurrency 32/64 with
    6.77 MiB peak RSS, but retains 41.94 ms concurrency-64 p99 and higher
    aggregate CPU, Unix-syscall, and context-switch pressure. At that
    checkpoint, the other named workload families and longer sustained profiles
    remained open.
  - 2026-07-17: the sustained eight-worker matrix adds dynamic escaping,
    finite streaming, actor, and empty in-memory SQLite routes beside the Hono
    basic control. Five startup samples and three 15-second samples at
    concurrency 8/64 all pass. TinyTSX reaches 0.40–0.72x Bun at concurrency 64
    with 6.30–8.06 MiB warm RSS, but p99 remains 9.575–15.622 ms. At that
    checkpoint, route parameters, large responses, file reads,
    non-empty/disk/transaction SQLite, JSON branch mixes, cancellation,
    multi-actor contention, and isolated arena pressure remained open.
  - 2026-07-17: the optional route-parameter tracer adds one decoded trailing
    parameter and bounded JSON response using identical application source for
    TinyTSX and Bun. Its three 15-second samples at concurrency 8/64 all pass;
    TinyTSX reaches 0.42x/0.57x Bun with 6.38 MiB warm RSS and 9.755 ms
    concurrency-64 p99. Catch-all/competing route shapes and the other named
    workload families remain open, so this broad item stays unchecked.
  - 2026-07-17: the bounded file tracer adds repeated warm page-cache reads of
    one pinned 21-byte asset through the TinyTSX application executor and
    `Bun.file`. All three 15-second samples at concurrency 8/64 pass; TinyTSX
    reaches 0.54x/0.56x Bun with 6.97 MiB warm RSS and 20.939 ms
    concurrency-64 p99. Cold/large/replaced files and the other named workload
    families remain open, so this broad item stays unchecked.
  - 2026-07-17: the 22,173-byte bounded file/response tracer adds an
    approximately 1,056x payload increase over the 21-byte route. TinyTSX
    reaches 1.30x/1.78x Bun at concurrency 8/64 with 7.41 MiB warm RSS, while
    its concurrency-64 p99 remains worse at 22.030 ms versus 5.104 ms. Responses
    above 32 KiB, streaming/range/compression behavior, and the other workload
    families remain open, so this broad item stays unchecked.
  - 2026-07-18: the unchanged upstream compact/pretty JSON pair adds the
    query-absent and query-present branches for one closed four-record array.
    All six 15-second samples per branch pass. Pretty formatting changes
    TinyTSX throughput by -2.1%/-0.3% at concurrency 8/64 versus Bun at
    -19.4%/-23.2%. Dynamic collections, arbitrary query values, request JSON,
    randomized branch mixes, and the other workload families remain open, so
    this broad item stays unchecked.
  - 2026-07-18: the prepared SQLite tracer adds two fixed-key idempotent writes
    in one callback transaction plus one non-empty row response. All three
    15-second samples at concurrency 8/64 pass; TinyTSX reaches 0.33x/0.52x Bun
    with 8.81 MiB warm RSS and 17.293 ms concurrency-64 p99. Disk/WAL I/O,
    competing connections, rollback load, request-derived values, and the
    other workload families remain open, so this broad item stays unchecked.
  - 2026-07-18: the shared JSON-body tracer posts and returns one fixed 65-byte
    primitive object through selected bounded request fields. All three
    15-second samples at concurrency 8/64 pass; TinyTSX reaches 0.45x/0.64x Bun
    with 7.34 MiB warm RSS and 9.937 ms concurrency-64 p99. Dynamic keys,
    structured values, schema validation, mixed bodies, and other workload
    families remain open, so this broad item stays unchecked.
  - 2026-07-18: the eight-actor URL-set tracer distributes fixed `tell(+1)`
    mutations across eight local TinyTSX actors or Bun Workers, then reads every
    owner after warm-up and each load interval. All 12 load samples and 18 state
    snapshots pass; TinyTSX reaches 0.40x/0.76x Bun at concurrency 8/64 with
    6.64 MiB warm RSS. Supervision/restart/persistence load, cancellation, and
    other workload families remain open, so this broad item stays unchecked.
  - 2026-07-18: the on-disk WAL tracer alternates two independent database
    owners, rolls back one savepoint update and commits one progress update per
    request, and verifies live DB/WAL/SHM files after every interval. All 12
    samples and 18 state checkpoints pass; TinyTSX reaches 1.14x/0.58x Bun at
    concurrency 8/64 with 8.06 MiB warm RSS, while concurrency-64 p99 reaches
    108.839 ms. Cross-process writers, growing/request-derived data,
    cancellation, and other workload families remain open, so this broad item
    stays unchecked.
  - 2026-07-18: the full-rollback WAL tracer binds one required request header,
    route value, and JSON integer, then forces its second callback step to fail.
    All 12 declared-500 samples and 18 checkpoints retain zero partial rows,
    progressing recovery, WAL mode, and live files. TinyTSX reaches 0.01x/0.06x
    Bun at concurrency 8/64 with 8.05 MiB warm RSS. Application conflict
    handling, growing data, competing/cross-process writers, cancellation, and
    other workload families remain open, so this broad item stays unchecked.
- [x] Add CPU, syscall, allocation, peak-RSS, and first-launch instrumentation.
  - 2026-07-17: the macOS harness samples whole-process CPU time, Unix/Mach
    syscalls, context switches, faults, threads, open-file-descriptor
    start/peak/end counts, and peak RSS during warm-up and load, and reports the
    first fresh-process launch separately from the startup median. TinyTSX
    allocator counters are a benchmark-only opt-in Cargo feature because their
    atomics change the measured path; ordinary comparisons and production
    binaries do not include them, and no Bun allocation ratio is claimed.
- [x] Run controlled longer-duration comparisons before publishing performance
      claims and optimize only from profiles.
  - 2026-07-18: the fifteen-workload sustained matrix retains three 15-second
    samples at concurrency 8 and 64 for both targets, alternates target and
    concurrency order, disables allocator instrumentation, and preserves all
    raw response-checked samples. It supports claims only for those exact
    localhost routes. Elevated CPU/syscall/context-switch totals and the
    two-writer WAL tail select scheduling/owner/lock boundaries for future
    profiles; no optimization is inferred from aggregate counters alone.
  - 2026-07-17: a symbolized five-second macOS sample during a ten-second,
    concurrency-64 actor run shows the HTTP executors blocked in synchronous
    actor asks while seven of eight actor executors sleep, as expected for one
    single-owner actor. Excess keep-alive connections remain pinned behind each
    HTTP executor's 100-request turn; wall-time samples are not presented as
    CPU-only attribution.
  - 2026-07-17: exploratory request-turn caps reject connection closing as the
    fairness mechanism. Reducing the cap from 100 to 8 improved p99 from the
    committed 41.94 ms baseline to 12.14 ms but reduced throughput from about
    71.0k to 41.9k requests/second. A cap of 32 reached 28.10 ms p99 and 63.3k
    requests/second. Neither experiment was retained because reconnect churn
    trades too much throughput for latency.
  - [x] Design bounded live-connection resubmission that preserves the socket,
        buffered request bytes, HTTP body framing, pipelining order, overload
        behavior, and graceful shutdown. The reusable worker pool atomically
        rotates a live job behind its bounded queue; HTTP retains the connection
        parser across sixteen-request turns and the 100-request lifetime cap.
        Three repeated concurrency-64 actor runs reach 67.0k requests/second,
        retaining 94.4% of the committed ~71.0k baseline while reducing p99
        from 41.94 to 13.72 ms. Repeated basic and SQLite runs record 12.46 and
        16.20 ms p99, respectively. TinyTSX open descriptors return from 68 peak
        to 4 at every interval end. The basic, actor, SQLite, and user-auth Hono
        suites pass on Apple arm64 and assemble for Linux arm64.

### P5 — Research tracks outside the release critical path

- [ ] Add deterministic AI invalid-schema and multi-step/tool-call behavior,
      using the pinned AI SDK only as an evidence source rather than promising
      general package compatibility.
- [ ] Add heap ABI descriptors, roots, safepoints/stack maps, and write barriers,
      then compare established conservative and precise per-worker collectors.
      Do not implement a production collector from scratch.
- [ ] Expose the optional no-WASI WASM profile through an explicit built-in only
      after capability, packaging, and actor-isolation contracts are complete.
- [ ] Evaluate distributed actors only after local actor scale, fairness,
      supervision, persistence, and failure semantics have executable evidence.

## Completed foundation

- [x] Compile static/multi-module TSX, closed Hono applications, dynamic escaped
      JSX, finite streaming, workers, and selected AI SDK paths into native
      Apple-arm64 servers without a JavaScript engine.
- [x] Pin Hono, Hono examples, Test262, WPT inputs, and AI SDK sources with
      provenance-preserving intake/native test layers.
- [x] Compile and execute the complete pinned Hono `basic` and `jsx-ssr`
      applications with native HTTP behavior coverage.
- [x] Implement bounded request arenas, HTTP/1.1 keep-alive, request framing,
      streaming responses, fixed HTTP/application executor pools, saturation
      recovery, and logical-worker request/reply mailboxes.
- [x] Distinguish closed records from dynamic maps and serialize staged constants
      into deterministic native data.
- [x] Implement reusable assembly macros, shared AArch64 lowering, and thin
      Mach-O/ELF dialect adapters with byte-stable Apple output and
      assembler-verified Linux output.
- [x] Record TinyTSX/Bun startup, RSS, throughput, latency, worker, streaming,
      JSX, Hono, and provider benchmark evidence with stated limitations.
- [x] Define memory-lifetime/GC decision gates and a separate bounded no-WASI
      interpreter profile without adding either to the default runtime.
