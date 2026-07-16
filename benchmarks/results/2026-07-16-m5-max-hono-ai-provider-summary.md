# Local AI provider worker scaling summary

The pinned 656-module Hono + AI SDK Core + OpenAI-compatible consumer was run
against one shared zero-delay loopback provider. Each point is the median of
three two-second samples; startup uses seven samples. The support provider is
excluded from target RSS.

| Workers | Startup | Warm RSS | RPS c1 | RPS c8 | RPS c32 | RPS c64 | p99 c64 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| TinyTSX 1 | 12.64 ms | 8.34 MiB | 12,077 | 12,241 | 12,274 | 12,259 | 254.80 ms |
| TinyTSX 8 | 14.08 ms | 10.03 MiB | 12,171 | 43,445 | 45,460 | 46,075 | 62.54 ms |
| Bun paired with w8 | 48.57 ms | 251.80 MiB | 7,969 | 18,314 | 16,683 | 16,082 | 7.93 ms |

Eight provider executors deliver 3.76x the one-worker throughput at concurrency
64 for 1.69 MiB additional warm RSS. They reach 2.37–2.87x the paired Bun
throughput at concurrency 8–64, but p99 is still materially worse because HTTP
connections retain bounded worker affinity.

This is not an inference benchmark. The provider immediately returns a fixed
response, so the result isolates framework orchestration, native transport,
message ownership, JSON decoding, and worker-pool scaling. Real model latency
would dominate these microsecond-scale differences.
