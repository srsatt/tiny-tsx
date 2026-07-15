# TinyTSX hono worker benchmark (8 worker(s))

Generated: 2026-07-15T22:08:23+00:00

> Scope: one persistent logical string worker behind a pinned Hono request/reply route; copied messages; HTTP/1.1; localhost. HTTP/1.1 connections are reused; one server process. This is not a general dynamic-language benchmark.

## Environment

- Machine: Model Name: MacBook Pro; Model Identifier: Mac17,6; Chip: Apple M5 Max; Total Number of Cores: 18 (6 Super and 12 Performance); Memory: 128 GB
- OS: macOS 26.5.2
- TinyTSX commit: `c2c946a`
- Bun: 1.3.13
- oha: oha 1.15.0
- Runs per point: 3
- Duration per run: 1 seconds

## Footprint and startup

| Target | Startup-to-first-response median | Idle RSS median | Post-warm-up RSS median | App artifact | Runtime executable |
| --- | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 7.22 ms | 6.22 MiB | 6.48 MiB | 490.84 KiB | 490.84 KiB |
| Bun | 19.78 ms | 43.97 MiB | 111.45 MiB | 1.01 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.

## Response contract

- Status: 200
- Body: `TINYTSX & BUN` (13 bytes)
- TinyTSX Content-Type: `text/plain; charset=UTF-8`
- Bun Content-Type: `text/plain; charset=UTF-8`
- TinyTSX framing: `13`
- Bun framing: `13`

## Throughput and latency

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 19,376 | 20,814 | 0.93x | 0.049 ms | 0.046 ms | 0.100 ms | 0.064 ms |
| 8 | 64,650 | 87,189 | 0.74x | 0.118 ms | 0.085 ms | 0.199 ms | 0.170 ms |
| 32 | 72,518 | 96,883 | 0.75x | 0.107 ms | 0.340 ms | 15.196 ms | 1.019 ms |
| 64 | 73,085 | 95,665 | 0.76x | 0.106 ms | 0.536 ms | 36.381 ms | 1.452 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 8 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- Both targets serialize this route through one logical worker; this measures request/reply and ownership-transfer overhead, not parallelism across multiple Worker instances.
- TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer.
- Power mode and unrelated background activity are not controlled by the harness.
