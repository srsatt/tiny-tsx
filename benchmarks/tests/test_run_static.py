import sys
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from run_static import normalize_content_type  # noqa: E402


class StaticHarnessTest(unittest.TestCase):
    def test_normalizes_equivalent_content_type_spelling(self) -> None:
        self.assertEqual(
            normalize_content_type("text/plain; charset=UTF-8"),
            normalize_content_type("text/plain;charset=utf-8"),
        )
