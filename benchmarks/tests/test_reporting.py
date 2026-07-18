import copy
import sys
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from reporting import render_markdown, summarize  # noqa: E402


class ReportingTest(unittest.TestCase):
    def test_reports_first_launch_and_disables_optional_allocator_metrics(self) -> None:
        result = summarize(self._raw())

        self.assertEqual(result["targets"]["tinytsx"]["firstLaunchMs"], 12.0)
        self.assertEqual(result["targets"]["tinytsx"]["startupMedianMs"], 10.0)
        markdown = render_markdown(result)
        self.assertIn("| TinyTSX | 12.00 ms | 10.00 ms |", markdown)
        self.assertIn("| Global allocator | disabled |", markdown)
        self.assertIn("| TinyTSX | 0.30 s | 30.0% | 30 | 20 | 5 | 3 | 4/7/4 |", markdown)

    def test_renders_instrumented_allocator_metrics_without_a_bun_ratio(self) -> None:
        raw = self._raw()
        raw["configuration"]["allocationInstrumentation"] = (
            "TinyTSX global allocator only"
        )
        raw["targets"]["tinytsx"]["allocationSamples"] = [
            {
                "allocationCalls": 20,
                "deallocationCalls": 10,
                "reallocationCalls": 2,
                "allocatedBytes": 4096,
                "liveBytes": 64,
                "peakLiveBytes": 512,
            }
        ]

        markdown = render_markdown(summarize(raw))

        self.assertIn("| Global allocator | 20 | 2 | 4.00 KiB |", markdown)
        self.assertIn("no allocation ratio is claimed", markdown)

    def test_bounds_large_response_body_previews(self) -> None:
        raw = self._raw()
        raw["correctness"]["bodyUtf8"] = "x" * 1_000
        raw["correctness"]["contentLength"] = 1_000

        markdown = render_markdown(summarize(raw))

        self.assertIn("Body: 1,000 UTF-8 bytes; SHA-256", markdown)
        self.assertIn("Body preview:", markdown)
        self.assertNotIn("x" * 200, markdown)

    def test_renders_a_fixed_post_request_contract(self) -> None:
        raw = self._raw()
        raw["correctness"].update({
            "method": "POST",
            "requestContentType": "application/json",
            "requestBodyUtf8": '{"value":7}',
        })

        markdown = render_markdown(summarize(raw))

        self.assertIn("## Request contract", markdown)
        self.assertIn("- Method: `POST`", markdown)
        self.assertIn("- Content-Type: `application/json`", markdown)
        self.assertIn(r'- Body: `"{\"value\":7}"` (11 bytes)', markdown)

    def test_renders_a_checked_multi_request_scenario_contract(self) -> None:
        raw = self._raw()
        raw["configuration"]["loadGenerator"] = "bounded CRUD client"
        raw["correctness"].update({
            "scenarioSteps": ["create", "list", "complete", "delete"],
            "scenarioRequestsPerCycle": 4,
        })

        markdown = render_markdown(summarize(raw))

        self.assertIn("Load generator: bounded CRUD client", markdown)
        self.assertIn("## Scenario contract", markdown)
        self.assertIn("1. create", markdown)
        self.assertIn("4. delete", markdown)
        self.assertIn("4 checked requests complete one state-bounded CRUD cycle", markdown)

    @staticmethod
    def _raw() -> dict:
        sample = {
            "requests_per_second": 1000.0,
            "p50_ms": 0.1,
            "p95_ms": 0.2,
            "p99_ms": 0.3,
            "max_ms": 0.5,
        }
        resource = {
            "wallSeconds": 1.0,
            "userCpuSeconds": 0.2,
            "systemCpuSeconds": 0.1,
            "cpuSeconds": 0.3,
            "cpuUtilizationPercent": 30.0,
            "peakRssBytes": 2 * 1024 * 1024,
            "pageFaults": 3,
            "pageIns": 0,
            "copyOnWriteFaults": 1,
            "machSyscalls": 20,
            "unixSyscalls": 30,
            "contextSwitches": 5,
            "peakThreads": 4,
            "openFileDescriptorsStart": 4,
            "openFileDescriptorsPeak": 7,
            "openFileDescriptorsEnd": 4,
            "diskBytesRead": 0,
            "diskBytesWritten": 0,
            "instructions": 100,
            "cycles": 200,
        }
        target = {
            "artifactBytes": 1024,
            "runtimeExecutableBytes": 2048,
            "startupSamplesMs": [12.0, 8.0],
            "idleRssSamplesBytes": [1024 * 1024],
            "postWarmupRssSamplesBytes": [2 * 1024 * 1024],
            "resourceSamples": [resource],
            "allocationSamples": [],
            "throughput": {"1": [sample]},
        }
        return {
            "timestamp": "2026-07-17T00:00:00+00:00",
            "workload": "hono-actor",
            "scope": "test scope",
            "limitations": [],
            "responseDifferences": [],
            "environment": {
                "machine": "test",
                "os": "test",
                "commit": "abc123",
                "bunVersion": "1.0",
                "ohaVersion": "1.0",
            },
            "configuration": {
                "runs": 1,
                "durationSeconds": 1,
                "concurrency": [1],
                "workers": 1,
                "keepAlive": True,
                "supportProcess": False,
                "allocationInstrumentation": "disabled",
            },
            "correctness": {
                "status": 200,
                "bodyUtf8": "ok",
                "contentLength": 2,
                "contentTypes": {"tinytsx": "text/plain", "bun": "text/plain"},
                "framings": {"tinytsx": "fixed", "bun": "fixed"},
            },
            "targets": {"tinytsx": target, "bun": copy.deepcopy(target)},
        }


if __name__ == "__main__":
    unittest.main()
