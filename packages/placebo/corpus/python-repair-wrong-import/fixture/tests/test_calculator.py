import unittest

from calculator import next_value


class CalculatorTest(unittest.TestCase):
    def test_next_value(self) -> None:
        self.assertEqual(next_value(4), 5)
