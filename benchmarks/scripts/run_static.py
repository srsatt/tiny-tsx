#!/usr/bin/env python3
from __future__ import annotations

import argparse
import atexit
import http.client
import json
import os
import platform
import shutil
import socket
import subprocess
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from oha_metrics import run_oha
from process_metrics import ProcessSampler
from reporting import render_markdown, summarize


ROOT = Path(__file__).resolve().parents[2]


def alias_arguments(flag: str, aliases: dict[str, str]) -> list[str]:
    return [value for alias, target in aliases.items() for value in (flag, f"{alias}={target}")]


AI_MANIFEST = json.loads((ROOT / "tests/compat/ai/manifest.json").read_text())
AI_TINY_ARGS = [
    *alias_arguments("--alias", {
        **AI_MANIFEST["runtimeAliases"],
        "hono": "vendor/hono/src/index.ts",
    }),
    *alias_arguments("--api", {
        "ai": "tests/compat/ai/node_modules/ai/dist/index.d.ts",
        "hono": "tests/compat/ai/node_modules/hono/dist/types/index.d.ts",
        "@ai-sdk/gateway": "tests/compat/ai/node_modules/@ai-sdk/gateway/dist/index.d.ts",
        "@ai-sdk/provider": "tests/compat/ai/node_modules/@ai-sdk/provider/dist/index.d.ts",
        "@ai-sdk/provider-utils": "tests/compat/ai/node_modules/@ai-sdk/provider-utils/dist/index.d.ts",
        "@ai-sdk/openai-compatible": "tests/compat/ai/node_modules/@ai-sdk/openai-compatible/dist/index.d.ts",
    }),
]

HONO_BASIC_TINY_ARGS = [
    "--alias", "hono=vendor/hono/src/index.ts",
    "--alias", "hono/basic-auth=vendor/hono/src/middleware/basic-auth/index.ts",
    "--alias", "hono/etag=vendor/hono/src/middleware/etag/index.ts",
    "--alias", "hono/powered-by=vendor/hono/src/middleware/powered-by/index.ts",
    "--alias", "hono/pretty-json=vendor/hono/src/middleware/pretty-json/index.ts",
    "--api", "hono=tests/compat/hono/api.d.ts",
    "--api", "hono/basic-auth=tests/compat/hono/basic-auth-api.d.ts",
    "--api", "hono/etag=tests/compat/hono/etag-api.d.ts",
    "--api", "hono/powered-by=tests/compat/hono/powered-by-api.d.ts",
    "--api", "hono/pretty-json=tests/compat/hono/pretty-json-api.d.ts",
]
HONO_BASIC_BUN_ARGS = [
    "--tsconfig-override", "benchmarks/bun/hono-tsconfig.json",
]


WORKLOADS = {
    "static-page": {
        "body": b"<html><body><h1>Hello from TinyTSX</h1></body></html>",
        "content_type": "text/html; charset=utf-8",
        "headers": {},
        "numeric_headers": [],
        "path": "/",
        "scope": "53-byte static HTML; HTTP/1.1; connection close; localhost",
        "limitation": "This workload does not exercise dynamic props, escaping, or application logic.",
        "tiny_entry": "examples/static-page/server.tsx",
        "tiny_args": [],
        "bun_script": "benchmarks/bun/static-server.ts",
        "bun_args": [],
    },
    "hono-basic": {
        "body": b"Hono!!",
        "content_type": "text/plain;charset=UTF-8",
        "headers": {"x-powered-by": "Hono"},
        "numeric_headers": ["x-response-time"],
        "target_content_types": {
            "tinytsx": "text/plain;charset=UTF-8",
            "bun": "application/octet-stream",
        },
        "response_differences": [
            "Bun 1.3.13 diverges from Fetch/WPT for a string BodyInit: it omits the required text/plain;charset=UTF-8 header, so its server adapter emits application/octet-stream after Hono clones the finalized body. TinyTSX preserves the Web-standard text type."
        ],
        "path": "/",
        "scope": "complete pinned 34-module Hono basic application, GET / with poweredBy and response-time middleware; HTTP/1.1; connection close; localhost",
        "limitation": "The measured root route has a six-byte closed body; it executes Hono routing and middleware but not request-dependent JSON or fetch work.",
        "tiny_entry": "vendor/hono-examples/basic/src/index.ts",
        "tiny_args": HONO_BASIC_TINY_ARGS,
        "bun_script": "benchmarks/bun/hono-server.ts",
        "bun_args": HONO_BASIC_BUN_ARGS,
    },
    "hono-json-compact": {
        "body": b"",
        "content_type": "application/json",
        "headers": {"x-powered-by": "Hono"},
        "numeric_headers": ["x-response-time"],
        "path": "/api/posts",
        "scope": "complete pinned 34-module Hono basic application, query-absent compact JSON branch serializing four closed records; HTTP/1.1; connection close; localhost",
        "limitation": "The route serializes one closed four-record array; it does not exercise dynamic collections, request JSON decoding, randomized branch traffic, replacers, or cycles.",
        "reference_target": "bun",
        "tiny_entry": "vendor/hono-examples/basic/src/index.ts",
        "tiny_args": HONO_BASIC_TINY_ARGS,
        "bun_script": "benchmarks/bun/hono-server.ts",
        "bun_args": HONO_BASIC_BUN_ARGS,
    },
    "hono-json-pretty": {
        "body": b"",
        "content_type": "application/json",
        "headers": {"x-powered-by": "Hono"},
        "numeric_headers": ["x-response-time"],
        "path": "/api/posts?pretty",
        "scope": "complete pinned 34-module Hono basic application, query-present prettyJSON branch serializing four closed records with two-space formatting; HTTP/1.1; connection close; localhost",
        "limitation": "The route measures query presence and pretty formatting for one closed array; it does not compare arbitrary query values, dynamic collections, request JSON decoding, or mixed branch traffic.",
        "reference_target": "bun",
        "tiny_entry": "vendor/hono-examples/basic/src/index.ts",
        "tiny_args": HONO_BASIC_TINY_ARGS,
        "bun_script": "benchmarks/bun/hono-server.ts",
        "bun_args": HONO_BASIC_BUN_ARGS,
    },
    "hono-jsx-ssr": {
        "body": b"",
        "content_type": "text/html; charset=UTF-8",
        "headers": {},
        "numeric_headers": [],
        "path": "/",
        "scope": "complete pinned 31-module Hono jsx-ssr application, GET / rendering five posts through typed JSX components; HTTP/1.1; connection close; localhost",
        "limitation": "The measured root route is fully closed and AOT-rendered; request-selected /post/:id behavior is correctness-tested but not part of this throughput sample.",
        "reference_target": "bun",
        "tiny_entry": "vendor/hono-examples/jsx-ssr/src/index.tsx",
        "tiny_args": [
            "--alias", "hono=vendor/hono/src/index.ts",
            "--alias", "hono/html=vendor/hono/src/helper/html/index.ts",
            "--api", "hono=tests/compat/hono/api.d.ts",
            "--api", "hono/html=tests/compat/hono/html-api.d.ts",
        ],
        "bun_script": "benchmarks/bun/hono-jsx-ssr-server.ts",
        "bun_args": [
            "--jsx-import-source", "hono/jsx",
            "--tsconfig-override", "benchmarks/bun/hono-jsx-ssr-tsconfig.json",
        ],
    },
    "hono-dynamic-jsx": {
        "body": b"",
        "content_type": "text/html; charset=UTF-8",
        "headers": {},
        "numeric_headers": [],
        "path": "/dynamic?name=TinyTSX+%26+Bun",
        "scope": "pinned Hono request-time JSX with one decoded query value rendered through nested component text and attribute escaping; HTTP/1.1; connection close; localhost",
        "limitation": "The route performs bounded query decoding and escaping but has a small fixed JSX shape and no dynamic collection traversal.",
        "reference_target": "bun",
        "tiny_entry": "tests/compat/hono/dynamic-jsx-smoke.tsx",
        "tiny_args": [
            "--alias", "hono=vendor/hono/src/index.ts",
            "--api", "hono=tests/compat/hono/api.d.ts",
        ],
        "bun_script": "benchmarks/bun/hono-dynamic-jsx-server.ts",
        "bun_args": [
            "--jsx-import-source", "hono/jsx",
            "--tsconfig-override", "benchmarks/bun/hono-runtime-tsconfig.json",
        ],
    },
    "hono-route-param": {
        "body": b'{"type":"TinyTSX Bench"}',
        "content_type": "application/json",
        "headers": {},
        "numeric_headers": [],
        "path": "/api/v1/animal/TinyTSX%20Bench",
        "scope": "pinned Hono optional route with one decoded trailing route parameter and bounded JSON response; HTTP/1.1; connection close; localhost",
        "limitation": "The measured path contains the optional parameter; the missing-parameter and overlong 404 branches are correctness-tested separately and are not mixed into this throughput point.",
        "tiny_entry": "tests/compat/hono/optional-param-smoke.ts",
        "tiny_args": [
            "--alias", "hono=vendor/hono/src/index.ts",
            "--api", "hono=tests/compat/hono/api.d.ts",
        ],
        "bun_script": "benchmarks/bun/hono-route-param-server.ts",
        "bun_args": [
            "--tsconfig-override", "benchmarks/bun/hono-runtime-tsconfig.json",
        ],
    },
    "hono-file-read": {
        "body": (ROOT / "vendor/hono-examples/serve-static/assets/my-file.txt").read_bytes(),
        "content_type": "text/plain; charset=UTF-8",
        "headers": {"x-powered-by": "Hono"},
        "numeric_headers": [],
        "path": "/my-file.txt",
        "scope": "one request-time read of the pinned 21-byte Hono serve-static asset through a bounded file API and Hono text response; HTTP/1.1; connection close; localhost",
        "limitation": "This measures repeated warm page-cache reads of one tiny immutable text file; it does not isolate filesystem syscalls, control the OS cache, or cover cold storage, large files, replacement, binary data, or writes.",
        "tiny_entry": "examples/hono-static/server.ts",
        "tiny_args": [
            "--allow-read", str(ROOT / "vendor/hono-examples/serve-static/assets"),
            "--alias", "hono=vendor/hono/src/index.ts",
            "--api", "hono=tests/compat/hono/api.d.ts",
            "--alias", "hono/powered-by=vendor/hono/src/middleware/powered-by/index.ts",
            "--api", "hono/powered-by=tests/compat/hono/powered-by-api.d.ts",
        ],
        "bun_script": "benchmarks/bun/hono-file-read-server.ts",
        "bun_args": [
            "--tsconfig-override", "benchmarks/bun/hono-tsconfig.json",
        ],
    },
    "hono-large-file": {
        "body": (ROOT / "vendor/hono/src/context.ts").read_bytes(),
        "content_type": "text/plain; charset=UTF-8",
        "headers": {"x-powered-by": "Hono"},
        "numeric_headers": [],
        "path": "/large-file",
        "scope": "one request-time read of the pinned 22,173-byte Hono context source through a 32 KiB-bounded file API and one Hono text response; HTTP/1.1; connection close; localhost",
        "limitation": "This measures repeated warm page-cache reads and one 22,173-byte response; it does not control the OS cache, isolate copies, or cover cold storage, responses above 32 KiB, streaming, binary data, ranges, or compression.",
        "tiny_entry": "benchmarks/tiny/hono-large-file.ts",
        "tiny_args": [
            "--allow-read", str(ROOT / "vendor/hono/src"),
            "--alias", "hono=vendor/hono/src/index.ts",
            "--api", "hono=tests/compat/hono/api.d.ts",
            "--alias", "hono/powered-by=vendor/hono/src/middleware/powered-by/index.ts",
            "--api", "hono/powered-by=tests/compat/hono/powered-by-api.d.ts",
        ],
        "bun_script": "benchmarks/bun/hono-large-file-server.ts",
        "bun_args": [
            "--tsconfig-override", "benchmarks/bun/hono-tsconfig.json",
        ],
    },
    "hono-stream-text": {
        "body": b"first\nsecond\nthird\n",
        "content_type": "text/plain; charset=UTF-8",
        "headers": {"x-content-type-options": "nosniff"},
        "numeric_headers": [],
        "framing": "chunked",
        "target_framings": {"tinytsx": "chunked", "bun": "content-length"},
        "response_differences": [
            "TinyTSX preserves the three HTTP/1.1 chunks on the wire; Bun 1.3.13 collects this immediately completed finite stream and emits Content-Length: 19."
        ],
        "path": "/stream",
        "scope": "pinned 33-module Hono streamText path with three finite flushed chunks; HTTP/1.1; connection close; localhost",
        "limitation": "The AOT stream has three closed chunks; it does not exercise request-dependent chunks, delays, cancellation, or provider backpressure.",
        "tiny_entry": "tests/compat/hono/stream-text-smoke.ts",
        "tiny_args": [
            "--alias", "hono=vendor/hono/src/index.ts",
            "--alias", "hono/streaming=vendor/hono/src/helper/streaming/index.ts",
            "--api", "hono=tests/compat/hono/api.d.ts",
            "--api", "hono/streaming=tests/compat/hono/streaming-api.d.ts",
        ],
        "bun_script": "benchmarks/bun/hono-stream-text-server.ts",
        "bun_args": [
            "--tsconfig-override", "benchmarks/bun/hono-runtime-tsconfig.json",
        ],
    },
    "hono-worker": {
        "body": b"TINYTSX & BUN",
        "content_type": "text/plain; charset=UTF-8",
        "headers": {},
        "numeric_headers": [],
        "path": "/worker?input=TinyTSX+%26+Bun",
        "scope": "one persistent logical string worker behind a pinned Hono request/reply route; copied messages; HTTP/1.1; localhost",
        "limitation": "Both targets serialize this route through one logical worker; this measures request/reply and ownership-transfer overhead, not parallelism across multiple Worker instances.",
        "tiny_entry": "tests/compat/workers/hono-worker-smoke.ts",
        "tiny_args": [
            "--alias", "hono=vendor/hono/src/index.ts",
            "--api", "hono=tests/compat/hono/api.d.ts",
        ],
        "bun_script": "benchmarks/bun/hono-worker-server.ts",
        "bun_args": [
            "--tsconfig-override", "benchmarks/bun/hono-runtime-tsconfig.json",
        ],
    },
    "hono-actor": {
        "body": b"0",
        "content_type": "text/plain; charset=UTF-8",
        "headers": {},
        "numeric_headers": [],
        "path": "/",
        "scope": "one persistent signed counter actor behind a pinned Hono ask/reply route; zero-delta reads through bounded copied messages; HTTP/1.1; localhost",
        "limitation": "TinyTSX uses its local actor mailbox while Bun uses one Worker-owned counter; the zero-delta route measures ownership/message overhead without persistence, mutation contention, supervision, or distributed actors.",
        "tiny_entry": "examples/hono-actors/server.ts",
        "tiny_args": [
            "--alias", "hono=vendor/hono/src/index.ts",
            "--api", "hono=tests/compat/hono/api.d.ts",
        ],
        "bun_script": "benchmarks/bun/hono-actor-server.ts",
        "bun_args": [
            "--tsconfig-override", "benchmarks/bun/hono-runtime-tsconfig.json",
        ],
    },
    "hono-sqlite": {
        "body": b'{"values":[]}',
        "content_type": "application/json",
        "headers": {},
        "numeric_headers": [],
        "path": "/sqlite",
        "scope": "one in-memory SQLite owner behind a pinned Hono route; CREATE TABLE IF NOT EXISTS plus one empty prepared SELECT and JSON envelope per request; HTTP/1.1; localhost",
        "limitation": "TinyTSX serializes SQLite through its bounded application mailbox while Bun executes synchronous bun:sqlite on the server thread; this does not measure disk I/O, writes, contention, or result copying beyond an empty row set.",
        "tiny_entry": "benchmarks/tiny/hono-sqlite.ts",
        "tiny_args": [
            "--alias", "hono=vendor/hono/src/index.ts",
            "--api", "hono=tests/compat/hono/api.d.ts",
        ],
        "bun_script": "benchmarks/bun/hono-sqlite-server.ts",
        "bun_args": [
            "--tsconfig-override", "benchmarks/bun/hono-runtime-tsconfig.json",
        ],
    },
    "hono-ai-provider": {
        "body": b"Hello from local provider",
        "content_type": "text/plain; charset=UTF-8",
        "headers": {},
        "numeric_headers": [],
        "path": "/ai-local",
        "scope": "pinned 656-module Hono plus AI SDK generateText path, one real OpenAI-compatible POST through a shared zero-delay loopback provider; HTTP/1.1; localhost",
        "limitation": "The mock provider has no model latency or token generation; this isolates framework, transport, message-copy, and JSON-decoding overhead and is not an inference benchmark.",
        "tiny_entry": "tests/compat/ai/hono-local-provider-smoke.ts",
        "tiny_args": AI_TINY_ARGS,
        "tiny_setup": ["npm", "ci", "--prefix", "tests/compat/ai"],
        "bun_script": "benchmarks/bun/hono-ai-provider-server.ts",
        "bun_args": [],
        "support_script": "benchmarks/bun/openai-compatible-provider.ts",
        "support_port": 39453,
        "support_path": "/health",
    },
}


def main() -> int:
    arguments = parse_arguments()
    workload = WORKLOADS[arguments.workload]
    require_tools("bun", "oha", "cargo", "npm", "ps")
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise RuntimeError("the current TinyTSX benchmark requires Apple Silicon macOS")

    port = free_port()
    tiny_suffix = "" if arguments.workers == 1 else f"-w{arguments.workers}"
    tiny_binary = ROOT / f"benchmarks/dist/tinytsx-{arguments.workload}{tiny_suffix}"
    build_tinytsx(
        tiny_binary,
        port,
        workload,
        arguments.workers,
        arguments.allocation_metrics,
    )
    bun_binary = Path(shutil.which("bun") or "bun").resolve()
    bun_script = ROOT / workload["bun_script"]
    specs = {
        "tinytsx": {
            "workload": arguments.workload,
            "name": "tinytsx",
            "command": [str(tiny_binary)],
            "environment": (
                {"TINYTSX_INTERNAL_ALLOC_METRICS": "1"}
                if arguments.allocation_metrics
                else {}
            ),
            "artifact": tiny_binary,
            "runtime": tiny_binary,
            "path": workload["path"],
        },
        "bun": {
            "workload": arguments.workload,
            "name": "bun",
            "command": [str(bun_binary), "run", *workload["bun_args"], str(bun_script)],
            "environment": {"TINYTSX_BENCH_PORT": str(port)},
            "artifact": bun_script,
            "runtime": bun_binary,
            "path": workload["path"],
        },
    }
    support_process = start_support_server(workload, bun_binary)
    if support_process is not None:
        atexit.register(stop_server, support_process)
    targets: dict[str, Any] = {
        name: {
            "artifactBytes": spec["artifact"].stat().st_size,
            "runtimeExecutableBytes": spec["runtime"].stat().st_size,
            "startupSamplesMs": [],
            "idleRssSamplesBytes": [],
            "postWarmupRssSamplesBytes": [],
            "resourceSamples": [],
            "allocationSamples": [],
            "throughput": {str(value): [] for value in arguments.concurrency},
        }
        for name, spec in specs.items()
    }
    if reference_target := workload.get("reference_target"):
        workload = dict(workload)
        reference_body, reference_startup_ms = capture_reference_body(
            specs[str(reference_target)],
            port,
            workload,
        )
        workload["body"] = reference_body
        targets[str(reference_target)]["startupSamplesMs"].append(reference_startup_ms)
    for run in range(arguments.startup_runs):
        order = ["tinytsx", "bun"] if run % 2 == 0 else ["bun", "tinytsx"]
        for name in order:
            if len(targets[name]["startupSamplesMs"]) >= arguments.startup_runs:
                continue
            targets[name]["startupSamplesMs"].append(
                measure_startup(specs[name], port, workload)
            )

    for run in range(arguments.runs):
        order = ["tinytsx", "bun"] if run % 2 == 0 else ["bun", "tinytsx"]
        for name in order:
            process = start_server(specs[name])
            sampler = None
            try:
                correctness = wait_for_response(process, port, specs[name]["path"])
                assert_correct(correctness, workload, name)
                targets[name]["idleRssSamplesBytes"].append(resident_bytes(process.pid))
                sampler = ProcessSampler(process.pid)
                url = f"http://127.0.0.1:{port}{specs[name]['path']}"
                run_oha(url, max(arguments.concurrency), 1, arguments.keep_alive)
                targets[name]["postWarmupRssSamplesBytes"].append(
                    resident_bytes(process.pid)
                )
                concurrency_order = (
                    arguments.concurrency
                    if run % 2 == 0
                    else list(reversed(arguments.concurrency))
                )
                for concurrency in concurrency_order:
                    sample = run_oha(
                        url,
                        concurrency,
                        arguments.duration,
                        arguments.keep_alive,
                    )
                    targets[name]["throughput"][str(concurrency)].append(sample.as_json())
            finally:
                if sampler is not None:
                    targets[name]["resourceSamples"].append(sampler.stop())
                stderr = stop_server(process)
                if (
                    name == "tinytsx"
                    and sampler is not None
                    and arguments.allocation_metrics
                ):
                    targets[name]["allocationSamples"].append(
                        parse_allocation_metrics(stderr)
                    )

    timestamp = datetime.now(UTC).replace(microsecond=0).isoformat()
    raw = {
        "schemaVersion": 2,
        "timestamp": timestamp,
        "workload": arguments.workload,
        "scope": benchmark_scope(workload, arguments.keep_alive),
        "limitations": benchmark_limitations(workload, arguments.keep_alive),
        "responseDifferences": workload.get("response_differences", []),
        "environment": environment_metadata(),
        "configuration": {
            "runs": arguments.runs,
            "startupRuns": arguments.startup_runs,
            "durationSeconds": arguments.duration,
            "concurrency": arguments.concurrency,
            "workers": arguments.workers,
            "requestMemoryBytes": 262_144,
            "keepAlive": arguments.keep_alive,
            "supportProcess": support_process is not None,
            "processSampleIntervalMs": 20,
            "allocationInstrumentation": (
                "TinyTSX global allocator only"
                if arguments.allocation_metrics
                else "disabled"
            ),
        },
        "correctness": {
            "path": workload["path"],
            "status": 200,
            "contentTypes": {
                name: expected_content_type(workload, name)
                for name in specs
            },
            "contentLength": len(workload["body"]),
            "framings": {
                name: expected_framing(workload, name)
                for name in specs
            },
            "bodyUtf8": workload["body"].decode(),
            "headers": workload["headers"],
            "numericHeaders": workload["numeric_headers"],
        },
        "targets": targets,
    }
    result = summarize(raw)
    prefix = output_prefix(arguments.output_prefix, arguments.workload)
    prefix.parent.mkdir(parents=True, exist_ok=True)
    prefix.with_suffix(".json").write_text(json.dumps(result, indent=2) + "\n")
    markdown = render_markdown(result)
    prefix.with_suffix(".md").write_text(markdown)
    print(markdown)
    print(f"JSON: {prefix.with_suffix('.json')}")
    print(f"Markdown: {prefix.with_suffix('.md')}")
    if support_process is not None:
        stop_server(support_process)
        atexit.unregister(stop_server)
    return 0


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark TinyTSX workloads against Bun")
    parser.add_argument("--workload", choices=WORKLOADS, default="static-page")
    parser.add_argument("--duration", type=int, default=5, help="seconds per sample")
    parser.add_argument("--runs", type=int, default=3, help="samples per target/concurrency")
    parser.add_argument("--startup-runs", type=int, default=5)
    parser.add_argument("--concurrency", default="1,8,32,64")
    parser.add_argument("--workers", type=int, default=1, help="TinyTSX native workers")
    parser.add_argument(
        "--keep-alive",
        action="store_true",
        help="reuse HTTP/1.1 connections for both targets",
    )
    parser.add_argument(
        "--allocation-metrics",
        action="store_true",
        help="build TinyTSX with allocator counters (adds measurement overhead)",
    )
    parser.add_argument("--output-prefix")
    arguments = parser.parse_args()
    arguments.concurrency = [int(value) for value in arguments.concurrency.split(",")]
    if (
        arguments.duration < 1
        or arguments.runs < 1
        or arguments.startup_runs < 1
        or arguments.workers < 1
    ):
        parser.error("duration, run counts, and workers must be positive")
    if not arguments.concurrency or min(arguments.concurrency) < 1:
        parser.error("concurrency values must be positive")
    return arguments


def require_tools(*names: str) -> None:
    missing = [name for name in names if shutil.which(name) is None]
    if missing:
        raise RuntimeError(f"missing benchmark tools: {', '.join(missing)}")


def build_tinytsx(
    output: Path,
    port: int,
    workload: dict[str, Any],
    workers: int = 1,
    allocation_metrics: bool = False,
) -> None:
    if setup := workload.get("tiny_setup"):
        subprocess.run(setup, cwd=ROOT, check=True)
    subprocess.run(["npm", "run", "build", "--prefix", "frontend"], cwd=ROOT, check=True)
    environment = os.environ.copy()
    if allocation_metrics:
        environment["TINYTSX_INTERNAL_ALLOC_METRICS"] = "1"
    else:
        environment.pop("TINYTSX_INTERNAL_ALLOC_METRICS", None)
    subprocess.run(
        tinytsx_build_command(output, port, workload, workers),
        cwd=ROOT,
        env=environment,
        check=True,
    )


def tinytsx_build_command(
    output: Path,
    port: int,
    workload: dict[str, Any],
    workers: int,
) -> list[str]:
    return [
        "cargo", "run", "-q", "-p", "tinytsx", "--", "build",
        workload["tiny_entry"], "--port", str(port), "--workers", str(workers),
        "--request-memory", "262144", "--runtime", "bootstrap", "--release",
        "--output", str(output), *workload["tiny_args"],
    ]


def start_server(spec: dict[str, Any]) -> subprocess.Popen[bytes]:
    environment = os.environ.copy()
    environment.update(spec["environment"])
    return subprocess.Popen(
        spec["command"],
        cwd=ROOT,
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE,
    )


def start_support_server(
    workload: dict[str, Any],
    bun_binary: Path,
) -> subprocess.Popen[bytes] | None:
    script = workload.get("support_script")
    if script is None:
        return None
    port = int(workload["support_port"])
    process = start_server({
        "command": [str(bun_binary), "run", str(ROOT / script)],
        "environment": {"TINYTSX_PROVIDER_PORT": str(port)},
    })
    response = wait_for_response(process, port, str(workload["support_path"]))
    if response["status"] != 200 or response["body"] != b"ok":
        stop_server(process)
        raise RuntimeError(f"support server health check failed: {response}")
    return process


def measure_startup(
    spec: dict[str, Any],
    port: int,
    workload: dict[str, Any],
) -> float:
    started = time.perf_counter_ns()
    process = start_server(spec)
    try:
        response = wait_for_response(process, port, spec["path"])
        assert_correct(response, workload, spec["name"])
        return (time.perf_counter_ns() - started) / 1_000_000
    finally:
        stop_server(process)


def capture_reference_body(
    spec: dict[str, Any],
    port: int,
    workload: dict[str, Any],
) -> tuple[bytes, float]:
    started = time.perf_counter_ns()
    process = start_server(spec)
    try:
        response = wait_for_response(process, port, spec["path"])
        actual_type = normalize_content_type(response["headers"].get("content-type"))
        expected_type = normalize_content_type(expected_content_type(workload, spec["name"]))
        if response["status"] != 200 or actual_type != expected_type:
            raise RuntimeError(
                "reference response mismatch: "
                f"status={response['status']}, content-type={actual_type}"
            )
        startup_ms = (time.perf_counter_ns() - started) / 1_000_000
        return bytes(response["body"]), startup_ms
    finally:
        stop_server(process)


def wait_for_response(
    process: subprocess.Popen[bytes],
    port: int,
    path: str = "/",
) -> dict[str, Any]:
    deadline = time.monotonic() + 10
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        if process.poll() is not None:
            stderr = (process.stderr.read() if process.stderr else b"").decode(errors="replace")
            raise RuntimeError(f"server exited with {process.returncode}: {stderr}")
        try:
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=0.5)
            connection.request("GET", path, headers={"Connection": "close"})
            response = connection.getresponse()
            body = response.read()
            headers = {name.lower(): value for name, value in response.getheaders()}
            connection.close()
            return {"status": response.status, "headers": headers, "body": body}
        except (ConnectionError, OSError) as error:
            last_error = error
            time.sleep(0.001)
    raise RuntimeError(f"server did not become ready: {last_error}")


def assert_correct(
    response: dict[str, Any],
    workload: dict[str, Any],
    target: str | None = None,
) -> None:
    headers = response["headers"]
    expected = {
        "status": 200,
        "content-type": normalize_content_type(expected_content_type(workload, target)),
        "framing": expected_framing(workload, target),
    }
    actual = {
        "status": response["status"],
        "content-type": normalize_content_type(headers.get("content-type")),
        "framing": actual_framing(headers),
    }
    if actual != expected or response["body"] != workload["body"]:
        raise RuntimeError(f"response mismatch: expected={expected}, actual={actual}")
    expected_headers = workload.get("headers", {})
    mismatched_headers = {
        name: {"expected": value, "actual": headers.get(name)}
        for name, value in expected_headers.items()
        if headers.get(name) != value
    }
    if mismatched_headers:
        raise RuntimeError(f"response header mismatch: {mismatched_headers}")
    invalid_numeric_headers = {
        name: headers.get(name)
        for name in workload.get("numeric_headers", [])
        if not is_millisecond_header(headers.get(name))
    }
    if invalid_numeric_headers:
        raise RuntimeError(
            f"response numeric header mismatch: {invalid_numeric_headers}"
        )


def is_millisecond_header(value: str | None) -> bool:
    return value is not None and value.endswith("ms") and value[:-2].isdigit()


def normalize_content_type(value: str | None) -> str | None:
    return value.lower().replace(" ", "") if value is not None else None


def expected_content_type(workload: dict[str, Any], target: str | None) -> str:
    if target is not None:
        target_types = workload.get("target_content_types", {})
        if target in target_types:
            return str(target_types[target])
    return str(workload["content_type"])


def expected_framing(workload: dict[str, Any], target: str | None = None) -> str:
    target_framings = workload.get("target_framings", {})
    framing = target_framings.get(target, workload.get("framing", "content-length"))
    return "chunked" if framing == "chunked" else str(len(workload["body"]))


def actual_framing(headers: dict[str, str]) -> str | None:
    if headers.get("transfer-encoding", "").lower() == "chunked":
        return "chunked"
    return headers.get("content-length")


def benchmark_scope(workload: dict[str, Any], keep_alive: bool) -> str:
    scope = str(workload["scope"])
    if keep_alive:
        return scope.replace("connection close", "keep-alive")
    return scope


def benchmark_limitations(
    workload: dict[str, Any],
    keep_alive: bool,
) -> list[str]:
    limitations = [str(workload["limitation"])]
    if keep_alive:
        limitations.append(
            "TinyTSX bounds each connection at 100 requests and reconnects; the Bun host may retain a connection longer."
        )
    return limitations


def stop_server(process: subprocess.Popen[bytes]) -> bytes:
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=2)
    return process.stderr.read() if process.stderr is not None else b""


def parse_allocation_metrics(stderr: bytes) -> dict[str, int]:
    prefix = b"TINYTSX_ALLOC_METRICS "
    for line in reversed(stderr.splitlines()):
        if line.startswith(prefix):
            value = json.loads(line[len(prefix):])
            if not isinstance(value, dict) or not all(
                isinstance(item, int) and item >= 0 for item in value.values()
            ):
                break
            return value
    raise RuntimeError("TinyTSX server did not emit valid allocation metrics")


def resident_bytes(pid: int) -> int:
    completed = subprocess.run(
        ["ps", "-o", "rss=", "-p", str(pid)],
        check=True,
        capture_output=True,
        text=True,
    )
    return int(completed.stdout.strip()) * 1024


def free_port() -> int:
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


def environment_metadata() -> dict[str, Any]:
    return {
        "machine": machine_description(),
        "os": f"macOS {platform.mac_ver()[0]}",
        "architecture": platform.machine(),
        "rustVersion": command_output("rustc", "--version"),
        "bunVersion": command_output("bun", "--version"),
        "ohaVersion": command_output("oha", "--version"),
        "commit": command_output("git", "rev-parse", "--short", "HEAD"),
        "dirty": bool(command_output("git", "status", "--porcelain", "--untracked-files=no")),
        "powerAndBackgroundState": "not controlled",
    }


def machine_description() -> str:
    output = command_output("system_profiler", "SPHardwareDataType")
    wanted = ("Model Name:", "Model Identifier:", "Chip:", "Total Number of Cores:", "Memory:")
    values = [line.strip() for line in output.splitlines() if line.strip().startswith(wanted)]
    return "; ".join(values)


def command_output(*command: str) -> str:
    return subprocess.run(command, check=True, capture_output=True, text=True).stdout.strip()


def output_prefix(value: str | None, workload: str = "static-page") -> Path:
    if value:
        path = Path(value)
        return path if path.is_absolute() else ROOT / path
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return ROOT / f"benchmarks/results/{stamp}-{workload}"


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, subprocess.CalledProcessError) as error:
        print(f"benchmark failed: {error}", file=sys.stderr)
        raise SystemExit(1)
