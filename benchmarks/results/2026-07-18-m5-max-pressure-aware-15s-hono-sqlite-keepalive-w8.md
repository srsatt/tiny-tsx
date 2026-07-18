# TinyTSX hono sqlite benchmark (8 worker(s))

Generated: 2026-07-18T11:17:53+00:00

> Scope: one in-memory SQLite owner behind a pinned Hono route; CREATE TABLE IF NOT EXISTS plus one empty prepared SELECT and JSON envelope per request; HTTP/1.1; localhost. HTTP/1.1 connections are reused; one server process. This is not a general dynamic-language benchmark.

## Environment

- Machine: Model Name: MacBook Pro; Model Identifier: Mac17,6; Chip: Apple M5 Max; Total Number of Cores: 18 (6 Super and 12 Performance); Memory: 128 GB
- OS: macOS 26.5.2
- TinyTSX commit: `932743e`
- Bun: 1.3.13
- oha: oha 1.15.0
- Runs per point: 3
- Duration per run: 15 seconds

## Footprint and startup

| Target | First launch | Startup median | Idle RSS median | Post-warm-up RSS median | Peak sampled RSS | App artifact | Runtime executable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 456.96 ms | 25.83 ms | 7.55 MiB | 7.91 MiB | 8.03 MiB | 2.26 MiB | 2.26 MiB |
| Bun | 117.89 ms | 21.99 ms | 39.17 MiB | 70.08 MiB | 71.27 MiB | 0.70 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.
Peak RSS is sampled from the server every 20 ms throughout warm-up and all load points.

## Process and optional allocation pressure

| Target | Server CPU | CPU utilization | Unix syscalls | Mach syscalls | Context switches | Page faults | Open FDs start/peak/end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 79.40 s | 252.8% | 26,470,649 | 5,562,377 | 6,007,940 | 33 | 4/68/4 |
| Bun | 31.01 s | 98.2% | 9,488,451 | 494,717 | 115,580 | 2,080 | 5/69/5 |

Counters are per measured server process from warm-up through the final load point; medians are across runs.
Open file descriptors are sampled every 20 ms; start and end are taken around the measured warm-up and load interval.

| TinyTSX allocator | Calls | Reallocations | Requested bytes | Peak live bytes | Live bytes at shutdown |
| --- | ---: | ---: | ---: | ---: | ---: |
| Global allocator | disabled | disabled | disabled | disabled | disabled |

Allocator counters are disabled for this comparison, so the TinyTSX throughput path has no instrumentation overhead.

## Response contract

- Status: 200
- Body: `"{\"values\":[]}"` (13 bytes)
- TinyTSX Content-Type: `application/json`
- Bun Content-Type: `application/json`
- TinyTSX framing: `13`
- Bun framing: `13`

## Throughput and latency

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 8 | 32,282 | 130,854 | 0.25x | 0.138 ms | 0.057 ms | 2.194 ms | 0.114 ms |
| 64 | 57,703 | 146,648 | 0.39x | 0.141 ms | 0.395 ms | 15.675 ms | 0.835 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 8 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- TinyTSX serializes SQLite through its bounded application mailbox while Bun executes synchronous bun:sqlite on the server thread; this does not measure disk I/O, writes, contention, or result copying beyond an empty row set.
- TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer.
- Power mode and unrelated background activity are not controlled by the harness.
