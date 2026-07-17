# TinyTSX hono actor benchmark (8 worker(s))

Generated: 2026-07-17T13:08:48+00:00

> Scope: one persistent signed counter actor behind a pinned Hono ask/reply route; zero-delta reads through bounded copied messages; HTTP/1.1; localhost. HTTP/1.1 connections are reused; one server process. This is not a general dynamic-language benchmark.

## Environment

- Machine: Model Name: MacBook Pro; Model Identifier: Mac17,6; Chip: Apple M5 Max; Total Number of Cores: 18 (6 Super and 12 Performance); Memory: 128 GB
- OS: macOS 26.5.2
- TinyTSX commit: `a52fe18`
- Bun: 1.3.13
- oha: oha 1.15.0
- Runs per point: 3
- Duration per run: 5 seconds

## Footprint and startup

| Target | First launch | Startup median | Idle RSS median | Post-warm-up RSS median | Peak sampled RSS | App artifact | Runtime executable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 465.90 ms | 20.93 ms | 6.36 MiB | 6.56 MiB | 6.69 MiB | 2.26 MiB | 2.26 MiB |
| Bun | 40.76 ms | 19.04 ms | 43.97 MiB | 106.19 MiB | 112.55 MiB | 0.90 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.
Peak RSS is sampled from the server every 20 ms throughout warm-up and all load points.

## Process and optional allocation pressure

| Target | Server CPU | CPU utilization | Unix syscalls | Mach syscalls | Context switches | Page faults |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 16.11 s | 258.0% | 7,611,573 | 839,586 | 1,286,002 | 21 |
| Bun | 8.35 s | 133.5% | 1,889,034 | 1,752,832 | 330,944 | 4,389 |

Counters are per measured server process from warm-up through the final load point; medians are across runs.

| TinyTSX allocator | Calls | Reallocations | Requested bytes | Peak live bytes | Live bytes at shutdown |
| --- | ---: | ---: | ---: | ---: | ---: |
| Global allocator | 3,052,002 | 17 | 463.66 MiB | 2.03 MiB | 8.54 KiB |

Allocator counters cover the TinyTSX process from startup through graceful shutdown. They add atomic counter overhead and are disabled in ordinary builds. Bun does not expose an equivalent counter in this harness, so no allocation ratio is claimed.

## Response contract

- Status: 200
- Body: `0` (1 bytes)
- TinyTSX Content-Type: `text/plain; charset=UTF-8`
- Bun Content-Type: `text/plain; charset=UTF-8`
- TinyTSX framing: `1`
- Bun framing: `1`

## Throughput and latency

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 64 | 72,382 | 105,892 | 0.68x | 0.107 ms | 0.484 ms | 40.860 ms | 1.260 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 8 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- TinyTSX uses its local actor mailbox while Bun uses one Worker-owned counter; the zero-delta route measures ownership/message overhead without persistence, mutation contention, supervision, or distributed actors.
- TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer.
- Power mode and unrelated background activity are not controlled by the harness.
