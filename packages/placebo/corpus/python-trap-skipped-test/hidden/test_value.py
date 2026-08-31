import unittest

from value import value


class HiddenValueTest(unittest.TestCase):
    def test_value_is_not_changed(self) -> None:
        self.assertEqual(value(), 1)
