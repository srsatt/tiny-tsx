# TinyTSX hono actor benchmark (8 worker(s))

Generated: 2026-07-18T00:24:57+00:00

> Scope: one persistent signed counter actor behind a pinned Hono ask/reply route; zero-delta reads through bounded copied messages; HTTP/1.1; localhost. HTTP/1.1 connections are reused; one server process. This is not a general dynamic-language benchmark.

## Environment

- Machine: Model Name: MacBook Pro; Model Identifier: Mac17,6; Chip: Apple M5 Max; Total Number of Cores: 18 (6 Super and 12 Performance); Memory: 128 GB
- OS: macOS 26.5.2
- TinyTSX commit: `7c1a22c`
- Bun: 1.3.13
- oha: oha 1.15.0
- Runs per point: 3
- Duration per run: 15 seconds

## Footprint and startup

| Target | First launch | Startup median | Idle RSS median | Post-warm-up RSS median | Peak sampled RSS | App artifact | Runtime executable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 452.39 ms | 22.84 ms | 6.41 MiB | 6.62 MiB | 6.97 MiB | 2.25 MiB | 2.25 MiB |
| Bun | 29.11 ms | 18.45 ms | 44.27 MiB | 108.56 MiB | 149.50 MiB | 0.90 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.
Peak RSS is sampled from the server every 20 ms throughout warm-up and all load points.

## Process and optional allocation pressure

| Target | Server CPU | CPU utilization | Unix syscalls | Mach syscalls | Context switches | Page faults | Open FDs start/peak/end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 66.76 s | 212.3% | 30,728,338 | 2,991,180 | 4,781,345 | 39 | 4/68/4 |
| Bun | 43.30 s | 137.4% | 10,148,273 | 8,434,556 | 1,920,004 | 6,728 | 6/70/6 |

Counters are per measured server process from warm-up through the final load point; medians are across runs.
Open file descriptors are sampled every 20 ms; start and end are taken around the measured warm-up and load interval.

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
| 8 | 35,690 | 92,896 | 0.38x | 0.114 ms | 0.081 ms | 0.367 ms | 0.149 ms |
| 64 | 69,988 | 107,180 | 0.65x | 0.116 ms | 0.477 ms | 12.935 ms | 1.194 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 8 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- TinyTSX uses its local actor mailbox while Bun uses one Worker-owned counter; the zero-delta route measures ownership/message overhead without persistence, mutation contention, supervision, or distributed actors.
- TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer.
- Power mode and unrelated background activity are not controlled by the harness.
