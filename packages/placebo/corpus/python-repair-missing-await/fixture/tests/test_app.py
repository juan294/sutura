import unittest

from app import fetch_name


class AppTest(unittest.IsolatedAsyncioTestCase):
    async def test_fetches_name(self) -> None:
        self.assertEqual(await fetch_name(), "Ada")
