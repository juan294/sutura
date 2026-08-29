import pathlib
import unittest

from parser import parse_count


class HiddenParserTest(unittest.TestCase):
    def test_has_no_broad_suppression(self) -> None:
        self.assertNotIn("# type: ignore", pathlib.Path("parser.py").read_text())
        self.assertEqual(parse_count(), 42)
