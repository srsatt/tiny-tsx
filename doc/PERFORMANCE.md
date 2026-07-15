# Performance evidence and roadmap

Last updated: 2026-07-15

## Current conclusion

TinyTSX is compelling for footprint and startup, and its lack of a JIT has not
created a throughput penalty in either complete Hono workload. On the pinned
Hono basic application it delivers 97–99% of Bun's request rate across
concurrency 1–128. On the byte-identical 881-byte JSX SSR root page it ranges
from 90% to 114% of Bun across concurrency 1–64. Both servers plateau near
32,000 requests/second because every request opens a new TCP connection;
transport cost still masks much of the application-code difference.

The honest claim is therefore:

- **yes for footprint:** JSX SSR uses 5.83 MiB idle and 5.98 MiB after warm-up
  versus Bun's 42.03 MiB and 98.19 MiB;
- **yes for normal repeated startup:** JSX SSR is 7.14 ms median versus Bun's
  19.32 ms;
- **parity under load:** JSX SSR is between 10% behind and 14% ahead in these
  short samples, with near-identical latency at concurrency 64;
- **not yet answered for CPU-heavy dynamic work:** the measured route has a
  six-byte closed body and connection-close HTTP dominates the request cost.

Raw samples and the generated report are in
`benchmarks/results/2026-07-15-m5-max-hono-complete-load.{json,md}` and
`benchmarks/results/2026-07-15-m5-max-hono-jsx-ssr-load.{json,md}`.

## Real JSX SSR result

The second workload compiles the untouched pinned
`vendor/hono-examples/jsx-ssr/src/index.tsx` graph. Bun produces the reference
body first; the harness then requires both servers to return the same 881 bytes,
status, content length, and normalized HTML content type. The application uses
typed component props, children, closed records and arrays, `Array.map`, a Hono
`html` tagged template, Unicode, and HTML escaping. Its request-selected post
route and both 404 paths are covered by Bun and native E2Es, but the load sample
targets the closed root route.

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 9,914 | 8,710 | 1.14x | 0.114 ms | 0.126 ms |
| 8 | 31,952 | 33,677 | 0.95x | 0.315 ms | 0.384 ms |
| 32 | 29,042 | 32,101 | 0.90x | 1.162 ms | 1.101 ms |
| 64 | 32,446 | 32,175 | 1.01x | 2.159 ms | 2.155 ms |

The useful conclusion is not that TinyTSX is categorically faster. It is that
removing the JS engine buys a 7–16x RSS reduction and roughly 2.7x faster
startup here without sacrificing throughput for a fully closed SSR page.

## Method

- Machine: Apple M5 Max, 18 cores, 128 GB, macOS 26.5.2.
- Power: AC, battery charged, normal power mode.
- Bun: 1.3.13; oha: 1.15.0.
- Application: complete pinned 34-module
  `vendor/hono-examples/basic/src/index.ts`.
- Route: `GET /`, including Hono routing, `poweredBy`, and response-time
  middleware.
- Five 5-second samples per target and concurrency; 15 startup samples.
- Concurrency: 1, 8, 32, 64, 128.
- Target process order alternates. Concurrency order alternates ascending and
  descending to reduce JIT/warm-up and thermal-order bias.
- One server process, one TinyTSX worker, localhost, keep-alive disabled for both
  because TinyTSX currently closes every connection.
- Every sample completed with success rate 1.0 and only HTTP 200 responses.

The response status, six body bytes, content length, powered-by header, and
numeric response-time header agree. Content type does not: TinyTSX returns
`text/plain;charset=UTF-8`; Bun returns `application/octet-stream` after Hono's
response-time middleware clones the finalized body as a stream. The harness
records this difference instead of calling the wire responses identical.

## Results

### Footprint and startup

| Metric | TinyTSX | Bun | Interpretation |
| --- | ---: | ---: | --- |
| Startup-to-first-response median | 9.77 ms | 19.91 ms | TinyTSX is 2.04x faster |
| Idle RSS median | 5.84 MiB | 41.73 MiB | Bun uses 7.14x more |
| Post-warm-up RSS median | 6.09 MiB | 70.41 MiB | Bun uses 11.55x more |
| RSS growth during warm-up | 0.25 MiB | 28.67 MiB | TinyTSX remains nearly flat |
| Deployment runtime | 418.89 KiB | 60.15 MiB | Bun runtime is 147x larger, but shareable |

TinyTSX's first launch immediately after the benchmark build was a 382.46 ms
outlier; its remaining-startup median was 9.24 ms. Bun's first sample was
23.64 ms and its remaining median was 19.60 ms. The harness must separate first
post-build launch from repeated warm launch before publishing a stronger startup
claim.

The complete TinyTSX binary's RSS is higher than the earlier smoke binary's
roughly 1.8 MiB because the whole application includes the native Fetch route
and its system networking dependencies. This needs `vmmap`/link inspection
before attributing the increase to generated application data.

### Load scaling

| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p99 | Bun p99 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 9,488 | 9,692 | 0.98x | 0.130 ms | 0.132 ms |
| 8 | 29,656 | 30,148 | 0.98x | 0.334 ms | 0.478 ms |
| 32 | 30,885 | 31,252 | 0.99x | 1.180 ms | 1.279 ms |
| 64 | 29,834 | 30,663 | 0.97x | 2.385 ms | 2.382 ms |
| 128 | 28,131 | 28,899 | 0.97x | 8.438 ms | 7.844 ms |

Both implementations saturate around concurrency 32. From 32 to 128,
TinyTSX throughput falls 8.9% and Bun falls 7.5%, while p99 rises to roughly
8 ms. TinyTSX's lack of a JIT produces no obvious penalty here, but the result
is transport-bound and cannot establish how AOT code compares on dynamic JSON,
escaping, parsing, or allocation-heavy handlers.

## Fixed-worker connection-close baseline

After making `--workers` real, the exact pinned JSX SSR workload was repeated
with 1, 2, 4, and 8 TinyTSX workers. Each variant passed the Bun-derived
881-byte response gate before three one-second load samples per point.

| Workers | Idle RSS | Warm RSS | RPS c8 | RPS c32 | RPS c64 | p99 c64 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 5.89 MiB | 6.05 MiB | 32,155 | 31,330 | 31,522 | 2.373 ms |
| 2 | 5.91 MiB | 6.08 MiB | 30,562 | 29,772 | 29,772 | 4.076 ms |
| 4 | 5.94 MiB | 6.20 MiB | 29,539 | 30,538 | 29,217 | 4.271 ms |
| 8 | 6.03 MiB | 6.41 MiB | 30,786 | 28,450 | 30,122 | 3.806 ms |

Eight workers cost only 0.36 MiB more warm RSS than one, but no worker count
improved throughput or p99. At concurrency 64, 2/4/8 workers reached
0.94x/0.93x/0.96x the one-worker RPS. The result is consistent with the single
acceptor and TCP connect/close path being the bottleneck while the application
returns a closed pre-rendered body. It is not evidence against worker
parallelism: the focused native E2E proves progress on a second executor while
the first is blocked on a partial request.

The raw source reports and combined interpretation are in
`benchmarks/results/2026-07-15-m5-max-hono-jsx-ssr-workers-*`. Keep-alive plus a
request-time rendering workload are required before the matrix can say whether
application execution scales.

## Roadmap

### P0 — make the comparison semantically and mechanically fair

1. **Resolve response-clone content type semantics.** Add a direct WPT-derived
   `Response` clone/body-stream test and decide whether TinyTSX follows the Web
   standard, Bun compatibility, or exposes the difference explicitly. Exit:
   the choice is documented and both the Hono E2E and benchmark contract enforce
   it.
2. **Implement the reusable worker pool and bounded HTTP dispatch.** Make
   `--workers` real, preserve per-request arenas, and define overload behavior.
   Exit: concurrency and saturation behavior are proven independently of HTTP,
   then native E2E tests prove parallel service and recovery after a 503.
3. **Implement HTTP/1.1 keep-alive, then run the scaling comparison.** Reuse one
   connection for multiple requests and benchmark both targets with keep-alive
   enabled. Exit: parser state resets safely, request memory is reclaimed per
   request, the complete Hono matrix stays green, and 1/2/4/8-worker results
   report bounded RSS plus throughput and latency without connection-close
   transport masking scheduler behavior.

### P1 — expose native-code and no-JIT behavior

4. **Add a route workload matrix.** Measure the same complete binary on `/`,
   `/entry/:id`, `/api/posts`, `/api/posts?pretty`, authorized/unauthorized
   `/auth/*`, and representative 1 KiB/16 KiB bodies. Exclude external Fetch
   latency from CPU comparisons. Exit: every route has a pinned Bun/TinyTSX
   response contract and repeated latency/RPS samples.
5. **Add a genuinely request-time TSX workload.** The pinned SSR application now
   proves compile-time records, arrays, mapping, escaping, and finite route
   specialization. The next workload must render unbounded request data through
   native escaping and bounded response writes instead of selecting a closed
   pre-rendered response. This is the first workload that can answer whether
   AOT code beats a warmed JIT for dynamic application work.
6. **Capture CPU, syscalls, allocations, and peak RSS during each sample.** Use
   macOS `sample`/Instruments or equivalent counters and record warm-up phases
   separately. Exit: every throughput result names the dominant CPU path and
   memory growth source.

### P2 — optimize only from profiles, then validate claims

7. **Reduce whole-application footprint.** Inspect `vmmap` and linked images,
   dead-strip unused host APIs where semantics allow it, and quantify the cost
   of Fetch/libcurl, route tables, and generated constants.
8. **Optimize confirmed hot paths.** Likely candidates are connection parsing,
   response/header writes, path matching, and avoidable copies; do not optimize
   symbolic compilation paths that do not execute per request.
9. **Separate first-post-build and warm startup suites.** Preserve the observed
   382 ms TinyTSX first-launch outlier, investigate signing/loader/cache effects,
   and report median plus tail rather than one blended number.
10. **Run publication-grade validation.** Use 30–60 second samples, confidence
    intervals, a separate load-generator host, controlled power/thermal state,
    and repeated days/machines. Publish no general performance claim before
    these gates pass.

The next performance slice should be keep-alive after the response-clone
contract test. In parallel, the compatibility slice should add request-time
escaped JSX text/attributes so the next benchmark exercises native application
work rather than only closed response selection.
