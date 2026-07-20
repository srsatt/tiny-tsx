# TinyTSX 0.1.0-beta.1

Beta is a backend-platform proof, not a general JavaScript compatibility claim.
It is gated by a separate Hono/Vite air-quality service that reads the live
SCD41 collector database through a deploy-time read-only binding.

## Required product slices

1. `tinytsx dev` provides cached AOT compilation and last-known-good hot
   restart after source edits.
2. `tinytsx:sqlite` opens an explicitly bound database read-only at deployment.
   This slice is implemented and covered by host HTTP plus Linux ARM64 assembly.
3. `tinytsx:assets` embeds and serves a bounded Vite output directory. This
   slice is implemented with native HTTP and Linux ARM64 assembly evidence.
4. The pinned Hono source supports the query parsing and prepared parameters
   required by the air-quality history API without project-local overlays.
   Static-name text queries with closed fallbacks and bounded `Number(...)`
   integer queries are implemented.
5. Four native compiler archives and the ARM64 Raspberry Pi application pass
   their functional, startup, RSS, throughput, and tail-latency gates.

## Development contract

Development and production execute the same generated native application ABI.
Dev mode only changes orchestration: it retains compiler caches, builds a new
executable beside the running generation, and restarts after success. Compiler
errors leave the current generation running. External persistence survives;
in-memory state restarts. Successful reloads expose stage timings on stdout so
the simple and pinned-Hono release workloads can enforce the beta latency gate.

## Explicit non-goals

Beta does not add in-process native patching, dynamic libraries, a stable
development proxy, state migration, general ECMAScript, a managed heap, I2C,
JWT/JWK, WebSockets, or arbitrary npm execution. Vite owns browser HMR in the
proof application; TinyTSX owns backend recompilation and restart.
