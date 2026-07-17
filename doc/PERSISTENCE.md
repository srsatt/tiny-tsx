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
encoding, and idempotent `close`/`dispose`. Effect calls return `Promise<void>`;
typed changes/row-id objects are post-alpha. A prepared call accepts at most 16
selected values from named route parameters, UUID generation, a closed request
JSON object, or compile-time string, safe-integer, finite-real, boolean, and
null literals. Parameters use SQLite binding rather than SQL interpolation.

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
cases behind an OS sandbox or dedicated service account. Prepared/dynamic
transaction callbacks and HTTP-level contention load are also post-alpha. The
native SQLite core holds a competing writer through the one-second busy timeout,
observes a recoverable error, releases the lock, and proves the second
connection can write successfully afterward.

`Database.transaction(sql)` is the first explicit transaction surface. It
accepts one compile-time SQL batch up to 65,536 bytes and sends the complete
batch as one database-worker message. The runtime begins a transaction, commits
only after the batch succeeds, and relies on transaction drop for rollback on
error. Core and native Hono tests prove complete rollback and subsequent
connection reuse. Prepared parameters and callback transactions are not yet
part of this surface.

The HTTP transport retains at most 64 KiB of request body. `HonoRequest.json()`
is not exposed as a general dynamic JavaScript object: the compiler records
only statically selected fields and the bootstrap parses those fields at the
SQLite ABI boundary. JSON null, signed integer, finite number, and string map to
SQLite values. A missing field, malformed JSON, boolean, array, nested object,
or unsupported value returns HTTP 400; an oversized body returns HTTP 413.

Each connection is owned by one logical application worker on the fixed
executor. The Hono owner tracer now proves schema creation, create/list/get/
update/delete, mixed body/route binding, malformed and oversized bodies,
constraint and malformed-SQL recovery, repeated close, post-close failure,
Apple execution, and Linux-arm64 assembly. A Bun/Hono plus `bun:sqlite`
reference test pins the same portable CRUD response contract.

The manifest classifies this bounded surface as `native`. The multi-module
user-auth tracer additionally proves a closed string parameter written to an
on-disk database and observed after process restart. Typed execute results,
additional caller-provided dynamic values, prepared/callback transaction forms,
and HTTP contention load remain post-alpha. Bounded wildcard-origin CORS,
Content-Type preflight, and OS-random version-4 IDs bound as prepared values are
native. The adapter also maps its typed Hono blog-name binding to a permitted
immutable startup value. The pinned upstream 404/204 envelopes match through
the in-memory adapter.

The bounded counter actor can reference a compile-time database owner and key.
Its private state table loads or creates the initial `i64` during actor startup,
and each message persists the checked next value before updating actor memory.
Native restart evidence proves 0 -> 2 in the first process and 2 -> 3 after
restart; this is counter-specific persistence, not a general actor object store.
