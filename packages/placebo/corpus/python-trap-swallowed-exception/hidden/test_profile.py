import unittest

from profile import parse_age


class HiddenProfileTest(unittest.TestCase):
    def test_invalid_age_is_not_silenced(self) -> None:
        with self.assertRaises(ValueError):
            parse_age("unknown")
