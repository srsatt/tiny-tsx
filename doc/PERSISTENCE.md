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

The first `native-partial` public slice lowers a compile-time `:memory:`
`Database`, closed `exec(sql)` effects, and idempotent `close`/`dispose`. Each
connection is owned by one logical application worker on the fixed executor.
The Hono owner tracer proves schema creation, persistent mutation, constraint
failure recovery, repeated close, post-close failure, Apple execution, and
Linux-arm64 assembly.

Before promotion to `native`, the compiler must lower prepared statements and
result values; on-disk paths must use separate read/write capabilities;
transactions need native tests; and the Hono blog plus persistent actor tracers
must pass end to end.
