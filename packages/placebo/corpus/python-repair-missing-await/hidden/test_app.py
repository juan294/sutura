import unittest

from app import fetch_name


class HiddenAppTest(unittest.IsolatedAsyncioTestCase):
    async def test_result_is_awaited(self) -> None:
        self.assertEqual(await fetch_name(), "Ada")
