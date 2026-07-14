#!/usr/bin/env python3
from __future__ import annotations

import argparse
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
from reporting import render_markdown, summarize


ROOT = Path(__file__).resolve().parents[2]
WORKLOADS = {
    "static-page": {
        "body": b"<html><body><h1>Hello from TinyTSX</h1></body></html>",
        "content_type": "text/html; charset=utf-8",
        "scope": "53-byte static HTML; HTTP/1.1; connection close; localhost",
        "tiny_entry": "examples/static-page/server.tsx",
        "tiny_args": [],
        "bun_script": "benchmarks/bun/static-server.ts",
        "bun_args": [],
    },
    "hono-basic": {
        "body": b"Hono!!",
        "content_type": "text/plain;charset=UTF-8",
        "scope": "same pinned Hono GET / source; HTTP/1.1; connection close; localhost",
        "tiny_entry": "tests/compat/hono/basic-smoke.ts",
        "tiny_args": [
            "--alias", "hono=vendor/hono/src/index.ts",
            "--api", "hono=tests/compat/hono/api.d.ts",
        ],
        "bun_script": "benchmarks/bun/hono-server.ts",
        "bun_args": [
            "--tsconfig-override", "benchmarks/bun/hono-tsconfig.json",
        ],
    },
}


def main() -> int:
    arguments = parse_arguments()
    workload = WORKLOADS[arguments.workload]
    require_tools("bun", "oha", "cargo", "npm", "ps")
    if platform.system() != "Darwin" or platform.machine() != "arm64":
        raise RuntimeError("the current TinyTSX benchmark requires Apple Silicon macOS")

    port = free_port()
    tiny_binary = ROOT / f"benchmarks/dist/tinytsx-{arguments.workload}"
    build_tinytsx(tiny_binary, port, workload)
    bun_binary = Path(shutil.which("bun") or "bun").resolve()
    bun_script = ROOT / workload["bun_script"]
    specs = {
        "tinytsx": {
            "workload": arguments.workload,
            "command": [str(tiny_binary)],
            "environment": {},
            "artifact": tiny_binary,
            "runtime": tiny_binary,
        },
        "bun": {
            "workload": arguments.workload,
            "command": [str(bun_binary), "run", *workload["bun_args"], str(bun_script)],
            "environment": {"TINYTSX_BENCH_PORT": str(port)},
            "artifact": bun_script,
            "runtime": bun_binary,
        },
    }

    targets: dict[str, Any] = {}
    for name, spec in specs.items():
        startup = [measure_startup(spec, port) for _ in range(arguments.startup_runs)]
        targets[name] = {
            "artifactBytes": spec["artifact"].stat().st_size,
            "runtimeExecutableBytes": spec["runtime"].stat().st_size,
            "startupSamplesMs": startup,
            "idleRssSamplesBytes": [],
            "throughput": {str(value): [] for value in arguments.concurrency},
        }

    for run in range(arguments.runs):
        order = ["tinytsx", "bun"] if run % 2 == 0 else ["bun", "tinytsx"]
        for name in order:
            process = start_server(specs[name])
            try:
                correctness = wait_for_response(process, port)
                assert_correct(correctness, workload)
                run_oha(f"http://127.0.0.1:{port}/", max(arguments.concurrency), 1)
                targets[name]["idleRssSamplesBytes"].append(resident_bytes(process.pid))
                for concurrency in arguments.concurrency:
                    sample = run_oha(
                        f"http://127.0.0.1:{port}/",
                        concurrency,
                        arguments.duration,
                    )
                    targets[name]["throughput"][str(concurrency)].append(sample.as_json())
            finally:
                stop_server(process)

    timestamp = datetime.now(UTC).replace(microsecond=0).isoformat()
    raw = {
        "schemaVersion": 1,
        "timestamp": timestamp,
        "workload": arguments.workload,
        "scope": workload["scope"],
        "environment": environment_metadata(),
        "configuration": {
            "runs": arguments.runs,
            "startupRuns": arguments.startup_runs,
            "durationSeconds": arguments.duration,
            "concurrency": arguments.concurrency,
            "workers": 1,
            "requestMemoryBytes": 262_144,
            "keepAlive": False,
        },
        "correctness": {
            "status": 200,
            "contentType": workload["content_type"],
            "contentLength": len(workload["body"]),
            "bodyUtf8": workload["body"].decode(),
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
    return 0


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Benchmark TinyTSX workloads against Bun")
    parser.add_argument("--workload", choices=WORKLOADS, default="static-page")
    parser.add_argument("--duration", type=int, default=5, help="seconds per sample")
    parser.add_argument("--runs", type=int, default=3, help="samples per target/concurrency")
    parser.add_argument("--startup-runs", type=int, default=5)
    parser.add_argument("--concurrency", default="1,8,32,64")
    parser.add_argument("--output-prefix")
    arguments = parser.parse_args()
    arguments.concurrency = [int(value) for value in arguments.concurrency.split(",")]
    if arguments.duration < 1 or arguments.runs < 1 or arguments.startup_runs < 1:
        parser.error("duration and run counts must be positive")
    if not arguments.concurrency or min(arguments.concurrency) < 1:
        parser.error("concurrency values must be positive")
    return arguments


def require_tools(*names: str) -> None:
    missing = [name for name in names if shutil.which(name) is None]
    if missing:
        raise RuntimeError(f"missing benchmark tools: {', '.join(missing)}")


def build_tinytsx(output: Path, port: int, workload: dict[str, Any]) -> None:
    subprocess.run(["npm", "run", "build", "--prefix", "frontend"], cwd=ROOT, check=True)
    subprocess.run(
        [
            "cargo", "run", "-q", "-p", "tinytsx", "--", "build",
            workload["tiny_entry"], "--port", str(port), "--workers", "1",
            "--request-memory", "262144", "--runtime", "bootstrap", "--release",
            "--output", str(output), *workload["tiny_args"],
        ],
        cwd=ROOT,
        check=True,
    )


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


def measure_startup(spec: dict[str, Any], port: int) -> float:
    started = time.perf_counter_ns()
    process = start_server(spec)
    try:
        response = wait_for_response(process, port)
        assert_correct(response, WORKLOADS[spec["workload"]])
        return (time.perf_counter_ns() - started) / 1_000_000
    finally:
        stop_server(process)


def wait_for_response(process: subprocess.Popen[bytes], port: int) -> dict[str, Any]:
    deadline = time.monotonic() + 10
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        if process.poll() is not None:
            stderr = (process.stderr.read() if process.stderr else b"").decode(errors="replace")
            raise RuntimeError(f"server exited with {process.returncode}: {stderr}")
        try:
            connection = http.client.HTTPConnection("127.0.0.1", port, timeout=0.5)
            connection.request("GET", "/", headers={"Connection": "close"})
            response = connection.getresponse()
            body = response.read()
            headers = {name.lower(): value for name, value in response.getheaders()}
            connection.close()
            return {"status": response.status, "headers": headers, "body": body}
        except (ConnectionError, OSError) as error:
            last_error = error
            time.sleep(0.001)
    raise RuntimeError(f"server did not become ready: {last_error}")


def assert_correct(response: dict[str, Any], workload: dict[str, Any]) -> None:
    headers = response["headers"]
    expected = {
        "status": 200,
        "content-type": normalize_content_type(workload["content_type"]),
        "content-length": str(len(workload["body"])),
    }
    actual = {
        "status": response["status"],
        "content-type": normalize_content_type(headers.get("content-type")),
        "content-length": headers.get("content-length"),
    }
    if actual != expected or response["body"] != workload["body"]:
        raise RuntimeError(f"response mismatch: expected={expected}, actual={actual}")


def normalize_content_type(value: str | None) -> str | None:
    return value.lower().replace(" ", "") if value is not None else None


def stop_server(process: subprocess.Popen[bytes]) -> None:
    if process.poll() is None:
        process.terminate()
        try:
            process.wait(timeout=2)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=2)


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
