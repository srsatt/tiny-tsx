# TinyTSX hono json compact benchmark (8 worker(s))

Generated: 2026-07-18T01:16:03+00:00

> Scope: complete pinned 34-module Hono basic application, query-absent compact JSON branch serializing four closed records; HTTP/1.1; keep-alive; localhost. HTTP/1.1 connections are reused; one server process. This is not a general dynamic-language benchmark.

## Environment

- Machine: Model Name: MacBook Pro; Model Identifier: Mac17,6; Chip: Apple M5 Max; Total Number of Cores: 18 (6 Super and 12 Performance); Memory: 128 GB
- OS: macOS 26.5.2
- TinyTSX commit: `a6cc7ae`
- Bun: 1.3.13
- oha: oha 1.15.0
- Runs per point: 3
- Duration per run: 15 seconds

## Footprint and startup

| Target | First launch | Startup median | Idle RSS median | Post-warm-up RSS median | Peak sampled RSS | App artifact | Runtime executable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 465.90 ms | 22.69 ms | 6.19 MiB | 6.72 MiB | 6.80 MiB | 2.25 MiB | 2.25 MiB |
| Bun | 16.19 ms | 17.73 ms | 40.95 MiB | 127.50 MiB | 128.78 MiB | 0.35 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.
Peak RSS is sampled from the server every 20 ms throughout warm-up and all load points.

## Process and optional allocation pressure

| Target | Server CPU | CPU utilization | Unix syscalls | Mach syscalls | Context switches | Page faults | Open FDs start/peak/end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 62.41 s | 198.3% | 46,383,612 | 2,665 | 2,202,202 | 41 | 4/68/4 |
| Bun | 32.22 s | 102.0% | 8,538,877 | 707,223 | 113,298 | 5,574 | 5/69/5 |

Counters are per measured server process from warm-up through the final load point; medians are across runs.
Open file descriptors are sampled every 20 ms; start and end are taken around the measured warm-up and load interval.

| TinyTSX allocator | Calls | Reallocations | Requested bytes | Peak live bytes | Live bytes at shutdown |
| --- | ---: | ---: | ---: | ---: | ---: |
| Global allocator | disabled | disabled | disabled | disabled | disabled |

Allocator counters are disabled for this comparison, so the TinyTSX throughput path has no instrumentation overhead.

## Response contract

- Status: 200
- Body: `"[{\"id\":1,\"title\":\"Good Morning\"},{\"id\":2,\"title\":\"Good Afternoon\"},{\"id\":3,\"title\":\"Good Evening\"},{\"id\":4,\"title\":\"Good Night\"}]"` (129 bytes)
- TinyTSX Content-Type: `application/json`
- Bun Content-Type: `application/json`
- TinyTSX framing: `129`
- Bun framing: `129`

## Throughput and latency

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 8 | 44,124 | 120,693 | 0.37x | 0.096 ms | 0.061 ms | 0.256 ms | 0.128 ms |
| 64 | 79,149 | 130,313 | 0.61x | 0.100 ms | 0.443 ms | 11.436 ms | 0.952 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 8 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- The route serializes one closed four-record array; it does not exercise dynamic collections, request JSON decoding, randomized branch traffic, replacers, or cycles.
- TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer.
- Power mode and unrelated background activity are not controlled by the harness.
