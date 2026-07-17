from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "benchmarks/scripts"))

from process_metrics import Snapshot, measurement, snapshot  # noqa: E402


class ProcessMetricsTest(unittest.TestCase):
    @unittest.skipUnless(sys.platform == "darwin", "macOS libproc is required")
    def test_reads_the_current_macos_process(self) -> None:
        value = snapshot(os.getpid())

        self.assertGreater(value.resident_size, 0)
        self.assertGreaterEqual(value.thread_count, 1)

    def test_computes_bounded_process_deltas(self) -> None:
        started = Snapshot(100, 1_000_000_000, 2_000_000_000, 4, 1, 2, 10, 20, 30, 2)
        ended = Snapshot(150, 3_000_000_000, 3_000_000_000, 9, 1, 5, 15, 28, 42, 4)

        result = measurement(started, ended, 2.0, 175, nanoseconds_per_tick=1.0)

        self.assertEqual(result["peakRssBytes"], 175)
        self.assertEqual(result["cpuSeconds"], 3.0)
        self.assertEqual(result["cpuUtilizationPercent"], 150.0)
        self.assertEqual(result["pageFaults"], 5)
        self.assertEqual(result["machSyscalls"], 5)
        self.assertEqual(result["unixSyscalls"], 8)
        self.assertEqual(result["contextSwitches"], 12)
        self.assertEqual(result["peakThreads"], 4)


if __name__ == "__main__":
    unittest.main()
