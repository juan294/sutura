import unittest

from value import value


class ValueTest(unittest.TestCase):
    def test_value(self) -> None:
        self.assertEqual(value(), 1)
