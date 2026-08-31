import unittest

from profile import parse_age


class ProfileTest(unittest.TestCase):
    def test_parses_age(self) -> None:
        self.assertEqual(parse_age("42"), 42)
