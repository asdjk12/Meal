"""食材录入：图片识别 和 文字输入 两种方式，输出统一的 Ingredient 列表。

两种方式输出同一种结构，后续落库 / 推荐逻辑不需要关心食材是怎么录入的。
"""

from __future__ import annotations

import base64
import io
import mimetypes
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from . import config
from .deepseek_client import chat_json

CATEGORIES = ["蔬菜", "水果", "肉类", "水产", "蛋奶", "豆制品", "主食", "调料", "其他"]


@dataclass
class Ingredient:
    name: str                      # 标准化名称，如 "西红柿"
    quantity: float | None         # 数量；无法判断时为 None
    unit: str | None               # 单位：个 / 克 / 斤 / 把 / 盒 ...
    category: str                  # CATEGORIES 之一
    confidence: float              # 0~1；文字输入通常为 1

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


_SCHEMA_HINT = f"""只输出 JSON，格式：
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

_IMAGE_SYSTEM = (
    "你是厨房食材识别助手。用户会上传冰箱、橱柜、菜篮或购物小票的照片。"
    "请识别图中所有可用于做饭的食材，估计数量。"
    "忽略餐具、容器、非食品物品；包装食品按其内容物识别（如一盒牛奶 → 牛奶）。"
    "看不清或不确定的给出较低 confidence，不要编造图中没有的东西。\n" + _SCHEMA_HINT
)

_TEXT_SYSTEM = (
    "你是厨房食材录入助手。用户会用自然语言描述家里有哪些食材，可能口语化、有错别字、中英混杂。"
    "请抽取出所有食材，把俗称统一为标准名称（如 番茄→西红柿、洋芋/土豆→土豆），"
    "并解析数量和单位（如 \"半斤猪肉\" → quantity 0.5, unit 斤；\"几个鸡蛋\" → quantity null）。"
    "用户明确提到的食材 confidence 为 1；只是模糊提到的可以更低。"
    "不要添加用户没有提到的食材。\n" + _SCHEMA_HINT
)


# ---------- 公共入口 ----------

def recognize_from_image(image: str | Path | bytes, mime: str | None = None,
                         hint: str = "") -> list[Ingredient]:
    """方式 1：视觉模型识别图片中的食材。

    image 可以是文件路径或图片字节；hint 是用户可选的补充说明（如 "这是冷冻层"）。
    """
    data, mime = _load_image(image, mime)
    data, mime = _downscale(data, mime)
    data_url = f"data:{mime};base64,{base64.b64encode(data).decode()}"

    user_text = "识别这张图里的食材。"
    if hint:
        user_text += f" 补充说明：{hint}"

    result = chat_json(
        [
            {"role": "system", "content": _IMAGE_SYSTEM},
            {"role": "user", "content": [
                {"type": "text", "text": user_text},
                {"type": "image_url", "image_url": {"url": data_url}},
            ]},
        ],
        model=config.VISION_MODEL,
    )
    return _normalize(result)


def parse_from_text(text: str) -> list[Ingredient]:
    """方式 2：用户文字输入，由模型解析成结构化食材。"""
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

def _load_image(image: str | Path | bytes, mime: str | None) -> tuple[bytes, str]:
    if isinstance(image, (str, Path)):
        path = Path(image)
        data = path.read_bytes()
        mime = mime or mimetypes.guess_type(path.name)[0]
    else:
        data = image
    return data, mime or "image/jpeg"


def _downscale(data: bytes, mime: str) -> tuple[bytes, str]:
    """长边超过 IMAGE_MAX_SIDE 时等比缩小并转成 JPEG；没装 Pillow 就原样返回。"""
    try:
        from PIL import Image, ImageOps
    except ImportError:
        return data, mime

    img = Image.open(io.BytesIO(data))
    img = ImageOps.exif_transpose(img)  # 手机照片按 EXIF 方向摆正
    if max(img.size) <= config.IMAGE_MAX_SIDE and mime in ("image/jpeg", "image/png", "image/webp"):
        return data, mime

    img.thumbnail((config.IMAGE_MAX_SIDE, config.IMAGE_MAX_SIDE))
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=85)
    return buf.getvalue(), "image/jpeg"


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
