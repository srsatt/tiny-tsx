# AI SDK compatibility plan

The next package-level compatibility target after the worker/keep-alive and
request-time Hono slices is Vercel AI SDK Core. This is an AOT source-compatibility
probe, not permission to embed Node, Bun, or a JavaScript fallback runtime.

## Reconnaissance snapshot

On 2026-07-15, upstream tag `ai@7.0.28` resolves to commit
`3649694271aba0a13d5f9b7090adf20c5a9c1fce`. This is the candidate pin, not yet
a repository submodule.

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

Only after this passes should TinyTSX attempt, in order:

1. multi-step/tool-call behavior with a deterministic fake model;
2. `streamText` and async-iterable chunk delivery;
3. a Hono route returning the SDK's Web `Response` stream;
4. one OpenAI-compatible HTTP provider behind a local deterministic test server;
5. external credentials and live providers as manual, non-conformance examples.

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
  TinyTSX with equivalent result/error behavior;
- every reachable unsupported feature appears in an aggregate report;
- native tests cover cancellation/OOM/recovery for the enabled async path;
- RSS and latency are measured with and without the application worker pool;
- no embedded JS engine, dynamic code loading, or network-dependent conformance
  test is present.

