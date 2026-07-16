# TinyTSX backend standard library

The backend standard library is a set of protected compiler built-ins. It is
not part of the Web platform and does not imply Node, Deno, or Bun API
compatibility. Application packages and aliases cannot shadow a `tinytsx:`
specifier. Run `tinytsx --list-builtins` for the machine-readable status,
targets, permissions, and compiled default limits.

## Versioning and availability

Built-in APIs follow the compiler alpha version. Additive changes may ship in a
later alpha. Breaking source or behavior changes require release notes and an
alpha-version increment. A declaration in the SDK means the source contract is
reserved; only a manifest status of `native` means the complete documented
alpha module is a release feature. `native-partial` names an executable tracer
whose remaining operations are still release gates. `declared` operations must
fail compilation with a stable diagnostic until promoted.

Apple arm64 and Linux arm64 are the only native alpha targets. Cross-host Linux
assembly inspection is evidence for code generation, not runtime availability.

## Capabilities and errors

Environment, filesystem, and on-disk database access are default-deny. They use
separate allowlists so granting one capability never implies another:

- `--allow-env <name>` permits one immutable startup environment value;
- `--allow-read <root>` permits reads below one canonical filesystem root;
- `--allow-write <root>` separately permits an on-disk SQLite database to
  mutate files below one canonical root.

Capability checks use canonical paths and occur before I/O. Symlink and `..`
traversal cannot escape an allowed root. Missing resources, invalid UTF-8,
permission denial, capacity overflow, busy databases, full mailboxes, stopped
actors, and closed handles are recoverable typed errors. The compiler reserves
`TINY1500`–`TINY1599` for built-in availability/capability diagnostics and the
runtime reserves stable error categories rather than host errno text.

## Resource and blocking contract

SQLite statements/databases and actor references are single-owner disposable
resources. `close()` or `stop()` performs the domain action; `dispose()` is an
idempotent common spelling suitable for structured cleanup. Use after disposal
is a recoverable error. Alpha does not depend on finalizers or a general garbage
collector.

Filesystem and SQLite calls never block an HTTP executor. They are dispatched
to the fixed application executor. SQLite connections are serialized through a
logical mailbox and are never shared concurrently across native threads. Actor
spawn/stop does not create or destroy an operating-system thread.

All inputs and outputs are bounded. Compiled defaults are published by
`--list-builtins`; CLI limits may lower them but may not silently exceed the
release maximum. Results are copied into the documented request, message, or
owner arena and cannot outlive that domain.

## Alpha modules

### `tinytsx:env`

Read-only `get(name)` and `require(name)` over permitted immutable startup
values. Names must be compile-time-known, portable ASCII identifiers of at most
128 bytes, and individually granted with `--allow-env <name>`. At most 64 names
may be granted or referenced by one program.

The runtime snapshots only referenced, permitted names before opening the HTTP
listener. It never enumerates or exposes the rest of the host environment.
Values must be UTF-8 and at most 4096 bytes. `get()` returns `undefined` for a
missing value and supports a closed `??` string fallback; `require()` turns a
missing value into a recoverable internal response error. Invalid UTF-8 and
oversized values use the same bounded error path. The snapshot cannot change
during the process lifetime.

### `tinytsx:fs`

Bounded UTF-8 `readTextFile(path, options)` only. Binary buffers, writes,
directory mutation, watching, and ambient current-directory access are outside
the initial contract.

Each call uses a compile-time-known normalized relative path: no absolute,
empty, `.`, or `..` segments are accepted, and the UTF-8 path is limited to
4096 bytes. At least one existing directory must be granted with
`--allow-read <root>`; roots are canonicalized during compilation and again at
startup, sorted, deduplicated, limited to 16, and embedded in the native
artifact. A request resolves the relative path under those roots in order and
rejects a canonical target outside the selected root, including a symlink
escape.

`maxBytes` is a positive compile-time integer capped at 1 MiB and defaults to
that cap. The application executor opens the canonical regular file, reads at
most `maxBytes + 1`, validates UTF-8, then returns owned bytes that the HTTP
executor copies into its request arena. Missing paths, directories, invalid
UTF-8, permission failures, traversal, and overflow return a bounded internal
response error without terminating the server. Each call canonicalizes and
opens anew, so a completed read owns one coherent result while a later call may
observe an atomic file replacement.

### `tinytsx:sqlite`

The current `native-partial` slice is a single-owner `:memory:` database with
closed `exec(sql)` effects and idempotent `close`/`dispose`, serialized through
one logical application worker. SQL is capped at 65,536 bytes and uses the
vendored runtime described in `doc/PERSISTENCE.md`. Prepared statements,
positional values, bounded returned rows, execute-result values, transactions,
and on-disk read/write capabilities remain required before promotion to
`native`.

### `tinytsx:actors`

The native alpha slice is the compile-time-known signed-integer counter
documented in `doc/ACTORS.md`. It provides typed `ask`, bounded fire-and-forget
`tell`, and idempotent `stop`/`dispose` on the fixed application pool. Each
actor owns one native `i64`, returns decimal text, and has a compile-time mailbox
capacity from 1 through 64. Actors are local logical workers, not one native
thread each. Structured messages, arbitrary behaviors, supervision, and
persistence are not yet native.

Post-alpha candidates are path utilities, signals, subprocesses, raw sockets,
binary filesystem APIs, remote actors, and actor supervision trees.
