import json
import sys
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from oha_metrics import oha_command, parse_oha_json  # noqa: E402


class OhaMetricsTest(unittest.TestCase):
    def test_keep_alive_controls_the_oha_transport(self) -> None:
        persistent = oha_command("http://127.0.0.1/", 8, 1, True)
        connection_close = oha_command("http://127.0.0.1/", 8, 1, False)

        self.assertNotIn("--disable-keepalive", persistent)
        self.assertIn("--disable-keepalive", connection_close)

    def test_posts_a_fixed_json_body_with_an_explicit_content_type(self) -> None:
        command = oha_command(
            "http://127.0.0.1/json-body",
            8,
            1,
            True,
            method="POST",
            body='{"value":7}',
            content_type="application/json",
        )

        self.assertEqual(command[command.index("-m") + 1], "POST")
        self.assertEqual(command[command.index("-d") + 1], '{"value":7}')
        self.assertEqual(command[command.index("-T") + 1], "application/json")

    def test_extracts_sub_millisecond_percentiles(self) -> None:
        payload = {
            "summary": {
                "successRate": 1.0,
                "total": 2.01,
                "slowest": 0.0045,
                "requestsPerSec": 12345.5,
            },
            "latencyPercentiles": {
                "p50": 0.00025,
                "p95": 0.0007,
                "p99": 0.0012,
            },
            "statusCodeDistribution": {"200": 25_000},
        }
        sample = parse_oha_json(json.dumps(payload))
        self.assertEqual(sample.requests_per_second, 12345.5)
        self.assertEqual(sample.p50_ms, 0.25)
        self.assertEqual(sample.p95_ms, 0.7)
        self.assertEqual(sample.p99_ms, 1.2)
        self.assertEqual(sample.max_ms, 4.5)

    def test_rejects_non_200_responses(self) -> None:
        payload = {
            "summary": {
                "successRate": 0.5,
                "total": 1,
                "slowest": 0.1,
                "requestsPerSec": 2,
            },
            "latencyPercentiles": {"p50": 0.1, "p95": 0.1, "p99": 0.1},
            "statusCodeDistribution": {"200": 1, "500": 1},
        }
        with self.assertRaises(RuntimeError):
            parse_oha_json(json.dumps(payload))


if __name__ == "__main__":
    unittest.main()
