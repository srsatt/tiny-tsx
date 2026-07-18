# TinyTSX hono stream text benchmark (8 worker(s))

Generated: 2026-07-18T00:21:22+00:00

> Scope: pinned 33-module Hono streamText path with three finite flushed chunks; HTTP/1.1; keep-alive; localhost. HTTP/1.1 connections are reused; one server process. This is not a general dynamic-language benchmark.

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
| TinyTSX | 547.26 ms | 22.07 ms | 6.12 MiB | 6.30 MiB | 6.42 MiB | 2.23 MiB | 2.23 MiB |
| Bun | 29.77 ms | 21.31 ms | 40.34 MiB | 154.70 MiB | 154.81 MiB | 0.35 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.
Peak RSS is sampled from the server every 20 ms throughout warm-up and all load points.

## Process and optional allocation pressure

| Target | Server CPU | CPU utilization | Unix syscalls | Mach syscalls | Context switches | Page faults | Open FDs start/peak/end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 45.42 s | 144.6% | 42,863,782 | 2,682 | 1,629,722 | 21 | 4/68/4 |
| Bun | 33.74 s | 107.2% | 5,470,041 | 941,675 | 142,422 | 7,301 | 5/69/5 |

Counters are per measured server process from warm-up through the final load point; medians are across runs.
Open file descriptors are sampled every 20 ms; start and end are taken around the measured warm-up and load interval.

| TinyTSX allocator | Calls | Reallocations | Requested bytes | Peak live bytes | Live bytes at shutdown |
| --- | ---: | ---: | ---: | ---: | ---: |
| Global allocator | disabled | disabled | disabled | disabled | disabled |

Allocator counters are disabled for this comparison, so the TinyTSX throughput path has no instrumentation overhead.

## Response contract

- Status: 200
- Body: `first
second
third
` (19 bytes)
- TinyTSX Content-Type: `text/plain; charset=UTF-8`
- Bun Content-Type: `text/plain; charset=UTF-8`
- TinyTSX framing: `chunked`
- Bun framing: `19`
- Difference: TinyTSX preserves the three HTTP/1.1 chunks on the wire; Bun 1.3.13 collects this immediately completed finite stream and emits Content-Length: 19.

## Throughput and latency

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 8 | 32,391 | 78,808 | 0.41x | 0.146 ms | 0.103 ms | 2.680 ms | 0.340 ms |
| 64 | 58,211 | 80,664 | 0.72x | 0.143 ms | 0.712 ms | 15.622 ms | 1.683 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 8 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- The AOT stream has three closed chunks; it does not exercise request-dependent chunks, delays, cancellation, or provider backpressure.
- TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer.
- Power mode and unrelated background activity are not controlled by the harness.
