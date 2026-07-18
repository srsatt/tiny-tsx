# Sustained fifteen-workload comparison

Collected on 2026-07-17 and 2026-07-18 local time.

This matrix compares fifteen exact Hono workloads. The original five use clean
commit `7c1a22c`; the route-parameter tracer uses clean commit `04ac58b`; the 21-byte
file tracer uses clean commit `c16333f`; and the 22,173-byte file/response tracer
uses clean commit `097982d`. The compact/pretty JSON pair uses clean commit
`a6cc7ae`; the prepared transaction tracer uses clean commit `c488480`. Those
first eleven reports have identical compiler/runtime source. The bounded JSON
request tracer uses clean commit `b35b608`, which adds its request-field ABI and
safe application-400 keep-alive recovery; its row is not used as a same-runtime
delta against the earlier controls. The eight-actor mixed-route tracer uses
clean commit `528ecd6` and adds a response-equivalent URL-set contract plus
post-load state checks. This is longer release-stability evidence, not a general
AOT/JIT or JavaScript-runtime claim.
The two-owner WAL tracer uses clean commit `07efc5d`; it adds isolated
target-private disk state, setup routes, live file/state checkpoints, and a
two-Worker Bun adapter without changing the earlier compiler/runtime rows.
The required-header full-transaction rollback tracer uses clean commit
`794ba22`; it adds copied request-header SQLite values, an expected-500 load
contract, and recovery/partial-row checkpoints.

## Protocol

- Apple M5 Max, 18 cores, 128 GiB RAM, macOS 26.5.2;
- Bun 1.3.13 and oha 1.15.0;
- one server process per target, eight TinyTSX HTTP workers, HTTP/1.1
  keep-alive for both targets;
- five fresh-process startup samples;
- three 15-second samples at concurrency 8 and 64, with target and concurrency
  order alternated;
- allocator instrumentation disabled;
- status, body, headers, and framing checked before measurement, with declared
  target-specific differences retained in each workload report.

All 180 load samples completed with success rate 1.0. No samples were discarded.
The multi-actor workload additionally retained 18 warm-up/load state snapshots;
every actor state was positive at every checkpoint. The WAL workload retained
18 more checkpoints; every committed counter progressed within its run, every
rollback probe stayed zero, journal mode stayed `wal`, and every live DB/WAL/SHM
file was non-empty. The full-rollback workload retained 18 more checkpoints;
every failed transaction left zero partial rows, every recovery counter
progressed within its run, and every WAL file remained live and non-empty.

## Throughput and latency

Values are medians of the three retained load samples.

| Workload | Tiny/Bun RPS c8 | Tiny p99 / Bun p99 c8 | Tiny/Bun RPS c64 | Tiny p99 / Bun p99 c64 |
| --- | ---: | ---: | ---: | ---: |
| Hono basic | 44,669 / 135,247 (0.33x) | 0.247 / 0.106 ms | 79,044 / 153,060 (0.52x) | 11.559 / 0.830 ms |
| Compact JSON | 44,124 / 120,693 (0.37x) | 0.256 / 0.128 ms | 79,149 / 130,313 (0.61x) | 11.436 / 0.952 ms |
| Pretty JSON | 43,199 / 97,326 (0.44x) | 0.241 / 0.138 ms | 78,936 / 100,046 (0.79x) | 11.519 / 1.227 ms |
| Request JSON primitives | 58,034 / 129,430 (0.45x) | 0.960 / 0.118 ms | 90,387 / 142,296 (0.64x) | 9.937 / 0.857 ms |
| Dynamic JSX | 58,782 / 127,140 (0.46x) | 1.172 / 0.119 ms | 93,596 / 139,058 (0.67x) | 9.575 / 0.877 ms |
| Optional route parameter | 58,997 / 140,060 (0.42x) | 1.160 / 0.107 ms | 92,459 / 163,341 (0.57x) | 9.755 / 0.736 ms |
| Bounded file read | 32,015 / 59,317 (0.54x) | 1.602 / 0.249 ms | 42,969 / 77,213 (0.56x) | 20.939 / 1.698 ms |
| 22 KiB file response | 31,858 / 24,457 (1.30x) | 0.618 / 0.569 ms | 40,856 / 22,976 (1.78x) | 22.030 / 5.104 ms |
| Finite text stream | 32,391 / 78,808 (0.41x) | 2.680 / 0.340 ms | 58,211 / 80,664 (0.72x) | 15.622 / 1.683 ms |
| Counter actor | 35,690 / 92,896 (0.38x) | 0.367 / 0.149 ms | 69,988 / 107,180 (0.65x) | 12.935 / 1.194 ms |
| Eight counter actors | 38,366 / 96,986 (0.40x) | 0.286 / 0.156 ms | 76,825 / 100,666 (0.76x) | 11.806 / 1.199 ms |
| Empty SQLite query | 32,430 / 132,946 (0.24x) | 2.161 / 0.112 ms | 59,545 / 148,474 (0.40x) | 15.282 / 0.821 ms |
| Prepared SQLite transaction | 32,292 / 98,111 (0.33x) | 3.375 / 0.138 ms | 52,193 / 100,896 (0.52x) | 17.293 / 1.214 ms |
| On-disk WAL rollback/commit | 7,850 / 6,880 (1.14x) | 4.483 / 4.669 ms | 8,554 / 14,872 (0.58x) | 108.839 / 13.504 ms |
| Failed full transaction rollback | 605 / 71,849 (0.01x) | 16.541 / 0.209 ms | 4,545 / 73,923 (0.06x) | 34.160 / 1.656 ms |

TinyTSX does not reach general Bun throughput parity in this matrix. Across the
original thirteen small-response routes it reaches 0.24x–1.14x Bun at
concurrency 8 and 0.40x–0.79x at concurrency 64. The expected-500 rollback row
reaches 0.01x/0.06x. On the exact 22,173-byte warm-cache response it
reaches 1.30x Bun at concurrency 8 and 1.78x at concurrency 64. Concurrency-64
p99 remains higher for every route: TinyTSX records 9.575–108.839 ms versus Bun
at 0.736–13.504 ms. The two-writer WAL row sets both maxima.

The actor route is 20.1% below the same-run TinyTSX basic control at concurrency
8 and 11.5% below it at 64; Bun's Worker route is 31.3% and 30.0% below its
control. The SQLite route is 27.4% and 24.7% below TinyTSX's control, while
Bun's synchronous SQLite route is 1.7% and 3.0% below its control. These are
end-to-end route deltas, not isolated actor or database operation costs.

The eight-actor route cycles eight response-equivalent fire-and-forget mutation
paths and reads every actor after warm-up and each load interval. Its final
TinyTSX states span 225,345–226,787 and Bun states span 383,232–384,219, proving
that every owner continued to receive work. This workload differs from the
single-actor ask/reply route, so their throughput difference is not an isolated
actor-count or tell-versus-ask cost.

The upstream pretty branch expands the same closed four-record array from 129
to 202 bytes. Relative to compact JSON, TinyTSX throughput is 2.1% lower at
concurrency 8 and 0.3% lower at 64; Bun is 19.4% and 23.2% lower. This is an
end-to-end query-presence and formatting delta for one closed array, not a
general JSON serializer comparison.

The request-body route posts and returns the same fixed 65-byte object with one
string, number, boolean, and null field. TinyTSX reaches 0.45x Bun at concurrency
8 and 0.64x at 64. This row measures the new bounded parser/selected-field ABI;
it does not cover dynamic keys, structured values, schema validation, or mixed
request bodies, and it is not a same-runtime delta against the earlier rows.

Relative to the empty SQLite route, the prepared transaction route changes
TinyTSX throughput by -0.4% at concurrency 8 and -12.3% at 64; Bun changes by
-26.2% and -32.0%. The transaction route performs two idempotent writes plus a
non-empty row copy and emits 41 bytes instead of an empty 13-byte envelope, so
these are end-to-end route deltas rather than isolated transaction costs.

The WAL row uses two independent owners/connections to one on-disk file and
cycles both response-equivalent routes. Every transaction rolls back a
savepoint update and commits one separate progress update with
`synchronous=FULL`. TinyTSX leads at concurrency 8 but reaches 0.58x Bun at 64;
its p99 expands from 4.483 to 108.839 ms. This is direct contention evidence,
not a failed full-transaction rollback, crash-durability, cross-process, or
storage-device benchmark.

The full-rollback row uses one WAL owner and copies a fixed required
`Idempotency-Key`, route parameter, and JSON integer into a two-step callback
transaction. The second step hits a pinned uniqueness conflict and the harness
requires the whole request to return 500 with no partial payment. A successful
recovery transaction follows every interval. TinyTSX reaches only 0.01x/0.06x
Bun at concurrency 8/64, even though warm RSS is 8.05 MiB versus 75.81 MiB.
This selects failed owner/error-path execution for profiling; it is not evidence
for application conflict handling or arbitrary request values.

The dynamic JSX route is not a direct cost delta against `hono-basic`: the
control includes `poweredBy` and response-time middleware that the escaping
tracer does not. The stream also differs on the wire: TinyTSX emits three
chunks, while Bun emits the same decoded 19-byte body with a content length.

## Startup and footprint

| Workload | Repeated startup Tiny/Bun | First launch Tiny/Bun | Warm RSS Tiny/Bun | Peak RSS Tiny/Bun |
| --- | ---: | ---: | ---: | ---: |
| Hono basic | 22.75 / 18.63 ms | 450.78 / 28.68 ms | 6.58 / 124.42 MiB | 6.94 / 127.77 MiB |
| Compact JSON | 22.69 / 17.73 ms | 465.90 / 16.19 ms | 6.72 / 127.50 MiB | 6.80 / 128.78 MiB |
| Pretty JSON | 21.18 / 17.78 ms | 443.41 / 17.56 ms | 6.58 / 143.52 MiB | 6.67 / 144.53 MiB |
| Request JSON primitives | 19.68 / 17.30 ms | 452.36 / 29.34 ms | 7.34 / 75.33 MiB | 7.48 / 75.89 MiB |
| Dynamic JSX | 20.99 / 20.15 ms | 453.83 / 20.15 ms | 6.36 / 107.34 MiB | 6.39 / 108.92 MiB |
| Optional route parameter | 21.98 / 18.52 ms | 454.85 / 37.84 ms | 6.38 / 79.02 MiB | 6.39 / 81.09 MiB |
| Bounded file read | 20.00 / 18.85 ms | 449.24 / 26.16 ms | 6.97 / 84.94 MiB | 7.22 / 85.66 MiB |
| 22 KiB file response | 22.10 / 19.21 ms | 437.66 / 28.41 ms | 7.41 / 106.19 MiB | 7.67 / 106.72 MiB |
| Finite text stream | 22.07 / 21.31 ms | 547.26 / 29.77 ms | 6.30 / 154.70 MiB | 6.42 / 154.81 MiB |
| Counter actor | 22.84 / 18.45 ms | 452.39 / 29.11 ms | 6.63 / 108.56 MiB | 6.97 / 149.50 MiB |
| Eight counter actors | 22.71 / 18.77 ms | 448.96 / 27.55 ms | 6.64 / 120.77 MiB | 6.75 / 703.77 MiB |
| Empty SQLite query | 22.86 / 17.49 ms | 451.07 / 27.60 ms | 8.06 / 70.33 MiB | 8.19 / 71.84 MiB |
| Prepared SQLite transaction | 22.60 / 19.67 ms | 510.45 / 29.51 ms | 8.81 / 64.50 MiB | 8.94 / 64.88 MiB |
| On-disk WAL rollback/commit | 49.48 / 26.07 ms | 475.98 / 42.07 ms | 8.06 / 87.50 MiB | 8.12 / 126.67 MiB |
| Failed full transaction rollback | 33.46 / 25.70 ms | 469.52 / 39.23 ms | 8.05 / 75.81 MiB | 8.16 / 77.25 MiB |

Repeated startup is close on the original thirteen routes: TinyTSX is
19.68–22.86 ms and Bun is 17.30–21.31 ms. WAL startup includes two setup routes
and records 49.48/26.07 ms; full rollback records 33.46/25.70 ms. TinyTSX's first post-build launch remains a separate
437.66–547.26 ms outlier and must not be folded into repeated-startup claims.

TinyTSX warm RSS stays at 6.30–8.81 MiB. Bun uses 7.3x–24.6x as much warm RSS
across the fifteen workloads. The footprint advantage remains the clearest
result in this matrix.

The eight-Worker Bun adapter records 696.75–708.52 MiB peak RSS across its three
runs while returning to a 120.77 MiB post-warm-up median. TinyTSX records
6.72–6.77 MiB peaks for the eight lightweight actors. These are complete-process
observations that include each target's ownership implementation; they do not
isolate Worker construction, stacks, message queues, or garbage collection.

## Whole-process pressure

Counters cover warm-up and both load points for one process. Request totals
differ between targets, so these aggregates identify profiling directions and
must not be interpreted as normalized per-request costs.

| Workload | Target | CPU / utilization | Unix / Mach syscalls | Context switches | Faults | Peak threads | FDs start/peak/end |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Hono basic | TinyTSX | 63.26 s / 201.1% | 46,350,379 / 2,672 | 2,219,839 | 51 | 9 | 4/68/4 |
|  | Bun | 32.06 s / 101.5% | 9,899,399 / 689,444 | 148,168 | 5,545 | 15 | 5/69/5 |
| Compact JSON | TinyTSX | 62.41 s / 198.3% | 46,383,612 / 2,665 | 2,202,202 | 41 | 9 | 4/68/4 |
|  | Bun | 32.22 s / 102.0% | 8,538,877 / 707,223 | 113,298 | 5,574 | 16 | 5/69/5 |
| Pretty JSON | TinyTSX | 62.24 s / 197.9% | 46,025,827 / 2,675 | 2,183,112 | 32 | 9 | 4/68/4 |
|  | Bun | 32.61 s / 103.5% | 6,641,455 / 690,207 | 83,297 | 6,595 | 16 | 5/69/5 |
| Request JSON primitives | TinyTSX | 48.57 s / 154.4% | 37,347,542 / 2,558 | 2,540,784 | 87 | 9 | 4/68/4 |
|  | Bun | 31.04 s / 98.3% | 9,279,054 / 495,167 | 117,997 | 2,372 | 15 | 5/69/5 |
| Dynamic JSX | TinyTSX | 46.31 s / 147.2% | 38,339,857 / 2,567 | 2,574,394 | 19 | 9 | 4/68/4 |
|  | Bun | 31.25 s / 99.0% | 9,083,597 / 582,375 | 117,410 | 4,376 | 17 | 5/69/5 |
| Optional route parameter | TinyTSX | 45.87 s / 145.8% | 37,919,166 / 2,563 | 2,552,096 | 17 | 9 | 4/68/4 |
|  | Bun | 30.86 s / 97.6% | 10,491,424 / 505,707 | 162,077 | 2,687 | 16 | 5/69/5 |
| Bounded file read | TinyTSX | 135.57 s / 432.1% | 44,293,598 / 2,339,261 | 4,793,336 | 57 | 17 | 4/71/4 |
|  | Bun | 194.68 s / 619.0% | 18,909,474 / 2,556,395 | 3,106,277 | 2,927 | 17 | 5/82/5 |
| 22 KiB file response | TinyTSX | 149.76 s / 477.0% | 45,068,518 / 2,264,276 | 4,860,081 | 80 | 17 | 4/73/4 |
|  | Bun | 83.49 s / 266.2% | 19,592,870 / 1,247,176 | 1,147,201 | 4,336 | 17 | 5/82/5 |
| Finite text stream | TinyTSX | 45.42 s / 144.6% | 42,863,782 / 2,682 | 1,629,722 | 21 | 9 | 4/68/4 |
|  | Bun | 33.74 s / 107.2% | 5,470,041 / 941,675 | 142,422 | 7,301 | 16 | 5/69/5 |
| Counter actor | TinyTSX | 66.76 s / 212.3% | 30,728,338 / 2,991,180 | 4,781,345 | 39 | 17 | 4/68/4 |
|  | Bun | 43.30 s / 137.4% | 10,148,273 / 8,434,556 | 1,920,004 | 6,728 | 17 | 6/70/6 |
| Eight counter actors | TinyTSX | 64.42 s / 202.9% | 34,130,054 / 2,757 | 4,617,140 | 13 | 17 | 4/68/4 |
|  | Bun | 60.46 s / 191.7% | 12,426,790 / 10,811,972 | 4,085,302 | 40,229 | 23 | 13/77/13 |
| Empty SQLite query | TinyTSX | 76.54 s / 243.7% | 25,749,966 / 5,679,011 | 6,119,876 | 40 | 17 | 4/68/4 |
|  | Bun | 31.01 s / 98.2% | 9,610,831 / 475,285 | 113,794 | 2,130 | 16 | 5/69/5 |
| Prepared SQLite transaction | TinyTSX | 78.59 s / 250.3% | 23,061,120 / 7,877,903 | 6,744,232 | 90 | 17 | 4/68/4 |
|  | Bun | 31.26 s / 99.2% | 6,642,170 / 423,673 | 61,501 | 1,627 | 15 | 5/69/5 |
| On-disk WAL rollback/commit | TinyTSX | 17.16 s / 54.6% | 6,664,061 / 512,280 | 867,084 | 17 | 17 | 9/73/9 |
|  | Bun | 20.47 s / 65.3% | 4,495,278 / 1,939,601 | 948,618 | 4,932 | 17 | 12/76/12 |
| Failed full transaction rollback | TinyTSX | 8.98 s / 28.5% | 2,448,676 / 166,041 | 149,795 | 25 | 15 | 7/59/7 |
|  | Bun | 31.30 s / 99.5% | 18,428,891 / 4,956,239 | 61,484 | 2,404 | 16 | 8/72/8 |

TinyTSX records greater aggregate CPU on twelve workloads; Bun records more on
the 21-byte file, WAL, and full-rollback routes. TinyTSX records more Unix
syscalls on the original fourteen while Bun records more on full rollback.
TinyTSX records more context switches on the original thirteen and full
rollback; Bun records more on WAL. The two file routes have the highest CPU totals, while SQLite has
TinyTSX's highest context-switch count. This is evidence to profile
application-executor, filesystem, response-copy, and owner-message boundaries;
it is not enough by itself to choose an optimization.

Descriptor lifetime is clean in the measured interval: the original TinyTSX
workloads return to their baseline of 4. The non-file routes have a median peak of 68; the
21-byte file route has a median peak of 71 and observed run peaks of 70–74; the
22 KiB route has a median and per-run peak of 73. The WAL route returns from 73
to its live-database baseline of 9; Bun returns from 76 to 12. Bun also returns
to its workload baseline on every row. Full rollback returns from 59 to 7 for
TinyTSX and 72 to 8 for Bun.

## Boundaries and next evidence

The empty SQLite route uses one in-memory database, repeats `CREATE TABLE IF NOT
EXISTS`, executes an empty prepared `SELECT`, and emits a JSON envelope. It
does not measure rows, result copying, disk access, writes, or transactions. The
prepared transaction route adds two fixed-key idempotent writes in one callback
transaction and copies one non-empty row. The WAL route adds two independent
connections, disk/WAL I/O, writer contention, and successful savepoint rollback
with live file/state verification. The full-rollback row adds one required
header plus route/JSON values, a second-step uniqueness failure, and successful
connection reuse with live file/state verification. None measures growing
tables, broad request-derived value families, cross-process writers, or crash
durability.

The original actor route uses one persistent zero-delta counter ask. The
eight-actor route adds distributed `tell(+1)` mutation and read-back progress
across eight compile-time-known owners. Neither measures supervision,
persistence, remote identity, runtime registries, or request-derived messages.

Still unmeasured in this sustained matrix:

- cold-cache, files/responses above 32 KiB, replacement, binary, range,
  compression, and filesystem-denial load;
- cross-process writers, crash/power-loss durability, and growing or broader
  request-derived SQLite values;
- streamed/very-large responses and competing/catch-all route shapes;
- arbitrary query-value comparisons and randomized query/branch mixes;
- dynamic JSON keys or structured values, schema validation, and mixed request
  bodies;
- cancellation and actor supervision/restart/persistence load.

Those require separate equivalence-checked workload entries before the broad
P4 benchmark item can be closed.

## Raw evidence

The adjacent `2026-07-{17,18}-m5-max-sustained-15s-*-keepalive-w8.json` files
retain every sample; the adjacent per-workload Markdown reports define the
precise response contract and limitations for each route.
