# Alpha release benchmark summary

Generated: 2026-07-17

This is the controlled `0.1.0-alpha.1` TinyTSX/Bun comparison on commit
`0e8f53e`. It covers the complete pinned Hono basic application, one persistent
counter owner, and one in-memory SQLite owner. It is evidence for these exact
routes, not a general TypeScript, JavaScript, Hono, actor, or database result.

## Method

- Apple M5 Max, 18 cores, 128 GB, macOS 26.5.2;
- Bun 1.3.13 and oha 1.15.0;
- one server process per target, eight TinyTSX native workers, HTTP/1.1
  keep-alive enabled;
- five startup-to-first-response samples;
- three five-second load samples at concurrency 1, 8, 32, and 64;
- alternating target and concurrency order, with no discarded samples;
- response status, bytes, framing, and target-specific content type checked
  before measurements are accepted.

## Footprint and startup

| Workload | Tiny startup | Bun startup | Tiny idle RSS | Bun idle RSS | Tiny warm RSS | Bun warm RSS | Tiny artifact | Bun runtime |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Hono basic | 22.62 ms | 21.36 ms | 6.16 MiB | 41.33 MiB | 6.64 MiB | 123.61 MiB | 2.23 MiB | 60.15 MiB |
| Counter actor | 23.80 ms | 20.32 ms | 6.36 MiB | 44.38 MiB | 6.59 MiB | 108.08 MiB | 2.23 MiB | 60.15 MiB |
| SQLite owner | 23.35 ms | 21.31 ms | 7.55 MiB | 40.06 MiB | 7.86 MiB | 70.39 MiB | 2.23 MiB | 60.15 MiB |

Startup is effectively the same order of magnitude: TinyTSX is 1.26–3.48 ms
slower in these repeated samples. The reliable advantage is footprint. Bun uses
5.3–7.0x the idle RSS and 9.0–18.6x the post-warm-up RSS. A TinyTSX application
is a self-contained 2.23 MiB executable; Bun's 60.15 MiB runtime can be shared,
so its 0.35–0.90 KiB application scripts must be reported separately.

## Throughput

| Workload | Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun |
| --- | ---: | ---: | ---: | ---: |
| Hono basic | 1 | 7,266 | 25,938 | 0.28x |
| Hono basic | 8 | 38,090 | 135,155 | 0.28x |
| Hono basic | 32 | 81,349 | 150,811 | 0.54x |
| Hono basic | 64 | 83,700 | 152,435 | 0.55x |
| Counter actor | 1 | 7,074 | 21,324 | 0.33x |
| Counter actor | 8 | 33,176 | 93,034 | 0.36x |
| Counter actor | 32 | 71,068 | 109,495 | 0.65x |
| Counter actor | 64 | 73,168 | 106,371 | 0.69x |
| SQLite owner | 1 | 7,250 | 25,526 | 0.28x |
| SQLite owner | 8 | 32,248 | 133,402 | 0.24x |
| SQLite owner | 32 | 60,188 | 147,333 | 0.41x |
| SQLite owner | 64 | 64,173 | 148,312 | 0.43x |

TinyTSX does not match Bun's request rate in this keep-alive comparison. The
ratio improves with concurrency for the basic and actor routes, so the absence
of a JIT does not cause throughput collapse under this load, but it is not
evidence of parity. The known bounded connection-affinity policy also remains
visible in the tail.

| Workload at concurrency 64 | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |
| --- | ---: | ---: | ---: | ---: |
| Hono basic | 0.090 ms | 0.374 ms | 36.961 ms | 0.872 ms |
| Counter actor | 0.106 ms | 0.480 ms | 44.878 ms | 1.218 ms |
| SQLite owner | 0.121 ms | 0.391 ms | 46.328 ms | 0.821 ms |

Median service is short, but TinyTSX's c64 p99 is 37–46 ms because persistent
connections remain assigned to bounded worker turns. Improving socket fairness
is more urgent than speculating about JIT effects from these routes.

## Actor and SQLite route cost

The Hono basic workload is the same-run control. These percentages are
end-to-end route-rate differences, not isolated nanosecond costs: the routes
have different bodies and middleware as well as actor/SQLite work.

| Target/workload vs its Hono control | c1 | c8 | c32 | c64 |
| --- | ---: | ---: | ---: | ---: |
| TinyTSX counter actor | -2.6% | -12.9% | -12.6% | -12.6% |
| Bun Worker counter | -17.8% | -31.2% | -27.4% | -30.2% |
| TinyTSX SQLite owner | -0.2% | -15.3% | -26.0% | -23.3% |
| Bun synchronous SQLite | -1.6% | -1.3% | -2.3% | -2.7% |

The actor mailbox has a bounded, measurable cost while retaining TinyTSX's
small and flat RSS. SQLite's single application-owner serialization becomes a
larger throughput limit at concurrency 32–64; this result covers an in-memory
schema check and empty prepared query, not disk I/O, writes, contention, or
non-empty result copying.

## Raw evidence

- `2026-07-17-m5-max-alpha-hono-basic-keepalive-w8.{json,md}`
- `2026-07-17-m5-max-alpha-hono-actor-keepalive-w8.{json,md}`
- `2026-07-17-m5-max-alpha-hono-sqlite-keepalive-w8.{json,md}`

