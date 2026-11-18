"""运行配置，全部从环境变量读取。"""

import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent

# ---------- 文字录入：DeepSeek ----------
DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
TEXT_MODEL = os.environ.get("MEAL_TEXT_MODEL", "deepseek-flash")
REQUEST_TIMEOUT = float(os.environ.get("MEAL_REQUEST_TIMEOUT", "120"))

# ---------- 图片录入：本地 YOLO 果蔬检测 ----------
YOLO_WEIGHTS = Path(os.environ.get(
    "MEAL_YOLO_WEIGHTS", PROJECT_ROOT / "weight" / "fruit_vegetable_yolov8m.pt"))
# 置信度阈值。实测冰箱照片：苹果 0.35~0.92，误检的"大蒜"最高 0.2
YOLO_CONF = float(os.environ.get("MEAL_YOLO_CONF", "0.3"))
