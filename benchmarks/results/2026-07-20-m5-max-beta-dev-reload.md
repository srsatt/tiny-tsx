# TinyTSX dev reload benchmark

- Measured: 2026-07-20T13:05:25.938Z
- Source: `d7fe6a5b21babbaf90522e04250bb26cf59e2bf6` (clean)
- Host: Apple M5 Max; darwin/arm64
- Compiler: `tinytsx 0.1.0-beta.1; hir=2; runtime-abi=1; target=aarch64-apple-darwin; builtins-schema=1; hono=v4.12.30@b2ae3a2204a48ce15a26448fd746d39745eb1837; hono-examples=3b0b6287; test262=f2d14356`
- Retained reloads: 7 per scenario

| Scenario | Metric | Median | p95 | Min | Max |
| --- | --- | ---: | ---: | ---: | ---: |
| simple-transitive-module | frontendMs | 81 ms | 94 ms | 79 ms | 94 ms |
| simple-transitive-module | codegenMs | 0 ms | 0 ms | 0 ms | 0 ms |
| simple-transitive-module | assemblyMs | 47 ms | 50 ms | 40 ms | 50 ms |
| simple-transitive-module | linkMs | 459 ms | 468 ms | 456 ms | 468 ms |
| simple-transitive-module | shutdownMs | 108 ms | 112 ms | 105 ms | 112 ms |
| simple-transitive-module | startupMs | 304 ms | 690 ms | 284 ms | 690 ms |
| simple-transitive-module | totalMs | 998 ms | 1401 ms | 987 ms | 1401 ms |
| simple-transitive-module | observedMs | 1090.863 ms | 1500.562 ms | 1063.301 ms | 1500.562 ms |
| pinned-hono-basic | frontendMs | 404 ms | 475 ms | 363 ms | 475 ms |
| pinned-hono-basic | codegenMs | 0 ms | 0 ms | 0 ms | 0 ms |
| pinned-hono-basic | assemblyMs | 51 ms | 63 ms | 43 ms | 63 ms |
| pinned-hono-basic | linkMs | 478 ms | 641 ms | 458 ms | 641 ms |
| pinned-hono-basic | shutdownMs | 107 ms | 111 ms | 103 ms | 111 ms |
| pinned-hono-basic | startupMs | 284 ms | 410 ms | 278 ms | 410 ms |
| pinned-hono-basic | totalMs | 1326 ms | 1568 ms | 1274 ms | 1568 ms |
| pinned-hono-basic | observedMs | 1397.169 ms | 1659.045 ms | 1346.786 ms | 1659.045 ms |

