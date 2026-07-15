# Performance evidence and roadmap

Last updated: 2026-07-15

## Current conclusion

TinyTSX is already compelling for footprint and steady-state startup, but the
current benchmark does not show a throughput advantage over Bun. On the complete
pinned Hono basic application, TinyTSX delivers 97–99% of Bun's request rate
across concurrency 1–128 while using far less memory. Both servers plateau near
31,000 requests/second because every request opens a new TCP connection; that
transport cost masks most application-code and JIT differences.

The honest claim is therefore:

- **yes for footprint:** 5.84 MiB idle and 6.09 MiB after warm-up versus Bun's
  41.73 MiB and 70.41 MiB;
- **yes for normal repeated startup:** 9.77 ms median versus Bun's 19.91 ms;
- **parity, not a win, for this throughput test:** TinyTSX is 1–3% behind Bun;
- **not yet answered for CPU-heavy dynamic work:** the measured route has a
  six-byte closed body and connection-close HTTP dominates the request cost.

Raw samples and the generated report are in
`benchmarks/results/2026-07-15-m5-max-hono-complete-load.{json,md}`.

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

## Roadmap

### P0 — make the comparison semantically and mechanically fair

1. **Resolve response-clone content type semantics.** Add a direct WPT-derived
   `Response` clone/body-stream test and decide whether TinyTSX follows the Web
   standard, Bun compatibility, or exposes the difference explicitly. Exit:
   the choice is documented and both the Hono E2E and benchmark contract enforce
   it.
2. **Implement HTTP/1.1 keep-alive in the bounded runtime.** Reuse one connection
   for multiple requests and benchmark both targets with keep-alive enabled.
   Exit: parser state resets safely, request memory is reclaimed per request,
   malformed/oversized requests recover or close deterministically, and the
   complete Hono matrix stays green.
3. **Implement the fixed native worker pool and bounded accept queue.** Make
   `--workers` real, preserve per-request arenas, and define overload behavior.
   Exit: measurements at 1, 2, 4, and 8 workers show scaling and bounded RSS;
   queue saturation returns a controlled failure rather than unbounded growth.

### P1 — expose native-code and no-JIT behavior

4. **Add a route workload matrix.** Measure the same complete binary on `/`,
   `/entry/:id`, `/api/posts`, `/api/posts?pretty`, authorized/unauthorized
   `/auth/*`, and representative 1 KiB/16 KiB bodies. Exclude external Fetch
   latency from CPU comparisons. Exit: every route has a pinned Bun/TinyTSX
   response contract and repeated latency/RPS samples.
5. **Add a genuinely request-dependent TSX workload.** Include query parsing,
   HTML escaping, record projection, arrays/loops, and bounded response writes.
   This is the first workload that can answer whether AOT code beats a warmed
   JIT for application work.
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

The next implementation slice should be keep-alive after the response-clone
contract test. It removes the largest known benchmark confounder and makes the
worker-pool and dynamic-workload results materially more informative.
