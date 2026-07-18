# TinyTSX hono large file benchmark (8 worker(s))

Generated: 2026-07-18T01:02:59+00:00

> Scope: one request-time read of the pinned 22,173-byte Hono context source through a 32 KiB-bounded file API and one Hono text response; HTTP/1.1; keep-alive; localhost. HTTP/1.1 connections are reused; one server process. This is not a general dynamic-language benchmark.

## Environment

- Machine: Model Name: MacBook Pro; Model Identifier: Mac17,6; Chip: Apple M5 Max; Total Number of Cores: 18 (6 Super and 12 Performance); Memory: 128 GB
- OS: macOS 26.5.2
- TinyTSX commit: `097982d`
- Bun: 1.3.13
- oha: oha 1.15.0
- Runs per point: 3
- Duration per run: 15 seconds

## Footprint and startup

| Target | First launch | Startup median | Idle RSS median | Post-warm-up RSS median | Peak sampled RSS | App artifact | Runtime executable |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 437.66 ms | 22.10 ms | 6.45 MiB | 7.41 MiB | 7.67 MiB | 2.25 MiB | 2.25 MiB |
| Bun | 28.41 ms | 19.21 ms | 39.33 MiB | 106.19 MiB | 106.72 MiB | 0.56 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.
Peak RSS is sampled from the server every 20 ms throughout warm-up and all load points.

## Process and optional allocation pressure

| Target | Server CPU | CPU utilization | Unix syscalls | Mach syscalls | Context switches | Page faults | Open FDs start/peak/end |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 149.76 s | 477.0% | 45,068,518 | 2,264,276 | 4,860,081 | 80 | 4/73/4 |
| Bun | 83.49 s | 266.2% | 19,592,870 | 1,247,176 | 1,147,201 | 4,336 | 5/82/5 |

Counters are per measured server process from warm-up through the final load point; medians are across runs.
Open file descriptors are sampled every 20 ms; start and end are taken around the measured warm-up and load interval.

| TinyTSX allocator | Calls | Reallocations | Requested bytes | Peak live bytes | Live bytes at shutdown |
| --- | ---: | ---: | ---: | ---: | ---: |
| Global allocator | disabled | disabled | disabled | disabled | disabled |

Allocator counters are disabled for this comparison, so the TinyTSX throughput path has no instrumentation overhead.

## Response contract

- Status: 200
- Body: 22,173 UTF-8 bytes; SHA-256 `9228b734a89c2db377a495c29cd2bbd09eb7b928e106c9872f53df19a927e576`
- Body preview: `"import { HonoRequest } from './request'\nimport type { Result } from './router'\nimport type {\n  Env,\n  FetchEventLike,\n  H,\n  Input,\n  NotFoundHandler,\n  RouterR"...`
- TinyTSX Content-Type: `text/plain; charset=UTF-8`
- Bun Content-Type: `text/plain; charset=UTF-8`
- TinyTSX framing: `22173`
- Bun framing: `22173`

## Throughput and latency

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 8 | 31,858 | 24,457 | 1.30x | 0.189 ms | 0.316 ms | 0.618 ms | 0.569 ms |
| 64 | 40,856 | 22,976 | 1.78x | 0.196 ms | 2.740 ms | 22.030 ms | 5.104 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 8 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- This measures repeated warm page-cache reads and one 22,173-byte response; it does not control the OS cache, isolate copies, or cover cold storage, responses above 32 KiB, streaming, binary data, ranges, or compression.
- TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer.
- Power mode and unrelated background activity are not controlled by the harness.
