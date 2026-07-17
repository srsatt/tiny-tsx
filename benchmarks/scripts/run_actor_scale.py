#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import platform
import statistics
import subprocess
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
BINARY = ROOT / "target/release/examples/actor_scale"


def main() -> None:
    parser = argparse.ArgumentParser(description="Measure idle TinyTSX logical actor scale")
    parser.add_argument("--counts", default="0,1000,10000")
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--executors", type=int, default=2)
    parser.add_argument("--output-prefix", required=True)
    args = parser.parse_args()
    counts = [int(value) for value in args.counts.split(",")]
    if not counts or counts[0] != 0 or any(value < 0 for value in counts):
        raise SystemExit("--counts must start with 0 and contain non-negative integers")
    if args.runs < 1 or args.executors < 1:
        raise SystemExit("--runs and --executors must be positive")

    subprocess.run(
        ["cargo", "build", "-q", "--release", "-p", "tinytsx-runtime-worker", "--example", "actor_scale"],
        cwd=ROOT,
        check=True,
    )
    samples = [
        measure(count, args.executors, run)
        for run in range(args.runs)
        for count in counts
    ]
    medians = {
        count: {
            "actors": count,
            "rssKiB": median(sample["rssKiB"] for sample in samples if sample["actors"] == count),
            "threads": median(sample["threads"] for sample in samples if sample["actors"] == count),
            "spawnMicros": median(sample["spawnMicros"] for sample in samples if sample["actors"] == count),
        }
        for count in counts
    }
    baseline = medians[0]["rssKiB"]
    summary = []
    for count in counts:
        row = medians[count]
        row["incrementalBytesPerActor"] = (
            None if count == 0 else round((row["rssKiB"] - baseline) * 1024 / count, 2)
        )
        summary.append(row)

    report = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(UTC).isoformat(),
        "platform": {
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
            "processor": platform.processor(),
        },
        "scope": "release-mode in-process logical actors with lazy empty mailboxes; no HTTP or actor messages",
        "limitations": [
            "RSS includes the Rust process, allocator, worker pool, and measurement granularity.",
            "Incremental bytes per actor subtract the zero-actor median from the same run configuration.",
            "This does not measure hot-mailbox fairness, message payloads, persistence, or supervision.",
        ],
        "configuration": {"counts": counts, "runs": args.runs, "executors": args.executors},
        "logicalHandleBytes": samples[0]["logicalHandleBytes"],
        "summary": summary,
        "samples": samples,
    }
    prefix = Path(args.output_prefix)
    prefix.parent.mkdir(parents=True, exist_ok=True)
    prefix.with_suffix(".json").write_text(json.dumps(report, indent=2) + "\n")
    prefix.with_suffix(".md").write_text(markdown(report))
    print(json.dumps(report["summary"], indent=2))


def measure(actor_count: int, executors: int, run: int) -> dict[str, Any]:
    process = subprocess.Popen(
        [str(BINARY), str(actor_count), str(executors)],
        cwd=ROOT,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
    )
    assert process.stdout is not None
    assert process.stdin is not None
    metadata = json.loads(process.stdout.readline())
    try:
        sample = {
            "run": run + 1,
            "actors": actor_count,
            "rssKiB": resident_kib(process.pid),
            "threads": thread_count(process.pid),
            "spawnMicros": metadata["spawnMicros"],
            "logicalHandleBytes": metadata["logicalHandleBytes"],
        }
    finally:
        process.stdin.write("release\n")
        process.stdin.flush()
        _, stderr = process.communicate(timeout=10)
        if process.returncode != 0:
            raise RuntimeError(stderr)
    return sample


def resident_kib(pid: int) -> int:
    if platform.system() == "Linux":
        status = Path(f"/proc/{pid}/status").read_text()
        line = next(line for line in status.splitlines() if line.startswith("VmRSS:"))
        return int(line.split()[1])
    output = subprocess.check_output(["ps", "-o", "rss=", "-p", str(pid)], text=True)
    return int(output.strip())


def thread_count(pid: int) -> int:
    if platform.system() == "Linux":
        return len(list(Path(f"/proc/{pid}/task").iterdir()))
    output = subprocess.check_output(["ps", "-M", "-p", str(pid), "-o", "pid="], text=True)
    return len([line for line in output.splitlines() if line.strip()])


def median(values: Any) -> int:
    return int(statistics.median(values))


def markdown(report: dict[str, Any]) -> str:
    lines = [
        "# TinyTSX idle actor scale",
        "",
        f"> Scope: {report['scope']}",
        "",
        f"Platform: `{report['platform']['system']} {report['platform']['release']} {report['platform']['machine']}`  ",
        f"Executors: `{report['configuration']['executors']}`  ",
        f"Runs per actor count: `{report['configuration']['runs']}`  ",
        f"Logical handle size: `{report['logicalHandleBytes']} bytes`",
        "",
        "| Actors | Median RSS | Incremental bytes/actor | OS threads | Median spawn |",
        "| ---: | ---: | ---: | ---: | ---: |",
    ]
    for row in report["summary"]:
        incremental = "baseline" if row["incrementalBytesPerActor"] is None else f"{row['incrementalBytesPerActor']:.2f}"
        lines.append(
            f"| {row['actors']:,} | {row['rssKiB'] / 1024:.2f} MiB | {incremental} | "
            f"{row['threads']} | {row['spawnMicros'] / 1000:.2f} ms |"
        )
    lines.extend(["", "Limitations:", ""])
    lines.extend(f"- {limitation}" for limitation in report["limitations"])
    lines.append("")
    return "\n".join(lines)


if __name__ == "__main__":
    main()
