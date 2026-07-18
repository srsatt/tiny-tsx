# Performance evidence and roadmap

Last updated: 2026-07-18

## Current conclusion

TinyTSX is compelling for deployment and resident footprint, but the sustained
eight-worker keep-alive matrix does not show throughput or tail-latency parity
with Bun. The current comparison covers Hono basic, request-time dynamic JSX,
one decoded optional route parameter, bounded warm-cache 21-byte and 22,173-byte
file responses, finite text streaming, one counter actor, and one in-memory
empty SQLite query. The matrix also pairs compact and query-present pretty JSON
from the complete pinned basic app, plus two idempotent prepared writes and a
non-empty row response in one in-memory callback transaction. Every one of the
132 load samples passed its response contract.

Across three 15-second samples at concurrency 8 and 64, TinyTSX reaches
0.24–0.54x Bun throughput at concurrency 8 and 0.40–0.79x at concurrency 64 on
the ten small-response routes. The exact 22,173-byte warm-cache response is
the exception: TinyTSX reaches 1.30x Bun at concurrency 8 and 1.78x at 64.
TinyTSX's concurrency-64 p99 remains higher on every route at 9.575–22.030 ms
versus Bun at 0.736–5.104 ms.

The honest current claim is:

- **yes for footprint:** TinyTSX stays at 6.30–8.81 MiB warm RSS; Bun uses
  7.3x–24.6x as much across the eleven routes;
- **repeated startup is close:** TinyTSX takes 20.00–22.86 ms and Bun takes
  17.49–21.31 ms, while TinyTSX's separately reported first post-build launch
  remains a 437.66–547.26 ms outlier;
- **no general throughput-parity claim:** TinyTSX reaches 40–79% of Bun at
  concurrency 64 on the small-response routes, while the exact 22 KiB route
  reaches 178%;
- **tail latency remains open:** TinyTSX's concurrency-64 p99 is 4.3–18.6x
  Bun's despite the large-response throughput result;
- **owner boundaries are visible:** the actor route is 11.5% below TinyTSX's
  basic control at concurrency 64 and the empty SQLite route is 24.7% below it;
- **transaction depth has a measured route cost:** versus the empty SQLite
  route, the two-write/non-empty-row route changes TinyTSX throughput by -0.4%
  at concurrency 8 and -12.3% at 64; Bun changes by -26.2%/-32.0%;
- **closed pretty JSON is inexpensive here:** versus compact JSON, TinyTSX loses
  0.3% throughput at concurrency 64 while Bun loses 23.2%;
- **process pressure needs profiling:** TinyTSX records greater aggregate CPU
  on ten routes; Bun records more on the 21-byte file route, while TinyTSX
  records more Unix syscalls and context switches on all eleven;
- **bounded resources recover:** every TinyTSX workload returns to four open
  descriptors; median peaks are 68 for non-file routes, 71 for the 21-byte file,
  and 73 for the 22 KiB file.

The current summary is
`benchmarks/results/2026-07-17-m5-max-sustained-15s-summary.md`; its adjacent
JSON files retain every raw sample and each per-workload Markdown report pins
the response differences and limitations. Cold/replaced/binary files, responses
above 32 KiB, streaming/range/compression behavior, on-disk/WAL SQLite,
competing connections and rollback load, competing/catch-all route shapes,
JSON branch mixes with arbitrary values or dynamic collections, cancellation,
and multiple actors remain unmeasured.

The five-second alpha comparison and earlier connection-close, JSX, streaming,
Worker, and AI-provider results below are historical evidence. They remain
useful for explaining the optimization sequence, but the sustained matrix is
the current release-stability baseline.

## Alpha release comparison (historical five-second baseline)

All three workloads use commit `0e8f53e`, one server process, eight TinyTSX
workers, keep-alive, five startup samples, and three five-second load samples at
concurrency 1, 8, 32, and 64. Target and concurrency order alternate, and the
harness rejects incorrect responses before recording samples.

| Workload | Tiny/Bun RPS c1 | c8 | c32 | c64 | Tiny/Bun warm RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| Hono basic | 0.28x | 0.28x | 0.54x | 0.55x | 6.64 / 123.61 MiB |
| Counter actor | 0.33x | 0.36x | 0.65x | 0.69x | 6.59 / 108.08 MiB |
| SQLite owner | 0.28x | 0.24x | 0.41x | 0.43x | 7.86 / 70.39 MiB |

The control-relative percentages are end-to-end route differences rather than
isolated primitive costs. The actor path performs a zero-delta copied-message
ask through one persistent owner. The SQLite path performs one in-memory schema
check, empty prepared query, and JSON envelope through one application owner.
Neither result covers actor supervision, disk I/O, writes, contention, or
non-empty SQLite result copying.

Idle logical actors now allocate their mailbox deque lazily instead of reserving
the full 64-message bound at spawn. A native regression proves 10,000 idle
actors retain zero message-slot capacity and use the configured two executors.
The adjacent five-run release-mode M5 Max probe records:

| Idle actors | Median RSS | Incremental bytes/actor | OS threads | Median spawn |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 1.75 MiB | baseline | 4 | 0.03 ms |
| 1,000 | 1.88 MiB | 131.07 | 4 | 0.06 ms |
| 10,000 | 3.08 MiB | 139.26 | 4 | 0.22 ms |

The incremental values subtract the zero-actor median and therefore include
allocator/RSS granularity. The raw samples are in
`benchmarks/results/2026-07-17-m5-max-actor-scale.json`. No messages are posted,
so that RSS probe does not measure mailbox throughput or scheduling fairness.

Scheduling semantics are tested independently of that RSS probe. A mailbox now
handles at most eight messages before yielding its executor; a deterministic
one-thread test proves a cold actor runs at the first quantum boundary while 56
or more hot messages remain. A two-executor barrier test separately proves
cross-actor parallel execution. Sustained hot/cold throughput and tail latency
remain P4 measurements.

The comparison harness now records the first fresh-process launch separately
from the startup median and samples whole-process CPU time, Unix/Mach syscalls,
context switches, faults, thread count, open descriptors, and peak RSS during
warm-up and load.
An opt-in TinyTSX runtime feature also counts allocator calls, requested bytes,
and live/peak-live bytes; it is excluded from ordinary builds and explicitly
labels its atomic measurement overhead. Bun allocation ratios are not claimed.
This adds the missing measurement capability, but it does not identify dominant
CPU paths without profiles or turn short localhost runs into publication-grade
evidence.

The post-hardening eight-worker actor matrix at commit `a52fe18` is retained in
`benchmarks/results/2026-07-17-m5-max-stable-hono-actor-keepalive-w8.*`.
TinyTSX records 6.56 MiB warm and 6.77 MiB peak sampled RSS versus Bun at
106.45 MiB warm and 128.73 MiB peak. It reaches 0.40x Bun throughput at
concurrency 1/8 and 0.68x at 32/64; concurrency-64 p99 remains 41.94 ms versus
1.30 ms. Across the mixed warm-up/load interval TinyTSX also records 37.78 CPU
seconds, 17.44 million Unix syscalls, and 2.97 million context switches versus
Bun at 24.78 seconds, 5.72 million, and 1.28 million respectively. Because the
targets complete different request totals, these aggregate counters are
profiling direction rather than normalized per-request costs.

A separate instrumented concurrency-64 report records a median 3.05 million
allocation calls, 17 reallocations, 463.66 MiB requested, 2.03 MiB peak-live,
and 8.54 KiB live at shutdown across the one-second warm-up plus five-second
load interval. The atomic counters are absent from the comparative matrix and
ordinary binaries. Together, the stable throughput and elevated process
pressure make connection/application scheduling and syscall profiles the next
evidence step; they do not support a generic AOT-versus-JIT conclusion.

### Bounded live-connection rotation

A symbolized actor profile showed HTTP executors synchronously waiting on one
single-owner actor while excess keep-alive connections sat behind each
executor's 100-request connection turn. Closing connections after 8 or 32
requests improved p99 but lost too much throughput to reconnect churn, so those
experiments were rejected.

The accepted design retains each socket, bounded parser buffer, and lifetime
request count while atomically rotating the live connection behind queued work
after sixteen requests. The worker-pool operation keeps the external queue bound
and cannot reject a resubmission merely because that queue is full. Shutdown
stops the connection at its next turn boundary.

The clean commit `eed2a92` comparison uses three five-second samples at
concurrency 64 with eight workers and keep-alive:

| Workload | TinyTSX req/s | Tiny/Bun | Tiny p99 | Bun p99 | Tiny/Bun peak RSS |
| --- | ---: | ---: | ---: | ---: | ---: |
| Hono basic | 73,293 | 0.56x | 12.456 ms | 1.149 ms | 6.88 / 118.89 MiB |
| Counter actor | 67,001 | 0.71x | 13.719 ms | 1.497 ms | 6.80 / 111.48 MiB |
| SQLite owner | 56,107 | 0.45x | 16.198 ms | 1.117 ms | 7.89 / 69.38 MiB |

TinyTSX open descriptors are 4/68/4 start/peak/end for all three workloads.
The raw samples are retained in the adjacent
`benchmarks/results/2026-07-17-m5-max-{basic,actor,sqlite}-fair-keepalive-w8.*`
reports.

## Earlier connection-close and compatibility evidence

## Real JSX SSR result

The second workload compiles the untouched pinned
`vendor/hono-examples/jsx-ssr/src/index.tsx` graph. Bun produces the reference
body first; the harness then requires both servers to return the same 881 bytes,
status, content length, and normalized HTML content type. The application uses
typed component props, children, closed records and arrays, `Array.map`, a Hono
`html` tagged template, Unicode, and HTML escaping. Its request-selected post
route and both 404 paths are covered by Bun and native E2Es, but the load sample
targets the closed root route.

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 9,914 | 8,710 | 1.14x | 0.114 ms | 0.126 ms |
| 8 | 31,952 | 33,677 | 0.95x | 0.315 ms | 0.384 ms |
| 32 | 29,042 | 32,101 | 0.90x | 1.162 ms | 1.101 ms |
| 64 | 32,446 | 32,175 | 1.01x | 2.159 ms | 2.155 ms |

The useful conclusion is not that TinyTSX is categorically faster. It is that
removing the JS engine buys a 7–16x RSS reduction and roughly 2.7x faster
startup here without sacrificing throughput for a fully closed SSR page.

## Method

- Machine: Apple M5 Max, 18 cores, 128 GB, macOS 26.5.2.
- Power: AC, battery charged, normal power mode.
- Bun: 1.3.13; oha: 1.15.0.
- Application: complete pinned 34-module
  `vendor/hono-examples/basic/src/index.ts`.
- Route: `GET /`, including Hono routing, `poweredBy`, and response-time
  middleware.
- Five 5-second samples per target and concurrency; 15 startup samples.
- Concurrency: 1, 8, 32, 64, 128.
- Target process order alternates. Concurrency order alternates ascending and
  descending to reduce JIT/warm-up and thermal-order bias.
- One server process, one TinyTSX worker, localhost, keep-alive disabled for both
  because TinyTSX currently closes every connection.
- Every sample completed with success rate 1.0 and only HTTP 200 responses.

The response status, six body bytes, content length, powered-by header, and
numeric response-time header agree. Content type does not: TinyTSX returns
`text/plain;charset=UTF-8`; Bun 1.3.13 returns `application/octet-stream`.
Fetch assigns the text type when the original string body is extracted, and
Hono's later stream-body clone retains it through the response init headers.
The pinned WPT `response-init-contenttype.any.js` source and native Hono E2E
enforce TinyTSX's standard behavior. Bun omits the initial header, so its server
adapter chooses the binary type. The harness records this runtime deviation
instead of calling the wire responses identical.

## Results

### Footprint and startup

| Metric | TinyTSX | Bun | Interpretation |
| --- | ---: | ---: | --- |
| Startup-to-first-response median | 9.77 ms | 19.91 ms | TinyTSX is 2.04x faster |
| Idle RSS median | 5.84 MiB | 41.73 MiB | Bun uses 7.14x more |
| Post-warm-up RSS median | 6.09 MiB | 70.41 MiB | Bun uses 11.55x more |
| RSS growth during warm-up | 0.25 MiB | 28.67 MiB | TinyTSX remains nearly flat |
| Deployment runtime | 418.89 KiB | 60.15 MiB | Bun runtime is 147x larger, but shareable |

TinyTSX's first launch immediately after the benchmark build was a 382.46 ms
outlier; its remaining-startup median was 9.24 ms. Bun's first sample was
23.64 ms and its remaining median was 19.60 ms. The harness must separate first
post-build launch from repeated warm launch before publishing a stronger startup
claim.

The complete TinyTSX binary's RSS is higher than the earlier smoke binary's
roughly 1.8 MiB because the whole application includes the native Fetch route
and its system networking dependencies. This needs `vmmap`/link inspection
before attributing the increase to generated application data.

### Load scaling

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 9,488 | 9,692 | 0.98x | 0.130 ms | 0.132 ms |
| 8 | 29,656 | 30,148 | 0.98x | 0.334 ms | 0.478 ms |
| 32 | 30,885 | 31,252 | 0.99x | 1.180 ms | 1.279 ms |
| 64 | 29,834 | 30,663 | 0.97x | 2.385 ms | 2.382 ms |
| 128 | 28,131 | 28,899 | 0.97x | 8.438 ms | 7.844 ms |

Both implementations saturate around concurrency 32. From 32 to 128,
TinyTSX throughput falls 8.9% and Bun falls 7.5%, while p99 rises to roughly
8 ms. TinyTSX's lack of a JIT produces no obvious penalty here, but the result
is transport-bound and cannot establish how AOT code compares on dynamic JSON,
escaping, parsing, or allocation-heavy handlers.

## Fixed-worker connection-close baseline

After making `--workers` real, the exact pinned JSX SSR workload was repeated
with 1, 2, 4, and 8 TinyTSX workers. Each variant passed the Bun-derived
881-byte response gate before three one-second load samples per point.

| Workers | Idle RSS | Warm RSS | RPS c8 | RPS c32 | RPS c64 | p99 c64 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 5.89 MiB | 6.05 MiB | 32,155 | 31,330 | 31,522 | 2.373 ms |
| 2 | 5.91 MiB | 6.08 MiB | 30,562 | 29,772 | 29,772 | 4.076 ms |
| 4 | 5.94 MiB | 6.20 MiB | 29,539 | 30,538 | 29,217 | 4.271 ms |
| 8 | 6.03 MiB | 6.41 MiB | 30,786 | 28,450 | 30,122 | 3.806 ms |

Eight workers cost only 0.36 MiB more warm RSS than one, but no worker count
improved throughput or p99. At concurrency 64, 2/4/8 workers reached
0.94x/0.93x/0.96x the one-worker RPS. The result is consistent with the single
acceptor and TCP connect/close path being the bottleneck while the application
returns a closed pre-rendered body. It is not evidence against worker
parallelism: the focused native E2E proves progress on a second executor while
the first is blocked on a partial request.

The raw source reports and combined interpretation are in
`benchmarks/results/2026-07-15-m5-max-hono-jsx-ssr-workers-*`. Keep-alive plus a
request-time rendering workload are required before the matrix can say whether
application execution scales.

## Fixed-worker keep-alive matrix

The same exact-source/Bun response gate was rerun with persistent HTTP/1.1
connections. At the time of this historical matrix, TinyTSX closed each
connection after 100 requests or five idle seconds and kept a live connection
on one executor for its complete lifetime turn. The bounded-rotation result
above supersedes that scheduling policy.

| Workers | Warm RSS | RPS c8 | RPS c32 | RPS c64 | c64 vs 1 worker | p99 c64 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 5.91 MiB | 24,760 | 24,035 | 23,783 | 1.00x | 133.569 ms |
| 2 | 5.97 MiB | 42,233 | 42,536 | 42,988 | 1.81x | 72.794 ms |
| 4 | 6.08 MiB | 68,777 | 72,164 | 70,886 | 2.98x | 42.273 ms |
| 8 | 6.30 MiB | 86,471 | 96,023 | 102,796 | 4.32x | 26.293 ms |

This is the first direct evidence that the worker pool scales: eight workers
deliver 4.32x the one-worker throughput at concurrency 64 for 0.39 MiB more
warm RSS. The paired eight-worker run reaches 0.90x/0.97x/1.04x Bun throughput
at concurrency 8/32/64.

The tail is the important counterweight. TinyTSX p99 remains 12.8–26.3 ms at
concurrency 32–64 while Bun records 0.6–1.3 ms. Blocking connection affinity
queues excess persistent connections behind a worker's current 100-request
turn. The result validates parallel execution but also proves that throughput
alone is not sufficient. Request-time JSX comes next; connection fairness should
then be profiled before choosing a more complex socket scheduler.

Raw reports and the combined interpretation are retained under
`benchmarks/results/2026-07-15-m5-max-hono-jsx-ssr-keepalive-*`.

## Dynamic JSX and finite-stream previews

Two eight-worker keep-alive workloads now replace the closed JSX page with
request work. Each point is the median of three one-second samples and remains
exploratory.

| Workload | Tiny warm RSS | Bun warm RSS | Tiny/Bun RPS c8 | c32 | c64 | Tiny/Bun p99 c64 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Query decode + nested JSX escaping | 6.14 MiB | 99.69 MiB | 0.72x | 0.74x | 0.79x | 30.34 / 1.13 ms |
| Three flushed `streamText` chunks | 6.12 MiB | 154.58 MiB | 0.72x | 0.81x | 0.90x | 43.64 / 2.10 ms |

At concurrency one, TinyTSX reaches 0.96x Bun on dynamic JSX but only 0.54x on
the three-chunk stream. Flushing each native chunk has visible fixed cost. As
concurrency increases, the stream ratio rises to 0.90x, while the dynamic JSX
route remains 0.72–0.79x Bun. This is the first direct result showing that the
no-JIT native path is not automatically faster once genuine request work is
measured.

Footprint remains the clear advantage: TinyTSX starts in 7.70–8.92 ms and stays
near 6.1 MiB warm, versus Bun at 21.17–21.82 ms and 99.7–154.6 MiB warm. The
same blocking connection-affinity tail dominates TinyTSX p99 at concurrency
32–64, so throughput and tail results cannot yet isolate renderer cost.

The stream wire contracts are intentionally visible. TinyTSX preserves three
HTTP/1.1 chunks; Bun 1.3.13 collects the immediately completed stream and emits
`Content-Length: 19`. Body bytes and semantic headers still match. Raw reports
are `2026-07-15-m5-max-hono-{dynamic-jsx,stream-text}-keepalive-w8.{json,md}`.

## Logical Worker request/reply preview

The first Worker workload uses one persistent logical Worker on each target.
TinyTSX copies a decoded query message through its separate bounded application
pool; Bun uses a real module Worker plus `postMessage`, a pending-Promise map,
and the same pinned Hono route semantics.

| Metric | TinyTSX | Bun |
| --- | ---: | ---: |
| Startup median | 7.22 ms | 19.78 ms |
| Idle RSS | 6.22 MiB | 43.97 MiB |
| Warm RSS | 6.48 MiB | 111.45 MiB |
| RPS c1 | 19,376 | 20,814 |
| RPS c8 | 64,650 | 87,189 |
| RPS c32 | 72,518 | 96,883 |
| RPS c64 | 73,085 | 95,665 |
| p99 c64 | 36.381 ms | 1.452 ms |

TinyTSX retains its startup and footprint advantage but reaches 0.74–0.76x
Bun throughput from concurrency 8–64. This route deliberately serializes
through one logical worker, so it measures message-copy/request-reply overhead,
not application-worker parallel scaling. The c32/c64 tail again includes the
known blocking HTTP connection-affinity policy. Raw evidence is retained in
`benchmarks/results/2026-07-15-m5-max-hono-worker-keepalive-w8.{json,md}`.

## Local AI provider and application-pool scaling

The provider workload runs the pinned 656-module Hono + AI SDK Core +
OpenAI-compatible graph against one shared zero-delay loopback provider. Both
targets send the same model/prompt request and must return the same 25-byte
assistant text. The support provider is excluded from both RSS measurements.
It performs no inference, token generation, retry, or streaming, so this is a
framework/transport benchmark rather than an AI-model benchmark.

| Workers | Tiny startup | Bun startup | Tiny warm RSS | Bun warm RSS | Tiny RPS c1 | c8 | c32 | c64 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 12.64 ms | 48.98 ms | 8.34 MiB | 255.27 MiB | 12,077 | 12,241 | 12,274 | 12,259 |
| 8 | 14.08 ms | 48.57 ms | 10.03 MiB | 251.80 MiB | 12,171 | 43,445 | 45,460 | 46,075 |

One provider executor is the bottleneck near 12.3k requests/s. Eight executors
raise concurrency-64 throughput 3.76x for 1.69 MiB more warm RSS. Against the
paired Bun runs, the eight-worker native binary reaches 1.53x Bun at concurrency
1 and 2.37–2.87x at concurrency 8–64. This advantage comes from specializing
the closed provider call into bounded native transport rather than executing
the full SDK graph per request.

Tail fairness remains open: eight-worker TinyTSX p99 reaches 62.54 ms at
concurrency 64 versus Bun's 7.93 ms, even though aggregate throughput is higher.
The first implementation also created one curl handle per call and exhausted
macOS ephemeral ports during the warmup. Provider workers now reuse their easy
handle and connection cache; a focused regression test and the repeated load
run both cover that correction. Raw reports are
`benchmarks/results/2026-07-16-m5-max-hono-ai-provider-keepalive-w{1,8}.{json,md}`.

## Roadmap

### P0 — make the comparison semantically and mechanically fair

1. **Resolve response-clone content type semantics — complete.** TinyTSX follows
   Fetch/WPT for string-body type synthesis and header retention through Hono's
   stream clone. The pinned WPT source, native response-time E2E, and explicit
   Bun 1.3.13 benchmark difference enforce the decision.
2. **Implement the reusable worker pool and bounded HTTP dispatch.** Make
   `--workers` real, preserve per-request arenas, and define overload behavior.
   Exit: concurrency and saturation behavior are proven independently of HTTP,
   then native E2E tests prove parallel service and recovery after a 503.
3. **Implement HTTP/1.1 keep-alive, then run the scaling comparison.** Reuse one
   connection for multiple requests and benchmark both targets with keep-alive
   enabled. Exit: parser state resets safely, request memory is reclaimed per
   request, the complete Hono matrix stays green, and 1/2/4/8-worker results
   report bounded RSS plus throughput and latency without connection-close
   transport masking scheduler behavior.

   **Complete.** The bounded parser, per-worker reusable arena, OOM recovery,
   pipelining/body-framing E2E, and retained 1/2/4/8 matrix satisfy this gate.

### P1 — expose native-code and no-JIT behavior

4. **Add a route workload matrix.** Measure the same complete binary on `/`,
   `/entry/:id`, `/api/posts`, `/api/posts?pretty`, authorized/unauthorized
   `/auth/*`, and representative 1 KiB/16 KiB bodies. Exclude external Fetch
   latency from CPU comparisons. Exit: every route has a pinned Bun/TinyTSX
   response contract and repeated latency/RPS samples.
5. **Add a genuinely request-time TSX workload.** The pinned SSR application now
   proves compile-time records, arrays, mapping, escaping, and finite route
   specialization. The next workload must render unbounded request data through
   native escaping and bounded response writes instead of selecting a closed
   pre-rendered response. This is the first workload that can answer whether
   AOT code beats a warmed JIT for dynamic application work.

   **Complete as an exploratory gate.** The query decode/escaping workload is
   byte-equivalent to Bun and records repeated startup, RSS, RPS, and latency.
   It shows 0.72–0.79x Bun throughput at concurrency 8–64 on this machine.
6. **Capture CPU, syscalls, allocations, and peak RSS during each sample.** Use
   macOS `sample`/Instruments or equivalent counters and record warm-up phases
   separately. Exit: every throughput result names the dominant CPU path and
   memory growth source.

   **Instrumentation complete; attribution remains open.** The harness captures
   whole-process counters with `libproc`, samples RSS every 20 ms, and offers a
   benchmark-only allocation-counting build. Profiles are still required to
   name dominant code paths and memory-growth sources.

### P2 — optimize only from profiles, then validate claims

7. **Reduce whole-application footprint.** Inspect `vmmap` and linked images,
   dead-strip unused host APIs where semantics allow it, and quantify the cost
   of Fetch/libcurl, route tables, and generated constants.
8. **Optimize confirmed hot paths.** Likely candidates are connection parsing,
   response/header writes, path matching, and avoidable copies; do not optimize
   symbolic compilation paths that do not execute per request.
9. **Separate first-post-build and warm startup suites.** Preserve the observed
   382 ms TinyTSX first-launch outlier, investigate signing/loader/cache effects,
   and report median plus tail rather than one blended number.

   The report now preserves first launch separately from the fresh-process
   median. Loader/signing/cache attribution and a multi-day tail distribution
   remain open.
10. **Run publication-grade validation.** Use 30–60 second samples, confidence
    intervals, a separate load-generator host, controlled power/thermal state,
    and repeated days/machines. Publish no general performance claim before
    these gates pass.

The next performance tasks are route/response-size coverage, normalized
CPU/syscall profiling, and longer controlled runs. The accepted three-route
result is still not publication-grade evidence.
