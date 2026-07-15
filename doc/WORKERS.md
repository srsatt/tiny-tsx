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

The intended source API follows the useful part of the Web/Node/Deno model:

```ts
const worker = new Worker(new URL('./worker.ts', import.meta.url), {
  type: 'module',
})

worker.postMessage({ kind: 'score', input })
worker.onmessage = (event) => consume(event.data)
worker.terminate()
```

The first subset is deliberately explicit:

- the module URL and `type: 'module'` are compile-time known;
- messages contain supported primitives, closed records, and bounded dense
  arrays;
- `postMessage` copies a message into the receiver's ownership domain;
- delivery is asynchronous and ordered per sender/receiver pair;
- `terminate()` cancels queued logical-worker work and drops its isolated
  state after any currently executing job reaches a compiler safepoint;
- object identity never crosses a worker boundary;
- `SharedArrayBuffer`, shared mutable objects, transfer lists, ports, dynamic
  module URLs, and synchronous receive are initially unsupported.

This is syntax sugar over the reusable pool and mailbox runtime. It is not a
second JavaScript engine and it is not a one-thread-per-`Worker` design.

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

## Verification gates

The native pool is complete only when tests prove parallel execution, FIFO
queueing, full/closed job recovery, worker-local state, panic recovery, and
draining shutdown. HTTP integration additionally requires:

- native E2E coverage with `--workers` greater than one;
- simultaneous slow connections completing in parallel;
- controlled 503 behavior at saturation and recovery afterward;
- response isolation across concurrent routes;
- RSS and load results for 1, 2, 4, and 8 workers.
