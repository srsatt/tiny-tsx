# TinyTSX benchmarks

The harness has three workloads:

- `static-page` compares the current static TinyTSX vertical slice to an
  idiomatic `Bun.serve` server returning the same response;
- `hono-basic` runs the complete pinned 34-module
  `vendor/hono-examples/basic/src/index.ts` application through TinyTSX and Bun.
  Bun uses only a host `Bun.serve` adapter and path aliases to the same pinned
  Hono source submodule;
- `hono-jsx-ssr` runs the complete pinned 31-module JSX SSR graph. Bun's root
  response is captured as the byte reference, then both targets must return the
  same 881-byte HTML before startup, RSS, and load samples are accepted.

Both verify status, content length, response bytes, powered-by behavior, and a
numeric response-time header before collecting samples. Target-specific content
types are recorded instead of hidden: after the example's response-time
middleware clones the body, TinyTSX preserves `text/plain;charset=UTF-8` while
Bun 1.3.13 serves the stream as `application/octet-stream`.

This is deliberately not presented as a general TypeScript performance result.
TinyTSX uses the worker count selected with `--workers`; the harness uses
connection-close by default and enables persistent connections with
`--keep-alive` for both targets. The JSX root is closed and rendered at AOT
time; request-selected post behavior is tested but is not the throughput target.

## Prerequisites

- Apple Silicon macOS;
- the project build dependencies from the root README;
- Bun;
- [`oha`](https://github.com/hatoo/oha), installable with `brew install oha`.

## Run

The default run records five-second samples three times at concurrency 1, 8, 32,
and 64:

```bash
python3 benchmarks/scripts/run_static.py
```

Run the exact-source Hono comparison with:

```bash
npm run benchmark:hono
npm run benchmark:hono-jsx-ssr
npm run benchmark:hono-jsx-ssr-keepalive
```

Run the worker-scaling baseline as four independent, equivalence-checked
TinyTSX/Bun comparisons:

```bash
python3 benchmarks/scripts/run_static.py --workload hono-jsx-ssr --workers 1
python3 benchmarks/scripts/run_static.py --workload hono-jsx-ssr --workers 2
python3 benchmarks/scripts/run_static.py --workload hono-jsx-ssr --workers 4
python3 benchmarks/scripts/run_static.py --workload hono-jsx-ssr --workers 8
```

These runs still create a new connection per request. Use them as the initial
worker/RSS baseline, not as evidence of scheduler scaling; rerun after
keep-alive removes most accept/connect/close work from the measured path.

Append `--keep-alive` to run the persistent-connection matrix. TinyTSX closes
each connection after 100 requests or five idle seconds, so the harness records
that bounded reconnect policy as a limitation beside Bun's host behavior.

A shorter exploratory run is useful during development:

```bash
python3 benchmarks/scripts/run_static.py \
  --duration 2 \
  --runs 3 \
  --startup-runs 5 \
  --concurrency 1,8,32 \
  --output-prefix benchmarks/results/local-preview
```

The harness builds a stripped release TinyTSX executable, alternates target order
between runs, warms each process, and retains every sample. It writes adjacent
JSON and Markdown reports under `benchmarks/results/`.

The first Hono smoke preview is persisted as
`2026-07-15-m5-max-hono-preview.{json,md}`. It uses three one-second samples at
concurrency 1 and 8 against the earlier single-route tracer. Treat it as
historical directional evidence only; it predates the complete-source workload.

The harness alternates TinyTSX/Bun process order for both startup and load
samples. Load concurrency runs ascending on even samples and descending on odd
samples, reducing systematic warm-up, JIT, and thermal-order bias. Idle RSS is
measured after one correctness request; post-warm-up RSS is measured after one
second at the maximum requested concurrency.

For credible comparative runs, connect the Mac to power, disable Low Power Mode,
close unnecessary applications, and avoid indexing or builds while measuring.

The first fixed-worker connection-close matrix is retained as four raw reports
and `2026-07-15-m5-max-hono-jsx-ssr-workers-summary.md`. It found no throughput
gain from 2/4/8 workers on the closed JSX root, while warm RSS rose from 6.05 MiB
at one worker to 6.41 MiB at eight. This is the baseline that keep-alive and a
request-time workload must replace before scheduler conclusions.
