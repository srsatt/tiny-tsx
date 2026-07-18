# TinyTSX static page benchmark (8 worker(s))

Generated: 2026-07-18T23:46:41+00:00

> Scope: 53-byte static HTML; HTTP/1.1; keep-alive; localhost. HTTP/1.1 connections are reused; one server process. This is not a general dynamic-language benchmark.

## Environment

- Machine: Model Name: MacBook Pro; Model Identifier: Mac17,6; Chip: Apple M5 Max; Total Number of Cores: 18 (6 Super and 12 Performance); Memory: 128 GB
- OS: macOS 26.5.2
- TinyTSX commit: `ce2200a`
- Bun: 1.3.13
- oha: oha 1.15.0
- Load generator: oha
- Runs per point: 3
- Duration per run: 5 seconds

## Footprint and startup

| Target | First launch | Startup median | Idle RSS median | Post-warm-up RSS median | Peak sampled RSS | App artifact | Runtime executable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 446.79 ms | 24.15 ms | 6.23 MiB | 6.59 MiB | 6.73 MiB | 2.28 MiB | 2.28 MiB |
| Bun | 22.03 ms | 16.84 ms | 25.05 MiB | 36.12 MiB | 36.33 MiB | 0.47 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.
Peak RSS is sampled from the server every 20 ms throughout warm-up and all load points.

## Process and optional allocation pressure

| Target | Server CPU | CPU utilization | Unix syscalls | Mach syscalls | Context switches | Page faults | Open FDs start/peak/end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 61.70 s | 543.3% | 10,390,534 | 941 | 449,725 | 34 | 6/70/6 |
| Bun | 10.53 s | 91.9% | 4,352,916 | 112,029 | 106,716 | 720 | 5/69/5 |

Counters are per measured server process from warm-up through the final load point; medians are across runs.
Open file descriptors are sampled every 20 ms; start and end are taken around the measured warm-up and load interval.

| TinyTSX allocator | Calls | Reallocations | Requested bytes | Peak live bytes | Live bytes at shutdown |
| --- | ---: | ---: | ---: | ---: | ---: |
| Global allocator | disabled | disabled | disabled | disabled | disabled |

Allocator counters are disabled for this comparison, so the TinyTSX throughput path has no instrumentation overhead.

## Response contract

- Status: 200
- Body: `"<html><body><h1>Hello from TinyTSX</h1></body></html>"` (53 bytes)
- TinyTSX Content-Type: `text/html; charset=utf-8`
- Bun Content-Type: `text/html; charset=utf-8`
- TinyTSX framing: `53`
- Bun framing: `53`

## Throughput and latency

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 8 | 33,660 | 157,154 | 0.21x | 0.122 ms | 0.048 ms | 0.504 ms | 0.081 ms |
| 64 | 63,892 | 194,801 | 0.33x | 0.938 ms | 0.281 ms | 2.246 ms | 0.601 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 8 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- This workload does not exercise dynamic props, escaping, or application logic.
- TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer.
- Power mode and unrelated background activity are not controlled by the harness.
