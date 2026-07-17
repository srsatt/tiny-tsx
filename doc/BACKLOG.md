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

The alpha implementation, executable example/failure gates, focused packaged
examples, and installable Apple-arm64 archive are complete. A clean
Apple-arm64 `npm run release:verify` passed on 2026-07-17. The remaining work is
**alpha release-candidate closure**: obtain native Linux-arm64 evidence, publish
the final repeated TinyTSX/Bun comparison, and assemble the tag-ready checklist.
Do not widen the language, Hono, actor, SQLite, or Web API surface unless one of
those existing alpha gates exposes a regression in the published contract.

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
- [ ] Complete one successful Linux-arm64 CI release run, install the resulting
  archive outside the checkout, and retain its checksum, artifact manifest,
  version report, and HTTP-contract evidence;
- [x] Repeat the controlled TinyTSX/Bun release benchmark and publish startup,
  idle/warm RSS, throughput, median/p99 latency, binary size, and the measured
  actor/SQLite overhead;
- [ ] After the Linux and benchmark artifacts land, rerun the complete
  clean-tree exit suite and produce a tag-ready `0.1.0-alpha.1` checklist
  without creating the tag.

Runtime SQLite symlink/sidecar-race hardening, prepared/callback transactions,
general actor messages, actor-scale/fairness work, and the combined user-auth
example are explicitly post-alpha. The alpha documents must keep those limits
prominent.

### Next-goal handoff

Use the goal title **Finish the alpha release candidate**. Its scope is the
three unchecked acceptance criteria above, in order. Native Linux-arm64
execution is required; cross-assembly does not close that gate. The benchmark
must include the Hono control plus actor and SQLite workloads, verify equivalent
responses, and commit the raw JSON and rendered Markdown results before making
comparative claims. The goal may repair a failing existing alpha path, but a
broader language, Web, Hono, standard-library, actor, SQLite, or GC requirement
becomes a post-alpha item instead of silently expanding `0.1.0-alpha.1`.

The goal is complete only when:

- `npm run release:verify` passes from a clean Apple-arm64 checkout and the
  Linux-arm64 workflow passes the same release contract natively;
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
- [ ] Produce and execute the equivalent Linux-arm64 archive on Linux arm64;
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

- [ ] Every A0–A6 item is complete or explicitly moved to post-alpha with the
      alpha contract adjusted so no documented feature depends on it.
- [x] The complete Rust, frontend, Hono, Test262 allowlist, WPT allowlist, native
      API, benchmark-harness, and alpha example suites pass from a clean tree.
- [ ] Apple and Linux archives install and execute outside the checkout, and
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

### P1 — Compatibility and language depth

- [ ] Promote remaining syntax-only Test262 cases only when their complete
      assertion programs execute natively.
- [ ] Expand ordinary functions to locals, branches, closures, additional native
      types, and general typed expressions/statements.
- [ ] Compile function values, closures, records, arrays, ordinary loops, the
      restricted class semantics required by `hono/tiny`, and required runtime
      rest/spread operations.
- [ ] Implement bounded native `Map`, constant `symbol`, signed zero, `NaN`, and
      infinities with complete semantics evidence.
- [ ] Replace whole-module forbidden-syntax rejection with request/initialization
      reachability and specialize remaining closed-shape Hono object rest.
- [ ] Add native RegExp, exceptions, Promise/async scheduling, and additional
      allowlisted Test262 coverage.

### P2 — Web and Hono breadth

- [ ] Add a multi-module user-auth/configuration example covering environment
      input, middleware, error handling, and persistent state without network
      credentials in the automated suite.
- [ ] Generalize Request, Response, Headers, Fetch, URL, encoding, request bodies
      beyond the alpha JSON subset, abort/timeout, and portable non-macOS
      transports.
- [ ] Add optional/multi-segment route parameters, general constraints,
      non-terminal catch-alls, and broader request-dependent handlers.
- [ ] Add invalid UTF-8 replacement semantics with upstream parser evidence.
- [ ] Add request-dependent stream chunks, sleep, cancellation, backpressure,
      and disconnect propagation.
- [ ] Continue expanding the explicit upstream Hono behavior allowlist and
      example matrix; never replace it with a blanket compatibility claim.

### P3 — Actors, AI, persistence, and managed memory

- [ ] Extend actor message copying to an explicit structured subset of
      primitives, closed records, and bounded arrays; preserve isolation and
      reject unsupported identity/transfer semantics.
- [ ] Define actor timeout, caller cancellation, drain-on-stop, automatic
      restart, and supervision behavior, then prove handler isolation and panic
      recovery beyond the counter specialization.
- [ ] Measure 1,000 and 10,000 idle/local actors, publish bytes per actor and
      thread count, and prove cross-actor parallelism and fairness under a hot
      mailbox before raising the documented actor-count limit.
- [ ] Harden on-disk SQLite opens against symlink replacement and path races
      across compilation, startup, and sidecar-file creation.
- [ ] Add bounded prepared-parameter/callback transactions, typed execute
      results, and broader dynamic SQLite values without allowing operations to
      interleave on one connection.
- [ ] Add actor supervision trees, restart intensity, monitors/links, registries,
      persistence snapshots, and remote/distributed actors only from separate
      evidence-driven proposals.
- [ ] Add deterministic AI invalid-schema and multi-step/tool-call behavior.
- [ ] Add heap ABI descriptors, roots, safepoints/stack maps, and write barriers,
      then compare established conservative and precise per-worker collectors.
      Do not implement a production collector from scratch.
- [ ] Expose the optional no-WASI WASM profile through an explicit built-in only
      after capability, packaging, and actor-isolation contracts are complete.

### P4 — Performance evidence

- [ ] Benchmark dynamic escaping, arenas, route parameters, JSON/query branches,
      response sizes, files, SQLite, and actors under representative load.
- [ ] Add CPU, syscall, allocation, peak-RSS, and first-launch instrumentation.
- [ ] Run controlled longer-duration comparisons before publishing performance
      claims and optimize only from profiles.

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
