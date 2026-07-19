from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from performance_gate import CoreHttpBudget, evaluate_core_http  # noqa: E402


class PerformanceGateTest(unittest.TestCase):
    def test_accepts_a_core_http_result_within_every_budget(self) -> None:
        self.assertEqual(evaluate_core_http(self._report(), [8, 64]), [])

    def test_reports_every_regressed_dimension(self) -> None:
        report = copy.deepcopy(self._report())
        tiny = report["targets"]["tinytsx"]
        tiny["startupSamplesMs"] = [12.0, 14.0, 16.0]
        tiny["postWarmupRssSamplesBytes"] = [7_000_000]
        tiny["artifactBytes"] = 800_000
        tiny["throughput"]["64"] = [self._sample(80_000.0, 4.0)]

        failures = evaluate_core_http(report, [8, 64])

        self.assertEqual(len(failures), 5)
        self.assertTrue(any("startup ratio" in value for value in failures))
        self.assertTrue(any("warm RSS ratio" in value for value in failures))
        self.assertTrue(any("artifact" in value for value in failures))
        self.assertTrue(any("c64 RPS ratio" in value for value in failures))
        self.assertTrue(any("c64 p99" in value for value in failures))

    def test_requires_every_requested_concurrency(self) -> None:
        failures = evaluate_core_http(self._report(), [8, 32, 64])

        self.assertEqual(failures, ["missing concurrency 32 samples"])

    def test_accepts_the_summarized_report_shape_written_by_the_harness(self) -> None:
        report = self._report()
        for target in report["targets"].values():
            target["throughput"] = {
                key: {"samples": samples, "median": samples[0]}
                for key, samples in target["throughput"].items()
            }

        self.assertEqual(evaluate_core_http(report, [8, 64]), [])

    def test_allows_an_absolute_p99_win_despite_ratio_noise(self) -> None:
        report = self._report()
        report["targets"]["tinytsx"]["throughput"]["64"] = [
            self._sample(110_000.0, 0.4)
        ]
        report["targets"]["bun"]["throughput"]["64"] = [
            self._sample(100_000.0, 0.1)
        ]

        self.assertEqual(evaluate_core_http(report, [64]), [])

    @staticmethod
    def _sample(rps: float, p99_ms: float) -> dict[str, float]:
        return {"requests_per_second": rps, "p99_ms": p99_ms}

    @classmethod
    def _report(cls) -> dict:
        tiny_sample = cls._sample(110_000.0, 1.5)
        bun_sample = cls._sample(100_000.0, 1.0)
        return {
            "targets": {
                "tinytsx": {
                    "artifactBytes": 600_000,
                    "startupSamplesMs": [8.0, 9.0, 10.0],
                    "postWarmupRssSamplesBytes": [5_000_000],
                    "throughput": {
                        "8": [tiny_sample],
                        "64": [tiny_sample],
                    },
                },
                "bun": {
                    "startupSamplesMs": [20.0, 21.0, 22.0],
                    "postWarmupRssSamplesBytes": [12_000_000],
                    "throughput": {
                        "8": [bun_sample],
                        "64": [bun_sample],
                    },
                },
            }
        }
