# TinyTSX hono jsx ssr benchmark (1 worker(s))

Generated: 2026-07-19T12:01:59+00:00

> Scope: complete pinned 31-module Hono jsx-ssr application, GET / rendering five posts through typed JSX components; HTTP/1.1; keep-alive; localhost. HTTP/1.1 connections are reused; one server process. This is not a general dynamic-language benchmark.

## Environment

- Machine: Model Name: MacBook Pro; Model Identifier: Mac17,6; Chip: Apple M5 Max; Total Number of Cores: 18 (6 Super and 12 Performance); Memory: 128 GB
- OS: macOS 26.5.2
- TinyTSX commit: `a3396c2`
- Bun: 1.3.13
- oha: oha 1.15.0
- Load generator: oha
- Runs per point: 3
- Duration per run: 5 seconds

## Footprint and startup

| Target | First launch | Startup median | Idle RSS median | Post-warm-up RSS median | Peak sampled RSS | App artifact | Runtime executable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 382.07 ms | 11.93 ms | 1.80 MiB | 1.89 MiB | 1.89 MiB | 491.62 KiB | 491.62 KiB |
| Bun | 19.04 ms | 26.37 ms | 41.42 MiB | 123.78 MiB | 124.11 MiB | 0.35 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.
Peak RSS is sampled from the server every 20 ms throughout warm-up and all load points.

## Process and optional allocation pressure

| Target | Server CPU | CPU utilization | Unix syscalls | Mach syscalls | Context switches | Page faults | Open FDs start/peak/end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 10.28 s | 89.7% | 4,518,503 | 2 | 116,725 | 6 | 6/70/6 |
| Bun | 11.29 s | 99.2% | 2,425,534 | 250,930 | 37,190 | 5,280 | 5/69/5 |

Counters are per measured server process from warm-up through the final load point; medians are across runs.
Open file descriptors are sampled every 20 ms; start and end are taken around the measured warm-up and load interval.

| TinyTSX allocator | Calls | Reallocations | Requested bytes | Peak live bytes | Live bytes at shutdown |
| --- | ---: | ---: | ---: | ---: | ---: |
| Global allocator | disabled | disabled | disabled | disabled | disabled |

Allocator counters are disabled for this comparison, so the TinyTSX throughput path has no instrumentation overhead.

## Response contract

- Status: 200
- Body: 881 UTF-8 bytes; SHA-256 `6eed16522d24e82b022cbff7f57a8637cfa2d96af8b2e66a1665124c416fc3c2`
- Body preview: `"<!DOCTYPE html>\n    <html>\n      <head>\n        <meta charset=\"UTF-8\">\n        <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n        <t"...`
- TinyTSX Content-Type: `text/html; charset=UTF-8`
- Bun Content-Type: `text/html; charset=UTF-8`
- TinyTSX framing: `881`
- Bun framing: `881`

## Throughput and latency

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 8 | 158,740 | 99,255 | 1.60x | 0.048 ms | 0.077 ms | 0.084 ms | 0.218 ms |
| 64 | 207,873 | 102,656 | 2.02x | 0.313 ms | 0.575 ms | 0.513 ms | 1.184 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 1 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- The measured root route is fully closed and AOT-rendered; request-selected /post/:id behavior is correctness-tested but not part of this throughput sample.
- Power mode and unrelated background activity are not controlled by the harness.
