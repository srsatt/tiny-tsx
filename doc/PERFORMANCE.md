# Performance evidence and roadmap

Last updated: 2026-07-19

## Current conclusion

The performance regression is resolved for the core HTTP path. Actors are not
part of request dispatch: they remain an opt-in standard-library facility, and
the HTTP server now owns connections in descriptor shards, retains hot
connections locally, coalesces response writes, and links only host facilities
used by the compiled program.

The current sustained comparison uses the normal one-worker TinyTSX default,
one Bun server process, keep-alive, three five-second samples, and concurrency
8/64. This is the fair CPU-bound configuration on the measured M5 Max; forcing
eight native HTTP workers onto these tiny closed routes reduces throughput due
to scheduler and cache contention.

| Workload | Tiny/Bun startup | Tiny/Bun warm RSS | RPS c8 | RPS c64 | p99 c8 | p99 c64 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Complete Hono basic | 13.13 / 26.75 ms | 6.03 / 123.61 MiB | 159,254 / 133,619 | 207,084 / 150,446 | 0.084 / 0.108 ms | 0.537 / 0.896 ms |
| Closed Hono JSX SSR | 11.93 / 26.37 ms | 1.89 / 123.78 MiB | 158,740 / 99,255 | 207,873 / 102,656 | 0.084 / 0.218 ms | 0.513 / 1.184 ms |

Both reports pass `benchmarks/scripts/performance_gate.py`. The complete basic
binary is 493.28 KiB and includes its external-Fetch route; the closed JSX
binary is 491.62 KiB. Raw evidence is retained in
`2026-07-19-m5-max-perf-recovery-hono-{basic,jsx}-keepalive-w1.{json,md}`.

The one-second Hono-basic worker curve at concurrency 64 is 206k/175k/149k/129k
requests per second for 1/2/4/8 workers. `--workers` is therefore a workload
knob, not a generally useful core-count setting. Start at one for closed
CPU-bound routes; add workers only when measurement shows blocking I/O or
substantial request computation benefits.

Optional paths are improved but not all are at parity. Isolating the filesystem
feature and pre-opening allowed roots reduced the 21-byte file binary from
2.31 MiB to 560 KiB, warm RSS from 6.86 MiB to about 2.8 MiB, and Unix syscalls
from 3.49M to 1.91M in the eight-worker preview. Throughput reached 0.93x/0.92x
Bun at concurrency 8/64. SQLite now uses rusqlite's prepared-statement cache and
streams rows directly to JSON, but the empty-query preview reaches 0.53x/0.70x
Bun because two synchronous calls still cross the generic application mailbox.

The 256 KiB arena remains a reservation, not committed RSS: the minimal closed
server touches only the response pages it uses and stays at 1.89 MiB warm.
Reducing the default would narrow useful response headroom without a measured
resident-memory win, so arena sizing stays configurable via `--request-memory`.

The next performance targets are the optional-path boundaries: fuse or directly
own repeated SQLite operations, introduce request continuations so one HTTP
reactor can overlap file/provider waits, and evaluate `kqueue`/`epoll` batching.
Publication-grade claims still require longer samples, controlled power state,
another machine, and ideally a separate load-generator host.

## Historical eight-worker baseline

TinyTSX is compelling for deployment and resident footprint, but the sustained
eight-worker keep-alive matrix does not show throughput or tail-latency parity
with Bun. The current comparison covers Hono basic, request-time dynamic JSX,
one decoded optional route parameter, bounded warm-cache 21-byte and 22,173-byte
file responses, one and eight counter-actor workloads, finite text streaming,
and one in-memory empty SQLite query. The matrix also pairs compact and
query-present pretty JSON from the complete pinned basic app, two idempotent
prepared writes plus a non-empty in-memory row, one bounded primitive JSON POST,
and two independent owners contending for one on-disk WAL file while rolling
back a savepoint probe on every request. A fifteenth row repeatedly fails the
second step of a request-header/route/JSON transaction on one WAL owner, then
proves zero partial rows and successful recovery. A sixteenth row posts four
bounded nested primitive leaves, performs two idempotent prepared writes in one
callback transaction, and returns the nested response. A seventeenth row runs
the unchanged pinned Stytch TODO backend through authenticated
create/list/complete/delete cycles backed by one actor-owned in-memory SQLite
adapter. Every one of the 204
load samples passed its declared response contract. All 18 multi-actor state
snapshots proved progress on every actor, all 18 two-owner WAL checkpoints
proved committed progress and a zero rollback probe, and all 18 full-rollback
checkpoints proved zero partial rows plus later recovery. The TODO row adds 18
interval checkpoints covering complete cycles, per-request response checks,
final empty state, and post-load recovery. Both disk workloads retained WAL
mode and non-empty live DB/WAL/SHM files.

The post-fix candidate comparison reruns the Hono basic, counter-actor, empty
SQLite, and nested-profile rows at clean source commit `932743e`. Its 48 load
samples all pass with success rate 1.0. TinyTSX reaches 0.25–0.38x Bun at
concurrency 8 and 0.39–0.63x at concurrency 64, with 12.576–16.008 ms
concurrency-64 p99 versus Bun at 0.835–1.283 ms. These four rows supersede
their historical counterparts when evaluating the pressure-aware scheduler;
the wider sixteen-workload matrix remains the breadth baseline.

The TODO application comparison runs at clean harness commit `efed239` with a
bounded closed-loop client because its record IDs are created at runtime. One
fixed user per client worker owns at most one record; every create, list,
complete, and delete response is validated before that worker continues. At
concurrency 8/64 TinyTSX reaches 15,905/17,367 checked HTTP requests per second
versus Bun at 23,359/23,049 (0.68x/0.75x). Warm RSS is 8.16 MiB versus
66.38 MiB. TinyTSX p99 is 1.624/50.026 ms versus Bun at 0.939/8.365 ms, so the
workload strengthens the footprint result but exposes high-concurrency tail
latency as the clearest remaining performance cost.

Across the fourteen successful small-response rows, TinyTSX reaches
0.24–1.14x Bun throughput at concurrency 8 and 0.40–0.79x at concurrency 64 on
three 15-second samples. The expected-500 full-rollback row reaches 0.01x/0.06x.
The exact 22,173-byte warm-cache response is
the exception: TinyTSX reaches 1.30x Bun at concurrency 8 and 1.78x at 64.
TinyTSX's concurrency-64 p99 remains higher on every route at 9.575–108.839 ms
versus Bun at 0.736–13.504 ms; the WAL contention route sets both maxima.

The historical conclusion at that checkpoint was:

- **yes for footprint:** TinyTSX stays at 6.30–8.86 MiB warm RSS; Bun uses
  7.3x–24.6x as much across the sixteen workloads;
- **repeated startup is close on the fourteen successful small-response routes:** TinyTSX takes
  19.68–23.70 ms and Bun 17.30–21.31 ms; the WAL route includes two connection
  setups and takes 49.48/26.07 ms, while TinyTSX's separately reported first
  post-build launch remains a 437.66–547.26 ms outlier;
- **no general throughput-parity claim:** TinyTSX reaches 40–79% of Bun at
  concurrency 64 on the original small-response routes and only 6% on the
  expected-500 rollback row, while the exact 22 KiB route reaches 178%;
- **tail latency remains open:** TinyTSX's concurrency-64 p99 is 4.3–20.6x
  Bun's despite the large-response throughput result;
- **owner boundaries are visible:** in the pressure-aware rerun the actor route
  is 6.8% below TinyTSX's basic control at concurrency 64 and the empty SQLite
  route is 19.5% below it;
- **transaction depth has a measured route cost:** versus the empty SQLite
  route, the two-write/non-empty-row route changes TinyTSX throughput by -0.4%
  at concurrency 8 and -12.3% at 64; Bun changes by -26.2%/-32.0%;
- **closed pretty JSON is inexpensive here:** versus compact JSON, TinyTSX loses
  0.3% throughput at concurrency 64 while Bun loses 23.2%;
- **bounded request JSON is now measured:** the fixed 65-byte primitive POST
  reaches 0.45x/0.64x Bun at concurrency 8/64 with 7.34 MiB warm RSS; it is not
  evidence for dynamic keys, structured values, validation, or mixed bodies;
- **nested request persistence is now measured:** the fixed 87-byte profile
  POST selects four nested primitive leaves, performs two idempotent prepared
  writes, and returns 104 response bytes. In the pressure-aware rerun TinyTSX
  reaches 0.35x/0.59x Bun at concurrency 8/64 with 8.86 MiB versus 72.25 MiB
  warm RSS; concurrency-64 p99 is 16.008 ms versus 1.283 ms;
- **authenticated bounded CRUD is now measured:** the pinned TODO application
  completes checked create/list/complete/delete cycles at 0.68x/0.75x Bun
  throughput for concurrency 8/64, uses 8.16 MiB versus 66.38 MiB warm RSS,
  and restores every worker user to empty state; concurrency-64 p99 reaches
  50.026 ms versus 8.365 ms, so this is not latency parity;
- **multi-actor progress is now measured:** the eight-owner mutation workload
  reaches 0.40x/0.76x Bun at concurrency 8/64, retains positive balanced state
  for every owner, and uses 6.64 MiB warm RSS; the eight-Worker Bun process uses
  120.77 MiB warm RSS and records a 703.77 MiB median peak under load;
- **two-owner WAL contention is now measured:** every request performs one
  successful savepoint rollback plus one durable progress commit. TinyTSX
  reaches 1.14x Bun at concurrency 8 but 0.58x at 64; its p99 grows from 4.483
  to 108.839 ms, making writer scheduling and lock handoff a concrete profiling
  target rather than an inferred SQLite concern;
- **failed full rollback is now measured:** every declared 500 leaves zero
  partial rows and a later recovery commit progresses. TinyTSX reaches
  605/4,545 requests per second at concurrency 8/64 versus Bun at
  71,849/73,923, with 8.05/75.81 MiB warm RSS; the owner/error path needs
  profiling before this can be considered a practical high-rate failure path;
- **process pressure needs profiling:** TinyTSX records greater aggregate CPU
  on fourteen workloads; Bun records more on the 21-byte file, WAL contention,
  and full-rollback rows. TinyTSX records more Unix syscalls on the original
  fifteen plus the TODO row but Bun records more on full rollback; TinyTSX
  records more context switches on sixteen rows;
- **bounded resources recover:** the original workloads return to four TinyTSX
  descriptors; the live two-connection WAL route returns from 73 to its
  nine-descriptor database baseline. The full-rollback row returns from 59 to
  seven for TinyTSX and 72 to eight for Bun. The TODO row returns from 68 to
  four for TinyTSX and 69 to five for Bun.

The current baseline summary is
`benchmarks/results/2026-07-17-m5-max-sustained-15s-summary.md`; the later
`2026-07-18-m5-max-sustained-15s-hono-nested-profile-keepalive-w8.*` pair adds
the nested-profile row; the adjacent
`2026-07-18-m5-max-sustained-15s-hono-stytch-todo-keepalive-w8.*` pair adds the
response-checked real-world CRUD row. The current scheduler comparison is
`benchmarks/results/2026-07-18-m5-max-pressure-aware-15s-summary.md`; its four
adjacent JSON/Markdown pairs retain all 48 post-fix load samples. Each
per-workload report pins the response differences and limitations.
Cold/replaced/binary files, responses
above 32 KiB, streaming/range/compression behavior, cross-process writers,
growing or broader request-derived database state,
competing/catch-all route shapes, arbitrary query values, dynamic JSON keys,
arrays, arbitrary schemas, mixed request bodies, cancellation,
and actor supervision/restart/persistence load remain unmeasured.

The five-second alpha comparison and earlier connection-close, JSX, streaming,
Worker, and AI-provider results below are historical evidence. They remain
useful for explaining the optimization sequence. The sustained matrix is the
breadth baseline; the pressure-aware four-workload rerun is the current
release-candidate scheduler evidence.

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
request count for at most sixteen hot requests per executor turn. When no
complete next head is buffered, a POSIX readiness poll waits one millisecond
under queue pressure. A pressured idle connection rotates at most sixteen
times before closing. Single-worker or previously pressured connections use a
100-millisecond idle reuse wait when no work is queued; never-contended
multi-worker connections retain the five-second bound. Ready socket input
continues on the same executor without losing parser bytes. The external queue
and resubmission boundary remain bounded.

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

Those results predate pressure-aware idle-connection scheduling. They remain
historical evidence for the sixteen-request hot path. The current controlled
rerun at clean source `932743e` retains three 15-second samples at concurrency
8/64 for the basic, actor, SQLite, and nested-profile routes. All 48 load
samples pass and TinyTSX descriptors return from 68 to four. TinyTSX reaches
38,359/71,646 basic requests per second, 34,918/66,797 actor requests per
second, 32,282/57,703 SQLite requests per second, and 32,183/56,376 nested
profile requests per second at concurrency 8/64.

The historical basic row at `7c1a22c` reached 44,669/79,044 requests per second
and recorded 63.26 seconds of TinyTSX CPU. The current basic row records
70.49 seconds while reaching 38,359/71,646. This is a measurable
correctness/stability tradeoff from preventing single-worker idle-socket
starvation, not a performance improvement. The combined current report is
`benchmarks/results/2026-07-18-m5-max-pressure-aware-15s-summary.md`.

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

The current tasks and accepted results are summarized at the top of this file;
the historical roadmap below is retained to explain the optimization sequence.
