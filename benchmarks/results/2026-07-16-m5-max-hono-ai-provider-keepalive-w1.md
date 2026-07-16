# TinyTSX hono ai provider benchmark (1 worker(s))

Generated: 2026-07-16T00:26:44+00:00

> Scope: pinned 656-module Hono plus AI SDK generateText path, one real OpenAI-compatible POST through a shared zero-delay loopback provider; HTTP/1.1; localhost. HTTP/1.1 connections are reused; one measured server process plus one shared support process excluded from RSS. This is not a general dynamic-language benchmark.

## Environment

- Machine: Model Name: MacBook Pro; Model Identifier: Mac17,6; Chip: Apple M5 Max; Total Number of Cores: 18 (6 Super and 12 Performance); Memory: 128 GB
- OS: macOS 26.5.2
- TinyTSX commit: `85c90bd`
- Bun: 1.3.13
- oha: oha 1.15.0
- Runs per point: 3
- Duration per run: 2 seconds

## Footprint and startup

| Target | Startup-to-first-response median | Idle RSS median | Post-warm-up RSS median | App artifact | Runtime executable |
| --- | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 12.64 ms | 7.88 MiB | 8.34 MiB | 507.51 KiB | 507.51 KiB |
| Bun | 48.98 ms | 73.75 MiB | 255.27 MiB | 0.35 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.

## Response contract

- Status: 200
- Body: `Hello from local provider` (25 bytes)
- TinyTSX Content-Type: `text/plain; charset=UTF-8`
- Bun Content-Type: `text/plain; charset=UTF-8`
- TinyTSX framing: `25`
- Bun framing: `25`

## Throughput and latency

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 12,077 | 7,932 | 1.52x | 0.080 ms | 0.117 ms | 0.134 ms | 0.458 ms |
| 8 | 12,241 | 17,643 | 0.69x | 0.080 ms | 0.329 ms | 28.593 ms | 1.139 ms |
| 32 | 12,274 | 17,057 | 0.72x | 0.080 ms | 1.710 ms | 123.388 ms | 3.885 ms |
| 64 | 12,259 | 16,321 | 0.75x | 0.080 ms | 3.843 ms | 254.803 ms | 7.697 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 1 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- The mock provider has no model latency or token generation; this isolates framework, transport, message-copy, and JSON-decoding overhead and is not an inference benchmark.
- TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer.
- Power mode and unrelated background activity are not controlled by the harness.
