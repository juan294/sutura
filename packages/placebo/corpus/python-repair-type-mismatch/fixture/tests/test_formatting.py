import unittest

from formatting import format_count


class FormattingTest(unittest.TestCase):
    def test_formats_count(self) -> None:
        self.assertEqual(format_count(7), "7")
