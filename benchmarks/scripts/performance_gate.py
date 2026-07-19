#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class CoreHttpBudget:
    startup_ratio: float = 0.5
    rss_ratio: float = 0.5
    rps_ratio: float = 1.0
    p99_ratio: float = 2.0
    p99_max_ms: float = 3.0
    artifact_max_bytes: int = 700 * 1024


def median(values: list[int | float]) -> float:
    if not values:
        raise ValueError("benchmark report has no samples")
    return float(statistics.median(values))


def throughput_samples(target: dict[str, Any], key: str) -> list[dict[str, Any]]:
    value = target["throughput"].get(key)
    if isinstance(value, dict):
        value = value.get("samples")
    return value if isinstance(value, list) else []


def evaluate_core_http(
    report: dict[str, Any],
    concurrency: list[int],
    budget: CoreHttpBudget = CoreHttpBudget(),
) -> list[str]:
    tiny = report["targets"]["tinytsx"]
    bun = report["targets"]["bun"]
    failures: list[str] = []

    startup_ratio = median(tiny["startupSamplesMs"]) / median(bun["startupSamplesMs"])
    if startup_ratio > budget.startup_ratio:
        failures.append(
            f"startup ratio {startup_ratio:.3f} exceeds {budget.startup_ratio:.3f}"
        )

    rss_ratio = median(tiny["postWarmupRssSamplesBytes"]) / median(
        bun["postWarmupRssSamplesBytes"]
    )
    if rss_ratio > budget.rss_ratio:
        failures.append(f"warm RSS ratio {rss_ratio:.3f} exceeds {budget.rss_ratio:.3f}")

    artifact_bytes = int(tiny["artifactBytes"])
    if artifact_bytes > budget.artifact_max_bytes:
        failures.append(
            f"artifact {artifact_bytes} bytes exceeds {budget.artifact_max_bytes} bytes"
        )

    for value in concurrency:
        key = str(value)
        tiny_samples = throughput_samples(tiny, key)
        bun_samples = throughput_samples(bun, key)
        if not tiny_samples or not bun_samples:
            failures.append(f"missing concurrency {value} samples")
            continue
        tiny_rps = median([float(sample["requests_per_second"]) for sample in tiny_samples])
        bun_rps = median([float(sample["requests_per_second"]) for sample in bun_samples])
        rps_ratio = tiny_rps / bun_rps
        if rps_ratio < budget.rps_ratio:
            failures.append(
                f"c{value} RPS ratio {rps_ratio:.3f} is below {budget.rps_ratio:.3f}"
            )

        tiny_p99 = median([float(sample["p99_ms"]) for sample in tiny_samples])
        bun_p99 = median([float(sample["p99_ms"]) for sample in bun_samples])
        p99_ratio = tiny_p99 / bun_p99
        if tiny_p99 > budget.p99_max_ms and p99_ratio > budget.p99_ratio:
            failures.append(
                f"c{value} p99 {tiny_p99:.3f} ms / {p99_ratio:.3f}x Bun exceeds both limits"
            )

    return failures


def parse_arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fail when a TinyTSX/Bun benchmark misses the core HTTP budget."
    )
    parser.add_argument("report", type=Path)
    parser.add_argument("--concurrency", default="8,64")
    return parser.parse_args()


def main() -> int:
    arguments = parse_arguments()
    report = json.loads(arguments.report.read_text())
    concurrency = [int(value) for value in arguments.concurrency.split(",")]
    failures = evaluate_core_http(report, concurrency)
    if failures:
        for failure in failures:
            print(f"FAIL: {failure}", file=sys.stderr)
        return 1
    print("PASS: core HTTP performance budget")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
