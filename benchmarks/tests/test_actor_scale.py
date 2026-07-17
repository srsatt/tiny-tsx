import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT / "benchmarks/results/2026-07-17-m5-max-actor-scale.json"


class ActorScaleEvidenceTest(unittest.TestCase):
    def test_committed_report_covers_both_required_actor_counts(self) -> None:
        report = json.loads(REPORT.read_text())

        self.assertEqual(report["schemaVersion"], 1)
        self.assertEqual(report["configuration"]["counts"], [0, 1_000, 10_000])
        self.assertGreaterEqual(report["configuration"]["runs"], 5)
        summary = {row["actors"]: row for row in report["summary"]}
        self.assertEqual(summary.keys(), {0, 1_000, 10_000})
        self.assertEqual({row["threads"] for row in summary.values()}, {4})
        self.assertGreater(summary[1_000]["incrementalBytesPerActor"], 0)
        self.assertGreater(summary[10_000]["incrementalBytesPerActor"], 0)
        self.assertTrue(any("fairness" in value for value in report["limitations"]))


if __name__ == "__main__":
    unittest.main()
