# TinyTSX hono dynamic jsx benchmark (8 worker(s))

Generated: 2026-07-15T21:43:49+00:00

> Scope: pinned Hono request-time JSX with one decoded query value rendered through nested component text and attribute escaping; HTTP/1.1; keep-alive; localhost. HTTP/1.1 connections are reused; one server process. This is not a general dynamic-language benchmark.

## Environment

- Machine: Model Name: MacBook Pro; Model Identifier: Mac17,6; Chip: Apple M5 Max; Total Number of Cores: 18 (6 Super and 12 Performance); Memory: 128 GB
- OS: macOS 26.5.2
- TinyTSX commit: `76cea7d`
- Bun: 1.3.13
- oha: oha 1.15.0
- Runs per point: 3
- Duration per run: 1 seconds

## Footprint and startup

| Target | Startup-to-first-response median | Idle RSS median | Post-warm-up RSS median | App artifact | Runtime executable |
| --- | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 8.92 ms | 5.98 MiB | 6.14 MiB | 440.26 KiB | 440.26 KiB |
| Bun | 21.82 ms | 41.44 MiB | 99.69 MiB | 0.35 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.

## Response contract

- Status: 200
- Body: `<main data-name="TinyTSX &amp; Bun">Hello, <strong>TinyTSX &amp; Bun</strong>!</main>` (85 bytes)
- TinyTSX Content-Type: `text/html; charset=UTF-8`
- Bun Content-Type: `text/html; charset=UTF-8`

## Throughput and latency

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 24,082 | 25,087 | 0.96x | 0.038 ms | 0.038 ms | 0.104 ms | 0.059 ms |
| 8 | 82,810 | 114,820 | 0.72x | 0.091 ms | 0.063 ms | 0.172 ms | 0.150 ms |
| 32 | 90,852 | 123,278 | 0.74x | 0.084 ms | 0.216 ms | 12.972 ms | 0.581 ms |
| 64 | 96,236 | 121,209 | 0.79x | 0.079 ms | 0.467 ms | 30.339 ms | 1.132 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 8 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- The route performs bounded query decoding and escaping but has a small fixed JSX shape and no dynamic collection traversal.
- TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer.
- Power mode and unrelated background activity are not controlled by the harness.
