import sys
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from run_static import (  # noqa: E402
    WORKLOADS,
    assert_correct,
    benchmark_limitations,
    benchmark_scope,
    expected_content_type,
    is_millisecond_header,
    normalize_content_type,
    parse_allocation_metrics,
    tinytsx_build_command,
)


class StaticHarnessTest(unittest.TestCase):
    def test_parses_the_native_allocator_report(self) -> None:
        report = parse_allocation_metrics(
            b'noise\nTINYTSX_ALLOC_METRICS {"allocationCalls":3,"peakLiveBytes":128}\n'
        )

        self.assertEqual(report, {"allocationCalls": 3, "peakLiveBytes": 128})
        with self.assertRaises(RuntimeError):
            parse_allocation_metrics(b"missing")

    def test_normalizes_equivalent_content_type_spelling(self) -> None:
        self.assertEqual(
            normalize_content_type("text/plain; charset=UTF-8"),
            normalize_content_type("text/plain;charset=utf-8"),
        )

    def test_hono_workload_uses_the_complete_pinned_example(self) -> None:
        workload = WORKLOADS["hono-basic"]
        self.assertEqual(
            workload["tiny_entry"],
            "vendor/hono-examples/basic/src/index.ts",
        )
        self.assertEqual(workload["path"], "/")
        self.assertEqual(workload["headers"], {"x-powered-by": "Hono"})
        self.assertEqual(workload["numeric_headers"], ["x-response-time"])
        self.assertEqual(
            expected_content_type(workload, "bun"),
            "application/octet-stream",
        )

    def test_hono_jsx_workload_uses_bun_as_the_byte_reference(self) -> None:
        workload = WORKLOADS["hono-jsx-ssr"]
        self.assertEqual(
            workload["tiny_entry"],
            "vendor/hono-examples/jsx-ssr/src/index.tsx",
        )
        self.assertEqual(workload["path"], "/")
        self.assertEqual(workload["reference_target"], "bun")
        self.assertTrue(any(
            argument.startswith("hono/html=")
            for argument in workload["tiny_args"]
        ))
        self.assertIn("hono/jsx", workload["bun_args"])

    def test_native_build_command_preserves_the_requested_worker_count(self) -> None:
        command = tinytsx_build_command(
            Path("dist/server"),
            3000,
            WORKLOADS["hono-jsx-ssr"],
            4,
        )
        worker_option = command.index("--workers")
        self.assertEqual(command[worker_option + 1], "4")

    def test_dynamic_jsx_workload_measures_request_time_escaping(self) -> None:
        workload = WORKLOADS["hono-dynamic-jsx"]
        self.assertIn("name=", workload["path"])
        self.assertEqual(workload["reference_target"], "bun")
        self.assertEqual(workload["tiny_entry"], "tests/compat/hono/dynamic-jsx-smoke.tsx")

    def test_stream_workload_requires_chunked_framing(self) -> None:
        workload = WORKLOADS["hono-stream-text"]
        response = {
            "status": 200,
            "headers": {
                "content-type": "text/plain; charset=UTF-8",
                "transfer-encoding": "chunked",
                "x-content-type-options": "nosniff",
            },
            "body": b"first\nsecond\nthird\n",
        }
        assert_correct(response, workload, "tinytsx")

        response["headers"].pop("transfer-encoding")
        response["headers"]["content-length"] = "19"
        with self.assertRaises(RuntimeError):
            assert_correct(response, workload, "tinytsx")
        assert_correct(response, workload, "bun")

    def test_worker_workload_compares_one_logical_worker_per_target(self) -> None:
        workload = WORKLOADS["hono-worker"]

        self.assertEqual(workload["path"], "/worker?input=TinyTSX+%26+Bun")
        self.assertEqual(workload["body"], b"TINYTSX & BUN")
        self.assertIn("one logical worker", workload["limitation"])
        self.assertEqual(
            workload["tiny_entry"],
            "tests/compat/workers/hono-worker-smoke.ts",
        )

    def test_actor_workload_compares_isolated_counter_owners(self) -> None:
        workload = WORKLOADS["hono-actor"]

        self.assertEqual(workload["path"], "/")
        self.assertEqual(workload["body"], b"0")
        self.assertIn("actor mailbox", workload["limitation"])
        self.assertEqual(workload["tiny_entry"], "examples/hono-actors/server.ts")
        self.assertEqual(workload["bun_script"], "benchmarks/bun/hono-actor-server.ts")

    def test_sqlite_workload_records_owner_serialization_boundary(self) -> None:
        workload = WORKLOADS["hono-sqlite"]

        self.assertEqual(workload["path"], "/sqlite")
        self.assertEqual(workload["body"], b'{"values":[]}')
        self.assertIn("application mailbox", workload["limitation"])
        self.assertEqual(workload["tiny_entry"], "benchmarks/tiny/hono-sqlite.ts")
        self.assertEqual(workload["bun_script"], "benchmarks/bun/hono-sqlite-server.ts")

    def test_ai_provider_workload_uses_the_exact_pinned_graph(self) -> None:
        workload = WORKLOADS["hono-ai-provider"]

        self.assertEqual(workload["path"], "/ai-local")
        self.assertEqual(workload["body"], b"Hello from local provider")
        self.assertEqual(workload["support_port"], 39453)
        self.assertIn("656-module", workload["scope"])
        self.assertIn("@ai-sdk/openai-compatible=", " ".join(workload["tiny_args"]))
        self.assertEqual(
            workload["tiny_entry"],
            "tests/compat/ai/hono-local-provider-smoke.ts",
        )

    def test_keep_alive_scope_records_the_bounded_reconnect_policy(self) -> None:
        workload = WORKLOADS["hono-jsx-ssr"]

        self.assertIn("keep-alive", benchmark_scope(workload, True))
        self.assertTrue(
            any("100 requests" in value for value in benchmark_limitations(workload, True))
        )

    def test_response_equivalence_includes_required_headers(self) -> None:
        workload = {
            "body": b"Hono!!",
            "content_type": "text/plain;charset=UTF-8",
            "headers": {"x-powered-by": "Hono"},
            "numeric_headers": ["x-response-time"],
        }
        response = {
            "status": 200,
            "headers": {
                "content-type": "text/plain; charset=UTF-8",
                "content-length": "6",
                "x-powered-by": "Hono",
                "x-response-time": "12ms",
            },
            "body": b"Hono!!",
        }
        assert_correct(response, workload)

        response["headers"].pop("x-powered-by")
        with self.assertRaises(RuntimeError):
            assert_correct(response, workload)

    def test_supports_visible_target_specific_content_types(self) -> None:
        workload = {
            "body": b"Hono!!",
            "content_type": "text/plain;charset=UTF-8",
            "target_content_types": {"bun": "application/octet-stream"},
        }
        response = {
            "status": 200,
            "headers": {
                "content-type": "application/octet-stream",
                "content-length": "6",
            },
            "body": b"Hono!!",
        }
        assert_correct(response, workload, "bun")
        with self.assertRaises(RuntimeError):
            assert_correct(response, workload, "tinytsx")

    def test_accepts_only_numeric_millisecond_headers(self) -> None:
        self.assertTrue(is_millisecond_header("0ms"))
        self.assertTrue(is_millisecond_header("123ms"))
        self.assertFalse(is_millisecond_header("ms"))
        self.assertFalse(is_millisecond_header("1.2ms"))
        self.assertFalse(is_millisecond_header(None))
