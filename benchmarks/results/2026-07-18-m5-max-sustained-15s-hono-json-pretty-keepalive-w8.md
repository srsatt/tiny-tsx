# TinyTSX hono json pretty benchmark (8 worker(s))

Generated: 2026-07-18T01:19:37+00:00

> Scope: complete pinned 34-module Hono basic application, query-present prettyJSON branch serializing four closed records with two-space formatting; HTTP/1.1; keep-alive; localhost. HTTP/1.1 connections are reused; one server process. This is not a general dynamic-language benchmark.

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
| TinyTSX | 443.41 ms | 21.18 ms | 6.19 MiB | 6.58 MiB | 6.67 MiB | 2.25 MiB | 2.25 MiB |
| Bun | 17.56 ms | 17.78 ms | 41.81 MiB | 143.52 MiB | 144.53 MiB | 0.35 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.
Peak RSS is sampled from the server every 20 ms throughout warm-up and all load points.

## Process and optional allocation pressure

| Target | Server CPU | CPU utilization | Unix syscalls | Mach syscalls | Context switches | Page faults | Open FDs start/peak/end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 62.24 s | 197.9% | 46,025,827 | 2,675 | 2,183,112 | 32 | 4/68/4 |
| Bun | 32.61 s | 103.5% | 6,641,455 | 690,207 | 83,297 | 6,595 | 5/69/5 |

Counters are per measured server process from warm-up through the final load point; medians are across runs.
Open file descriptors are sampled every 20 ms; start and end are taken around the measured warm-up and load interval.

| TinyTSX allocator | Calls | Reallocations | Requested bytes | Peak live bytes | Live bytes at shutdown |
| --- | ---: | ---: | ---: | ---: | ---: |
| Global allocator | disabled | disabled | disabled | disabled | disabled |

Allocator counters are disabled for this comparison, so the TinyTSX throughput path has no instrumentation overhead.

## Response contract

- Status: 200
- Body: `"[\n  {\n    \"id\": 1,\n    \"title\": \"Good Morning\"\n  },\n  {\n    \"id\": 2,\n    \"title\": \"Good Afternoon\"\n  },\n  {\n    \"id\": 3,\n    \"title\": \"Good Evening\"\n  },\n  {\n    \"id\": 4,\n    \"title\": \"Good Night\"\n  }\n]"` (202 bytes)
- TinyTSX Content-Type: `application/json`
- Bun Content-Type: `application/json`
- TinyTSX framing: `202`
- Bun framing: `202`

## Throughput and latency

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 8 | 43,199 | 97,326 | 0.44x | 0.096 ms | 0.078 ms | 0.241 ms | 0.138 ms |
| 64 | 78,936 | 100,046 | 0.79x | 0.101 ms | 0.587 ms | 11.519 ms | 1.227 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 8 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- The route measures query presence and pretty formatting for one closed array; it does not compare arbitrary query values, dynamic collections, request JSON decoding, or mixed branch traffic.
- TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer.
- Power mode and unrelated background activity are not controlled by the harness.
