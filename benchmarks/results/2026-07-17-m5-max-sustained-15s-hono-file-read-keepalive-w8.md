# TinyTSX hono file read benchmark (8 worker(s))

Generated: 2026-07-18T00:53:44+00:00

> Scope: one request-time read of the pinned 21-byte Hono serve-static asset through a bounded file API and Hono text response; HTTP/1.1; keep-alive; localhost. HTTP/1.1 connections are reused; one server process. This is not a general dynamic-language benchmark.

## Environment

- Machine: Model Name: MacBook Pro; Model Identifier: Mac17,6; Chip: Apple M5 Max; Total Number of Cores: 18 (6 Super and 12 Performance); Memory: 128 GB
- OS: macOS 26.5.2
- TinyTSX commit: `c16333f`
- Bun: 1.3.13
- oha: oha 1.15.0
- Runs per point: 3
- Duration per run: 15 seconds

## Footprint and startup

| Target | First launch | Startup median | Idle RSS median | Post-warm-up RSS median | Peak sampled RSS | App artifact | Runtime executable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 449.24 ms | 20.00 ms | 6.42 MiB | 6.97 MiB | 7.22 MiB | 2.25 MiB | 2.25 MiB |
| Bun | 26.16 ms | 18.85 ms | 40.00 MiB | 84.94 MiB | 85.66 MiB | 0.60 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.
Peak RSS is sampled from the server every 20 ms throughout warm-up and all load points.

## Process and optional allocation pressure

| Target | Server CPU | CPU utilization | Unix syscalls | Mach syscalls | Context switches | Page faults | Open FDs start/peak/end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 135.57 s | 432.1% | 44,293,598 | 2,339,261 | 4,793,336 | 57 | 4/71/4 |
| Bun | 194.68 s | 619.0% | 18,909,474 | 2,556,395 | 3,106,277 | 2,927 | 5/82/5 |

Counters are per measured server process from warm-up through the final load point; medians are across runs.
Open file descriptors are sampled every 20 ms; start and end are taken around the measured warm-up and load interval.

| TinyTSX allocator | Calls | Reallocations | Requested bytes | Peak live bytes | Live bytes at shutdown |
| --- | ---: | ---: | ---: | ---: | ---: |
| Global allocator | disabled | disabled | disabled | disabled | disabled |

Allocator counters are disabled for this comparison, so the TinyTSX throughput path has no instrumentation overhead.

## Response contract

- Status: 200
- Body: `This is a sample file` (21 bytes)
- TinyTSX Content-Type: `text/plain; charset=UTF-8`
- Bun Content-Type: `text/plain; charset=UTF-8`
- TinyTSX framing: `21`
- Bun framing: `21`

## Throughput and latency

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 8 | 32,015 | 59,317 | 0.54x | 0.183 ms | 0.128 ms | 1.602 ms | 0.249 ms |
| 64 | 42,969 | 77,213 | 0.56x | 0.187 ms | 0.773 ms | 20.939 ms | 1.698 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 8 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- This measures repeated warm page-cache reads of one tiny immutable text file; it does not isolate filesystem syscalls, control the OS cache, or cover cold storage, large files, replacement, binary data, or writes.
- TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer.
- Power mode and unrelated background activity are not controlled by the harness.
