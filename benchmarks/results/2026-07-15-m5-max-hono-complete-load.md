# TinyTSX hono basic benchmark

Generated: 2026-07-15T07:21:30+00:00

> Scope: complete pinned 34-module Hono basic application, GET / with poweredBy and response-time middleware; HTTP/1.1; connection close; localhost. A new TCP connection per request; one server process. This is not a general dynamic-language benchmark.

## Environment

- Machine: Model Name: MacBook Pro; Model Identifier: Mac17,6; Chip: Apple M5 Max; Total Number of Cores: 18 (6 Super and 12 Performance); Memory: 128 GB
- OS: macOS 26.5.2
- TinyTSX commit: `fcd6842`
- Bun: 1.3.13
- oha: oha 1.15.0
- Runs per point: 5
- Duration per run: 5 seconds

## Footprint and startup

| Target | Startup-to-first-response median | Idle RSS median | Post-warm-up RSS median | App artifact | Runtime executable |
| --- | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 9.77 ms | 5.84 MiB | 6.09 MiB | 418.89 KiB | 418.89 KiB |
| Bun | 19.91 ms | 41.73 MiB | 70.41 MiB | 0.35 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.

## Response contract

- Status: 200
- Body: `Hono!!` (6 bytes)
- TinyTSX Content-Type: `text/plain;charset=UTF-8`
- Bun Content-Type: `application/octet-stream`
- Difference: Content-Type differs after Hono's response-time middleware clones the finalized body: TinyTSX preserves text/plain;charset=UTF-8; Bun 1.3.13 serves the cloned stream as application/octet-stream.

## Throughput and latency

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 9,488 | 9,692 | 0.98x | 0.099 ms | 0.096 ms | 0.130 ms | 0.132 ms |
| 8 | 29,656 | 30,148 | 0.98x | 0.238 ms | 0.235 ms | 0.334 ms | 0.478 ms |
| 32 | 30,885 | 31,252 | 0.99x | 0.935 ms | 0.919 ms | 1.180 ms | 1.279 ms |
| 64 | 29,834 | 30,663 | 0.97x | 1.911 ms | 1.869 ms | 2.385 ms | 2.382 ms |
| 128 | 28,131 | 28,899 | 0.97x | 4.052 ms | 4.005 ms | 8.438 ms | 7.844 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX currently has one worker and always closes the connection.
- The benchmark client and server share the same machine.
- The measured root route has a six-byte closed body; it executes Hono routing and middleware but not request-dependent JSON or fetch work.
- Power mode and unrelated background activity are not controlled by the harness.
