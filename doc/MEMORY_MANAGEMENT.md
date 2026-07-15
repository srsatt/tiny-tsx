# Memory-management roadmap

TinyTSX should not begin by writing a general tracing garbage collector. The
compiler can keep most values out of a managed heap by assigning every value to
the narrowest lifetime that matches its observable behavior.

| Value class | Storage | Reclamation |
| --- | --- | --- |
| closed constants and records | executable read-only data | process exit |
| request-local non-escaping values | per-worker request arena | reset after request |
| logical-worker mutable state | isolated worker heap | worker termination or collection |
| copied messages | receiver-owned message arena/heap | after delivery or retention analysis |
| genuinely shared/escaping graphs | unsupported until a collector contract exists | collector-defined |

## Worker boundary

Each logical worker owns its mutable heap. Messages copy supported values and
never share object identity. This makes worker termination useful as a bulk
reclamation boundary and avoids a process-wide stop-the-world collector merely
to support parallel workers.

HTTP executor threads own reusable request arenas, but an arena is reset for
every request. An executor thread is not itself a JavaScript heap or logical
worker.

## Compiler work before a collector

Before selecting a collector, the compiler needs:

1. escape classification for request, worker, and process lifetimes;
2. a stable heap object header and type/layout descriptor ABI;
3. enumerated roots for generated globals, worker state, stack slots, and
   registers;
4. stack maps and explicit safepoints for precise collection, or a documented
   conservative-root contract for an exploratory collector;
5. write-barrier call sites in the HIR even if the first backend makes them
   no-ops;
6. OOM and worker-termination semantics that do not unwind across the native
   ABI.

Choosing a collector does not remove these compiler obligations. In
particular, a precise collector cannot discover pointers held in generated
Apple-arm64 stack slots or registers without root metadata and safepoints.

## Collector decision boundary

Keep static data plus arenas while the pinned Hono and AI workloads can be
compiled without persistent escaping object graphs. Start a collector spike
when an exact-source compatibility audit demonstrates a required graph that:

- outlives one request or message delivery;
- cannot be represented as immutable process data or isolated owned state;
- may contain cycles or observable aliases; and
- is exercised by a behavior test, not only parsed syntax.

The spike compares an existing conservative collector such as BDWGC with a
precise, non-moving, per-worker design built on an established toolkit. Compare
integration complexity, root accuracy, pause isolation, retained RSS, worker
termination cost, and Apple-arm64/Linux portability. Reference counting alone
is not the JavaScript heap solution because observable cycles remain.

The preferred end state is a non-moving heap per logical worker with no shared
objects. A conservative collector may be a useful compatibility experiment,
but accidental retention and process-wide thread scanning make it a poor
default until measurements say otherwise.

No production tracing collector should be written from scratch as part of the
worker milestone.

