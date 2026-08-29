import unittest

from parser import parse_count


class ParserTest(unittest.TestCase):
    def test_returns_integer(self) -> None:
        self.assertIsInstance(parse_count(), int)
