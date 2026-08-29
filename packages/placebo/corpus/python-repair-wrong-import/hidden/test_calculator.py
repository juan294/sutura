import unittest

from calculator import next_value


class HiddenCalculatorTest(unittest.TestCase):
    def test_multiple_values(self) -> None:
        self.assertEqual([next_value(0), next_value(9)], [1, 10])
