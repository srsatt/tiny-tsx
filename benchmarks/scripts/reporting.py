from __future__ import annotations

import statistics
from typing import Any


METRICS = (
    "requests_per_second",
    "p50_ms",
    "p95_ms",
    "p99_ms",
    "max_ms",
)


def median_metrics(samples: list[dict[str, Any]]) -> dict[str, float]:
    return {
        metric: statistics.median(float(sample[metric]) for sample in samples)
        for metric in METRICS
    }


def summarize(raw: dict[str, Any]) -> dict[str, Any]:
    targets: dict[str, Any] = {}
    for name, target in raw["targets"].items():
        throughput = {
            concurrency: {
                "samples": samples,
                "median": median_metrics(samples),
            }
            for concurrency, samples in target["throughput"].items()
        }
        targets[name] = {
            **target,
            "startupMedianMs": statistics.median(target["startupSamplesMs"]),
            "idleRssMedianBytes": int(statistics.median(target["idleRssSamplesBytes"])),
            "throughput": throughput,
        }

    comparisons = {}
    for concurrency in raw["configuration"]["concurrency"]:
        key = str(concurrency)
        tiny = targets["tinytsx"]["throughput"][key]["median"]
        bun = targets["bun"]["throughput"][key]["median"]
        comparisons[key] = {
            "tinytsxToBunRps": tiny["requests_per_second"]
            / bun["requests_per_second"],
            "tinytsxToBunP99": tiny["p99_ms"] / bun["p99_ms"],
        }

    return {**raw, "targets": targets, "comparisons": comparisons}


def render_markdown(result: dict[str, Any]) -> str:
    tiny = result["targets"]["tinytsx"]
    bun = result["targets"]["bun"]
    title = result["workload"].replace("-", " ")
    lines = [
        f"# TinyTSX {title} benchmark",
        "",
        f"Generated: {result['timestamp']}",
        "",
        f"> Scope: {result['scope']}. A new TCP connection per request; one server process. "
        "This is not a general dynamic-language benchmark.",
        "",
        "## Environment",
        "",
        f"- Machine: {result['environment']['machine']}",
        f"- OS: {result['environment']['os']}",
        f"- TinyTSX commit: `{result['environment']['commit']}`",
        f"- Bun: {result['environment']['bunVersion']}",
        f"- oha: {result['environment']['ohaVersion']}",
        f"- Runs per point: {result['configuration']['runs']}",
        f"- Duration per run: {result['configuration']['durationSeconds']} seconds",
        "",
        "## Footprint and startup",
        "",
        "| Target | Startup-to-first-response median | Idle RSS median | App artifact | Runtime executable |",
        "| --- | ---: | ---: | ---: | ---: |",
        _footprint_row("TinyTSX", tiny),
        _footprint_row("Bun", bun),
        "",
        "Bun's application script and runtime executable are reported separately; the "
        "runtime is required in deployment but may be shared by multiple applications.",
        "",
        "## Throughput and latency",
        "",
        "| Concurrency | TinyTSX req/s | Bun req/s | Tiny/Bun | Tiny p50 | Bun p50 | Tiny p99 | Bun p99 |",
        "| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for concurrency in result["configuration"]["concurrency"]:
        key = str(concurrency)
        tiny_metrics = tiny["throughput"][key]["median"]
        bun_metrics = bun["throughput"][key]["median"]
        ratio = result["comparisons"][key]["tinytsxToBunRps"]
        lines.append(
            f"| {concurrency} | {tiny_metrics['requests_per_second']:,.0f} | "
            f"{bun_metrics['requests_per_second']:,.0f} | {ratio:.2f}x | "
            f"{tiny_metrics['p50_ms']:.3f} ms | {bun_metrics['p50_ms']:.3f} ms | "
            f"{tiny_metrics['p99_ms']:.3f} ms | {bun_metrics['p99_ms']:.3f} ms |"
        )
    lines.extend(
        [
            "",
            "Medians are computed across all recorded runs; no samples are discarded. "
            "Raw samples are retained in the adjacent JSON report.",
            "",
            "## Limitations",
            "",
            "- TinyTSX currently has one worker and always closes the connection.",
            "- The benchmark client and server share the same machine.",
            "- This workload covers one closed response and does not exercise dynamic application logic.",
            "- Power mode and unrelated background activity are not controlled by the harness.",
            "",
        ]
    )
    return "\n".join(lines)


def _footprint_row(label: str, target: dict[str, Any]) -> str:
    return (
        f"| {label} | {target['startupMedianMs']:.2f} ms | "
        f"{_mib(target['idleRssMedianBytes']):.2f} MiB | "
        f"{_size(target['artifactBytes'])} | "
        f"{_size(target['runtimeExecutableBytes'])} |"
    )


def _mib(value: int) -> float:
    return value / 1024 / 1024


def _size(value: int) -> str:
    if value < 1024 * 1024:
        return f"{value / 1024:.2f} KiB"
    return f"{_mib(value):.2f} MiB"
