# SQLite persistence

TinyTSX uses a focused native runtime crate for its SQLite built-in. The alpha
link policy is vendored and static: `rusqlite` 0.40.1 with its `bundled` feature
pins `libsqlite3-sys` 0.38.1 and the SQLite 3.53.2 amalgamation in `Cargo.lock`.
This avoids an undeclared host SQLite installation. `rusqlite` is MIT licensed;
the SQLite amalgamation is public domain.

The runtime core currently owns the following release bounds:

- SQL text: 65,536 UTF-8 bytes;
- positional parameters: 64;
- returned rows: 1,024;
- returned column data: 1 MiB;
- busy timeout: one second;
- values: null, signed 64-bit integer, finite `f64`, UTF-8 text, and bytes.

Prepared parameters are passed through SQLite rather than interpolated into SQL.
Malformed SQL, non-finite numbers, and every size limit are recoverable typed
runtime errors, and a failed operation does not poison the connection. The core
unit suite covers prepared insertion, all value families, bounded queries,
malformed SQL recovery, and row/byte/parameter limits.

The native alpha public slice lowers a compile-time `:memory:` or
capability-scoped on-disk `Database`, closed `exec(sql)` effects, prepared
`run()`/`all()`/`get()` calls, static-SQL transactions, bounded JSON row
encoding, one bounded prepared-write callback transaction, and idempotent
`close`/`dispose`. `exec()` and both `transaction()` forms return
`Promise<void>`; `Statement.run()` returns an immutable `RunResult` with a
numeric `changes` count and `lastInsertRowId: string | null`. The decimal string
preserves the complete signed SQLite `i64` domain rather than rounding through
a JavaScript number. A run with zero changed rows reports `null`; otherwise the
field contains SQLite's connection-local last-insert row ID. A prepared call
accepts at most 16 selected values from named route parameters, UUID generation,
a bounded static primitive path in a closed request JSON object, a required
statically named request header, or compile-time string, safe-integer,
finite-real, boolean, and null literals.
Parameters use SQLite binding rather than SQL interpolation.

Each handler is limited to 16 SQLite actions and therefore 16 stable result
slots. A `run()` action sends its slot through the serialized owner request;
the owner reply carries the changes count and optional signed row ID, and the
bootstrap copies them into a fixed writer-owned array. Response lowering may
read only the result produced by that exact action. Ignored results still occupy
their deterministic slot, and no runtime record allocation or managed heap is
introduced.

On-disk owners accept one static normalized relative path. Compilation requires
exactly one canonical root present in both `--allow-read` and `--allow-write`,
resolves the database path below that root, and embeds only the resolved path in
the generated configuration. The bootstrap opens that path on the owning
application worker. Build reports record the canonical read and write roots.
The persistent Hono tracer writes a row, terminates the native process, starts
the same binary again, and requires the row to remain; its Linux-arm64 output
also passes Clang assembly.

Static path normalization prevents absolute, empty, dot, and parent segments.
Runtime disk opens enforce a service-owned Unix path contract before and after
SQLite opens the connection: every component must be a real directory; the
final database directory must be owned by the effective service user and must
not be group/other writable; a writable ancestor is accepted only when it is
sticky and its next component is service-owned. A missing main database is
precreated atomically with `O_NOFOLLOW`, `O_EXCL`, and mode `0600`. Existing
main, rollback-journal, WAL, and SHM names must be service-owned, single-link
regular files without group/other write permission.

The pinned SQLite Unix VFS independently uses `O_NOFOLLOW` for main, journal,
WAL, and SHM opens, while the public connection retains
`SQLITE_OPEN_NOFOLLOW` path-component checking. Native regressions reject a
symlinked database, intermediate directory, and every sidecar name, reject a
hard-linked sidecar and an unsafe shared directory, preserve the sidecar target,
and verify private file creation. Together with the directory ownership rule,
another Unix identity cannot replace an authorized path or pre-place a sidecar
during the process lifetime.

This is still an application capability boundary, not an OS sandbox against
code running as the same effective user. Roots writable through unusual ACLs,
mount changes, privileged attackers, network filesystems with weaker Unix
semantics, and out-of-process same-UID mutation are unsupported; deploy those
cases behind an OS sandbox or dedicated service account. General dynamic
transaction callbacks remain post-alpha. Sustained HTTP tracers now cover one
in-memory owner with fixed-key transaction work and two independent owners of a
protected on-disk WAL file. The native SQLite core holds a competing writer
through the one-second busy timeout,
observes a recoverable error, releases the lock, and proves the second
connection can write successfully afterward.

`Database.transaction(sql)` is the first explicit transaction surface. It
accepts one compile-time SQL batch up to 65,536 bytes and sends the complete
batch as one database-worker message. The runtime begins a transaction, commits
only after the batch succeeds, and relies on transaction drop for rollback on
error. Core and native Hono tests prove complete rollback and subsequent
connection reuse. Prepared parameters and callback transactions are not yet
part of the static batch surface.

`Database.transaction(async () => {...})` adds one exact prepared-write form.
The zero-argument callback block contains 1–16 awaited `Statement.run(...)`
expression statements from the receiving database. Its aggregate SQL text is
limited to 65,536 bytes and its aggregate parameter count to 64. The generated
ABI describes every SQL/parameter view in one call; the bootstrap copies and
decodes all steps before posting one database-owner message. The owner opens one
SQLite transaction, executes the prepared steps in order, and commits only
after all succeed. Dropping the transaction after any error rolls every step
back, and no other request can interleave on that connection.

The project-owned Hono tracer commits an item and audit row from route and JSON
values. Its failure path makes the audit insert violate a unique constraint and
proves the earlier item insert is absent, then executes another successful
transaction to prove connection reuse. The core unit test pins commit and
rollback, Apple arm64 executes the HTTP behavior, and Linux arm64 assembles the
same transaction-step ABI. Callback arguments or returned values, query steps,
visible per-step results, `Database.exec` steps, branches or loops, nesting,
mixed databases, and an interactive transaction object are not admitted.

A separate idempotency tracer binds `context.req.header("Idempotency-Key")!`
as SQLite `TEXT` in both prepared writes and the callback transaction. The
generated descriptor carries only the static header name. During dispatch the
bootstrap requires a present 1–256-byte valid UTF-8 value, copies it into an
owned `String`, and only then posts the database-owner message, so request-head
disposal cannot invalidate queued work. Missing, empty, oversized, or invalid
UTF-8 values return 400; a dynamic or invalid header name rejects at compile
time. Apple HTTP also proves 32 concurrent distinct values, second-step rollback,
and later reuse; Linux assembly and a Bun/Hono `bun:sqlite` reference pin the
same external contract. Optional/fallback headers, query/cookie/environment
values, structured values, and arbitrary runtime expressions remain outside
this slice.

The focused performance tracer repeats two fixed-key idempotent prepared writes
as one callback transaction, then copies and JSON-encodes one non-empty prepared
row. Apple and Linux native gates pin the exact source, and the sustained
TinyTSX/Bun matrix retains startup, RSS, throughput, latency, process counters,
and descriptor recovery. This earlier tracer is single-owner in-memory HTTP pressure, not evidence for
disk/WAL behavior, competing SQLite connections, rollback frequency, growing
tables, request-derived values, or primitive-operation parity.

The WAL tracer constructs two static `Database("wal-load.db")` values, which
become independent logical owners and native connections to the same
capability-scoped file. Setup selects WAL mode, `synchronous=FULL`, a 1,000 ms
busy timeout, and a 1,000-page automatic checkpoint. Every successful request
opens an outer transaction, increments a probe inside a savepoint, rolls that
increment back, then commits a separate progress increment. Native and benchmark
checks require the progress counter to advance, the probe to remain exactly
zero, journal mode to remain `wal`, and the live database, WAL, and SHM files to
be non-empty. The native gate also proves restart persistence, an externally
held writer timing out, and successful reuse after the lock is released.

The clean three-by-15-second comparison alternates both owners against two Bun
Workers owning equivalent `bun:sqlite` connections. TinyTSX reaches 1.14x Bun
throughput at concurrency 8 and 0.58x at 64, but its concurrency-64 p99 rises to
108.839 ms versus 13.504 ms. This is evidence for two-connection WAL contention
and successful savepoint rollback, not failed full-transaction rollback load,
cross-process writers, crash/power-loss durability, network filesystems,
disabled automatic checkpoints, growing tables, or request-derived values.

The adjacent full-rollback tracer uses one protected on-disk WAL owner and a
fixed POST containing a required idempotency header, route value, and JSON
integer. Its first callback step inserts a payment and its second violates a
pinned audit-key uniqueness constraint. Every declared 500 must leave the
payment absent. After warm-up and each measured interval, the harness commits a
separate recovery transaction on the same owner, requires its counter to
advance, and checks WAL mode plus non-empty DB/WAL/SHM files. All 12 load samples
and 18 state/file checkpoints pass. TinyTSX reaches 605/4,545 requests per
second at concurrency 8/64 versus Bun at 71,849/73,923, with 8.05 MiB versus
75.81 MiB warm RSS. This intentionally exposes a severe failed-transaction
throughput gap; it does not measure application conflict handling, growing
data, competing or cross-process writers, cancellation, arbitrary callbacks,
crash durability, or network filesystems.

The HTTP transport retains at most 64 KiB of request body. `HonoRequest.json()`
is not exposed as a general dynamic JavaScript object: the compiler records
only statically selected primitive paths and the bootstrap traverses them at
the response or SQLite ABI boundary. One canonical encoded path is shared by
both lowerings. It contains one through four non-empty UTF-8 segments, each at
most 128 bytes, uses at most 512 bytes, and participates in a 16-distinct-leaf
handler limit. JSON null, signed integer, finite number, string, and boolean map
to SQLite values; booleans bind as integers. Selected strings are capped at 4
KiB. A missing leaf, malformed JSON, non-object intermediate, selected
array/object, or exceeded bound returns HTTP 400; an oversized body returns
HTTP 413.

The packaged nested-profile tracer uses one in-memory owner with `users` and
`preferences` tables. Its callback transaction inserts the route ID plus
nested name/score and theme/alerts leaves as one non-interleaving owner message.
A duplicate unique theme fails the second step and leaves no user row; a later
distinct request commits, and `GET /profiles/:id` proves committed and missing
state. Apple native HTTP, Linux-arm64 assembly, Bun/Hono with `bun:sqlite`, the
Hono manifest, and the installed archive gate the same external contract. This
promotes nested primitive bindings, not JSON columns, structured SQLite values,
arbitrary transaction callbacks, or a dynamic object heap.

Each connection is owned by one logical application worker on the fixed
executor. The Hono owner tracer now proves schema creation, create/list/get/
update/delete, mixed body/route binding, malformed and oversized bodies,
constraint and malformed-SQL recovery, repeated close, post-close failure,
Apple execution, and Linux-arm64 assembly. A Bun/Hono plus `bun:sqlite`
reference test pins the same portable CRUD response contract.

The manifest classifies this bounded surface as `native`. The multi-module
user-auth tracer additionally proves a closed string parameter written to an
on-disk database and observed after process restart. It now also returns both
fields from an inserted row and proves a zero-change update yields
`lastInsertRowId: null`. Additional caller-provided value families, broader
callback transaction forms, arbitrary result-object operations, and disk or
multi-connection contention shapes remain post-alpha. Bounded wildcard-origin CORS,
Content-Type preflight, and OS-random version-4 IDs bound as prepared values are
native. The adapter also maps its typed Hono blog-name binding to a permitted
immutable startup value. The pinned upstream 404/204 envelopes match through
the in-memory adapter.

The bounded counter actor can reference a compile-time database owner and key.
Its private state table loads or creates the initial `i64` during actor startup,
and each message persists the checked next value before updating actor memory.
Native restart evidence proves 0 -> 2 in the first process and 2 -> 3 after
restart; this is counter-specific persistence, not a general actor object store.
