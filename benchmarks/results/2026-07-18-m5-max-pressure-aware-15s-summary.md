# Pressure-aware keep-alive comparison

Collected on 2026-07-18 local time from clean source commit `932743e`.

This matrix repeats the Hono basic control, single-counter actor, empty
in-memory SQLite, and bounded nested-profile workloads after pressure-aware
HTTP keep-alive scheduling replaced the idle blocking behavior. It is evidence
for these four exact localhost routes, not a general AOT/JIT or JavaScript
runtime claim.

## Protocol

- Apple M5 Max, 18 cores, 128 GiB RAM, macOS 26.5.2;
- Bun 1.3.13 and oha 1.15.0;
- one server process per target, eight TinyTSX HTTP workers, HTTP/1.1
  keep-alive for both targets;
- five fresh-process startup samples;
- three 15-second load samples at concurrency 8 and 64, with target and
  concurrency order alternated;
- allocator instrumentation disabled;
- status, body, headers, and framing checked before measurement.

All 48 load samples completed with success rate 1.0. No samples were discarded.
Every TinyTSX process returned from 68 peak file descriptors to its baseline of
four.

## Throughput and latency

Values are medians of the three retained load samples.

| Workload | Tiny/Bun RPS c8 | Tiny p99 / Bun p99 c8 | Tiny/Bun RPS c64 | Tiny p99 / Bun p99 c64 |
| --- | ---: | ---: | ---: | ---: |
| Hono basic | 38,359 / 133,860 (0.29x) | 0.333 / 0.108 ms | 71,646 / 151,322 (0.47x) | 12.576 / 0.892 ms |
| Counter actor | 34,918 / 92,274 (0.38x) | 0.348 / 0.151 ms | 66,797 / 106,091 (0.63x) | 13.668 / 1.231 ms |
| Empty SQLite query | 32,282 / 130,854 (0.25x) | 2.194 / 0.114 ms | 57,703 / 146,648 (0.39x) | 15.675 / 0.835 ms |
| Nested profile | 32,183 / 92,978 (0.35x) | 3.403 / 0.164 ms | 56,376 / 95,720 (0.59x) | 16.008 / 1.283 ms |

TinyTSX reaches 0.25–0.38x Bun throughput at concurrency 8 and 0.39–0.63x at
concurrency 64. Its concurrency-64 p99 is 12.576–16.008 ms versus Bun at
0.835–1.283 ms. The actor route is 9.0% below TinyTSX's same-run basic control
at concurrency 8 and 6.8% below it at 64; Bun's Worker route is 31.1% and 29.9%
below its control. The SQLite route is 15.8% and 19.5% below TinyTSX's control,
while Bun's synchronous SQLite route is 2.2% and 3.1% below its control. These
are complete route deltas, not isolated operation costs.

The nested-profile route selects four bounded request primitives, performs two
idempotent prepared writes in one callback transaction, and returns the nested
response. Relative to the empty SQLite route, its TinyTSX throughput is within
0.3% at concurrency 8 and 2.3% lower at 64. The Bun route uses a different
response and transaction shape, so the cross-row delta is not an isolated
nested-path cost.

## Startup and footprint

| Workload | Repeated startup Tiny/Bun | First launch Tiny/Bun | Warm RSS Tiny/Bun | Peak RSS Tiny/Bun |
| --- | ---: | ---: | ---: | ---: |
| Hono basic | 23.12 / 21.31 ms | 447.37 / 29.37 ms | 6.55 / 123.22 MiB | 6.92 / 126.44 MiB |
| Counter actor | 23.10 / 18.19 ms | 451.11 / 26.66 ms | 6.67 / 106.91 MiB | 6.98 / 147.39 MiB |
| Empty SQLite query | 25.83 / 21.99 ms | 456.96 / 117.89 ms | 7.91 / 70.08 MiB | 8.03 / 71.27 MiB |
| Nested profile | 22.68 / 20.47 ms | 460.53 / 27.16 ms | 8.86 / 72.25 MiB | 9.03 / 74.69 MiB |

TinyTSX warm RSS stays at 6.55–8.86 MiB while Bun uses 70.08–123.22 MiB.
Repeated startup is 22.68–25.83 ms for TinyTSX and 18.19–21.99 ms for Bun.
TinyTSX's first post-build launch remains a separate 447.37–460.53 ms outlier
and is not folded into the repeated-startup claim.

## Whole-process pressure

Counters cover warm-up and both load points for one process. Request totals
differ between targets, so aggregate counters identify profiling directions
and are not normalized per-request costs.

| Workload | TinyTSX CPU | Unix syscalls | Context switches | FDs start/peak/end |
| --- | ---: | ---: | ---: | ---: |
| Hono basic | 70.49 s | 42,939,728 | 2,020,528 | 4/68/4 |
| Counter actor | 71.68 s | 30,953,979 | 4,643,969 | 4/68/4 |
| Empty SQLite query | 79.40 s | 26,470,649 | 6,007,940 | 4/68/4 |
| Nested profile | 82.10 s | 25,646,600 | 5,849,902 | 4/68/4 |

The historical clean basic row at `7c1a22c` reached 44,669/79,044 requests per
second at concurrency 8/64 and recorded 63.26 seconds of TinyTSX CPU. The
pressure-aware row reaches 38,359/71,646 and records 70.49 seconds. Machine
noise prevents treating this as a precise isolated scheduler cost, but the
direction is clear: the single-worker starvation fix carries a control-path
throughput and CPU penalty. It is retained as a bounded correctness and
stability tradeoff, not presented as a performance improvement.

## Boundaries and next evidence

The scheduler preserves a maximum sixteen-request hot turn. Under queued work,
an idle connection uses one-millisecond POSIX readiness polls and closes after
sixteen empty pressured rotations. A single-worker or previously pressured
connection uses a 100-millisecond idle reuse wait once the queue clears;
never-contended multi-worker connections retain the five-second idle bound.

The reports do not cover connection counts above the bounded queue, slow
partial request heads, long-duration churn, external network latency, growing
SQLite data, disk I/O, rollback frequency, arbitrary nested schemas, actor
supervision, or mixed application traffic. Native Apple and Linux release
verification at one exact later source commit remains a separate gate.

Raw evidence is retained in the adjacent
`2026-07-18-m5-max-pressure-aware-15s-{hono-basic,hono-actor,hono-sqlite,hono-nested-profile}-keepalive-w8.{json,md}`
reports.
