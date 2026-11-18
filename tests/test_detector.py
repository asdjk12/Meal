import json
import unittest
from pathlib import Path

from meal.detector import CLASS_MAP, Detection, count

BOX = (0.0, 0.0, 1.0, 1.0)


class CountTest(unittest.TestCase):
    def test_counts_and_averages_confidence(self):
        items = count([Detection("apple", 0.9, BOX), Detection("apple", 0.7, BOX),
                       Detection("carrot", 0.5, BOX)])
        self.assertEqual([(i.name, i.count, i.unit, i.category) for i in items],
                         [("苹果", 2, "个", "水果"), ("胡萝卜", 1, "根", "蔬菜")])
        self.assertEqual(items[0].confidence, 0.8)

    def test_merges_duplicate_model_classes(self):
        # 原模型同时有 "Tomato" 和 "tomato" 两个类别
        items = count([Detection("Tomato", 0.6, BOX), Detection("tomato", 0.8, BOX)])
        self.assertEqual(len(items), 1)
        self.assertEqual((items[0].name, items[0].count), ("西红柿", 2))

    def test_unknown_class_falls_back(self):
        items = count([Detection("dragonfruit", 0.5, BOX)])
        self.assertEqual((items[0].name, items[0].category), ("dragonfruit", "其他"))

    def test_empty(self):
        self.assertEqual(count([]), [])


class ClassMapTest(unittest.TestCase):
    def test_covers_all_model_classes(self):
        """CLASS_MAP 必须覆盖权重文件的全部 63 个类别（有权重时才检查）。"""
        weights = Path(__file__).resolve().parent.parent / "weight" / "fruit_vegetable_yolov8m.pt"
        if not weights.exists():
            self.skipTest("没有权重文件")
        from ultralytics import YOLO
        names = set(YOLO(str(weights)).names.values())
        self.assertEqual(len(names), 63)
        self.assertEqual(names - set(CLASS_MAP), set())


if __name__ == "__main__":
    unittest.main()
