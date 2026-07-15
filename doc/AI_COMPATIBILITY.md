# AI SDK compatibility plan

The next package-level compatibility target after the worker/keep-alive and
request-time Hono slices is Vercel AI SDK Core. This is an AOT source-compatibility
probe, not permission to embed Node, Bun, or a JavaScript fallback runtime.

## Reconnaissance snapshot

Upstream tag `ai@7.0.28` is pinned as the `vendor/ai` git submodule at commit
`3649694271aba0a13d5f9b7090adf20c5a9c1fce`.

At that exact tag, `packages/ai/package.json` records:

- package version `7.0.28`, ESM, Apache-2.0;
- Node engine `>=22` for the published package toolchain/runtime contract;
- workspace dependencies `@ai-sdk/gateway`, `@ai-sdk/provider`, and
  `@ai-sdk/provider-utils`;
- peer dependency `zod` at `^3.25.76 || ^4.1.8`;
- public root, `internal`, and `test` exports.

Sources:

- <https://github.com/vercel/ai/tree/ai%407.0.28>
- <https://github.com/vercel/ai/blob/ai%407.0.28/packages/ai/package.json>
- <https://ai-sdk.dev/docs/getting-started/navigating-the-library>

The official environment guide describes AI SDK Core as usable across JavaScript
environments, unlike the framework-oriented UI layer. That makes Core the right
first probe. UI hooks, React Server Components, agents, MCP, and real provider
packages are outside the first slice.

## Intake evidence

The published package is installed reproducibly under `tests/compat/ai` with a
lockfile. It selects `ai@7.0.28`, `@ai-sdk/gateway@4.0.20`,
`@ai-sdk/provider@4.0.3`, `@ai-sdk/provider-utils@5.0.10`, and `zod@3.25.76`.
The package and Zod tarball integrities are pinned in the compatibility
manifest. Upstream declaration checking also needs the monorepo's exact
`@types/node@22.19.19` and `@types/json-schema@7.0.15` development types; this
is declaration/tooling evidence, not a decision to add Node to the native
runtime.

The root Core export graph, three workspace packages, selected Zod v3/v4
entries, event-source parser, workflow serde, and OIDC dependency audit to 609
modules, 2,065,807 source bytes, and 64,774 lines with zero unresolved runtime
imports. Notable counts include 821 async/await sites, 565 exception sites, 650
computed accesses, 945 rest/spread sites, 267 Promise references, 37 Map and 51
Set references, and 37 TransformStream references. Only six spreads are
currently closed at AOT time; 939 remain runtime.

The published package imports under Node, and an unchanged
`generateText`/`MockLanguageModelV4` test produces deterministic text with no
network or credentials. The scale difference from Hono confirms that
export/reachability pruning is required for every later AI slice.

## First native evidence

`tests/compat/ai/hono-generate-text-smoke.ts` is an unchanged-style consumer of
the upstream `generateText`, `MockLanguageModelV4`, and Hono APIs. The model is
constructed inside the `/ai` handler and returns the fixed text `Hello from
deterministic AI`. Bun executes the same source twice as the reference.

TinyTSX now type-checks the consumer against the published declarations while
evaluating the exact pinned runtime sources. The reachable path required
star-export resolution, imported runtime constants, dependency classes and
getters, destructuring/defaults, optional calls, Promise/array/object helpers,
switch and bounded `for`/`for...of`/`do...while` execution, and a minimal native
Zod-schema boundary. `rtk npm run test:ai-intake` asserts that the produced HIR
contains the exact `/ai` response. `rtk npm run build:ai-hono` compiles 662
TypeScript modules into a 1,051,560-byte arm64 executable with no JavaScript
engine and GC disabled. A real request returned HTTP 200, the expected content
type, and the exact 27-byte body.

The same build carries an executed memory report with 753 allocation sites:
752 compile-time and one static response, including 229 sites with observed
aliases. It reports one response escape, no request/worker/message/managed
sites, and `managedHeapRequired: false`. Native compile tests pin SDK internal
generated-ID sites to the compile-time/non-escaping classification.

This first target is deliberately deterministic and AOT-closed. The schema
adapter only supplies the Zod builder/valid-result subset exercised by this
known-valid prompt; it is not general Zod conformance. Likewise, `Math.random`
uses a compile-time witness for SDK-internal IDs now proven by the escape report
not to reach the response. Invalid schema behavior, tool calls, general
asynchronous streaming, and provider I/O remain separate promotion gates.

A second unchanged-style Hono target deliberately supplies both `prompt` and
`messages`. Bun and TinyTSX both route the upstream `InvalidPromptError` through
the installed Hono error handler as status 500 with the upstream message. This
proves thrown completion across dependency classes and star re-exports; it does
not replace the still-open invalid-Zod-schema gate.

## Pin and intake contract

When this milestone starts:

1. add the exact upstream revision under `vendor/ai` with its license and gitlink;
2. preserve aliases from `ai` and each reachable workspace package to upstream
   source rather than recreating their interfaces;
3. record the published package manifest and selected `zod` revision/integrity;
4. type-check the selected graph with upstream declarations;
5. emit an aggregate syntax, built-in, Web API, and escaping-allocation report;
6. keep parse/type intake, native execution, and upstream-test execution as
   separate evidence levels.

Do not claim `ai` support because `npm install ai` succeeds or because the root
module parses. The first claim requires an unchanged consumer program to execute
through upstream AI SDK Core code in the native binary.

## First executable slice

Use `generateText` with the pinned package's own test-model export or the
smallest interface-correct fake model derived from its upstream tests:

```ts
import { generateText } from 'ai'
import { deterministicModel } from './deterministic-model.ts'

const result = await generateText({
  model: deterministicModel,
  prompt: 'Say hello',
})

export default new Response(result.text)
```

The model returns a fixed response locally. The native behavior test requires no
API key, DNS, provider service, or network. Bun runs the same source as the byte
and error-semantics reference. This isolates AI SDK orchestration from provider
transport and makes failures reproducible.

The deterministic generation slice now passes. The finite streaming tracer also
passes with the pinned SDK's `streamText`, mock model, and
`toTextStreamResponse()` consumer. It executes the configured model stream,
accepts one completed text part plus finish event, preserves the two text deltas
as native HTTP chunks, and emits the SDK content type
`text/plain; charset=utf-8`. The specialization is deliberately limited to a
closed `{model, prompt}` call; it is not evidence for arbitrary asynchronous
tools, cancellation, or provider streams.

Continue in order:

1. multi-step/tool-call behavior with a deterministic fake model;
2. one OpenAI-compatible HTTP provider behind a local deterministic test server;
3. cancellation, bounded backpressure, and application-worker delivery;
4. external credentials and live providers as manual, non-conformance examples.

## Capability audit hypotheses

The exact pinned graph decides the implementation backlog. Before that audit,
the likely boundaries are hypotheses, not compatibility claims:

- Promise, exceptions, async/await, and async iterators;
- `ReadableStream`, `TransformStream`, cancellation, and backpressure;
- `AbortController`/`AbortSignal`, timers, and task scheduling;
- Fetch, Request, Response, Headers, URL, and URLSearchParams;
- TextEncoder/TextDecoder and incremental UTF-8 decoding;
- JSON parsing/serialization, dynamic Map/Set, RegExp, and richer arrays;
- crypto-quality IDs/randomness and possibly hashing;
- schema validation through the selected Zod graph;
- worker-lifetime closures, aliases, cycles, and other escaping objects.

Each implemented capability must promote one focused AI SDK behavior test plus
the relevant Test262/WPT/native API evidence where available.

## Workers and memory management

AI work must use the logical Worker contract in `doc/WORKERS.md`, not borrow an
HTTP executor and synchronously wait on the same pool. Model jobs use the
separate application pool; streamed chunks cross back as copied messages with
bounded backpressure.

The first fake-model audit must emit value-lifetime and escape classifications.
Static data, request arenas, message arenas, and isolated worker-owned state stay
preferred. If an exact executed SDK path requires a cyclic or aliased graph that
outlives one request/message, that evidence triggers the collector spike defined
in `doc/MEMORY_MANAGEMENT.md`. It does not trigger an ad hoc GC implementation
inside the AI adapter.

## Exit gates

AI SDK Core reaches a first-class experimental status only when:

- the revision and dependency graph are reproducibly pinned;
- the unchanged deterministic `generateText` consumer passes under Bun and
  TinyTSX with equivalent result behavior; error equivalence remains required
  before first-class experimental status;
- every reachable unsupported feature appears in an aggregate report;
- native tests cover cancellation/OOM/recovery for the enabled async path;
- RSS and latency are measured with and without the application worker pool;
- no embedded JS engine, dynamic code loading, or network-dependent conformance
  test is present.
