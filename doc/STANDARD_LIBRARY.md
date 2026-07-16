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
reserved; only a manifest status of `native` means the implementation is an
alpha release feature. `declared` operations must fail compilation with a stable
diagnostic until promoted.

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

### `tinytsx:sqlite`

Single-owner database and prepared-statement handles with positional values,
bounded rows, execute results, explicit close/dispose, and transactions before
promotion to `native`. `:memory:` is capability-free; disk databases require
read and write roots.

### `tinytsx:actors`

Compile-time-known behavior, bounded structured messages, `ask`, non-blocking
bounded `tell`, and idempotent `stop`/`dispose` on the fixed application pool.
Actors are local logical workers, not one native thread each.

Post-alpha candidates are path utilities, signals, subprocesses, raw sockets,
binary filesystem APIs, remote actors, and actor supervision trees.
