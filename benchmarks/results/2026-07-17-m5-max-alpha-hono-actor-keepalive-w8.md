# TinyTSX hono actor benchmark (8 worker(s))

Generated: 2026-07-17T03:12:53+00:00

> Scope: one persistent signed counter actor behind a pinned Hono ask/reply route; zero-delta reads through bounded copied messages; HTTP/1.1; localhost. HTTP/1.1 connections are reused; one server process. This is not a general dynamic-language benchmark.

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
| TinyTSX | 23.80 ms | 6.36 MiB | 6.59 MiB | 2.23 MiB | 2.23 MiB |
| Bun | 20.32 ms | 44.38 MiB | 108.08 MiB | 0.90 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.

## Response contract

- Status: 200
- Body: `0` (1 bytes)
- TinyTSX Content-Type: `text/plain; charset=UTF-8`
- Bun Content-Type: `text/plain; charset=UTF-8`
- TinyTSX framing: `1`
- Bun framing: `1`

## Throughput and latency

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 7,074 | 21,324 | 0.33x | 0.058 ms | 0.045 ms | 1.593 ms | 0.061 ms |
| 8 | 33,176 | 93,034 | 0.36x | 0.115 ms | 0.080 ms | 0.744 ms | 0.150 ms |
| 32 | 71,068 | 109,495 | 0.65x | 0.109 ms | 0.304 ms | 19.657 ms | 0.793 ms |
| 64 | 73,168 | 106,371 | 0.69x | 0.106 ms | 0.480 ms | 44.878 ms | 1.218 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 8 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- TinyTSX uses its local actor mailbox while Bun uses one Worker-owned counter; the zero-delta route measures ownership/message overhead without persistence, mutation contention, supervision, or distributed actors.
- TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer.
- Power mode and unrelated background activity are not controlled by the harness.
