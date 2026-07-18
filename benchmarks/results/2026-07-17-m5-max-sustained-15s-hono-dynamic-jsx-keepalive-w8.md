# TinyTSX hono dynamic jsx benchmark (8 worker(s))

Generated: 2026-07-18T00:17:49+00:00

> Scope: pinned Hono request-time JSX with one decoded query value rendered through nested component text and attribute escaping; HTTP/1.1; keep-alive; localhost. HTTP/1.1 connections are reused; one server process. This is not a general dynamic-language benchmark.

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
| TinyTSX | 453.83 ms | 20.99 ms | 6.12 MiB | 6.36 MiB | 6.39 MiB | 2.23 MiB | 2.23 MiB |
| Bun | 20.15 ms | 20.15 ms | 41.67 MiB | 107.34 MiB | 108.92 MiB | 0.35 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.
Peak RSS is sampled from the server every 20 ms throughout warm-up and all load points.

## Process and optional allocation pressure

| Target | Server CPU | CPU utilization | Unix syscalls | Mach syscalls | Context switches | Page faults | Open FDs start/peak/end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 46.31 s | 147.2% | 38,339,857 | 2,567 | 2,574,394 | 19 | 4/68/4 |
| Bun | 31.25 s | 99.0% | 9,083,597 | 582,375 | 117,410 | 4,376 | 5/69/5 |

Counters are per measured server process from warm-up through the final load point; medians are across runs.
Open file descriptors are sampled every 20 ms; start and end are taken around the measured warm-up and load interval.

| TinyTSX allocator | Calls | Reallocations | Requested bytes | Peak live bytes | Live bytes at shutdown |
| --- | ---: | ---: | ---: | ---: | ---: |
| Global allocator | disabled | disabled | disabled | disabled | disabled |

Allocator counters are disabled for this comparison, so the TinyTSX throughput path has no instrumentation overhead.

## Response contract

- Status: 200
- Body: `<main data-name="TinyTSX &amp; Bun">Hello, <strong>TinyTSX &amp; Bun</strong>!</main>` (85 bytes)
- TinyTSX Content-Type: `text/html; charset=UTF-8`
- Bun Content-Type: `text/html; charset=UTF-8`
- TinyTSX framing: `85`
- Bun framing: `85`

## Throughput and latency

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 8 | 58,782 | 127,140 | 0.46x | 0.088 ms | 0.059 ms | 1.172 ms | 0.119 ms |
| 64 | 93,596 | 139,058 | 0.67x | 0.088 ms | 0.417 ms | 9.575 ms | 0.877 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 8 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- The route performs bounded query decoding and escaping but has a small fixed JSX shape and no dynamic collection traversal.
- TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer.
- Power mode and unrelated background activity are not controlled by the harness.
