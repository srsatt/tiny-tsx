# Sustained seven-workload comparison

Collected on 2026-07-17 local time; reports were rendered on 2026-07-18 UTC.

This matrix compares seven exact Hono routes. The original five use clean commit
`7c1a22c`; the route-parameter tracer uses clean commit `04ac58b`; and the file
tracer uses clean commit `c16333f`. The commits have identical compiler/runtime
source; the intervening changes add benchmark evidence, documentation, and
harness entries. This is longer release-stability evidence, not a general
AOT/JIT or JavaScript-runtime claim.

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

All 84 load samples completed with success rate 1.0. No samples were discarded.

## Throughput and latency

Values are medians of the three retained load samples.

| Workload | Tiny/Bun RPS c8 | Tiny p99 / Bun p99 c8 | Tiny/Bun RPS c64 | Tiny p99 / Bun p99 c64 |
| --- | ---: | ---: | ---: | ---: |
| Hono basic | 44,669 / 135,247 (0.33x) | 0.247 / 0.106 ms | 79,044 / 153,060 (0.52x) | 11.559 / 0.830 ms |
| Dynamic JSX | 58,782 / 127,140 (0.46x) | 1.172 / 0.119 ms | 93,596 / 139,058 (0.67x) | 9.575 / 0.877 ms |
| Optional route parameter | 58,997 / 140,060 (0.42x) | 1.160 / 0.107 ms | 92,459 / 163,341 (0.57x) | 9.755 / 0.736 ms |
| Bounded file read | 32,015 / 59,317 (0.54x) | 1.602 / 0.249 ms | 42,969 / 77,213 (0.56x) | 20.939 / 1.698 ms |
| Finite text stream | 32,391 / 78,808 (0.41x) | 2.680 / 0.340 ms | 58,211 / 80,664 (0.72x) | 15.622 / 1.683 ms |
| Counter actor | 35,690 / 92,896 (0.38x) | 0.367 / 0.149 ms | 69,988 / 107,180 (0.65x) | 12.935 / 1.194 ms |
| Empty SQLite query | 32,430 / 132,946 (0.24x) | 2.161 / 0.112 ms | 59,545 / 148,474 (0.40x) | 15.282 / 0.821 ms |

TinyTSX does not reach Bun throughput parity in this matrix. Its ratio improves
at concurrency 64, ranging from 0.40x to 0.72x, but its concurrency-64 p99 is
9.575–20.939 ms versus Bun at 0.736–1.698 ms. At concurrency 8, TinyTSX reaches
0.24x–0.54x Bun.

The actor route is 20.1% below the same-run TinyTSX basic control at concurrency
8 and 11.5% below it at 64; Bun's Worker route is 31.3% and 30.0% below its
control. The SQLite route is 27.4% and 24.7% below TinyTSX's control, while
Bun's synchronous SQLite route is 1.7% and 3.0% below its control. These are
end-to-end route deltas, not isolated actor or database operation costs.

The dynamic JSX route is not a direct cost delta against `hono-basic`: the
control includes `poweredBy` and response-time middleware that the escaping
tracer does not. The stream also differs on the wire: TinyTSX emits three
chunks, while Bun emits the same decoded 19-byte body with a content length.

## Startup and footprint

| Workload | Repeated startup Tiny/Bun | First launch Tiny/Bun | Warm RSS Tiny/Bun | Peak RSS Tiny/Bun |
| --- | ---: | ---: | ---: | ---: |
| Hono basic | 22.75 / 18.63 ms | 450.78 / 28.68 ms | 6.58 / 124.42 MiB | 6.94 / 127.77 MiB |
| Dynamic JSX | 20.99 / 20.15 ms | 453.83 / 20.15 ms | 6.36 / 107.34 MiB | 6.39 / 108.92 MiB |
| Optional route parameter | 21.98 / 18.52 ms | 454.85 / 37.84 ms | 6.38 / 79.02 MiB | 6.39 / 81.09 MiB |
| Bounded file read | 20.00 / 18.85 ms | 449.24 / 26.16 ms | 6.97 / 84.94 MiB | 7.22 / 85.66 MiB |
| Finite text stream | 22.07 / 21.31 ms | 547.26 / 29.77 ms | 6.30 / 154.70 MiB | 6.42 / 154.81 MiB |
| Counter actor | 22.84 / 18.45 ms | 452.39 / 29.11 ms | 6.63 / 108.56 MiB | 6.97 / 149.50 MiB |
| Empty SQLite query | 22.86 / 17.49 ms | 451.07 / 27.60 ms | 8.06 / 70.33 MiB | 8.19 / 71.84 MiB |

Repeated startup is close: TinyTSX is 20.00–22.86 ms and Bun is
17.49–21.31 ms. TinyTSX's first post-build launch is a separate 449.24–547.26
ms outlier and must not be folded into that repeated-startup claim.

TinyTSX warm RSS stays at 6.30–8.06 MiB. Bun uses 8.7x–24.6x as much warm RSS
across the seven routes. The footprint advantage remains the clearest result in
this matrix.

## Whole-process pressure

Counters cover warm-up and both load points for one process. Request totals
differ between targets, so these aggregates identify profiling directions and
must not be interpreted as normalized per-request costs.

| Workload | Target | CPU / utilization | Unix / Mach syscalls | Context switches | Faults | Peak threads | FDs start/peak/end |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Hono basic | TinyTSX | 63.26 s / 201.1% | 46,350,379 / 2,672 | 2,219,839 | 51 | 9 | 4/68/4 |
|  | Bun | 32.06 s / 101.5% | 9,899,399 / 689,444 | 148,168 | 5,545 | 15 | 5/69/5 |
| Dynamic JSX | TinyTSX | 46.31 s / 147.2% | 38,339,857 / 2,567 | 2,574,394 | 19 | 9 | 4/68/4 |
|  | Bun | 31.25 s / 99.0% | 9,083,597 / 582,375 | 117,410 | 4,376 | 17 | 5/69/5 |
| Optional route parameter | TinyTSX | 45.87 s / 145.8% | 37,919,166 / 2,563 | 2,552,096 | 17 | 9 | 4/68/4 |
|  | Bun | 30.86 s / 97.6% | 10,491,424 / 505,707 | 162,077 | 2,687 | 16 | 5/69/5 |
| Bounded file read | TinyTSX | 135.57 s / 432.1% | 44,293,598 / 2,339,261 | 4,793,336 | 57 | 17 | 4/71/4 |
|  | Bun | 194.68 s / 619.0% | 18,909,474 / 2,556,395 | 3,106,277 | 2,927 | 17 | 5/82/5 |
| Finite text stream | TinyTSX | 45.42 s / 144.6% | 42,863,782 / 2,682 | 1,629,722 | 21 | 9 | 4/68/4 |
|  | Bun | 33.74 s / 107.2% | 5,470,041 / 941,675 | 142,422 | 7,301 | 16 | 5/69/5 |
| Counter actor | TinyTSX | 66.76 s / 212.3% | 30,728,338 / 2,991,180 | 4,781,345 | 39 | 17 | 4/68/4 |
|  | Bun | 43.30 s / 137.4% | 10,148,273 / 8,434,556 | 1,920,004 | 6,728 | 17 | 6/70/6 |
| Empty SQLite query | TinyTSX | 76.54 s / 243.7% | 25,749,966 / 5,679,011 | 6,119,876 | 40 | 17 | 4/68/4 |
|  | Bun | 31.01 s / 98.2% | 9,610,831 / 475,285 | 113,794 | 2,130 | 16 | 5/69/5 |

TinyTSX records greater aggregate CPU, Unix-syscall, and context-switch
pressure on the six non-file routes. On the file route Bun records more CPU,
while TinyTSX still records more Unix syscalls and context switches. The file
route has the highest CPU totals for both targets; SQLite has TinyTSX's highest
context-switch count. This is evidence to profile application-executor,
filesystem, and owner-message boundaries; it is not enough by itself to choose
an optimization.

Descriptor lifetime is clean in the measured interval: every TinyTSX workload
returns to its baseline of 4. The non-file routes have a median peak of 68; the
file route has a median peak of 71 and observed run peaks of 70–74. Bun also
returns to its workload baseline.

## Boundaries and next evidence

The SQLite route uses one in-memory database, repeats `CREATE TABLE IF NOT
EXISTS`, executes an empty prepared `SELECT`, and emits a JSON envelope. It
does not measure rows, result copying, disk access, writes, or transactions.
The actor route uses one persistent zero-delta counter ask; it does not measure
mutation contention, restart, cancellation, supervision, persistence, or
multiple actors.

Still unmeasured in this sustained matrix:

- cold-cache, large-file, replacement, binary, and filesystem-denial load;
- non-empty SQLite results, disk I/O, and transaction writes;
- large responses and competing/catch-all route shapes;
- JSON/query branch mixes;
- cancellation and multi-actor contention.

Those require separate equivalence-checked workload entries before the broad
P4 benchmark item can be closed.

## Raw evidence

The adjacent `2026-07-17-m5-max-sustained-15s-*-keepalive-w8.json` files retain
every sample; the adjacent per-workload Markdown reports define the precise
response contract and limitations for each route.
