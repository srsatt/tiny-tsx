# Local actors

TinyTSX actors are compile-time-known logical workers that run on the fixed
application executor. They are local to one native process. An actor does not
own an operating-system thread, has no network identity, and is not a
Cloudflare Durable Object or an Erlang-compatible distributed process.

## Native actor surface

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

Counter initial state and messages are signed integers. State addition is
checked, and replies are decimal strings. The behavior, initial state, and
mailbox capacity must be known during compilation.

The post-alpha source tree also admits one exact typed value-mailbox behavior:

```ts
const mailbox = spawn((context, message: Status) => {
  context.state = message;
  return JSON.stringify(context.state);
}, {status: "idle", tags: []});
```

`Status` may contain `string`, safe-integer `number`, `boolean`, `null`, closed
records, and arrays. Values are limited to eight nested levels, 64 array items,
32 record fields, 128 UTF-8 bytes per field name, 1,024 UTF-8 bytes per string,
and 4,096 canonical JSON bytes per complete message. Initial state and messages
must be closed at compile time. Spreads, cycles, dynamic request values, object
identity, transfer semantics, and persistence for this value behavior are
rejected with `TINY1520` or `TINY1521`.

The generated server copies each static JSON message into an owned mailbox
buffer before returning to the HTTP executor. The actor replaces its own state
buffer and clones the reply into request-owned response memory. Consequently,
the sender, mailbox, actor state, and response do not alias one another and no
managed JavaScript heap is required. This is a bounded value-copy contract,
not a general JavaScript object or arbitrary behavior runtime.

## Identity, state, and ordering

Each source `spawn` site creates one process-local actor during application
startup. Its numeric HIR identity is stable within that compiled artifact but
is not a persistent or public identifier. Counter state is an actor-owned
native `i64`; value-mailbox state is an owned bounded byte vector. Both live for
the process lifetime, never enter request memory, and cannot be shared by
handlers.

Every actor has one FIFO mailbox. The default and release maximum capacity is
64 queued messages; `mailboxCapacity` may lower it to a compile-time integer in
the range 1 through 64. A single drain owns the actor state, while separate
actors may run on different application-executor threads. Actor count does not
change the executor thread count. Idle actors allocate no message-slot buffer;
the deque grows only when the first message is posted while its logical capacity
remains bounded. A native structural regression creates 10,000 idle actors,
pins two executors and sequential identities, and verifies zero allocated
mailbox slots before disposal.

The five-run release-mode M5 Max probe measures 1.75 MiB RSS with no actors,
1.88 MiB with 1,000 actors, and 3.08 MiB with 10,000 actors. After subtracting
the zero-actor median, that is 131.07 and 139.26 bytes per actor respectively.
All three configurations report four OS threads for the process while retaining
two configured executors. These are idle local-actor numbers, not a mailbox
throughput or fairness result.

`ask(message)` enqueues in FIFO order, waits for that message's reply, and
renders the reply into request-owned response memory. An optional
`ask(message, {timeoutMs})` bounds the wait to a compile-time integer from 1
through 60,000 milliseconds. `tell(message)` enqueues
through the same bounded mailbox and returns without waiting for the reply.
Consequently, a successful `tell` followed by `ask` observes the tell first.
One executor handles at most eight messages from a mailbox before resubmitting
that actor behind already runnable work. A deterministic one-executor test
blocks the first hot message, queues the remaining 63 plus a cold actor, and
proves the cold actor runs by the first quantum boundary while hot work remains.
Separate barrier evidence proves distinct actors execute in parallel when two
executors are configured.

The sustained eight-owner HTTP tracer cycles response-equivalent `tell(+1)`
routes across eight compile-time-known counters and reads every state after
warm-up and each concurrency interval. All 18 TinyTSX/Bun checkpoints show
progress on every owner; the final TinyTSX states span 225,345–226,787. At
concurrency 8/64 TinyTSX reaches 38,366/76,825 requests per second, uses 6.64
MiB warm RSS, peaks at 6.75 MiB, and returns from 68 descriptors to 4. The Bun
reference uses eight OS Workers and records 120.77 MiB warm RSS plus a 703.77
MiB median peak. Those are complete-process implementation comparisons, not
isolated per-actor allocation or scheduling costs. The tracer does not add a
runtime actor registry, dynamic identity, supervision, or persistence.

## Bounded restart policy

One exact non-persistent counter form may declare a closed failure sentinel and
rolling restart intensity:

```ts
const counter = spawn((context, delta: number) => {
  if (delta === 99) throw Error("counter failure");
  context.state += delta;
  return String(context.state);
}, 0, {restart: {maxRestarts: 2, withinMs: 60_000}});
```

`maxRestarts` is a compile-time integer from 1 through 16 and `withinMs` is a
compile-time window from 1 through 60,000 milliseconds. The sentinel is one
compile-time safe integer. The throwing caller receives the existing bounded
internal-error response. If capacity remains in the rolling window, only that
logical actor reruns its initializer, resets to the declared initial state, and
continues queued messages. Other actors and executor threads are unchanged.
The next failure after the configured intensity is exhausted terminates the
actor and cancels its queued replies.

This is panic containment plus reinitialization for the exact source shape
above, not evaluation of arbitrary actor code. Persistence is rejected because
its recovery source and disk/memory reconciliation require a separate policy.
There is no backoff, manual restart, supervisor, child hierarchy, link, monitor,
registry, snapshot, or distributed identity.

## Stop and failures

`stop()` and `dispose()` are idempotent. Stopping rejects new messages and
fails queued replies; an already executing message is allowed to finish. It
does not destroy an executor thread. Dropping an `ask`/post reply (including a
caller that no longer waits) or reaching an explicit ask timeout detaches the
waiter but does not cancel an accepted message; FIFO effects remain visible to
the next call. A timed-out native HTTP ask returns the same recoverable 503
overload envelope as bounded queue saturation. Omitting `timeoutMs` retains the
original unbounded deadline.

While an HTTP handler is waiting in `ask()`, the reply receiver checks the
connection's pending socket error every 10 milliseconds. A hard client reset
detaches that HTTP waiter and releases its executor promptly; the accepted FIFO
message is not retracted and may still update actor state. A clean read-side EOF
is deliberately not cancellation because valid raw HTTP clients may half-close
their request stream while still awaiting the response. This narrow transport
policy does not expose an `AbortSignal`, cancel SQLite/fetch/file operations, or
make messages interruptible. Supervision trees, message retraction, and general
durable snapshots remain outside this slice; restart is limited to the exact
bounded policy above. Optional
counter persistence restores state after a process restart; it does not restart
a failed actor in-process.

Mailbox or application-queue saturation is a recoverable overload response.
Use after stop, a disconnected reply, a handler panic, and checked-integer
overflow become bounded internal response errors. They do not terminate the
HTTP server. The hard-reset status is internal and causes the HTTP connection to
close without attempting another response write. The public error payload is
deliberately generic; stable typed application errors and general caller-driven
cancellation remain release work. Generic runtime tests pin
active-finish/queued-cancel stop semantics, detached, cancelled, and timed-out
reply behavior, panic containment with a later successful message, isolated
state, and cross-actor parallelism independently of the counter adapter.

## Evidence and remaining work

`examples/hono-actors/server.ts` is the native Hono counter tracer. Its test
proves ordered ask/tell, decrement, idempotent stop, post-stop recovery, an
Apple-arm64 native server, and Linux-arm64 assembly. It is a TinyTSX adapter to
the pinned durable-objects example's counter behavior, not unchanged Cloudflare
source compatibility.

`examples/hono-actors/persistent.ts` binds the same counter behavior to a
capability-scoped SQLite database. Native HTTP drives it to 2, terminates the
process, restarts the same binary at 2, and advances to 3. The program also
assembles for Linux arm64. Its one-worker lifecycle case holds an external
SQLite write lock, resets the client during an accepted increment, requires the
static health route to respond within 500 milliseconds before releasing the
lock, then observes the detached increment at state 4.

`examples/hono-actors/messages.ts` proves the copied value-mailbox contract for
a primitive, a bounded array, and a nested closed record through native Hono
HTTP routes on Apple arm64 and assembles the same paths for Linux arm64. Stable
diagnostic tests reject dynamic messages and exceeded array/string limits.

`examples/hono-actors/restart.ts` proves two failures reset a fallible counter
from state 1 to its declared state 0. A third failure inside the 60-second
window exhausts the intensity and terminates only that actor. Apple native HTTP
checks the complete sequence and Linux arm64 assembles the restart
configuration functions.

Before actors can carry general request-derived application state, TinyTSX
still needs a runtime expression/value representation for dynamic messages;
hot-mailbox profiling; clean-close and general `AbortSignal` cancellation
policy; persistence for arbitrary actor behaviors outside the counter
specialization; and any explicit identity or transfer model.
