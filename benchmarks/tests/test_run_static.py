import json
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
    decode_sqlite_wal_state,
    decode_sqlite_rollback_state,
    expected_content_type,
    is_millisecond_header,
    materialize_workload,
    normalize_content_type,
    parse_allocation_metrics,
    tinytsx_build_command,
    workload_load_target,
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

    def test_json_branch_pair_uses_the_complete_pinned_example(self) -> None:
        compact = WORKLOADS["hono-json-compact"]
        pretty = WORKLOADS["hono-json-pretty"]

        self.assertEqual(compact["path"], "/api/posts")
        self.assertEqual(pretty["path"], "/api/posts?pretty")
        for workload in (compact, pretty):
            self.assertEqual(
                workload["tiny_entry"],
                "vendor/hono-examples/basic/src/index.ts",
            )
            self.assertEqual(workload["bun_script"], "benchmarks/bun/hono-server.ts")
            self.assertEqual(workload["reference_target"], "bun")
            self.assertEqual(workload["headers"], {"x-powered-by": "Hono"})
            self.assertEqual(workload["numeric_headers"], ["x-response-time"])
            self.assertIn("hono/pretty-json", " ".join(workload["tiny_args"]))
        self.assertIn("query-absent", compact["scope"])
        self.assertIn("query-present", pretty["scope"])

    def test_json_body_workload_posts_the_shared_primitive_tracer(self) -> None:
        workload = WORKLOADS["hono-json-body"]

        self.assertEqual(workload["method"], "POST")
        self.assertEqual(workload["path"], "/json-body")
        self.assertEqual(workload["request_content_type"], "application/json")
        self.assertEqual(workload["request_body"], workload["body"])
        self.assertEqual(
            workload["tiny_entry"],
            "tests/compat/hono/json-body-smoke.ts",
        )
        self.assertEqual(
            workload["bun_script"],
            "benchmarks/bun/hono-json-body-server.ts",
        )
        self.assertIn("string, number, boolean, and null", workload["scope"])

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

    def test_route_parameter_workload_uses_the_same_hono_source(self) -> None:
        workload = WORKLOADS["hono-route-param"]

        self.assertEqual(workload["path"], "/api/v1/animal/TinyTSX%20Bench")
        self.assertEqual(workload["body"], b'{"type":"TinyTSX Bench"}')
        self.assertEqual(workload["content_type"], "application/json")
        self.assertIn("decoded trailing route parameter", workload["scope"])
        self.assertEqual(
            workload["tiny_entry"],
            "tests/compat/hono/optional-param-smoke.ts",
        )
        self.assertEqual(
            workload["bun_script"],
            "benchmarks/bun/hono-route-param-server.ts",
        )

    def test_file_workload_pins_the_asset_and_read_capability(self) -> None:
        workload = WORKLOADS["hono-file-read"]
        asset_root = Path(__file__).resolve().parents[2] / "vendor/hono-examples/serve-static/assets"

        self.assertEqual(workload["path"], "/my-file.txt")
        self.assertEqual(workload["body"], b"This is a sample file")
        self.assertEqual(workload["headers"], {"x-powered-by": "Hono"})
        self.assertEqual(
            workload["tiny_entry"],
            "examples/hono-static/server.ts",
        )
        read_option = workload["tiny_args"].index("--allow-read")
        self.assertEqual(workload["tiny_args"][read_option + 1], str(asset_root))
        self.assertIn("warm page-cache", workload["limitation"])
        self.assertEqual(
            workload["bun_script"],
            "benchmarks/bun/hono-file-read-server.ts",
        )

    def test_large_file_workload_scales_the_same_response_shape(self) -> None:
        workload = WORKLOADS["hono-large-file"]
        source_root = Path(__file__).resolve().parents[2] / "vendor/hono/src"

        self.assertEqual(workload["path"], "/large-file")
        self.assertEqual(len(workload["body"]), 22_173)
        self.assertEqual(workload["body"], (source_root / "context.ts").read_bytes())
        self.assertEqual(workload["headers"], {"x-powered-by": "Hono"})
        self.assertEqual(workload["tiny_entry"], "benchmarks/tiny/hono-large-file.ts")
        read_option = workload["tiny_args"].index("--allow-read")
        self.assertEqual(workload["tiny_args"][read_option + 1], str(source_root))
        self.assertIn("22,173-byte", workload["scope"])
        self.assertEqual(
            workload["bun_script"],
            "benchmarks/bun/hono-large-file-server.ts",
        )

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

    def test_multi_actor_workload_cycles_eight_response_equivalent_routes(self) -> None:
        workload = WORKLOADS["hono-actor-multi"]

        self.assertEqual(len(workload["paths"]), 8)
        self.assertEqual(len(workload["state_paths"]), 8)
        self.assertEqual(workload["body"], b"queued")
        self.assertIn("fire-and-forget", workload["limitation"])
        self.assertEqual(workload["tiny_entry"], "benchmarks/tiny/hono-actor-multi.ts")
        self.assertEqual(
            workload["bun_script"],
            "benchmarks/bun/hono-actor-multi-server.ts",
        )

        target, urls_from_file, file = workload_load_target(39_495, workload)
        try:
            self.assertTrue(urls_from_file)
            self.assertEqual(target, file.name)
            self.assertEqual(
                Path(target).read_text().splitlines(),
                [f"http://127.0.0.1:39495/actor/{index}/tell" for index in range(8)],
            )
        finally:
            file.close()

    def test_sqlite_workload_records_owner_serialization_boundary(self) -> None:
        workload = WORKLOADS["hono-sqlite"]

        self.assertEqual(workload["path"], "/sqlite")
        self.assertEqual(workload["body"], b'{"values":[]}')
        self.assertIn("application mailbox", workload["limitation"])
        self.assertEqual(workload["tiny_entry"], "benchmarks/tiny/hono-sqlite.ts")
        self.assertEqual(workload["bun_script"], "benchmarks/bun/hono-sqlite-server.ts")

    def test_sqlite_transaction_workload_pins_writes_and_non_empty_read(self) -> None:
        workload = WORKLOADS["hono-sqlite-transaction"]

        self.assertEqual(workload["path"], "/sqlite-transaction")
        self.assertEqual(
            workload["body"],
            b'{"value":{"id":"stable","value":"ready"}}',
        )
        self.assertIn("two idempotent prepared writes", workload["scope"])
        self.assertIn("non-empty prepared row", workload["scope"])
        self.assertIn("does not measure disk", workload["limitation"])
        self.assertEqual(
            workload["tiny_entry"],
            "benchmarks/tiny/hono-sqlite-transaction.ts",
        )
        self.assertEqual(
            workload["bun_script"],
            "benchmarks/bun/hono-sqlite-transaction-server.ts",
        )

    def test_nested_profile_workload_pins_request_transaction_and_response(self) -> None:
        workload = WORKLOADS["hono-nested-profile"]

        self.assertEqual(workload["method"], "POST")
        self.assertEqual(workload["expected_status"], 201)
        self.assertEqual(workload["path"], "/profiles/benchmark")
        self.assertEqual(workload["request_content_type"], "application/json")
        self.assertEqual(
            json.loads(workload["request_body"]),
            {
                "profile": {
                    "name": "Benchmark",
                    "preferences": {"theme": "dark", "alerts": True},
                },
                "score": 7,
            },
        )
        self.assertEqual(
            json.loads(workload["body"]),
            {
                "id": "benchmark",
                "profile": {
                    "name": "Benchmark",
                    "preferences": {"theme": "dark", "alerts": True},
                },
                "score": 7,
            },
        )
        self.assertIn("four bounded nested primitive", workload["scope"])
        self.assertIn("two idempotent prepared writes", workload["scope"])
        self.assertIn("duplicate-theme rollback", workload["limitation"])
        self.assertEqual(
            workload["tiny_entry"],
            "benchmarks/tiny/hono-nested-profile.ts",
        )
        self.assertEqual(
            workload["bun_script"],
            "benchmarks/bun/hono-nested-profile-server.ts",
        )

    def test_stytch_todo_workload_runs_a_bounded_authenticated_crud_scenario(self) -> None:
        workload = WORKLOADS["hono-stytch-todo"]

        self.assertEqual(workload["scenario"], "stytch-todo-crud")
        self.assertEqual(
            workload["tiny_entry"],
            "examples/hono-stytch-todo/server.ts",
        )
        self.assertIn("TODOS=sqlite-kv::memory:", workload["tiny_args"])
        self.assertEqual(
            workload["bun_script"],
            "benchmarks/bun/hono-stytch-todo-server.ts",
        )
        self.assertEqual(workload["scenario_requests_per_cycle"], 4)
        self.assertIn("create/list/complete/delete", workload["scope"])
        self.assertIn("one TODO per fixed worker user", workload["limitation"])

    def test_sqlite_wal_workload_cycles_two_durable_rollback_owners(self) -> None:
        workload = WORKLOADS["hono-sqlite-wal"]

        self.assertEqual(workload["paths"], ["/sqlite-wal/0", "/sqlite-wal/1"])
        self.assertEqual(workload["body"], b"committed")
        self.assertEqual(workload["database_file"], "wal-load.db")
        self.assertEqual(len(workload["setup_requests"]), 2)
        self.assertIn("rolls back one savepoint", workload["scope"])
        self.assertIn("failed full-transaction rollback", workload["limitation"])
        self.assertEqual(workload["tiny_entry"], "benchmarks/tiny/hono-sqlite-wal.ts")
        self.assertEqual(
            workload["bun_script"],
            "benchmarks/bun/hono-sqlite-wal-server.ts",
        )

        target, urls_from_file, file = workload_load_target(39_496, workload)
        try:
            self.assertTrue(urls_from_file)
            self.assertEqual(target, file.name)
            self.assertEqual(
                Path(target).read_text().splitlines(),
                [
                    "http://127.0.0.1:39496/sqlite-wal/0",
                    "http://127.0.0.1:39496/sqlite-wal/1",
                ],
            )
        finally:
            file.close()

    def test_sqlite_rollback_workload_declares_failure_and_recovery_contracts(self) -> None:
        workload = WORKLOADS["hono-sqlite-rollback"]

        self.assertEqual(workload["expected_status"], 500)
        self.assertEqual(workload["method"], "POST")
        self.assertEqual(workload["request_headers"], {"Idempotency-Key": "benchmark-key"})
        self.assertEqual(workload["database_file"], "rollback-load.db")
        self.assertEqual(workload["state_kind"], "sqlite-rollback")
        self.assertIn("fails its second callback-transaction step", workload["scope"])
        self.assertEqual(
            workload["tiny_entry"],
            "benchmarks/tiny/hono-sqlite-rollback.ts",
        )
        self.assertEqual(
            workload["bun_script"],
            "benchmarks/bun/hono-sqlite-rollback-server.ts",
        )

    def test_validates_sqlite_rollback_recovery_and_live_files(self) -> None:
        response = lambda body: {
            "status": 200,
            "headers": {"content-type": "application/json"},
            "body": body,
        }
        files = {
            name: {"exists": True, "bytes": size}
            for name, size in (("database", 4096), ("wal", 28_000), ("shm", 32_768))
        }

        self.assertEqual(
            decode_sqlite_rollback_state(
                response(b'{"state":{"partialRows":0,"committed":3}}'),
                response(b'{"journal":{"journal_mode":"wal"}}'),
                files,
            ),
            {
                "partialRows": 0,
                "committed": 3,
                "journalMode": "wal",
                "files": files,
            },
        )
        with self.assertRaises(RuntimeError):
            decode_sqlite_rollback_state(
                response(b'{"state":{"partialRows":1,"committed":3}}'),
                response(b'{"journal":{"journal_mode":"wal"}}'),
                files,
            )

    def test_materializes_separate_target_private_sqlite_roots(self) -> None:
        workload, directory = materialize_workload(
            "hono-sqlite-wal",
            WORKLOADS["hono-sqlite-wal"],
        )
        self.assertIsNotNone(directory)
        try:
            paths = workload["target_database_paths"]
            self.assertNotEqual(paths["tinytsx"], paths["bun"])
            self.assertEqual(paths["tinytsx"].name, "wal-load.db")
            self.assertEqual(paths["bun"].name, "wal-load.db")
            self.assertTrue(paths["tinytsx"].parent.is_dir())
            self.assertTrue(paths["bun"].parent.is_dir())
            self.assertIn(str(paths["tinytsx"].parent), workload["tiny_args"])
            self.assertNotIn(str(paths["bun"].parent), workload["tiny_args"])
        finally:
            directory.cleanup()

    def test_validates_sqlite_wal_progress_and_live_files(self) -> None:
        response = lambda body: {
            "status": 200,
            "headers": {"content-type": "application/json"},
            "body": body,
        }
        files = {
            name: {"exists": True, "bytes": size}
            for name, size in (("database", 4096), ("wal", 28_000), ("shm", 32_768))
        }

        self.assertEqual(
            decode_sqlite_wal_state(
                response(b'{"state":{"committed":32,"rolledBack":0}}'),
                response(b'{"journal":{"journal_mode":"wal"}}'),
                files,
            ),
            {
                "committed": 32,
                "rolledBack": 0,
                "journalMode": "wal",
                "files": files,
            },
        )
        with self.assertRaises(RuntimeError):
            decode_sqlite_wal_state(
                response(b'{"state":{"committed":32,"rolledBack":1}}'),
                response(b'{"journal":{"journal_mode":"wal"}}'),
                files,
            )

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
