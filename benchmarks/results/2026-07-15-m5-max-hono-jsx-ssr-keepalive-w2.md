# TinyTSX hono jsx ssr benchmark (2 worker(s))

Generated: 2026-07-15T21:14:36+00:00

> Scope: complete pinned 31-module Hono jsx-ssr application, GET / rendering five posts through typed JSX components; HTTP/1.1; keep-alive; localhost. HTTP/1.1 connections are reused; one server process. This is not a general dynamic-language benchmark.

## Environment

- Machine: Model Name: MacBook Pro; Model Identifier: Mac17,6; Chip: Apple M5 Max; Total Number of Cores: 18 (6 Super and 12 Performance); Memory: 128 GB
- OS: macOS 26.5.2
- TinyTSX commit: `8b0681e`
- Bun: 1.3.13
- oha: oha 1.15.0
- Runs per point: 3
- Duration per run: 1 seconds

## Footprint and startup

| Target | Startup-to-first-response median | Idle RSS median | Post-warm-up RSS median | App artifact | Runtime executable |
| --- | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 7.72 ms | 5.89 MiB | 5.97 MiB | 440.18 KiB | 440.18 KiB |
| Bun | 22.79 ms | 41.39 MiB | 123.20 MiB | 0.35 KiB | 60.15 MiB |

Bun's application script and runtime executable are reported separately; the runtime is required in deployment but may be shared by multiple applications.
Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled after one second at maximum concurrency.

## Response contract

- Status: 200
- Body: `<!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Top</title>
        <link
          rel="stylesheet"
          href="https://cdnjs.cloudflare.com/ajax/libs/mini.css/3.0.1/mini-default.min.css"
        />
      </head>
      <body style="padding: 1em 2em">
        <header>
          <h1>
            <a href="/">Hono Example</a>
          </h1>
        </header>
        <main><h2>Posts</h2><ul><li><a href="/post/1">Good Morning</a></li><li><a href="/post/2">Good Afternoon</a></li><li><a href="/post/3">Good Evening</a></li><li><a href="/post/4">Good Night</a></li><li><a href="/post/5">こんにちは</a></li></ul></main>
        <footer>
          <p>Built with <a href="https://github.com/honojs/hono">Hono</a></p>
        </footer>
      </body>
    </html>` (881 bytes)
- TinyTSX Content-Type: `text/html; charset=UTF-8`
- Bun Content-Type: `text/html; charset=UTF-8`

## Throughput and latency

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 24,352 | 23,619 | 1.03x | 0.038 ms | 0.039 ms | 0.096 ms | 0.066 ms |
| 8 | 42,233 | 89,033 | 0.47x | 0.045 ms | 0.084 ms | 7.510 ms | 0.241 ms |
| 32 | 42,536 | 90,809 | 0.47x | 0.045 ms | 0.302 ms | 35.530 ms | 0.776 ms |
| 64 | 42,988 | 93,129 | 0.46x | 0.045 ms | 0.629 ms | 72.794 ms | 1.371 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 2 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- The measured root route is fully closed and AOT-rendered; request-selected /post/:id behavior is correctness-tested but not part of this throughput sample.
- TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer.
- Power mode and unrelated background activity are not controlled by the harness.
