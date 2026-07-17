# TinyTSX hono actor benchmark (8 worker(s))

Generated: 2026-07-17T13:06:53+00:00

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
| TinyTSX | 460.02 ms | 20.49 ms | 6.34 MiB | 6.56 MiB | 6.77 MiB | 2.25 MiB | 2.25 MiB |
| Bun | 26.41 ms | 17.46 ms | 43.92 MiB | 106.45 MiB | 128.73 MiB | 0.90 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.
Peak RSS is sampled from the server every 20 ms throughout warm-up and all load points.

## Process and optional allocation pressure

| Target | Server CPU | CPU utilization | Unix syscalls | Mach syscalls | Context switches | Page faults |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 37.78 s | 174.8% | 17,441,951 | 1,923,221 | 2,967,686 | 27 |
| Bun | 24.78 s | 114.6% | 5,717,384 | 4,601,207 | 1,278,667 | 5,452 |

Counters are per measured server process from warm-up through the final load point; medians are across runs.

| TinyTSX allocator | Calls | Reallocations | Requested bytes | Peak live bytes | Live bytes at shutdown |
| --- | ---: | ---: | ---: | ---: | ---: |
| Global allocator | disabled | disabled | disabled | disabled | disabled |

Allocator counters are disabled for this comparison, so the TinyTSX throughput path has no instrumentation overhead.

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
| 1 | 8,269 | 20,663 | 0.40x | 0.052 ms | 0.046 ms | 1.623 ms | 0.068 ms |
| 8 | 35,846 | 88,790 | 0.40x | 0.118 ms | 0.083 ms | 0.659 ms | 0.166 ms |
| 32 | 70,678 | 103,545 | 0.68x | 0.110 ms | 0.315 ms | 16.450 ms | 0.896 ms |
| 64 | 71,009 | 103,911 | 0.68x | 0.109 ms | 0.493 ms | 41.942 ms | 1.298 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 8 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- TinyTSX uses its local actor mailbox while Bun uses one Worker-owned counter; the zero-delta route measures ownership/message overhead without persistence, mutation contention, supervision, or distributed actors.
- TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer.
- Power mode and unrelated background activity are not controlled by the harness.
