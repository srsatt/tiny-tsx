# TinyTSX benchmarks

The harness has two workloads:

- `static-page` compares the current static TinyTSX vertical slice to an
  idiomatic `Bun.serve` server returning the same response;
- `hono-basic` runs the exact pinned `tests/compat/hono/basic-smoke.ts`
  application through TinyTSX and Bun. Bun uses a host-only `Bun.serve` adapter
  and a path alias to the same pinned Hono submodule.

Both verify status, content type, content length, and response bytes before
collecting samples.

This is deliberately not presented as a general TypeScript performance result.
TinyTSX currently supports only a static page, one worker, and connection-close
HTTP. The client therefore disables keep-alive for both targets.

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
```

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

The first exact-source Hono preview is persisted as
`2026-07-15-m5-max-hono-preview.{json,md}`. It uses three one-second samples at
concurrency 1 and 8. Treat it as directional evidence only: the response is six
closed bytes, both servers close every connection, and no request-dependent
Hono behavior executes.

For credible comparative runs, connect the Mac to power, disable Low Power Mode,
close unnecessary applications, and avoid indexing or builds while measuring.
