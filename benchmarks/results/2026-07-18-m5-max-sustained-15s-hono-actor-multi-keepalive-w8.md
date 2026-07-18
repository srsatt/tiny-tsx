# TinyTSX hono actor multi benchmark (8 worker(s))

Generated: 2026-07-18T02:54:01+00:00

> Scope: eight persistent signed counter owners behind response-equivalent Hono tell routes; URL-file traffic cycles all owners and post-load asks prove mutation; HTTP/1.1; localhost. HTTP/1.1 connections are reused; one server process. This is not a general dynamic-language benchmark.

## Environment

- Machine: Model Name: MacBook Pro; Model Identifier: Mac17,6; Chip: Apple M5 Max; Total Number of Cores: 18 (6 Super and 12 Performance); Memory: 128 GB
- OS: macOS 26.5.2
- TinyTSX commit: `528ecd6`
- Bun: 1.3.13
- oha: oha 1.15.0
- Runs per point: 3
- Duration per run: 15 seconds

## Footprint and startup

| Target | First launch | Startup median | Idle RSS median | Post-warm-up RSS median | Peak sampled RSS | App artifact | Runtime executable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 448.96 ms | 22.71 ms | 6.55 MiB | 6.64 MiB | 6.75 MiB | 2.26 MiB | 2.26 MiB |
| Bun | 27.55 ms | 18.77 ms | 74.62 MiB | 120.77 MiB | 703.77 MiB | 1.48 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.
Peak RSS is sampled from the server every 20 ms throughout warm-up and all load points.

## Process and optional allocation pressure

| Target | Server CPU | CPU utilization | Unix syscalls | Mach syscalls | Context switches | Page faults | Open FDs start/peak/end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 64.42 s | 202.9% | 34,130,054 | 2,757 | 4,617,140 | 13 | 4/68/4 |
| Bun | 60.46 s | 191.7% | 12,426,790 | 10,811,972 | 4,085,302 | 40,229 | 13/77/13 |

Counters are per measured server process from warm-up through the final load point; medians are across runs.
Open file descriptors are sampled every 20 ms; start and end are taken around the measured warm-up and load interval.

| TinyTSX allocator | Calls | Reallocations | Requested bytes | Peak live bytes | Live bytes at shutdown |
| --- | ---: | ---: | ---: | ---: | ---: |
| Global allocator | disabled | disabled | disabled | disabled | disabled |

Allocator counters are disabled for this comparison, so the TinyTSX throughput path has no instrumentation overhead.

## Response contract

- Status: 200
- Body: `"queued"` (6 bytes)
- TinyTSX Content-Type: `text/plain; charset=UTF-8`
- Bun Content-Type: `text/plain; charset=UTF-8`
- TinyTSX framing: `6`
- Bun framing: `6`

## Throughput and latency

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 8 | 38,366 | 96,986 | 0.40x | 0.107 ms | 0.078 ms | 0.286 ms | 0.156 ms |
| 64 | 76,825 | 100,666 | 0.76x | 0.107 ms | 0.612 ms | 11.806 ms | 1.199 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 8 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- TinyTSX uses eight lightweight local actors while Bun uses eight Worker-owned counters. This measures distributed fire-and-forget mutation and complete-process pressure, not isolated ask latency, supervision, persistence, remote actors, or Worker creation cost.
- TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer.
- Power mode and unrelated background activity are not controlled by the harness.
