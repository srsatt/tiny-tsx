# TinyTSX hono basic benchmark

Generated: 2026-07-14T23:32:17+00:00

> Scope: same pinned Hono GET / source; HTTP/1.1; connection close; localhost. A new TCP connection per request; one server process. This is not a general dynamic-language benchmark.

## Environment

- Machine: Model Name: MacBook Pro; Model Identifier: Mac17,6; Chip: Apple M5 Max; Total Number of Cores: 18 (6 Super and 12 Performance); Memory: 128 GB
- OS: macOS 26.5.2
- TinyTSX commit: `77c95a1`
- Bun: 1.3.13
- oha: oha 1.15.0
- Runs per point: 3
- Duration per run: 1 seconds

## Footprint and startup

| Target | Startup-to-first-response median | Idle RSS median | App artifact | Runtime executable |
| --- | ---: | ---: | ---: | ---: |
| TinyTSX | 6.65 ms | 1.77 MiB | 384.83 KiB | 384.83 KiB |
| Bun | 17.50 ms | 49.61 MiB | 0.34 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.

## Throughput and latency

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 10,151 | 10,570 | 0.96x | 0.092 ms | 0.089 ms | 0.109 ms | 0.113 ms |
| 8 | 33,819 | 34,274 | 0.99x | 0.223 ms | 0.221 ms | 0.279 ms | 0.293 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX currently has one worker and always closes the connection.
- The benchmark client and server share the same machine.
- This workload covers one closed response and does not exercise dynamic application logic.
- Power mode and unrelated background activity are not controlled by the harness.
