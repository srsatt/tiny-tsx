# TinyTSX hono sqlite wal benchmark (8 worker(s))

Generated: 2026-07-18T03:27:48+00:00

> Scope: two independent SQLite owners contending for one capability-scoped on-disk WAL file; every request rolls back one savepoint update, commits one progress update with synchronous FULL, and returns a fixed Hono response; HTTP/1.1; localhost. HTTP/1.1 connections are reused; one server process. This is not a general dynamic-language benchmark.

## Environment

- Machine: Model Name: MacBook Pro; Model Identifier: Mac17,6; Chip: Apple M5 Max; Total Number of Cores: 18 (6 Super and 12 Performance); Memory: 128 GB
- OS: macOS 26.5.2
- TinyTSX commit: `07efc5d`
- Bun: 1.3.13
- oha: oha 1.15.0
- Runs per point: 3
- Duration per run: 15 seconds

## Footprint and startup

| Target | First launch | Startup median | Idle RSS median | Post-warm-up RSS median | Peak sampled RSS | App artifact | Runtime executable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 475.98 ms | 49.48 ms | 7.92 MiB | 8.06 MiB | 8.12 MiB | 2.26 MiB | 2.26 MiB |
| Bun | 42.07 ms | 26.07 ms | 49.84 MiB | 87.50 MiB | 126.67 MiB | 2.60 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.
Peak RSS is sampled from the server every 20 ms throughout warm-up and all load points.

## Process and optional allocation pressure

| Target | Server CPU | CPU utilization | Unix syscalls | Mach syscalls | Context switches | Page faults | Open FDs start/peak/end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 17.16 s | 54.6% | 6,664,061 | 512,280 | 867,084 | 17 | 9/73/9 |
| Bun | 20.47 s | 65.3% | 4,495,278 | 1,939,601 | 948,618 | 4,932 | 12/76/12 |

Counters are per measured server process from warm-up through the final load point; medians are across runs.
Open file descriptors are sampled every 20 ms; start and end are taken around the measured warm-up and load interval.

| TinyTSX allocator | Calls | Reallocations | Requested bytes | Peak live bytes | Live bytes at shutdown |
| --- | ---: | ---: | ---: | ---: | ---: |
| Global allocator | disabled | disabled | disabled | disabled | disabled |

Allocator counters are disabled for this comparison, so the TinyTSX throughput path has no instrumentation overhead.

## Response contract

- Status: 200
- Body: `"committed"` (9 bytes)
- TinyTSX Content-Type: `text/plain; charset=UTF-8`
- Bun Content-Type: `text/plain; charset=UTF-8`
- TinyTSX framing: `9`
- Bun framing: `9`

## Throughput and latency

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 8 | 7,850 | 6,880 | 1.14x | 0.702 ms | 0.758 ms | 4.483 ms | 4.669 ms |
| 64 | 8,554 | 14,872 | 0.58x | 1.077 ms | 2.573 ms | 108.839 ms | 13.504 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 8 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- TinyTSX uses two application-pool database owners while Bun uses two dedicated Workers; this does not measure failed full-transaction rollback, crash or power-loss durability, cold storage, disabled automatic checkpoints, more than two connections, growing tables, request-derived values, network filesystems, or cross-process writers.
- TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer.
- Power mode and unrelated background activity are not controlled by the harness.
