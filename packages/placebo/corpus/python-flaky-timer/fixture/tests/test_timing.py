import os
import unittest

from timing import completed_before_deadline


class TimingTest(unittest.TestCase):
    def test_completes_before_deadline(self) -> None:
        attempt = int(os.environ.get("SUTURA_TRIAGE_ATTEMPT", "0"))
        self.assertTrue(completed_before_deadline(attempt))
