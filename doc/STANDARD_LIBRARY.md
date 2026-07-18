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

All five modules reported by the `0.1.0-alpha.1` release manifest are `native`
for their bounded contracts below. That status does not promote operations that
are absent from those contracts.

Apple arm64 and Linux arm64 are the only native alpha targets. Cross-host Linux
assembly inspection is evidence for code generation, not runtime availability.

## Capabilities and errors

Environment, filesystem, and on-disk database access are default-deny. They use
separate allowlists so granting one capability never implies another:

- `--allow-env <name>` permits one immutable startup environment value;
- `--allow-read <root>` permits reads below one canonical filesystem root;
- `--allow-write <root>` separately permits the bounded on-disk SQLite owner to
  mutate files below one canonical root and must currently match its read root.

File-read capability checks canonicalize again before I/O, so symlink and `..`
traversal cannot escape an allowed read root. SQLite paths reject lexical
traversal. Runtime database opens additionally require a service-owned,
non-group/other-writable final directory; securely precreate a missing database;
and reject symlinked, hard-linked, or unsafe main, journal, WAL, and SHM names.
The pinned SQLite VFS also opens those names with no-follow semantics. Same-UID
mutation, unusual ACLs, mount changes, and filesystems without ordinary Unix ownership
semantics remain OS-sandbox boundaries described in `doc/PERSISTENCE.md`. Missing
resources, invalid UTF-8, permission denial, capacity overflow, busy databases,
full mailboxes, stopped actors, and closed handles are recoverable typed errors.
The compiler reserves `TINY1500`–`TINY1599` for built-in diagnostics:

- `TINY1500`: built-in unavailable on the selected native target;
- `TINY1501`: missing environment capability;
- `TINY1502`: missing or invalid filesystem read capability;
- `TINY1504`: invalid static environment/filesystem input or exceeded limit;
- `TINY1510`: invalid static SQLite path;
- `TINY1511`: missing or invalid SQLite write capability;
- `TINY1512`: unsupported SQLite operation, argument shape, or exceeded limit;
- `TINY1520`: unsupported actor spawn behavior, persistence, or capacity;
- `TINY1521`: unsupported actor-reference operation or message.

Focused frontend/native tests pin these codes. Runtime failures use stable error
categories rather than exposing host errno text.

## Resource and blocking contract

SQLite statements/databases and actor references are single-owner disposable
resources. `close()` or `stop()` performs the domain action; `dispose()` is an
idempotent common spelling suitable for structured cleanup. Use after disposal
is a recoverable error. Alpha does not depend on finalizers or a general garbage
collector.

Filesystem and SQLite calls never block an HTTP executor. They are dispatched
to the fixed application executor. SQLite connections are serialized through a
logical mailbox and are never shared concurrently across native threads. Two
static `Database` constructions may target the same permitted path; they remain
independent owners/connections and therefore contend through SQLite's locking
and busy-timeout rules. The WAL load tracer proves that bounded two-owner
shape, but does not imply a dynamic connection pool. Actor spawn/stop does not
create or destroy an operating-system thread.

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

A typed Hono `Bindings` field such as `context.env.APP_NAME` maps to the same
required snapshot value. It does not expose a separate platform object or
ambient environment: the field name is static, requires `--allow-env APP_NAME`,
and uses the same missing/invalid/oversized error path. Optional bindings should
continue to use `get()` with a closed fallback in this alpha.

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

The native alpha module is a single-owner `:memory:` or capability-scoped
on-disk database. It provides closed `exec(sql)` effects, prepared
`run()`/`all()`/`get()` calls, static-SQL `transaction(sql)` batches, and
one bounded prepared-write `transaction(async () => {...})` callback, plus
idempotent `close`/`dispose`, serialized through one logical application
worker. `exec()` and both transaction forms resolve to `Promise<void>`;
`Statement.run()` resolves to a closed immutable `RunResult` containing a
numeric `changes` count and `lastInsertRowId: string | null`. The row ID uses a
decimal string so every signed SQLite `i64` remains exact outside JavaScript's
safe-integer range. A run with zero changed rows reports `null`; otherwise the
field contains SQLite's connection-local last-insert row ID.

Prepared calls bind at most 16 compile-time-selected route, bounded JSON-body,
UUID, or closed primitive values (string, safe integer, finite real, boolean,
and null). SQL is capped at 65,536 bytes; results at 1,024 rows and 1 MiB;
and the vendored runtime is described in `doc/PERSISTENCE.md`. One handler may
contain at most 16 SQLite actions/result slots; the generated writer owns fixed
result storage, so returning these fields does not introduce a general object
heap. A prepared callback contains 1–16 awaited same-database `Statement.run`
steps with at most 64 aggregate parameters and 65,536 aggregate SQL bytes. It
is sent as one owner message and commits or rolls back as a unit. On-disk paths
require one matching canonical read/write root plus the service-owned runtime
directory/file policy above. Transaction queries, callback arguments/results,
control flow, nested or mixed-database callbacks, arbitrary result inspection,
and retaining result objects beyond the response are post-alpha.

### `tinytsx:actors`

The native surface includes the compile-time-known signed-integer counter and
one exact typed value-mailbox behavior documented in `doc/ACTORS.md`. Both
provide typed `ask`, bounded fire-and-forget `tell`, and idempotent
`stop`/`dispose` on the fixed application pool. A counter owns one native `i64`;
a value mailbox copies compile-time-known primitive, bounded-array, or
closed-record messages into actor-owned canonical JSON bytes. Complete value
messages are capped at 4,096 bytes, eight nested levels, 64 array items, and 32
record fields. Every actor has a compile-time mailbox capacity from 1 through
64 and remains a local logical worker, not one native thread.

`ask(message, {timeoutMs})` optionally bounds the caller wait with a static
1–60,000 ms deadline. Timeout detaches the reply receiver and produces the
recoverable overload response; an already accepted FIFO message is not
retracted and may still update actor state. A hard TCP reset while an HTTP
handler waits in `ask()` detaches the response waiter within the runtime's
10-millisecond polling interval, releases that HTTP executor, and likewise does
not retract accepted work. Clean half-close and general `AbortSignal`
cancellation are not implemented.

One exact non-persistent counter behavior may throw on a closed integer
sentinel and declare `restart: {maxRestarts, withinMs}`. The bounds are 1–16
restarts in a 1–60,000 ms rolling window. An admitted failure resets only that
actor to its declared initial state; exceeding the intensity terminates it and
cancels queued replies.

The same fallible behavior may instead join one static root created by
`supervise({strategy: "oneForOne", maxRestarts, withinMs})`. A program has at
most eight roots and sixteen children per root. The root shares its rolling
restart budget across its children, resets only the failed child while capacity
remains, and terminates that root's complete child group when exhausted.
Actors outside the group remain usable. A supervised child cannot also select
local restart or persistence. Supervisors expose no mailbox or status API and
cannot be nested or created dynamically. Backoff, manual restart, alternate
strategies, links, monitors, and registries are not implemented.

Dynamic request-derived messages, arbitrary behaviors, general supervision,
value identity/transfer, and general persistence are not native. The optional
SQLite-backed counter persistence specialization has process-restart evidence;
value-mailbox persistence is rejected.

Post-alpha candidates are path utilities, signals, subprocesses, raw sockets,
binary filesystem APIs, remote actors, and broader actor supervision trees.
