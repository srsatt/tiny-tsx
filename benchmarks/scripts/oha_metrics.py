from __future__ import annotations

import json
import os
import subprocess
from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class OhaSample:
    requests_per_second: float
    success_rate: float
    p50_ms: float
    p95_ms: float
    p99_ms: float
    max_ms: float
    total_seconds: float
    status_codes: dict[str, int]

    def as_json(self) -> dict[str, object]:
        return asdict(self)


def run_oha(url: str, concurrency: int, duration_seconds: int) -> OhaSample:
    command = [
        "oha",
        "-z",
        f"{duration_seconds}s",
        "-c",
        str(concurrency),
        "--wait-ongoing-requests-after-deadline",
        "--disable-keepalive",
        "--no-tui",
        "--output-format",
        "json",
        url,
    ]
    environment = os.environ.copy()
    environment["NO_COLOR"] = "1"
    completed = subprocess.run(
        command,
        check=False,
        capture_output=True,
        text=True,
        env=environment,
    )
    if completed.returncode != 0:
        raise RuntimeError(
            f"oha failed ({completed.returncode}):\n{completed.stderr.strip()}"
        )
    return parse_oha_json(completed.stdout)


def parse_oha_json(raw: str) -> OhaSample:
    payload = json.loads(raw)
    summary = payload["summary"]
    percentiles = payload["latencyPercentiles"]
    status_codes = {
        str(code): int(count)
        for code, count in payload["statusCodeDistribution"].items()
    }
    sample = OhaSample(
        requests_per_second=float(summary["requestsPerSec"]),
        success_rate=float(summary["successRate"]),
        p50_ms=float(percentiles["p50"]) * 1000,
        p95_ms=float(percentiles["p95"]) * 1000,
        p99_ms=float(percentiles["p99"]) * 1000,
        max_ms=float(summary["slowest"]) * 1000,
        total_seconds=float(summary["total"]),
        status_codes=status_codes,
    )
    if sample.success_rate != 1.0 or set(status_codes) != {"200"}:
        raise RuntimeError(
            f"benchmark response failure: success={sample.success_rate}, "
            f"statuses={status_codes}"
        )
    return sample

