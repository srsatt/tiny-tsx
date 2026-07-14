# TinyTSX static benchmark

Generated: 2026-07-14T16:01:24+00:00

> Scope: static 53-byte response, HTTP/1.1, a new TCP connection per request, one server process, localhost. This is not a dynamic-language benchmark.

## Environment

- Machine: Model Name: MacBook Pro; Model Identifier: Mac17,6; Chip: Apple M5 Max; Total Number of Cores: 18 (6 Super and 12 Performance); Memory: 128 GB
- OS: macOS 26.5.2
- TinyTSX commit: `a4db505`
- Bun: 1.3.13
- oha: oha 1.15.0
- Runs per point: 3
- Duration per run: 2 seconds

## Footprint and startup

| Target | Startup-to-first-response median | Idle RSS median | App artifact | Runtime executable |
| --- | ---: | ---: | ---: | ---: |
| TinyTSX | 5.64 ms | 1.78 MiB | 384.69 KiB | 384.69 KiB |
| Bun | 12.87 ms | 31.53 MiB | 0.47 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.

## Throughput and latency

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 10,271 | 10,235 | 1.00x | 0.091 ms | 0.090 ms | 0.115 ms | 0.184 ms |
| 8 | 32,599 | 32,236 | 1.01x | 0.226 ms | 0.226 ms | 0.311 ms | 0.339 ms |
| 32 | 31,734 | 32,302 | 0.98x | 0.907 ms | 0.909 ms | 1.184 ms | 1.151 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX currently has one worker and always closes the connection.
- The benchmark client and server share the same machine.
- This workload does not exercise dynamic props, escaping, or application logic.
- Power mode and unrelated background activity are not controlled by the harness.
