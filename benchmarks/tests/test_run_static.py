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
    tinytsx_build_command,
)


class StaticHarnessTest(unittest.TestCase):
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
