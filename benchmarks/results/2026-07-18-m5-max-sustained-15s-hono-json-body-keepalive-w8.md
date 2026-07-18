# TinyTSX hono json body benchmark (8 worker(s))

Generated: 2026-07-18T02:15:37+00:00

> Scope: shared pinned Hono POST route selecting one string, number, boolean, and null field from a bounded request JSON object and serializing the closed response; HTTP/1.1; localhost. HTTP/1.1 connections are reused; one server process. This is not a general dynamic-language benchmark.

## Environment

- Machine: Model Name: MacBook Pro; Model Identifier: Mac17,6; Chip: Apple M5 Max; Total Number of Cores: 18 (6 Super and 12 Performance); Memory: 128 GB
- OS: macOS 26.5.2
- TinyTSX commit: `b35b608`
- Bun: 1.3.13
- oha: oha 1.15.0
- Runs per point: 3
- Duration per run: 15 seconds

## Footprint and startup

| Target | First launch | Startup median | Idle RSS median | Post-warm-up RSS median | Peak sampled RSS | App artifact | Runtime executable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 452.36 ms | 19.68 ms | 6.20 MiB | 7.34 MiB | 7.48 MiB | 2.30 MiB | 2.30 MiB |
| Bun | 29.34 ms | 17.30 ms | 39.14 MiB | 75.33 MiB | 75.89 MiB | 0.33 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.
Peak RSS is sampled from the server every 20 ms throughout warm-up and all load points.

## Process and optional allocation pressure

| Target | Server CPU | CPU utilization | Unix syscalls | Mach syscalls | Context switches | Page faults | Open FDs start/peak/end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 48.57 s | 154.4% | 37,347,542 | 2,558 | 2,540,784 | 87 | 4/68/4 |
| Bun | 31.04 s | 98.3% | 9,279,054 | 495,167 | 117,997 | 2,372 | 5/69/5 |

Counters are per measured server process from warm-up through the final load point; medians are across runs.
Open file descriptors are sampled every 20 ms; start and end are taken around the measured warm-up and load interval.

| TinyTSX allocator | Calls | Reallocations | Requested bytes | Peak live bytes | Live bytes at shutdown |
| --- | ---: | ---: | ---: | ---: | ---: |
| Global allocator | disabled | disabled | disabled | disabled | disabled |

Allocator counters are disabled for this comparison, so the TinyTSX throughput path has no instrumentation overhead.

## Request contract

- Method: `POST`
- Content-Type: `application/json`
- Body: `"{\"name\":\"TinyTSX & \\\"Bun\\\"\",\"count\":7,\"enabled\":true,\"note\":null}"` (65 bytes)

## Response contract

- Status: 200
- Body: `"{\"name\":\"TinyTSX & \\\"Bun\\\"\",\"count\":7,\"enabled\":true,\"note\":null}"` (65 bytes)
- TinyTSX Content-Type: `application/json`
- Bun Content-Type: `application/json`
- TinyTSX framing: `65`
- Bun framing: `65`

## Throughput and latency

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 8 | 58,034 | 129,430 | 0.45x | 0.091 ms | 0.057 ms | 0.960 ms | 0.118 ms |
| 64 | 90,387 | 142,296 | 0.64x | 0.091 ms | 0.408 ms | 9.937 ms | 0.857 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 8 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- The route selects four fixed primitive fields from one fixed body; it does not measure dynamic keys, arrays, nested objects, mutation, coercion, schema validation, streaming JSON, or mixed request bodies.
- TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer.
- Power mode and unrelated background activity are not controlled by the harness.
