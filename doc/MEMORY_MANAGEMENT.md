# Memory-management roadmap

TinyTSX should not begin by writing a general tracing garbage collector. The
compiler can keep most values out of a managed heap by assigning every value to
the narrowest lifetime that matches its observable behavior.

| Value class | Storage | Reclamation |
| --- | --- | --- |
| closed constants and records | executable read-only data | process exit |
| request-local non-escaping values | per-worker request arena | reset after request |
| logical-worker mutable state | isolated invocation/worker arena by default | worker termination or arena reset |
| copied messages | receiver-owned message arena | after delivery or retention analysis |
| genuinely shared/escaping graphs | unsupported until a collector contract exists | collector-defined |

## Worker boundary

Each logical worker owns its mutable arena domain. Messages copy supported values
and never share object identity. This makes worker termination useful as a bulk
reclamation boundary and avoids a process-wide stop-the-world collector merely
to support parallel workers. A managed heap is an optional future compatibility
profile, not the default representation of worker state.

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

The preferred default is an arena-only light-lambda profile: immutable static
captures, bounded invocation state, copied messages, and bulk reclamation at
request/message/worker boundaries. If executed compatibility evidence later
requires cyclic escaping graphs, a separate profile may add a non-moving heap
per logical worker with no shared objects. A conservative collector may be a
useful experiment, but accidental retention and process-wide thread scanning
make it a poor default until measurements say otherwise.

No production tracing collector should be written from scratch as part of the
worker milestone.

## Current AI evidence

The first executed `generateText` plus Hono target does not trigger the
collector boundary. Its mock model, prompt, orchestration records, generated
steps, and result object are request-local during AOT evaluation; only the
closed 27-byte response reaches HIR and the native executable. The build still
uses the arena-only runtime with GC disabled.

This conclusion is now machine-readable in both HIR and `<binary>.build.json`.
The `memory` object records the `arena` policy, every allocation site reached by
symbolic execution, source location and value kind, instance/reference counts,
the selected lifetime and escape target, a checked summary, and the
`managedHeapRequired` decision. The Rust HIR validator recomputes the summary
from the sites instead of trusting frontend totals.

The deterministic AI/Hono target currently reports 753 sites: 752 compile-time
and one static response site, with 229 aliased sites, one response escape, and
zero request, worker, message, or managed sites. Focused tests also require all
reached SDK `generate-id.ts` sites to remain compile-time and non-escaping.
These counts describe executed tracer evidence, not runtime allocation bytes or
peak heap use.

The first finite `streamText` path changes the ownership mix but still does not
trigger a collector. It reports 101 reached sites: 78 compile-time, 13 static,
10 request-lifetime, and zero worker/message/managed sites. Its 23 response
escapes include the provider stream parts and chunks, while
`managedHeapRequired` remains false. This is evidence for a finite closed mock
stream only; cancellation, backpressure, live provider I/O, and callbacks that
outlive a request remain separate escape-analysis gates.

The first real provider-I/O path also stays below the collector threshold. Its
656-module OpenAI-compatible build reports 66 reached sites: 65 compile-time,
one request-lifetime response allocation, 22 aliased sites, one response escape,
and zero worker, message, or managed sites. Provider requests and replies cross
the application-pool boundary as bounded owned byte buffers; the decoded reply
is copied into the caller's request arena. Each provider worker persistently
owns one native curl handle and connection cache, but that opaque acyclic native
resource has deterministic worker/process destruction and is not a JavaScript
object graph.

Measured eight-worker load raises TinyTSX warm RSS from 8.34 MiB with one
provider executor to 10.03 MiB with eight while increasing concurrency-64
throughput from 12.3k to 46.1k requests/s. No retained JS graph or unbounded RSS
growth appears in this executed path. The collector spike therefore remains
deferred; invalid schemas, multi-step tools, dynamic callbacks, and streamed
provider state are the next evidence-bearing escape gates.
