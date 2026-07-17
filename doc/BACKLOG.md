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
callback transactions and the explicitly documented OS-sandbox boundaries
remain open.

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

The current stabilization pass has landed the complete native Test262
allowlist, the multi-module Hono user-auth tracer, copied structured actor
messages, protected SQLite ownership, actor pressure evidence, and bounded live
HTTP-connection resubmission. The bounded Hono Body Limit tracer has also
landed. Their implementation and evidence are recorded under P1-P4. No next
implementation slice is selected in this backlog; select one explicitly before
implementation begins.

Do not reopen the completed alpha foundations as broad projects. File reading,
SQLite, and local actors already have public bounded built-ins. Their next work
is API depth and real-application evidence, not a second standard-library
design. Likewise, a new Hono row promotes only the behavior exercised by its
named upstream tracer.

The groomed candidates, in recommended dependency order, are:

1. **One further upstream Hono tracer:** choose one
   exact example or behavior file from the pinned tree and promote only its
   first unsupported language, Web API, or built-in boundary. Prefer a tracer
   that extends the user-auth application rather than an isolated synthetic
   feature.
2. **SQLite result depth:** add typed execute results and only the dynamic value
   forms required by the selected application while retaining single-owner,
   non-interleaving execution.
3. **Actor lifecycle depth:** specify disconnect cancellation, restart, and
   supervision separately; do not bundle distributed actors, snapshots, or a
   managed heap into the local lifecycle goal.
4. **Release-stability evidence:** finish the named P4 workload families and a
   longer controlled TinyTSX/Bun run only after the selected functional slice
   is green. A new release candidate remains a separate explicitly selected
   goal.

Before implementation, the selected goal must be copied into the active goal
with: its exact tracer/source revision; admitted and rejected boundaries; Apple
execution and Linux-arm64 evidence; failure, saturation, and disposal tests as
applicable; manifest/declaration/package changes; and documentation updates.
General JavaScript object identity, blanket Hono compatibility, distributed
actors, production GC, and a new release tag remain out of scope unless
explicitly promoted into a later goal.

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
    and an async-function Promise brand. All fourteen allowlisted cases now run
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
- [ ] Implement bounded native `Map`, constant `symbol`, signed zero, `NaN`, and
      infinities with complete semantics evidence.
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
- [ ] Add optional/multi-segment route parameters, general constraints,
      non-terminal catch-alls, and broader request-dependent handlers.
  - 2026-07-17: one or more contiguous trailing `:name?` parameters now expand
    into a finite native route set. Present values use the borrowed path segment;
    absent values remain staged `undefined`. The pinned terminal
    `:remaining{.*}` shape also captures an empty or slash-containing tail and
    writes it with bounded percent decoding on Apple and Linux arm64.
    Non-trailing optionals, non-terminal catch-alls, and general constraints
    remain open.
- [ ] Add invalid UTF-8 replacement semantics with upstream parser evidence.
- [ ] Add request-dependent stream chunks, sleep, cancellation, backpressure,
      and disconnect propagation.
- [ ] Continue expanding the explicit upstream Hono behavior allowlist and
      example matrix; never replace it with a blanket compatibility claim.

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
    later successful message, and cross-actor parallelism. Deadlines/timeouts,
    restart policy, and supervision remain open.
  - 2026-07-17: `ask(message, {timeoutMs})` now accepts a static 1–60,000 ms
    deadline across the SDK, HIR, Apple/Linux code generation, and runtime. A
    deterministic blocked-handler test proves timeout detaches the waiter
    without retracting the accepted FIFO message; the public Hono tracer proves
    a successful bounded ask. Automatic HTTP-disconnect cancellation, restart
    policy, and supervision remain open.
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
    route/JSON/UUID values. Dynamic values, result objects, and callback
    transactions remain open.
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
    aggregate CPU, Unix-syscall, and context-switch pressure. The other named
    workload families and longer sustained profiles remain open.
- [x] Add CPU, syscall, allocation, peak-RSS, and first-launch instrumentation.
  - 2026-07-17: the macOS harness samples whole-process CPU time, Unix/Mach
    syscalls, context switches, faults, threads, open-file-descriptor
    start/peak/end counts, and peak RSS during warm-up and load, and reports the
    first fresh-process launch separately from the startup median. TinyTSX
    allocator counters are a benchmark-only opt-in Cargo feature because their
    atomics change the measured path; ordinary comparisons and production
    binaries do not include them, and no Bun allocation ratio is claimed.
- [ ] Run controlled longer-duration comparisons before publishing performance
      claims and optimize only from profiles.
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
