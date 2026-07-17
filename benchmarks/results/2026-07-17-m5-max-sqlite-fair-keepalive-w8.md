# TinyTSX hono sqlite benchmark (8 worker(s))

Generated: 2026-07-17T14:17:13+00:00

> Scope: one in-memory SQLite owner behind a pinned Hono route; CREATE TABLE IF NOT EXISTS plus one empty prepared SELECT and JSON envelope per request; HTTP/1.1; localhost. HTTP/1.1 connections are reused; one server process. This is not a general dynamic-language benchmark.

## Environment

- Machine: Model Name: MacBook Pro; Model Identifier: Mac17,6; Chip: Apple M5 Max; Total Number of Cores: 18 (6 Super and 12 Performance); Memory: 128 GB
- OS: macOS 26.5.2
- TinyTSX commit: `633e0da`
- Bun: 1.3.13
- oha: oha 1.15.0
- Runs per point: 3
- Duration per run: 5 seconds

## Footprint and startup

| Target | First launch | Startup median | Idle RSS median | Post-warm-up RSS median | Peak sampled RSS | App artifact | Runtime executable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 439.56 ms | 24.16 ms | 7.55 MiB | 7.89 MiB | 7.89 MiB | 2.25 MiB | 2.25 MiB |
| Bun | 25.41 ms | 22.98 ms | 40.19 MiB | 69.30 MiB | 69.38 MiB | 0.70 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.
Peak RSS is sampled from the server every 20 ms throughout warm-up and all load points.

## Process and optional allocation pressure

| Target | Server CPU | CPU utilization | Unix syscalls | Mach syscalls | Context switches | Page faults | Open FDs start/peak/end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 18.12 s | 289.3% | 6,024,889 | 1,342,316 | 1,436,799 | 23 | 4/68/4 |
| Bun | 5.92 s | 94.3% | 1,522,856 | 84,953 | 48,624 | 1,880 | 5/69/5 |

Counters are per measured server process from warm-up through the final load point; medians are across runs.
Open file descriptors are sampled every 20 ms; start and end are taken around the measured warm-up and load interval.

| TinyTSX allocator | Calls | Reallocations | Requested bytes | Peak live bytes | Live bytes at shutdown |
| --- | ---: | ---: | ---: | ---: | ---: |
| Global allocator | disabled | disabled | disabled | disabled | disabled |

Allocator counters are disabled for this comparison, so the TinyTSX throughput path has no instrumentation overhead.

## Response contract

- Status: 200
- Body: `{"values":[]}` (13 bytes)
- TinyTSX Content-Type: `application/json`
- Bun Content-Type: `application/json`
- TinyTSX framing: `13`
- Bun framing: `13`

## Throughput and latency

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 64 | 56,107 | 123,476 | 0.45x | 0.145 ms | 0.456 ms | 16.198 ms | 1.117 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 8 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- TinyTSX serializes SQLite through its bounded application mailbox while Bun executes synchronous bun:sqlite on the server thread; this does not measure disk I/O, writes, contention, or result copying beyond an empty row set.
- TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer.
- Power mode and unrelated background activity are not controlled by the harness.
