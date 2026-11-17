import unittest

from meal.ingredients import _normalize


class NormalizeTest(unittest.TestCase):
    def test_merges_same_name_and_unit(self):
        out = _normalize({"ingredients": [
            {"name": "鸡蛋", "quantity": 2, "unit": "个", "category": "蛋奶", "confidence": 0.9},
            {"name": "鸡蛋", "quantity": 3, "unit": "个", "category": "蛋奶", "confidence": 0.6},
        ]})
        self.assertEqual(len(out), 1)
        self.assertEqual(out[0].quantity, 5)
        self.assertEqual(out[0].confidence, 0.9)

    def test_does_not_add_different_units(self):
        out = _normalize({"ingredients": [
            {"name": "猪肉", "quantity": 1, "unit": "斤", "category": "肉类", "confidence": 1},
            {"name": "猪肉", "quantity": 200, "unit": "克", "category": "肉类", "confidence": 1},
        ]})
        self.assertEqual(len(out), 1)
        self.assertEqual((out[0].quantity, out[0].unit), (1, "斤"))

    def test_drops_bad_entries_and_cleans_fields(self):
        out = _normalize({"ingredients": [
            {"name": ""},
            "garbage",
            {"name": " 西红柿 ", "quantity": "abc", "unit": "", "category": "未知类", "confidence": 5},
        ]})
        self.assertEqual(len(out), 1)
        ing = out[0]
        self.assertEqual(ing.name, "西红柿")
        self.assertIsNone(ing.quantity)
        self.assertIsNone(ing.unit)
        self.assertEqual(ing.category, "其他")
        self.assertEqual(ing.confidence, 1.0)

    def test_bad_shape_returns_empty(self):
        self.assertEqual(_normalize({"foo": 1}), [])
        self.assertEqual(_normalize([]), [])


if __name__ == "__main__":
    unittest.main()
