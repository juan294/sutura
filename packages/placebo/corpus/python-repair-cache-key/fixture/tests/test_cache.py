import unittest

from cache import cache_key


class CacheTest(unittest.TestCase):
    def test_namespaces_keys(self) -> None:
        self.assertNotEqual(cache_key("a", "item"), cache_key("b", "item"))
