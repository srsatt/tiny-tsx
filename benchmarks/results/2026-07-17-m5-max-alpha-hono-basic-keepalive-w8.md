# TinyTSX hono basic benchmark (8 worker(s))

Generated: 2026-07-17T03:10:28+00:00

> Scope: complete pinned 34-module Hono basic application, GET / with poweredBy and response-time middleware; HTTP/1.1; keep-alive; localhost. HTTP/1.1 connections are reused; one server process. This is not a general dynamic-language benchmark.

## Environment

- Machine: Model Name: MacBook Pro; Model Identifier: Mac17,6; Chip: Apple M5 Max; Total Number of Cores: 18 (6 Super and 12 Performance); Memory: 128 GB
- OS: macOS 26.5.2
- TinyTSX commit: `0e8f53e`
- Bun: 1.3.13
- oha: oha 1.15.0
- Runs per point: 3
- Duration per run: 5 seconds

## Footprint and startup

| Target | Startup-to-first-response median | Idle RSS median | Post-warm-up RSS median | App artifact | Runtime executable |
| --- | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 22.62 ms | 6.16 MiB | 6.64 MiB | 2.23 MiB | 2.23 MiB |
| Bun | 21.36 ms | 41.33 MiB | 123.61 MiB | 0.35 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.

## Response contract

- Status: 200
- Body: `Hono!!` (6 bytes)
- TinyTSX Content-Type: `text/plain;charset=UTF-8`
- Bun Content-Type: `application/octet-stream`
- TinyTSX framing: `6`
- Bun framing: `6`
- Difference: Bun 1.3.13 diverges from Fetch/WPT for a string BodyInit: it omits the required text/plain;charset=UTF-8 header, so its server adapter emits application/octet-stream after Hono clones the finalized body. TinyTSX preserves the Web-standard text type.

## Throughput and latency

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 7,266 | 25,938 | 0.28x | 0.050 ms | 0.037 ms | 0.640 ms | 0.049 ms |
| 8 | 38,090 | 135,155 | 0.28x | 0.097 ms | 0.054 ms | 0.252 ms | 0.107 ms |
| 32 | 81,349 | 150,811 | 0.54x | 0.093 ms | 0.173 ms | 20.381 ms | 0.555 ms |
| 64 | 83,700 | 152,435 | 0.55x | 0.090 ms | 0.374 ms | 36.961 ms | 0.872 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 8 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- The measured root route has a six-byte closed body; it executes Hono routing and middleware but not request-dependent JSON or fetch work.
- TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer.
- Power mode and unrelated background activity are not controlled by the harness.
