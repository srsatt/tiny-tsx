# TinyTSX hono jsx ssr benchmark

Generated: 2026-07-15T08:07:50+00:00

> Scope: complete pinned 31-module Hono jsx-ssr application, GET / rendering five posts through typed JSX components; HTTP/1.1; connection close; localhost. A new TCP connection per request; one server process. This is not a general dynamic-language benchmark.

## Environment

- Machine: Model Name: MacBook Pro; Model Identifier: Mac17,6; Chip: Apple M5 Max; Total Number of Cores: 18 (6 Super and 12 Performance); Memory: 128 GB
- OS: macOS 26.5.2
- TinyTSX commit: `45648ef`
- Bun: 1.3.13
- oha: oha 1.15.0
- Runs per point: 3
- Duration per run: 1 seconds

## Footprint and startup

| Target | Startup-to-first-response median | Idle RSS median | Post-warm-up RSS median | App artifact | Runtime executable |
| --- | ---: | ---: | ---: | ---: | ---: |
| TinyTSX | 7.14 ms | 5.83 MiB | 5.98 MiB | 401.04 KiB | 401.04 KiB |
| Bun | 19.32 ms | 42.03 MiB | 98.19 MiB | 0.35 KiB | 60.15 MiB |

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
| 1 | 9,914 | 8,710 | 1.14x | 0.093 ms | 0.099 ms | 0.114 ms | 0.126 ms |
| 8 | 31,952 | 33,677 | 0.95x | 0.229 ms | 0.230 ms | 0.315 ms | 0.384 ms |
| 32 | 29,042 | 32,101 | 0.90x | 0.898 ms | 0.891 ms | 1.162 ms | 1.101 ms |
| 64 | 32,446 | 32,175 | 1.01x | 1.808 ms | 1.812 ms | 2.159 ms | 2.155 ms |

Medians are computed across all recorded runs; no samples are discarded. Raw samples are retained in the adjacent JSON report.

## Limitations

- TinyTSX currently has one worker and always closes the connection.
- The benchmark client and server share the same machine.
- The measured root route is fully closed and AOT-rendered; request-selected /post/:id behavior is correctness-tested but not part of this throughput sample.
- Power mode and unrelated background activity are not controlled by the harness.
