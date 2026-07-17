# TinyTSX hono sqlite benchmark (8 worker(s))

Generated: 2026-07-17T03:15:18+00:00

> Scope: one in-memory SQLite owner behind a pinned Hono route; CREATE TABLE IF NOT EXISTS plus one empty prepared SELECT and JSON envelope per request; HTTP/1.1; localhost. HTTP/1.1 connections are reused; one server process. This is not a general dynamic-language benchmark.

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
| TinyTSX | 23.35 ms | 7.55 MiB | 7.86 MiB | 2.23 MiB | 2.23 MiB |
| Bun | 21.31 ms | 40.06 MiB | 70.39 MiB | 0.70 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.

## Response contract

- Status: 200
- Body: `{"values":[]}` (13 bytes)
- TinyTSX Content-Type: `application/json`
- Bun Content-Type: `application/json`
- TinyTSX framing: `13`
- Bun framing: `13`

## Throughput and latency

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 7,250 | 25,526 | 0.28x | 0.064 ms | 0.038 ms | 1.399 ms | 0.050 ms |
| 8 | 32,248 | 133,402 | 0.24x | 0.136 ms | 0.056 ms | 1.650 ms | 0.110 ms |
| 32 | 60,188 | 147,333 | 0.41x | 0.129 ms | 0.181 ms | 18.589 ms | 0.403 ms |
| 64 | 64,173 | 148,312 | 0.43x | 0.121 ms | 0.391 ms | 46.328 ms | 0.821 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 8 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- TinyTSX serializes SQLite through its bounded application mailbox while Bun executes synchronous bun:sqlite on the server thread; this does not measure disk I/O, writes, contention, or result copying beyond an empty row set.
- TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer.
- Power mode and unrelated background activity are not controlled by the harness.
