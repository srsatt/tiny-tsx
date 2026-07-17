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
            "firstLaunchMs": target["startupSamplesMs"][0],
            "startupMedianMs": statistics.median(target["startupSamplesMs"]),
            "idleRssMedianBytes": int(statistics.median(target["idleRssSamplesBytes"])),
            "postWarmupRssMedianBytes": int(
                statistics.median(target["postWarmupRssSamplesBytes"])
            ),
            "resourceMedian": median_values(target["resourceSamples"]),
            "allocationMedian": median_values(target["allocationSamples"]),
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
        f"# TinyTSX {title} benchmark ({result['configuration']['workers']} worker(s))",
        "",
        f"Generated: {result['timestamp']}",
        "",
        f"> Scope: {result['scope']}. {_transport_scope(result)}; {_process_scope(result)}. "
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
        "| Target | First launch | Startup median | Idle RSS median | Post-warm-up RSS median | Peak sampled RSS | App artifact | Runtime executable |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
        _footprint_row("TinyTSX", tiny),
        _footprint_row("Bun", bun),
        "",
        "Bun's application script and runtime executable are reported separately; the "
        "runtime is required in deployment but may be shared by multiple applications.",
        "Idle RSS is sampled after one correctness request; post-warm-up RSS is sampled "
        "after one second at maximum concurrency.",
        "Peak RSS is sampled from the server every 20 ms throughout warm-up and all load points.",
        "",
        "## Process and optional allocation pressure",
        "",
        "| Target | Server CPU | CPU utilization | Unix syscalls | Mach syscalls | Context switches | Page faults |",
        "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
        _process_row("TinyTSX", tiny),
        _process_row("Bun", bun),
        "",
        "Counters are per measured server process from warm-up through the final load point; medians are across runs.",
        "",
        "| TinyTSX allocator | Calls | Reallocations | Requested bytes | Peak live bytes | Live bytes at shutdown |",
        "| --- | ---: | ---: | ---: | ---: | ---: |",
        _allocation_row(tiny),
        "",
        _allocation_note(result),
        "",
        "## Response contract",
        "",
        f"- Status: {result['correctness']['status']}",
        f"- Body: `{result['correctness']['bodyUtf8']}` ({result['correctness']['contentLength']} bytes)",
        f"- TinyTSX Content-Type: `{result['correctness']['contentTypes']['tinytsx']}`",
        f"- Bun Content-Type: `{result['correctness']['contentTypes']['bun']}`",
        f"- TinyTSX framing: `{result['correctness']['framings']['tinytsx']}`",
        f"- Bun framing: `{result['correctness']['framings']['bun']}`",
        *[f"- Difference: {difference}" for difference in result.get("responseDifferences", [])],
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
            f"- TinyTSX uses {result['configuration']['workers']} fixed native worker(s); keep-alive is {str(result['configuration']['keepAlive']).lower()}.",
            "- The benchmark client and server share the same machine.",
            *[f"- {limitation}" for limitation in result.get("limitations", [])],
            "- Power mode and unrelated background activity are not controlled by the harness.",
            "",
        ]
    )
    return "\n".join(lines)


def _footprint_row(label: str, target: dict[str, Any]) -> str:
    return (
        f"| {label} | {target['firstLaunchMs']:.2f} ms | "
        f"{target['startupMedianMs']:.2f} ms | "
        f"{_mib(target['idleRssMedianBytes']):.2f} MiB | "
        f"{_mib(target['postWarmupRssMedianBytes']):.2f} MiB | "
        f"{_mib(int(target['resourceMedian']['peakRssBytes'])):.2f} MiB | "
        f"{_size(target['artifactBytes'])} | "
        f"{_size(target['runtimeExecutableBytes'])} |"
    )


def _process_row(label: str, target: dict[str, Any]) -> str:
    value = target["resourceMedian"]
    return (
        f"| {label} | {value['cpuSeconds']:.2f} s | "
        f"{value['cpuUtilizationPercent']:.1f}% | "
        f"{value['unixSyscalls']:,.0f} | {value['machSyscalls']:,.0f} | "
        f"{value['contextSwitches']:,.0f} | {value['pageFaults']:,.0f} |"
    )


def _allocation_row(target: dict[str, Any]) -> str:
    value = target["allocationMedian"]
    if not value:
        return "| Global allocator | disabled | disabled | disabled | disabled | disabled |"
    return (
        f"| Global allocator | {value['allocationCalls']:,.0f} | "
        f"{value['reallocationCalls']:,.0f} | {_size(int(value['allocatedBytes']))} | "
        f"{_size(int(value['peakLiveBytes']))} | {_size(int(value['liveBytes']))} |"
    )


def _allocation_note(result: dict[str, Any]) -> str:
    if result["configuration"]["allocationInstrumentation"] == "disabled":
        return (
            "Allocator counters are disabled for this comparison, so the TinyTSX "
            "throughput path has no instrumentation overhead."
        )
    return (
        "Allocator counters cover the TinyTSX process from startup through graceful "
        "shutdown. They add atomic counter overhead and are disabled in ordinary builds. "
        "Bun does not expose an equivalent counter in this harness, so no allocation "
        "ratio is claimed."
    )


def median_values(samples: list[dict[str, Any]]) -> dict[str, float]:
    if not samples:
        return {}
    return {
        key: statistics.median(float(sample[key]) for sample in samples)
        for key in samples[0]
    }


def _transport_scope(result: dict[str, Any]) -> str:
    if result["configuration"]["keepAlive"]:
        return "HTTP/1.1 connections are reused"
    return "a new TCP connection is opened per request"


def _process_scope(result: dict[str, Any]) -> str:
    if result["configuration"].get("supportProcess"):
        return "one measured server process plus one shared support process excluded from RSS"
    return "one server process"


def _mib(value: int) -> float:
    return value / 1024 / 1024


def _size(value: int) -> str:
    if value < 1024 * 1024:
        return f"{value / 1024:.2f} KiB"
    return f"{_mib(value):.2f} MiB"
