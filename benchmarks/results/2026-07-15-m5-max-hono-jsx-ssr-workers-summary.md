# Hono JSX SSR worker-scaling baseline

Generated from the four adjacent `workers-w{1,2,4,8}.{json,md}` reports on an
Apple M5 Max. Every report used the exact pinned 31-module Hono JSX SSR root,
verified the same 881-byte response against Bun, and retained three one-second
samples at each concurrency. The client and server shared one machine and every
request opened a new TCP connection.

| Workers | Startup median | Idle RSS | Warm RSS | RPS c1 | RPS c8 | RPS c32 | RPS c64 | p99 c64 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 11.40 ms | 5.89 MiB | 6.05 MiB | 10,013 | 32,155 | 31,330 | 31,522 | 2.373 ms |
| 2 | 7.36 ms | 5.91 MiB | 6.08 MiB | 9,923 | 30,562 | 29,772 | 29,772 | 4.076 ms |
| 4 | 7.13 ms | 5.94 MiB | 6.20 MiB | 9,662 | 29,539 | 30,538 | 29,217 | 4.271 ms |
| 8 | 7.15 ms | 6.03 MiB | 6.41 MiB | 9,964 | 30,786 | 28,450 | 30,122 | 3.806 ms |

At concurrency 64, 2/4/8 workers delivered 0.94x/0.93x/0.96x the one-worker
throughput. Eight workers added only 0.36 MiB of warm RSS, but none improved
throughput or tail latency. The varying startup medians are within the known
short-run launch noise and do not show that more workers start faster.

This result is useful but narrow: the single acceptor plus TCP connect/close path
is already the ceiling, while the selected root body is pre-rendered. It does
not disprove parallel execution; the native saturation E2E separately proves
that a second worker progresses while one is blocked. It shows that adding
threads alone cannot make this transport-bound workload faster.

Next, add HTTP/1.1 keep-alive and a genuinely request-time Hono JSX workload,
then repeat the same worker matrix. Those two changes are required before
interpreting worker scaling or no-JIT application performance.

