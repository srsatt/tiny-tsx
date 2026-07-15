# TinyTSX hono jsx ssr benchmark (2 worker(s))

Generated: 2026-07-15T08:48:27+00:00

> Scope: complete pinned 31-module Hono jsx-ssr application, GET / rendering five posts through typed JSX components; HTTP/1.1; connection close; localhost. A new TCP connection per request; one server process. This is not a general dynamic-language benchmark.

## Environment

- Machine: Model Name: MacBook Pro; Model Identifier: Mac17,6; Chip: Apple M5 Max; Total Number of Cores: 18 (6 Super and 12 Performance); Memory: 128 GB
- OS: macOS 26.5.2
- TinyTSX commit: `ca2c6f8`
- Bun: 1.3.13
- oha: oha 1.15.0
- Runs per point: 3
- Duration per run: 1 seconds

## Footprint and startup

| Target | Startup-to-first-response median | Idle RSS median | Post-warm-up RSS median | App artifact | Runtime executable |
| --- | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 7.36 ms | 5.91 MiB | 6.08 MiB | 439.45 KiB | 439.45 KiB |
| Bun | 20.27 ms | 41.50 MiB | 97.73 MiB | 0.35 KiB | 60.15 MiB |

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
| 1 | 9,923 | 9,350 | 1.06x | 0.093 ms | 0.098 ms | 0.112 ms | 0.126 ms |
| 8 | 30,562 | 31,676 | 0.96x | 0.237 ms | 0.230 ms | 0.310 ms | 0.404 ms |
| 32 | 29,772 | 31,886 | 0.93x | 0.959 ms | 0.900 ms | 1.474 ms | 1.151 ms |
| 64 | 29,772 | 31,244 | 0.95x | 1.928 ms | 1.844 ms | 4.076 ms | 3.730 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX uses 2 fixed native worker(s) and always closes the connection.
- The benchmark client and server share the same machine.
- The measured root route is fully closed and AOT-rendered; request-selected /post/:id behavior is correctness-tested but not part of this throughput sample.
- Power mode and unrelated background activity are not controlled by the harness.
