# TinyTSX idle actor scale

> Scope: release-mode in-process logical actors with lazy empty mailboxes; no HTTP or actor messages

Platform: `Darwin 25.5.0 arm64`  
Executors: `2`  
Runs per actor count: `5`  
Logical handle size: `16 bytes`

| Actors | Median RSS | Incremental bytes/actor | OS threads | Median spawn |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 1.75 MiB | baseline | 4 | 0.03 ms |
| 1,000 | 1.91 MiB | 163.84 | 4 | 0.07 ms |
| 10,000 | 3.03 MiB | 134.35 | 4 | 0.31 ms |

Limitations:

- RSS includes the Rust process, allocator, worker pool, and measurement granularity.
- Incremental bytes per actor subtract the zero-actor median from the same run configuration.
- This does not measure hot-mailbox fairness, message payloads, persistence, or supervision.
