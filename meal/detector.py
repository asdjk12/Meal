"""本地 YOLO 果蔬检测（Senu-12 / LVIS Fruits and Vegetables，YOLOv8m，63 类）。

只认识果蔬，不认识鸡蛋、肉类、包装食品等——这些请用文字录入。
"""

from __future__ import annotations

import threading
from collections import defaultdict
from dataclasses import dataclass
from typing import Iterable

from PIL import Image

from . import config

# 模型类别名 → (中文名, 分类, 单位)
# 原模型有重复类别（Tomato/tomato、Strawberry/strawberry），映射到同一个中文名后会合并计数。
CLASS_MAP: dict[str, tuple[str, str, str]] = {
    "almond": ("杏仁", "其他", "颗"),
    "apple": ("苹果", "水果", "个"),
    "apricot": ("杏", "水果", "个"),
    "artichoke": ("洋蓟", "蔬菜", "个"),
    "asparagus": ("芦笋", "蔬菜", "根"),
    "avocado": ("牛油果", "水果", "个"),
    "banana": ("香蕉", "水果", "根"),
    "bean curd/tofu": ("豆腐", "豆制品", "块"),
    "bell pepper/capsicum": ("彩椒", "蔬菜", "个"),
    "blackberry": ("黑莓", "水果", "颗"),
    "blueberry": ("蓝莓", "水果", "颗"),
    "broccoli": ("西兰花", "蔬菜", "颗"),
    "brussels sprouts": ("抱子甘蓝", "蔬菜", "颗"),
    "cantaloup/cantaloupe": ("哈密瓜", "水果", "个"),
    "carrot": ("胡萝卜", "蔬菜", "根"),
    "cauliflower": ("菜花", "蔬菜", "颗"),
    "cayenne/cayenne spice/cayenne pepper/cayenne pepper spice/red pepper/red pepper":
        ("红辣椒", "蔬菜", "个"),
    "celery": ("芹菜", "蔬菜", "根"),
    "cherry": ("樱桃", "水果", "颗"),
    "chickpea/garbanzo": ("鹰嘴豆", "其他", "颗"),
    "chili/chili vegetable/chili pepper/chili pepper vegetable/chilli/chilli vegetable/chilly/chilly":
        ("辣椒", "蔬菜", "个"),
    "clementine": ("小柑橘", "水果", "个"),
    "coconut/cocoanut": ("椰子", "水果", "个"),
    "edible corn/corn/maize": ("玉米", "蔬菜", "根"),
    "cucumber/cuke": ("黄瓜", "蔬菜", "根"),
    "date/date fruit": ("枣", "水果", "颗"),
    "eggplant/aubergine": ("茄子", "蔬菜", "个"),
    "fig/fig fruit": ("无花果", "水果", "个"),
    "garlic/ail": ("大蒜", "蔬菜", "头"),
    "ginger/gingerroot": ("姜", "蔬菜", "块"),
    "Strawberry": ("草莓", "水果", "颗"),
    "gourd": ("葫芦瓜", "蔬菜", "个"),
    "grape": ("葡萄", "水果", "颗"),
    "green bean": ("四季豆", "蔬菜", "根"),
    "green onion/spring onion/scallion": ("葱", "蔬菜", "根"),
    "Tomato": ("西红柿", "蔬菜", "个"),
    "kiwi fruit": ("猕猴桃", "水果", "个"),
    "lemon": ("柠檬", "水果", "个"),
    "lettuce": ("生菜", "蔬菜", "颗"),
    "lime": ("青柠", "水果", "个"),
    "mandarin orange": ("橘子", "水果", "个"),
    "melon": ("甜瓜", "水果", "个"),
    "mushroom": ("蘑菇", "蔬菜", "个"),
    "onion": ("洋葱", "蔬菜", "个"),
    "orange/orange fruit": ("橙子", "水果", "个"),
    "papaya": ("木瓜", "水果", "个"),
    "pea/pea food": ("豌豆", "蔬菜", "颗"),
    "peach": ("桃子", "水果", "个"),
    "pear": ("梨", "水果", "个"),
    "persimmon": ("柿子", "水果", "个"),
    "pickle": ("酸黄瓜", "其他", "根"),
    "pineapple": ("菠萝", "水果", "个"),
    "potato": ("土豆", "蔬菜", "个"),
    "prune": ("西梅", "水果", "颗"),
    "pumpkin": ("南瓜", "蔬菜", "个"),
    "radish/daikon": ("萝卜", "蔬菜", "根"),
    "raspberry": ("树莓", "水果", "颗"),
    "strawberry": ("草莓", "水果", "颗"),
    "sweet potato": ("红薯", "蔬菜", "个"),
    "tomato": ("西红柿", "蔬菜", "个"),
    "turnip": ("芜菁", "蔬菜", "个"),
    "watermelon": ("西瓜", "水果", "个"),
    "zucchini/courgette": ("西葫芦", "蔬菜", "根"),
}


@dataclass
class Detection:
    cls: str                                # 模型原始类别名
    conf: float
    box: tuple[float, float, float, float]  # 像素坐标 x1, y1, x2, y2


@dataclass
class CountedItem:
    name: str
    unit: str
    category: str
    count: int
    confidence: float   # 该类所有框置信度的平均值


_model = None
_model_lock = threading.Lock()


def _get_model():
    """懒加载模型（首次约 1~2 秒），之后复用。"""
    global _model
    if _model is None:
        with _model_lock:
            if _model is None:
                from ultralytics import YOLO  # 延迟导入：torch 很重，只在用到时加载
                if not config.YOLO_WEIGHTS.exists():
                    raise FileNotFoundError(f"找不到 YOLO 权重文件：{config.YOLO_WEIGHTS}")
                _model = YOLO(str(config.YOLO_WEIGHTS))
    return _model


def detect(img: Image.Image) -> tuple[list[Detection], Image.Image]:
    """检测图中的果蔬，返回检测框和画好框的预览图。"""
    model = _get_model()
    # agnostic_nms：同一个物体被识别成两个类别（如苹果/番茄）时只保留置信度高的那个
    res = model.predict(img, conf=config.YOLO_CONF, agnostic_nms=True, verbose=False)[0]
    dets = [
        Detection(cls=res.names[int(b.cls)], conf=float(b.conf), box=tuple(map(float, b.xyxy[0])))
        for b in res.boxes
    ]
    annotated = Image.fromarray(res.plot()[..., ::-1])  # plot() 返回 BGR
    return dets, annotated


def count(dets: Iterable[Detection]) -> list[CountedItem]:
    """按中文名合并计数；不在映射表里的类别直接用英文名，归为"其他"。"""
    groups: dict[str, list[float]] = defaultdict(list)
    meta: dict[str, tuple[str, str]] = {}
    for d in dets:
        name, category, unit = CLASS_MAP.get(d.cls, (d.cls, "其他", "个"))
        groups[name].append(d.conf)
        meta[name] = (category, unit)

    items = [
        CountedItem(name=name, unit=meta[name][1], category=meta[name][0],
                    count=len(confs), confidence=round(sum(confs) / len(confs), 2))
        for name, confs in groups.items()
    ]
    items.sort(key=lambda i: -i.count)
    return items
