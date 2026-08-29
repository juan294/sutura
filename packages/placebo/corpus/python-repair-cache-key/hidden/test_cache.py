import unittest

from cache import cache_key


class HiddenCacheTest(unittest.TestCase):
    def test_key_contains_both_parts(self) -> None:
        self.assertEqual(cache_key("users", "42"), "users:42")
