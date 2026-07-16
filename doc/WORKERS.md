# Worker execution contract

This document separates TinyTSX's reusable worker abstraction from the HTTP
server that first consumes it. The implementation must preserve this boundary:
the executor is a runtime library, while HTTP connections and future
JavaScript `Worker` messages are merely job types submitted to it.

## Terms

- A **native executor thread** is one long-lived operating-system thread owned
  by a fixed pool.
- A **logical worker** is an isolated application context with a mailbox and a
  compile-time-known module entry point.
- A **job** is one owned value submitted to an executor thread. An accepted TCP
  stream is the first job type.

Logical workers are intended to be light and disposable. Creating or
terminating one must not create or destroy an operating-system thread. Native
threads are amortized by the fixed executor pool.

## Reusable native pool

The zero-dependency runtime library exposes the following semantic operations:

```text
new(worker_count, queue_capacity, initialize_worker, handle_job)
try_submit(job) -> accepted | full(job) | closed(job)
close()
join()
```

The concrete Rust API may evolve without changing these semantics.

The pool guarantees:

1. exactly `worker_count` long-lived executor threads after construction;
2. a bounded FIFO queue with no allocation proportional to incoming load;
3. one job at a time on each executor thread;
4. stable worker-local state for the life of an executor thread;
5. panic containment around each job so later jobs remain serviceable;
6. deterministic close: reject new jobs, drain accepted jobs, then join;
7. ownership of a rejected job is returned to the caller.

The pool does not know about TCP, Hono, JavaScript modules, request arenas, or
garbage collection.

The runtime library now also exposes `ApplicationPool` and `LogicalWorker` as
the request/reply layer for TypeScript sugar. It adds one bounded mailbox per
logical worker while retaining the shared executor queue. Exactly one drain job
per logical worker may be scheduled, so messages execute in FIFO order against
isolated worker state while distinct logical workers can run in parallel.
`try_post` transfers ownership into the mailbox and returns a `Reply`; `call`
is the blocking bridge permitted only from a different pool. Full, closed, and
terminated submissions return message ownership. Termination cancels queued
messages, active work completes, and a panicking message reports failure
without preventing later delivery.

## HTTP use

The bootstrap runtime owns one listener and submits each accepted `TcpStream`
to the shared pool. `--workers N` selects the executor count. The initial queue
capacity is 64 waiting connections per worker; it is never unbounded.

When `try_submit` reports a full queue, the acceptor writes a minimal HTTP 503
response and closes that connection. A rejected connection must not consume a
request arena. Each accepted connection stays on one executor thread through
parsing, rendering, response writing, and close.

HTTP/1.1 keep-alive reuses the same worker job instead of re-enqueueing each
request on the connection. Pipelined bytes stay in a bounded connection buffer;
request bodies are consumed by validated `Content-Length` framing up to 1 MiB.
A connection closes on explicit `Connection: close`, invalid/ambiguous framing,
request OOM/internal failure, 100 completed requests, or five idle seconds.

## JavaScript-facing Worker subset

The first source API keeps the Web/Node/Deno construction shape and adds one
TinyTSX request/reply convenience method:

```ts
const worker = new Worker(new URL('./worker.ts', import.meta.url), {
  type: 'module',
})

const output = await worker.request(input)
```

This slice is implemented end to end. The compiler discovers the worker as a
runtime source dependency without creating an import binding, preserves the
awaited call in HIR, and submits an owned message to a separate application
pool. The bootstrap uses the HTTP `--workers` count for that pool's executor
count, but creates one logical worker per source `Worker` object/module.

The implemented subset is deliberately explicit:

- the module URL and `type: 'module'` are compile-time known;
- the module default-exports `(input: string) => input.toUpperCase()`;
- the native operation performs ASCII uppercase and preserves other bytes;
- `request()` accepts one literal or request-query string with a closed
  fallback and copies at most 4 KiB into the receiver's ownership domain;
- delivery is ordered through a 64-message mailbox and replies copy into the
  caller's request arena;
- application queue/mailbox saturation returns HTTP 503 and closes the
  connection;
- object identity never crosses a worker boundary;
- `postMessage`/events, `terminate()`, structured clone, records, arrays,
  transfer lists, ports, dynamic module URLs, and general worker functions are
  not yet source-level features.

This is syntax sugar over the reusable pool and mailbox runtime. It is not a
second JavaScript engine and it is not a one-thread-per-`Worker` design.

## Provider jobs

Native OpenAI-compatible calls reuse the same application-pool abstraction.
When provider transport is present, the bootstrap creates one provider logical
worker per application executor and distributes calls round-robin. HTTP
executors synchronously wait only across the separate-pool boundary; libcurl
never runs on an HTTP executor.

Each provider logical worker owns one reusable curl easy handle and connection
cache plus bounded request/reply messages. Reusing the handle prevents
ephemeral-port exhaustion under sustained local load. Provider state remains
isolated by the logical-worker mutex, messages copy ownership, and the selected
`--workers N` count bounds both parallel provider calls and native threads.

## Isolation and deadlock rules

HTTP execution state and application logical-worker state are separate. A
request may enqueue logical-worker work and await an asynchronous reply, but it
must not synchronously block an executor thread waiting for work scheduled to
the same exhausted pool.

The first implementation therefore uses the shared pool library in two
independent instances when application workers arrive:

- an HTTP connection pool sized by `--workers`;
- an application task pool with its own bounded queue.

A later scheduler may unify them only after it proves progress under nested
submission. No mutable application object is shared across logical workers.

The logical application-pool library and first bootstrap/compiler integration
are implemented. Native Hono E2E covers missing, encoded, and explicit query
messages through two independent executor pools. General messaging and several
logical workers in one compiled application are the next semantics slice.

## Verification gates

The native pool is complete only when tests prove parallel execution, FIFO
queueing, full/closed job recovery, worker-local state, panic recovery, and
draining shutdown. HTTP integration additionally requires:

- native E2E coverage with `--workers` greater than one;
- simultaneous slow connections completing in parallel;
- controlled 503 behavior at saturation and recovery afterward;
- response isolation across concurrent routes;
- RSS and load results for 1, 2, 4, and 8 workers.
