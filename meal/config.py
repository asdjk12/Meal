"""运行配置，全部从环境变量读取。"""

import os

DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "")
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com")

# deepseek-flash (V4.1-Flash) 支持 text + image 输入；deepseek-v4-pro 只支持文本。
VISION_MODEL = os.environ.get("MEAL_VISION_MODEL", "deepseek-flash")
TEXT_MODEL = os.environ.get("MEAL_TEXT_MODEL", "deepseek-flash")

# 上传前把图片长边压到这个尺寸，减少 token 和上传体积
IMAGE_MAX_SIDE = int(os.environ.get("MEAL_IMAGE_MAX_SIDE", "1568"))

REQUEST_TIMEOUT = float(os.environ.get("MEAL_REQUEST_TIMEOUT", "120"))
