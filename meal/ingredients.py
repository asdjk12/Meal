"""食材录入：图片识别（本地 YOLO）和 文字输入（DeepSeek）两种方式，输出统一的 Ingredient 列表。

两种方式输出同一种结构，后续落库 / 推荐逻辑不需要关心食材是怎么录入的。
"""

from __future__ import annotations

import io
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps

from . import config, detector
from .deepseek_client import chat_json

CATEGORIES = ["蔬菜", "水果", "肉类", "水产", "蛋奶", "豆制品", "主食", "调料", "其他"]


@dataclass
class Ingredient:
    name: str                      # 标准化名称，如 "西红柿"
    quantity: float | None         # 数量；无法判断时为 None
    unit: str | None               # 单位：个 / 克 / 斤 / 把 / 盒 ...
    category: str                  # CATEGORIES 之一
    confidence: float              # 0~1；图片为检测框平均置信度，文字输入通常为 1

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _schema_hint() -> str:
    return f"""只输出 JSON，所有文字用简体中文，格式：
{{
  "ingredients": [
    {{
      "name": "中文标准名称，去掉品牌和修饰词，如 西红柿、鸡蛋、五花肉",
      "quantity": 数字或 null,
      "unit": "单位，如 个/克/斤/把/盒/瓶/根/颗，未知则 null",
      "category": "{'/'.join(CATEGORIES)} 之一",
      "confidence": 0到1之间的数字
    }}
  ]
}}
同一种食材只出现一次（数量合并）。没有食材时返回 {{"ingredients": []}}。"""


_TEXT_SYSTEM = (
    "你是厨房食材录入助手。用户会用自然语言描述家里有哪些食材，可能口语化、有错别字、中英混杂。"
    "请抽取出所有食材，把俗称统一为标准名称（如 番茄→西红柿、洋芋/土豆→土豆），"
    "并解析数量和单位（如 \"半斤猪肉\" → quantity 0.5, unit 斤；\"几个鸡蛋\" → quantity null）。"
    "用户明确提到的食材 confidence 为 1；只是模糊提到的可以更低。"
    "不要添加用户没有提到的食材。\n" + _schema_hint()
)


# ---------- 公共入口 ----------

def recognize_from_image(image: str | Path | bytes) -> list[Ingredient]:
    """方式 1：本地 YOLO 检测图片中的果蔬并计数。

    只能识别 63 类果蔬（见 detector.CLASS_MAP）；鸡蛋、肉类、包装食品等识别不了，需要文字录入。
    image 可以是文件路径或图片字节。
    """
    items, _ = recognize_from_image_with_preview(image)
    return items


def recognize_from_image_with_preview(image: str | Path | bytes) -> tuple[list[Ingredient], Image.Image]:
    """同 recognize_from_image，额外返回画好检测框的预览图（测试页用）。"""
    dets, annotated = detector.detect(_load_image(image))
    items = [
        Ingredient(name=c.name, quantity=float(c.count), unit=c.unit,
                   category=c.category, confidence=c.confidence)
        for c in detector.count(dets)
    ]
    return items, annotated


def parse_from_text(text: str) -> list[Ingredient]:
    """方式 2：用户文字输入，由 DeepSeek 解析成结构化食材。"""
    text = text.strip()
    if not text:
        return []
    result = chat_json(
        [
            {"role": "system", "content": _TEXT_SYSTEM},
            {"role": "user", "content": text},
        ],
        model=config.TEXT_MODEL,
    )
    return _normalize(result)


# ---------- 内部工具 ----------

def _load_image(image: str | Path | bytes) -> Image.Image:
    """读图并按 EXIF 摆正（手机竖拍的照片原始像素是横的）。"""
    data = Path(image).read_bytes() if isinstance(image, (str, Path)) else image
    return ImageOps.exif_transpose(Image.open(io.BytesIO(data))).convert("RGB")


def _normalize(result: dict[str, Any]) -> list[Ingredient]:
    """校验并清洗模型输出；坏条目直接丢弃，重名条目合并。"""
    items = result.get("ingredients") if isinstance(result, dict) else None
    if not isinstance(items, list):
        return []

    merged: dict[str, Ingredient] = {}
    for raw in items:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()
        if not name:
            continue

        ing = Ingredient(
            name=name,
            quantity=_to_float(raw.get("quantity")),
            unit=(str(raw["unit"]).strip() or None) if raw.get("unit") else None,
            category=raw.get("category") if raw.get("category") in CATEGORIES else "其他",
            confidence=min(max(_to_float(raw.get("confidence")) or 0.0, 0.0), 1.0),
        )

        prev = merged.get(name)
        if prev is None:
            merged[name] = ing
        elif prev.unit == ing.unit and prev.quantity is not None and ing.quantity is not None:
            prev.quantity += ing.quantity
            prev.confidence = max(prev.confidence, ing.confidence)
        # 单位不同或数量未知时保留第一条，避免错误相加

    return list(merged.values())


def _to_float(v: Any) -> float | None:
    if v is None or isinstance(v, bool):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None
