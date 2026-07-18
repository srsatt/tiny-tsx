# TinyTSX hono basic benchmark (8 worker(s))

Generated: 2026-07-18T00:14:11+00:00

> Scope: complete pinned 34-module Hono basic application, GET / with poweredBy and response-time middleware; HTTP/1.1; keep-alive; localhost. HTTP/1.1 connections are reused; one server process. This is not a general dynamic-language benchmark.

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
| TinyTSX | 450.78 ms | 22.75 ms | 6.19 MiB | 6.58 MiB | 6.94 MiB | 2.25 MiB | 2.25 MiB |
| Bun | 28.68 ms | 18.63 ms | 41.31 MiB | 124.42 MiB | 127.77 MiB | 0.35 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.
Peak RSS is sampled from the server every 20 ms throughout warm-up and all load points.

## Process and optional allocation pressure

| Target | Server CPU | CPU utilization | Unix syscalls | Mach syscalls | Context switches | Page faults | Open FDs start/peak/end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 63.26 s | 201.1% | 46,350,379 | 2,672 | 2,219,839 | 51 | 4/68/4 |
| Bun | 32.06 s | 101.5% | 9,899,399 | 689,444 | 148,168 | 5,545 | 5/69/5 |

Counters are per measured server process from warm-up through the final load point; medians are across runs.
Open file descriptors are sampled every 20 ms; start and end are taken around the measured warm-up and load interval.

| TinyTSX allocator | Calls | Reallocations | Requested bytes | Peak live bytes | Live bytes at shutdown |
| --- | ---: | ---: | ---: | ---: | ---: |
| Global allocator | disabled | disabled | disabled | disabled | disabled |

Allocator counters are disabled for this comparison, so the TinyTSX throughput path has no instrumentation overhead.

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
| 8 | 44,669 | 135,247 | 0.33x | 0.095 ms | 0.055 ms | 0.247 ms | 0.106 ms |
| 64 | 79,044 | 153,060 | 0.52x | 0.101 ms | 0.372 ms | 11.559 ms | 0.830 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 8 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- The measured root route has a six-byte closed body; it executes Hono routing and middleware but not request-dependent JSON or fetch work.
- TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer.
- Power mode and unrelated background activity are not controlled by the harness.
