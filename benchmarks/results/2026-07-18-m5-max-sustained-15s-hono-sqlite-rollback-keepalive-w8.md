# TinyTSX hono sqlite rollback benchmark (8 worker(s))

Generated: 2026-07-18T06:32:26+00:00

> Scope: one capability-scoped on-disk WAL owner; every POST copies a fixed required idempotency header plus route/JSON values, inserts a payment, fails its second callback-transaction step on a pinned uniqueness conflict, rolls the whole transaction back, and returns the declared 500 response; HTTP/1.1; localhost. HTTP/1.1 connections are reused; one server process. This is not a general dynamic-language benchmark.

## Environment

- Machine: Model Name: MacBook Pro; Model Identifier: Mac17,6; Chip: Apple M5 Max; Total Number of Cores: 18 (6 Super and 12 Performance); Memory: 128 GB
- OS: macOS 26.5.2
- TinyTSX commit: `794ba22`
- Bun: 1.3.13
- oha: oha 1.15.0
- Runs per point: 3
- Duration per run: 15 seconds

## Footprint and startup

| Target | First launch | Startup median | Idle RSS median | Post-warm-up RSS median | Peak sampled RSS | App artifact | Runtime executable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 469.52 ms | 33.46 ms | 7.83 MiB | 8.05 MiB | 8.16 MiB | 2.29 MiB | 2.29 MiB |
| Bun | 39.23 ms | 25.70 ms | 39.98 MiB | 75.81 MiB | 77.25 MiB | 3.63 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.
Peak RSS is sampled from the server every 20 ms throughout warm-up and all load points.

## Process and optional allocation pressure

| Target | Server CPU | CPU utilization | Unix syscalls | Mach syscalls | Context switches | Page faults | Open FDs start/peak/end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 8.98 s | 28.5% | 2,448,676 | 166,041 | 149,795 | 25 | 7/59/7 |
| Bun | 31.30 s | 99.5% | 18,428,891 | 4,956,239 | 61,484 | 2,404 | 8/72/8 |

Counters are per measured server process from warm-up through the final load point; medians are across runs.
Open file descriptors are sampled every 20 ms; start and end are taken around the measured warm-up and load interval.

| TinyTSX allocator | Calls | Reallocations | Requested bytes | Peak live bytes | Live bytes at shutdown |
| --- | ---: | ---: | ---: | ---: | ---: |
| Global allocator | disabled | disabled | disabled | disabled | disabled |

Allocator counters are disabled for this comparison, so the TinyTSX throughput path has no instrumentation overhead.

## Request contract

- Method: `POST`
- Content-Type: `application/json`
- Body: `"{\"amount\":7}"` (12 bytes)
- Header `Idempotency-Key`: `benchmark-key`

## Response contract

- Status: 500
- Body: `"internal server error"` (21 bytes)
- TinyTSX Content-Type: `text/plain; charset=UTF-8`
- Bun Content-Type: `text/plain; charset=UTF-8`
- TinyTSX framing: `21`
- Bun framing: `21`

## Throughput and latency

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 8 | 605 | 71,849 | 0.01x | 13.328 ms | 0.127 ms | 16.541 ms | 0.209 ms |
| 64 | 4,545 | 73,923 | 0.06x | 15.161 ms | 0.815 ms | 34.160 ms | 1.656 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 8 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- The failure and recovery keys, JSON body, SQL, and uniqueness conflict are fixed; this does not measure conflict handling in application code, growing data, competing or cross-process writers, cancellation, arbitrary callbacks, crash durability, or network filesystems.
- TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer.
- Power mode and unrelated background activity are not controlled by the harness.
