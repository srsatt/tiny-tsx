# TinyTSX hono nested profile benchmark (8 worker(s))

Generated: 2026-07-18T11:21:28+00:00

> Scope: one in-memory SQLite owner behind a pinned Hono POST route; schema check, four bounded nested primitive request leaves, two idempotent prepared writes in one callback transaction, and the nested JSON response per request; HTTP/1.1; localhost. HTTP/1.1 connections are reused; one server process. This is not a general dynamic-language benchmark.

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
| TinyTSX | 460.53 ms | 22.68 ms | 7.64 MiB | 8.86 MiB | 9.03 MiB | 2.33 MiB | 2.33 MiB |
| Bun | 27.16 ms | 20.47 ms | 40.03 MiB | 72.25 MiB | 74.69 MiB | 1.68 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.
Peak RSS is sampled from the server every 20 ms throughout warm-up and all load points.

## Process and optional allocation pressure

| Target | Server CPU | CPU utilization | Unix syscalls | Mach syscalls | Context switches | Page faults | Open FDs start/peak/end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 82.10 s | 261.3% | 25,646,600 | 5,500,638 | 5,849,902 | 94 | 4/68/4 |
| Bun | 31.36 s | 99.6% | 6,296,067 | 477,543 | 74,307 | 2,237 | 5/69/5 |

Counters are per measured server process from warm-up through the final load point; medians are across runs.
Open file descriptors are sampled every 20 ms; start and end are taken around the measured warm-up and load interval.

| TinyTSX allocator | Calls | Reallocations | Requested bytes | Peak live bytes | Live bytes at shutdown |
| --- | ---: | ---: | ---: | ---: | ---: |
| Global allocator | disabled | disabled | disabled | disabled | disabled |

Allocator counters are disabled for this comparison, so the TinyTSX throughput path has no instrumentation overhead.

## Request contract

- Method: `POST`
- Content-Type: `application/json`
- Body: `"{\"profile\":{\"name\":\"Benchmark\",\"preferences\":{\"theme\":\"dark\",\"alerts\":true}},\"score\":7}"` (87 bytes)

## Response contract

- Status: 201
- Body: `"{\"id\":\"benchmark\",\"profile\":{\"name\":\"Benchmark\",\"preferences\":{\"theme\":\"dark\",\"alerts\":true}},\"score\":7}"` (104 bytes)
- TinyTSX Content-Type: `application/json`
- Bun Content-Type: `application/json`
- TinyTSX framing: `104`
- Bun framing: `104`

## Throughput and latency

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 8 | 32,183 | 92,978 | 0.35x | 0.142 ms | 0.088 ms | 3.403 ms | 0.164 ms |
| 64 | 56,376 | 95,720 | 0.59x | 0.144 ms | 0.623 ms | 16.008 ms | 1.283 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 8 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- The fixed profile and ID keep the two writes idempotent. This does not measure growing data, duplicate-theme rollback frequency, malformed-input mixtures, dynamic schemas, arrays, JSON columns, disk or WAL I/O, competing connections, or arbitrary callback shapes.
- TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer.
- Power mode and unrelated background activity are not controlled by the harness.
