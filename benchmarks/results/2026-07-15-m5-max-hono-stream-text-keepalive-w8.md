# TinyTSX hono stream text benchmark (8 worker(s))

Generated: 2026-07-15T21:45:53+00:00

> Scope: pinned 33-module Hono streamText path with three finite flushed chunks; HTTP/1.1; keep-alive; localhost. HTTP/1.1 connections are reused; one server process. This is not a general dynamic-language benchmark.

## Environment

- Machine: Model Name: MacBook Pro; Model Identifier: Mac17,6; Chip: Apple M5 Max; Total Number of Cores: 18 (6 Super and 12 Performance); Memory: 128 GB
- OS: macOS 26.5.2
- TinyTSX commit: `49c0f3c`
- Bun: 1.3.13
- oha: oha 1.15.0
- Runs per point: 3
- Duration per run: 1 seconds

## Footprint and startup

| Target | Startup-to-first-response median | Idle RSS median | Post-warm-up RSS median | App artifact | Runtime executable |
| --- | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 7.70 ms | 6.00 MiB | 6.12 MiB | 440.34 KiB | 440.34 KiB |
| Bun | 21.17 ms | 40.45 MiB | 154.58 MiB | 0.35 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.

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
| 1 | 12,487 | 23,189 | 0.54x | 0.075 ms | 0.039 ms | 0.145 ms | 0.064 ms |
| 8 | 50,195 | 69,640 | 0.72x | 0.152 ms | 0.111 ms | 0.256 ms | 0.551 ms |
| 32 | 57,305 | 70,411 | 0.81x | 0.135 ms | 0.383 ms | 20.275 ms | 1.439 ms |
| 64 | 63,497 | 70,732 | 0.90x | 0.122 ms | 0.803 ms | 43.644 ms | 2.095 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 8 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- The AOT stream has three closed chunks; it does not exercise request-dependent chunks, delays, cancellation, or provider backpressure.
- TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer.
- Power mode and unrelated background activity are not controlled by the harness.
