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

This foundation is not yet the public `tinytsx:sqlite` implementation. Before
promotion, each connection must be owned by one logical application worker; the
compiler must lower the declared database/statement API; on-disk paths must use
separate read/write capabilities; transactions and close semantics need native
tests; and the Hono blog plus persistent actor tracers must pass end to end.
