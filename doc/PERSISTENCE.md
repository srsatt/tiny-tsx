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

The `native-partial` public slice lowers a compile-time `:memory:` `Database`,
closed `exec(sql)` effects, prepared `run()`/`all()`/`get()` calls, bounded JSON
row encoding, and idempotent `close`/`dispose`. A prepared call accepts at most
16 selected values from named route parameters and a closed request JSON
object. Parameters use SQLite binding rather than SQL interpolation.

On-disk owners accept one static normalized relative path. Compilation requires
exactly one canonical root present in both `--allow-read` and `--allow-write`,
resolves the database path below that root, and embeds only the resolved path in
the generated configuration. The bootstrap opens that path on the owning
application worker. Build reports record the canonical read and write roots.
The persistent Hono tracer writes a row, terminates the native process, starts
the same binary again, and requires the row to remain; its Linux-arm64 output
also passes Clang assembly.

This is the first disk-capability slice, not the final filesystem security
contract. Static path normalization prevents absolute, empty, dot, and parent
segments, but runtime protection against symlink replacement and SQLite
sidecar-file path races remains open. Prepared/dynamic transaction callbacks,
HTTP-level contention load and symlink hardening remain the next persistence
gate. The native SQLite core holds a competing writer through the one-second
busy timeout, observes a recoverable error, releases the lock, and proves the
second connection can write successfully afterward.

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

Before promotion to `native`, the compiler must expose typed execute results and
the remaining value families needed by public callers; prepared transaction
forms and HTTP contention evidence remain open. Bounded
wildcard-origin CORS, Content-Type preflight, and OS-random version-4 IDs bound
as prepared values are native. The adapter also maps its typed Hono blog-name
binding to a permitted immutable startup value. The pinned upstream 404/204
envelopes now match through the in-memory adapter.

The bounded counter actor can reference a compile-time database owner and key.
Its private state table loads or creates the initial `i64` during actor startup,
and each message persists the checked next value before updating actor memory.
Native restart evidence proves 0 -> 2 in the first process and 2 -> 3 after
restart; this is counter-specific persistence, not a general actor object store.
