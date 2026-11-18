"""Web 服务：食材录入 API + 一个聊天式测试页面。

启动：python -m uvicorn meal.web:app --reload --port 8000
然后浏览器打开 http://localhost:8000
"""

from __future__ import annotations

import base64
import io
import time
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from PIL import Image
from pydantic import BaseModel

from .deepseek_client import DeepSeekError
from .ingredients import parse_from_text, recognize_from_image_with_preview

STATIC_DIR = Path(__file__).parent / "static"
MAX_IMAGE_BYTES = 20 * 1024 * 1024

app = FastAPI(title="Meal")


class TextIn(BaseModel):
    text: str


@app.get("/")
def index() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.post("/api/ingredients/text")
def ingredients_from_text(body: TextIn) -> dict:
    start = time.perf_counter()
    try:
        items = parse_from_text(body.text)
    except DeepSeekError as e:
        raise HTTPException(502, str(e))
    return _response(items, start)


@app.post("/api/ingredients/image")
async def ingredients_from_image(file: UploadFile = File(...)) -> dict:
    """本地 YOLO 果蔬检测。额外返回 preview：画好检测框的图片（data URL），方便测试时核对。"""
    data = await file.read()
    if not data:
        raise HTTPException(400, "图片为空")
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "图片超过 20MB")

    start = time.perf_counter()
    try:
        items, preview = await run_in_threadpool(recognize_from_image_with_preview, data)
    except OSError as e:  # Pillow 打不开的文件
        raise HTTPException(400, f"无法读取图片：{e}")
    resp = _response(items, start)
    resp["preview"] = _to_data_url(preview)
    return resp


def _response(items, start: float) -> dict:
    return {
        "ingredients": [i.to_dict() for i in items],
        "elapsed_ms": round((time.perf_counter() - start) * 1000),
    }


def _to_data_url(img: Image.Image, max_side: int = 1280) -> str:
    img = img.copy()
    img.thumbnail((max_side, max_side))
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()
