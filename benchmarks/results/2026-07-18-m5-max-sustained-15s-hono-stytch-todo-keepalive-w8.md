# TinyTSX hono stytch todo benchmark (8 worker(s))

Generated: 2026-07-18T15:00:46+00:00

> Scope: unchanged pinned three-module Hono Stytch TODO backend; credential-free cookie sessions; one actor-owned in-memory SQLite KV binding; closed-loop authenticated create/list/complete/delete cycles; HTTP/1.1; localhost. HTTP/1.1 connections are reused; one server process. This is not a general dynamic-language benchmark.

## Environment

- Machine: Model Name: MacBook Pro; Model Identifier: Mac17,6; Chip: Apple M5 Max; Total Number of Cores: 18 (6 Super and 12 Performance); Memory: 128 GB
- OS: macOS 26.5.2
- TinyTSX commit: `efed239`
- Bun: 1.3.13
- oha: oha 1.15.0
- Load generator: bounded response-checked Python CRUD client
- Runs per point: 3
- Duration per run: 15 seconds

## Footprint and startup

| Target | First launch | Startup median | Idle RSS median | Post-warm-up RSS median | Peak sampled RSS | App artifact | Runtime executable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 519.79 ms | 91.36 ms | 7.80 MiB | 8.16 MiB | 8.20 MiB | 2.31 MiB | 2.31 MiB |
| Bun | 35.70 ms | 24.45 ms | 40.30 MiB | 66.38 MiB | 70.78 MiB | 2.16 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.
Peak RSS is sampled from the server every 20 ms throughout warm-up and all load points.

## Process and optional allocation pressure

| Target | Server CPU | CPU utilization | Unix syscalls | Mach syscalls | Context switches | Page faults | Open FDs start/peak/end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 20.16 s | 64.6% | 11,893,238 | 1,036,480 | 1,643,715 | 28 | 4/68/4 |
| Bun | 13.08 s | 41.9% | 2,487,535 | 146,321 | 803,421 | 2,002 | 5/69/5 |

Counters are per measured server process from warm-up through the final load point; medians are across runs.
Open file descriptors are sampled every 20 ms; start and end are taken around the measured warm-up and load interval.

| TinyTSX allocator | Calls | Reallocations | Requested bytes | Peak live bytes | Live bytes at shutdown |
| --- | ---: | ---: | ---: | ---: | ---: |
| Global allocator | disabled | disabled | disabled | disabled | disabled |

Allocator counters are disabled for this comparison, so the TinyTSX throughput path has no instrumentation overhead.

## Scenario contract

1. POST /api/todos creates one request-owned record
2. GET /api/todos verifies that exact record
3. POST /api/todos/:id/complete verifies the completed record
4. DELETE /api/todos/:id verifies empty state

Every step carries a fixed per-worker credential-free session cookie; the client validates status, content type, record identity, text, completion, and final empty state before starting the next cycle.

## Response contract

- Status: 200
- Body: `"{\"todos\":[]}"` (12 bytes)
- TinyTSX Content-Type: `application/json`
- Bun Content-Type: `application/json`
- TinyTSX framing: `12`
- Bun framing: `12`

## Throughput and latency

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 8 | 15,905 | 23,359 | 0.68x | 0.405 ms | 0.301 ms | 1.624 ms | 0.939 ms |
| 64 | 17,367 | 23,049 | 0.75x | 0.474 ms | 2.440 ms | 50.026 ms | 8.365 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.
Throughput counts individual HTTP requests; 4 checked requests complete one state-bounded CRUD cycle.

## Limitations

- TinyTSX uses 8 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- The custom closed-loop client keeps one TODO per fixed worker user and validates every response before continuing. It does not measure live Stytch/JWT/network behavior, growing lists, shared-user write contention, disk persistence, browser assets, or general class/KV compatibility.
- TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer.
- Power mode and unrelated background activity are not controlled by the harness.
