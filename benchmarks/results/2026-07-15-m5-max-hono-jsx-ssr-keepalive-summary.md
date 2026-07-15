# Hono JSX SSR keep-alive worker scaling

Generated from the four adjacent `keepalive-w{1,2,4,8}.{json,md}` reports on an
Apple M5 Max. Every report used the exact pinned 31-module Hono JSX SSR root,
verified the same 881-byte response against Bun, and retained three one-second
samples at concurrency 1, 8, 32, and 64. Both targets reused HTTP/1.1
connections. TinyTSX bounds each connection at 100 requests or five idle
seconds; Bun may retain one longer.

| Workers | Startup median | Idle RSS | Warm RSS | RPS c1 | RPS c8 | RPS c32 | RPS c64 | p99 c64 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 7.62 ms | 5.88 MiB | 5.91 MiB | 24,156 | 24,760 | 24,035 | 23,783 | 133.569 ms |
| 2 | 7.72 ms | 5.89 MiB | 5.97 MiB | 24,352 | 42,233 | 42,536 | 42,988 | 72.794 ms |
| 4 | 7.62 ms | 5.94 MiB | 6.08 MiB | 24,681 | 68,777 | 72,164 | 70,886 | 42.273 ms |
| 8 | 7.50 ms | 6.00 MiB | 6.30 MiB | 24,731 | 86,471 | 96,023 | 102,796 | 26.293 ms |

At concurrency 64, 2/4/8 workers deliver 1.81x/2.98x/4.32x the one-worker
throughput. Eight workers add only 0.39 MiB of warm RSS. This proves that the
native executor scales once connection setup/teardown no longer hides it.

Against the Bun sample paired with each run, eight-worker TinyTSX reaches 0.90x
at concurrency 8, 0.97x at 32, and 1.04x at 64. Those throughput ratios are not
a general AOT-versus-JIT result: the body is pre-rendered and TinyTSX's p99 is
12.8–26.3 ms at concurrency 32–64 versus Bun's 0.6–1.3 ms. A live connection is
pinned to one blocking executor until its bounded turn ends, so queued
connections produce long tails even when aggregate throughput is high.

The next performance work should measure request-time JSX and improve connection
fairness without migrating live application execution between workers. Possible
experiments are a smaller request quantum with explicit parser-state handoff, a
nonblocking socket layer, or one listener per worker; none should replace the
current simple pool without profile and correctness evidence.

