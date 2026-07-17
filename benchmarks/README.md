# TinyTSX benchmarks

The harness has nine workloads:

- `static-page` compares the current static TinyTSX vertical slice to an
  idiomatic `Bun.serve` server returning the same response;
- `hono-basic` runs the complete pinned 34-module
  `vendor/hono-examples/basic/src/index.ts` application through TinyTSX and Bun.
  Bun uses only a host `Bun.serve` adapter and path aliases to the same pinned
  Hono source submodule;
- `hono-jsx-ssr` runs the complete pinned 31-module JSX SSR graph. Bun's root
  response is captured as the byte reference, then both targets must return the
  same 881-byte HTML before startup, RSS, and load samples are accepted;
- `hono-dynamic-jsx` decodes one request query value and renders it through
  nested JSX text and attribute escaping; and
- `hono-stream-text` runs the pinned 33-module upstream `streamText()` path and
  requires three finite HTTP/1.1 chunks plus the decoded 19-byte body; and
- `hono-worker` compares one persistent logical string worker per target,
  including copied request/reply messages through an async Hono route; and
- `hono-actor` compares a zero-delta read through one persistent TinyTSX
  counter actor with a Bun Worker-owned counter; and
- `hono-sqlite` compares one schema-check plus empty prepared query through the
  bounded TinyTSX SQLite owner with synchronous `bun:sqlite`; and
- `hono-ai-provider` runs the pinned 656-module Hono + AI SDK Core +
  OpenAI-compatible provider graph against one shared zero-delay loopback
  provider. The support process is excluded from both targets' RSS.

Both verify status, content length, response bytes, powered-by behavior, and a
numeric response-time header before collecting samples. Target-specific content
types are recorded instead of hidden: after the example's response-time
middleware clones the body, TinyTSX preserves `text/plain;charset=UTF-8` while
Bun 1.3.13 serves the stream as `application/octet-stream`. The pinned Fetch
WPT requires the TinyTSX value for the original string body; the Bun value is a
visible reference-runtime deviation, not the portable contract.

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
npm run benchmark:hono-dynamic-jsx
npm run benchmark:hono-stream-text
npm run benchmark:hono-worker
npm run benchmark:hono-actor
npm run benchmark:hono-sqlite
npm run benchmark:hono-ai-provider
npm run benchmark:actor-scale
```

The actor-scale probe is separate from the HTTP/Bun matrix. It builds the
release worker runtime, holds 0, 1,000, and 10,000 idle logical actors with two
executors, and records process RSS, incremental bytes per actor, OS threads,
and spawn time. Override its defaults directly when collecting release evidence:

```bash
python3 benchmarks/scripts/run_actor_scale.py \
  --runs 5 \
  --counts 0,1000,10000 \
  --executors 2 \
  --output-prefix benchmarks/results/local-actor-scale
```

This probe does not involve Hono, Bun, messages, persistence, or hot-mailbox
fairness. The committed M5 Max result is
`results/2026-07-17-m5-max-actor-scale.{json,md}`.

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

Each report now separates the target's first launch from the median of all
fresh-process startup samples. During warm-up and load, a macOS `libproc`
sampler reads process CPU time, Unix/Mach syscall counts, context switches,
faults, thread count, and RSS; RSS is sampled every 20 ms and the remaining
counters are captured at the measurement boundaries. These are whole-server
process counters, not per-route profiles, and the load generator runs on the
same machine.

Allocator instrumentation is opt-in because counting adds atomic work to every
TinyTSX allocation. Use `--allocation-metrics` to build the runtime with that
feature and record allocation/reallocation calls, requested bytes, peak live
bytes, and live bytes at shutdown. Ordinary benchmark and production builds do
not contain the counting allocator. Bun has no equivalent counter in this
harness, so instrumented reports do not claim an allocation ratio.

## Alpha release comparison

The repeated eight-worker keep-alive release comparison is retained in
`results/2026-07-17-m5-max-alpha-release-summary.md`, with adjacent raw JSON and
rendered reports for `hono-basic`, `hono-actor`, and `hono-sqlite`. Each point is
the median of three five-second samples; startup uses five samples. Run the same
matrix with:

```bash
python3 benchmarks/scripts/run_static.py --workload hono-basic --keep-alive --workers 8
python3 benchmarks/scripts/run_static.py --workload hono-actor --keep-alive --workers 8
python3 benchmarks/scripts/run_static.py --workload hono-sqlite --keep-alive --workers 8
```

The summary reports actor and SQLite route-rate differences against the
same-run Hono control. They are route-level costs, not isolated operation
benchmarks, because the response and middleware work also differ.

For credible comparative runs, connect the Mac to power, disable Low Power Mode,
close unnecessary applications, and avoid indexing or builds while measuring.

The first fixed-worker connection-close matrix is retained as four raw reports
and `2026-07-15-m5-max-hono-jsx-ssr-workers-summary.md`. It found no throughput
gain from 2/4/8 workers on the closed JSX root, while warm RSS rose from 6.05 MiB
at one worker to 6.41 MiB at eight. This is the baseline that keep-alive and a
request-time workload must replace before scheduler conclusions.

The persistent-connection rerun is retained as four
`2026-07-15-m5-max-hono-jsx-ssr-keepalive-w*.{json,md}` reports plus a combined
summary. Throughput at concurrency 64 scales from 23.8k requests/s with one
worker to 102.8k with eight for 0.39 MiB more warm RSS. The summary also records
the remaining p99 problem caused by bounded blocking connection affinity.

The first request-time previews are retained as
`2026-07-15-m5-max-hono-{dynamic-jsx,stream-text}-keepalive-w8.{json,md}`. Both
use eight workers, persistent connections, three one-second samples, and Bun
response gates. Dynamic JSX reaches 0.72–0.79x Bun throughput at concurrency
8–64; finite streaming reaches 0.72–0.90x. TinyTSX stays near 6.1 MiB warm but
retains the measured high-concurrency p99 fairness problem. These are
exploratory route measurements, not general AOT/JIT claims.

The local-provider comparison is retained as
`2026-07-16-m5-max-hono-ai-provider-keepalive-w{1,8}.{json,md}`. One provider
worker saturates near 12.3k requests/s; eight reusable provider transports reach
43.4–46.1k requests/s at concurrency 8–64 and use 10.03 MiB warm RSS. The mock
provider performs no inference or token generation, so this isolates framework,
transport, copying, and JSON-decoding overhead rather than model performance.
