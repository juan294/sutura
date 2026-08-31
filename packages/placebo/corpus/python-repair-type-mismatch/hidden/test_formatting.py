import unittest

from formatting import format_count


class HiddenFormattingTest(unittest.TestCase):
    def test_preserves_string_type(self) -> None:
        self.assertIsInstance(format_count(0), str)
