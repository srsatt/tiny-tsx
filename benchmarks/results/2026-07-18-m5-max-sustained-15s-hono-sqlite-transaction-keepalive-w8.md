# TinyTSX hono sqlite transaction benchmark (8 worker(s))

Generated: 2026-07-18T01:40:15+00:00

> Scope: one in-memory SQLite owner behind a pinned Hono route; schema check, two idempotent prepared writes in one callback transaction, one non-empty prepared row copy, and JSON encoding per request; HTTP/1.1; localhost. HTTP/1.1 connections are reused; one server process. This is not a general dynamic-language benchmark.

## Environment

- Machine: Model Name: MacBook Pro; Model Identifier: Mac17,6; Chip: Apple M5 Max; Total Number of Cores: 18 (6 Super and 12 Performance); Memory: 128 GB
- OS: macOS 26.5.2
- TinyTSX commit: `c488480`
- Bun: 1.3.13
- oha: oha 1.15.0
- Runs per point: 3
- Duration per run: 15 seconds

## Footprint and startup

| Target | First launch | Startup median | Idle RSS median | Post-warm-up RSS median | Peak sampled RSS | App artifact | Runtime executable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 510.45 ms | 22.60 ms | 7.64 MiB | 8.81 MiB | 8.94 MiB | 2.29 MiB | 2.29 MiB |
| Bun | 29.51 ms | 19.67 ms | 39.42 MiB | 64.50 MiB | 64.88 MiB | 1.29 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.
Peak RSS is sampled from the server every 20 ms throughout warm-up and all load points.

## Process and optional allocation pressure

| Target | Server CPU | CPU utilization | Unix syscalls | Mach syscalls | Context switches | Page faults | Open FDs start/peak/end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 78.59 s | 250.3% | 23,061,120 | 7,877,903 | 6,744,232 | 90 | 4/68/4 |
| Bun | 31.26 s | 99.2% | 6,642,170 | 423,673 | 61,501 | 1,627 | 5/69/5 |

Counters are per measured server process from warm-up through the final load point; medians are across runs.
Open file descriptors are sampled every 20 ms; start and end are taken around the measured warm-up and load interval.

| TinyTSX allocator | Calls | Reallocations | Requested bytes | Peak live bytes | Live bytes at shutdown |
| --- | ---: | ---: | ---: | ---: | ---: |
| Global allocator | disabled | disabled | disabled | disabled | disabled |

Allocator counters are disabled for this comparison, so the TinyTSX throughput path has no instrumentation overhead.

## Response contract

- Status: 200
- Body: `"{\"value\":{\"id\":\"stable\",\"value\":\"ready\"}}"` (41 bytes)
- TinyTSX Content-Type: `application/json`
- Bun Content-Type: `application/json`
- TinyTSX framing: `41`
- Bun framing: `41`

## Throughput and latency

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 8 | 32,292 | 98,111 | 0.33x | 0.155 ms | 0.082 ms | 3.375 ms | 0.138 ms |
| 64 | 52,193 | 100,896 | 0.52x | 0.156 ms | 0.592 ms | 17.293 ms | 1.214 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 8 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- This does not measure disk or WAL I/O, competing connections, rollback frequency, request-derived values, growing tables, arbitrary callback shapes, or SQLite primitive parity.
- TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer.
- Power mode and unrelated background activity are not controlled by the harness.
