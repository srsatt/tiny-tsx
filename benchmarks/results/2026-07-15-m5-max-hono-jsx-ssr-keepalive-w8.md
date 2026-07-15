# TinyTSX hono jsx ssr benchmark (8 worker(s))

Generated: 2026-07-15T21:16:03+00:00

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
| TinyTSX | 7.50 ms | 6.00 MiB | 6.30 MiB | 440.18 KiB | 440.18 KiB |
| Bun | 19.87 ms | 41.36 MiB | 123.97 MiB | 0.35 KiB | 60.15 MiB |

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
| 1 | 24,731 | 24,390 | 1.01x | 0.038 ms | 0.039 ms | 0.086 ms | 0.055 ms |
| 8 | 86,471 | 96,401 | 0.90x | 0.088 ms | 0.078 ms | 0.157 ms | 0.220 ms |
| 32 | 96,023 | 99,419 | 0.97x | 0.081 ms | 0.276 ms | 12.792 ms | 0.645 ms |
| 64 | 102,796 | 99,105 | 1.04x | 0.075 ms | 0.590 ms | 26.293 ms | 1.250 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 8 fixed native worker(s); keep-alive is true.
- The benchmark client and server share the same machine.
- The measured root route is fully closed and AOT-rendered; request-selected /post/:id behavior is correctness-tested but not part of this throughput sample.
- TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer.
- Power mode and unrelated background activity are not controlled by the harness.
