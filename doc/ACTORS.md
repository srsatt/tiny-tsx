# Local actors

TinyTSX actors are compile-time-known logical workers that run on the fixed
application executor. They are local to one native process. An actor does not
own an operating-system thread, has no network identity, and is not a
Cloudflare Durable Object or an Erlang-compatible distributed process.

## Alpha counter surface

The first native slice is intentionally narrow. `tinytsx:actors` exposes
`spawn`, a typed `CounterActorRef`, and `ask`, `tell`, `stop`, and `dispose`.
The accepted behavior is the closed counter operation used by the Hono tracer:

```ts
const counter = spawn((context, delta: number) => {
  context.state += delta;
  return String(context.state);
}, 0, {mailboxCapacity: 64});
```

An actor may opt into the bounded SQLite owner with a compile-time database and
key:

```ts
const counter = spawn(behavior, 0, {
  persistence: {database, key: "primary-counter"},
});
```

The database path still requires matching read/write capabilities. Startup
loads the stored signed integer or inserts the declared initial state. Each
successful actor message writes the next value before publishing it as
in-memory state, so a failed write cannot move memory ahead of disk.

The initial state and messages are signed integers. State addition is checked,
and replies are decimal strings. The behavior, initial state, and mailbox
capacity must be known during compilation. Other behaviors and structured
messages remain unsupported until their copying and ownership rules are
implemented.

## Identity, state, and ordering

Each source `spawn` site creates one process-local actor during application
startup. Its numeric HIR identity is stable within that compiled artifact but
is not a persistent or public identifier. State is an actor-owned native `i64`
stored for the process lifetime; it never enters request memory and cannot be
shared by handlers.

Every actor has one FIFO mailbox. The default and release maximum capacity is
64 queued messages; `mailboxCapacity` may lower it to a compile-time integer in
the range 1 through 64. A single drain owns the actor state, while separate
actors may run on different application-executor threads. Actor count does not
change the executor thread count. Idle actors allocate no message-slot buffer;
the deque grows only when the first message is posted while its logical capacity
remains bounded. A native structural regression creates 10,000 idle actors,
pins two executors and sequential identities, and verifies zero allocated
mailbox slots before disposal.

`ask(message)` enqueues in FIFO order, waits for that message's reply, and
renders the reply into request-owned response memory. `tell(message)` enqueues
through the same bounded mailbox and returns without waiting for the reply.
Consequently, a successful `tell` followed by `ask` observes the tell first.

## Stop and failures

`stop()` and `dispose()` are idempotent. Stopping rejects new messages and
fails queued replies; it does not destroy an executor thread. There is no
automatic restart, supervision tree, general durable snapshot, timeout,
cancellation, or mailbox drain-on-stop in this alpha slice. Optional counter
persistence restores state after a process restart; it does not restart a
failed actor in-process.

Mailbox or application-queue saturation is a recoverable overload response.
Use after stop, a disconnected reply, a handler panic, and checked-integer
overflow become bounded internal response errors. They do not terminate the
HTTP server. The public error payload is deliberately generic; stable typed
application errors and caller-selected timeout behavior remain release work.

## Evidence and remaining work

`examples/hono-actors/server.ts` is the native Hono counter tracer. Its test
proves ordered ask/tell, decrement, idempotent stop, post-stop recovery, an
Apple-arm64 native server, and Linux-arm64 assembly. It is a TinyTSX adapter to
the pinned durable-objects example's counter behavior, not unchanged Cloudflare
source compatibility.

`examples/hono-actors/persistent.ts` binds the same counter behavior to a
capability-scoped SQLite database. Native HTTP drives it to 2, terminates the
process, restarts the same binary at 2, and advances to 3. The program also
assembles for Linux arm64.

Before actors can carry general application state, TinyTSX still needs bounded
copying for primitives, closed records, and bounded arrays; per-actor scale and
fairness measurements (the 10,000-actor structural test is not an RSS result);
timeout/cancellation policy; panic and isolation tests; and persistence for
arbitrary actor behaviors outside the counter specialization.
