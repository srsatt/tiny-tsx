import sys
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from scenario_metrics import percentile, validate_stytch_todo_response  # noqa: E402


class ScenarioMetricsTest(unittest.TestCase):
    def test_uses_nearest_rank_latency_percentiles(self) -> None:
        values = [1.0, 2.0, 3.0, 4.0, 5.0]

        self.assertEqual(percentile(values, 0.5), 3.0)
        self.assertEqual(percentile(values, 0.99), 5.0)

    def test_validates_every_todo_crud_response_shape(self) -> None:
        created = b'{"todos":[{"id":"123","text":"bench-0","completed":false}]}'
        completed = b'{"todos":[{"id":"123","text":"bench-0","completed":true}]}'

        todo_id = validate_stytch_todo_response("create", created, "bench-0")
        self.assertEqual(todo_id, "123")
        self.assertEqual(
            validate_stytch_todo_response("list", created, "bench-0", todo_id),
            todo_id,
        )
        self.assertEqual(
            validate_stytch_todo_response("complete", completed, "bench-0", todo_id),
            todo_id,
        )
        self.assertIsNone(
            validate_stytch_todo_response("delete", b'{"todos":[]}', "bench-0", todo_id),
        )

    def test_rejects_a_silent_crud_state_mismatch(self) -> None:
        with self.assertRaises(RuntimeError):
            validate_stytch_todo_response(
                "complete",
                b'{"todos":[{"id":"123","text":"bench-0","completed":false}]}',
                "bench-0",
                "123",
            )


if __name__ == "__main__":
    unittest.main()
