# Backlog

This is the active, ordered work queue. Detailed completed history and exact
verification commands live in `doc/STATUS.md`; compatibility provenance lives
in `doc/COMPATIBILITY.md`.

A checked item must have evidence in `doc/STATUS.md` or its commit message.
Work top to bottom unless a failed tracer requires pulling one of its explicit
dependencies forward.

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

## Alpha critical path

### A0 — Freeze the developer-preview contract

- [ ] Add `doc/ALPHA.md` with the supported syntax, Hono/Web API matrix, native
      targets, standard-library modules, limits, security model, prerequisites,
      non-goals, and known incompatibilities.
- [x] Resolve bare package imports and package declarations so documented Hono
      applications do not require long `--alias`/`--api` command lines.
- [ ] Define built-in module resolution for `tinytsx:env`, `tinytsx:fs`,
      `tinytsx:sqlite`, and `tinytsx:actors`; built-ins must not be resolved from
      `node_modules` or shadowed by application packages.
- [ ] Add stable diagnostic codes for unavailable built-ins, missing native
      capabilities, denied paths, exceeded limits, and unsupported actor or
      SQLite operations.
- [ ] Decide and document the alpha compatibility policy: additive APIs are
      allowed between alpha releases; breaking changes require release notes and
      an alpha-version increment.

### A1 — Broaden the executable Hono matrix

- [x] Add a machine-readable example matrix recording source provenance,
      required imports/APIs, intake status, native compile status, HTTP behavior
      coverage, Bun/reference coverage, and the first unsupported boundary.
- [ ] Keep the complete pinned `basic` and `jsx-ssr` applications as mandatory
      release gates on every supported native target.
- [ ] Compile and execute the pinned upstream `serve-static` landing application,
      then extend it with `tinytsx:fs` using the pinned assets as the file API
      tracer.
- [ ] Use the pinned upstream `blog` routes and behavior as the CRUD contract for
      a Hono + `tinytsx:sqlite` example. Clearly distinguish any TinyTSX binding
      adapter from unchanged upstream source.
- [ ] Close the minimum portable dependencies exposed by that blog tracer:
      bounded JSON request bodies, closed-shape JSON parsing, CORS middleware,
      `crypto.randomUUID()`, and environment-backed Hono bindings.
- [ ] Use the pinned upstream `durable-objects` counter behavior as the contract
      for a Hono + `tinytsx:actors` counter example. Do not claim Cloudflare API
      compatibility unless the upstream source itself runs unchanged.
- [ ] Add at least one multi-module user-auth/configuration example covering
      environment input, middleware, error handling, and persistent state without
      network credentials in the automated suite.
- [ ] For every alpha example, build a native server, exercise success and error
      HTTP paths, compare portable behavior with Bun or another declared
      reference, and assemble the Linux-arm64 output in cross-host tests.
- [ ] Resolve the known Hono response-clone Content-Type difference with direct
      Web-platform evidence and pin the decision in every affected contract.
- [x] Replace the open-ended “broader Hono tests” task with an explicit allowlist
      of upstream Hono behavior files exercised by the alpha matrix.

### A2 — Define the TinyTSX backend standard library

- [ ] Add `doc/STANDARD_LIBRARY.md` defining built-in-module versioning,
      capability permissions, error types, blocking rules, resource ownership,
      bounds, target support, and the distinction from Web-standard APIs.
- [ ] Keep built-in declarations in the shipped SDK and implementations in
      focused zero-JavaScript native runtime modules. Applications must not need
      npm packages to use them.
- [ ] Add `tinytsx --list-builtins` or equivalent machine-readable capability
      output, including target availability and compiled limits.
- [ ] Define a common disposable-resource contract (`close`/`dispose`) for file,
      SQLite, and actor handles without requiring a general garbage collector.
- [ ] Define how potentially blocking filesystem and database work uses the
      application executor rather than blocking an HTTP executor.
- [ ] Record candidates for post-alpha OS modules (path utilities, signals,
      subprocesses, sockets) without adding them to the alpha gate.

### A3 — Add environment input and bounded file reading

- [ ] Specify and declare read-only `tinytsx:env` access with explicit
      `--allow-env <name>` capabilities, missing-value behavior, UTF-8 rules,
      maximum value length, and immutable startup snapshots.
- [ ] Connect permitted environment values to typed Hono bindings and cover
      missing/denied configuration without exposing the entire host environment.

- [ ] Specify and declare `tinytsx:fs` with an alpha-minimum text-file read API;
      reserve binary buffers, directory mutation, watching, and writes for later
      unless an alpha example proves they are required.
- [ ] Add explicit `--allow-read <root>` capabilities. Default-deny request-time
      filesystem access, canonicalize paths before permission checks, and keep
      environment and filesystem capabilities separate.
- [ ] Define deterministic behavior for missing files, directories, invalid
      UTF-8, symlinks, traversal attempts, permission denial, and concurrent
      replacement.
- [ ] Enforce configurable maximum path and file sizes, copy results into a
      documented ownership domain, and return recoverable errors on overflow.
- [ ] Add native unit tests, permission/security tests, request-time Hono tests,
      and Apple/Linux target coverage.
- [ ] Run the Hono static-file tracer through the public built-in rather than a
      test-only runtime intrinsic.

### A4 — Add bounded SQLite persistence

- [ ] Pin a SQLite revision and choose a reproducible linking policy. Prefer a
      vendored/static alpha artifact with license and provenance records so
      applications do not depend on an undeclared host SQLite installation.
- [ ] Specify and declare `tinytsx:sqlite` with database open/close, prepared
      statements, positional binding, bounded query rows, execute results, and
      explicit transactions.
- [ ] Define the alpha value mapping for `null`, integer, finite number, text,
      and blob; reject unsupported dynamic values at compile time.
- [ ] Make each connection single-owner and serialize its operations through a
      logical worker/actor mailbox instead of sharing a native handle across HTTP
      executors.
- [ ] Require an explicit filesystem capability for on-disk databases and offer
      `:memory:` for deterministic tests.
- [ ] Bound SQL length, parameter count, row count, row bytes, open statements,
      busy timeout, and queued operations; surface typed recoverable failures.
- [ ] Prove schema creation, insert/select/update/delete, rollback, contention,
      malformed SQL, limit recovery, shutdown, and restart persistence.
- [ ] Run the Hono blog tracer end to end against the public SQLite built-in.

### A5 — Promote logical workers into lightweight actors

- [ ] Add `doc/ACTORS.md` defining actor identity, state ownership, mailbox
      ordering, ask/reply, tell, stop, failure, restart, supervision boundary,
      fairness, and shutdown. State explicitly that actors are local and are not
      one operating-system thread each.
- [ ] Specify and declare `tinytsx:actors` around compile-time-known actor
      behaviors and typed `ActorRef` handles. The alpha API must provide bounded
      `ask`, bounded fire-and-forget `tell`, and idempotent `stop`.
- [ ] Reuse the existing fixed application executor and logical-worker mailbox;
      spawning or stopping an actor must not create or destroy a native thread.
- [ ] Extend message copying from strings to an explicit structured subset of
      primitives, closed records, and bounded arrays. Preserve isolation and
      reject unsupported identity/transfer semantics.
- [ ] Define actor-local state storage without a managed heap; reject state that
      escapes the supported worker arena/lifetime contract.
- [ ] Add deterministic mailbox-full, stopped, handler-failure, timeout, and
      caller-cancellation behavior. Automatic restart/supervision is optional for
      the first alpha but its absence must be explicit.
- [ ] Measure 1,000 and 10,000 idle/local actors, publish bytes per actor and
      thread count, then set a documented practical limit from evidence.
- [ ] Prove per-actor FIFO ordering, parallelism across actors, fairness under a
      hot mailbox, isolation, stop/drain behavior, panic recovery, and no native
      thread growth proportional to actor count.
- [ ] Run the Hono counter tracer through the public actor API and persist one
      actor variant through `tinytsx:sqlite`.

### A6 — Make the alpha release installable

- [ ] Remove compile-time source-checkout discovery from the released compiler.
      Define an installed resource layout for frontend JavaScript, TypeScript,
      SDK declarations, runtime link inputs, licenses, and built-in metadata.
- [ ] Decide whether alpha bundles the frontend/runtime assets or declares Node,
      TypeScript, Rust, Clang, libcurl, and SQLite as prerequisites. A release
      must fail with actionable diagnostics when a declared prerequisite is
      missing.
- [ ] Add `tinytsx --version` and report compiler version, HIR version, target,
      runtime ABI version, built-ins, and pinned compatibility revisions.
- [ ] Set the workspace/package version to `0.1.0-alpha.1`, add a changelog and
      third-party notices, and ensure generated reports carry the same version.
- [ ] Add a reproducible `release:verify` command that starts from a clean tree,
      builds release artifacts, runs the alpha example matrix, checks reports,
      and fails on uncommitted generated changes.
- [ ] Produce installable Apple-arm64 and Linux-arm64 archives with checksums and
      an explicit artifact manifest. Verify each archive from a clean directory,
      outside the repository checkout.
- [ ] Add native Apple-arm64 and Linux-arm64 CI/release jobs. Cross-assembled ELF
      evidence does not replace executing the Linux archive on Linux.
- [ ] Verify startup, graceful shutdown, malformed input recovery, request OOM,
      worker/actor saturation, filesystem denial, SQLite contention, and clean
      resource disposal in release builds.
- [ ] Publish one short getting-started path that installs the archive, builds a
      Hono application using files/SQLite/actors, and exercises it with `curl`.

## Alpha exit gate

Do not tag `0.1.0-alpha.1` until all of these are true:

- [ ] Every A0–A6 item is complete or explicitly moved to post-alpha with the
      alpha contract adjusted so no documented feature depends on it.
- [ ] The complete Rust, frontend, Hono, Test262 allowlist, WPT allowlist, native
      API, benchmark-harness, and alpha example suites pass from a clean tree.
- [ ] Apple and Linux archives install and execute outside the checkout, and
      their checksums, version output, build reports, and HTTP contracts match
      the release manifest.
- [ ] The published compatibility matrix contains no unqualified “supports
      Hono/TypeScript/Web APIs” claim and links every supported row to executable
      evidence.
- [ ] Security/resource limits and known issues for files, SQLite, actors,
      network transport, and request memory are documented and tested.
- [ ] A repeated release benchmark records startup, idle/warm RSS, throughput,
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
