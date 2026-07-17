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
the remaining value families needed by public callers; on-disk paths must use
separate read/write capabilities; transactions need native tests; and the exact
Hono blog adapter plus persistent actor tracers must pass end to end. Bounded
wildcard-origin CORS and Content-Type preflight are native; UUIDs,
environment-backed bindings, and upstream 404/204 envelopes remain blog parity
work rather than claims of this local CRUD tracer.
