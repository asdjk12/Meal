"""DeepSeek Chat Completions（OpenAI 兼容格式）的最小封装。"""

from __future__ import annotations

import json
from typing import Any

import requests

from . import config


class DeepSeekError(RuntimeError):
    pass


def chat_json(messages: list[dict[str, Any]], model: str) -> dict[str, Any]:
    """调用 chat/completions，要求模型返回 JSON 对象，并解析成 dict。"""
    if not config.DEEPSEEK_API_KEY:
        raise DeepSeekError("缺少环境变量 DEEPSEEK_API_KEY")

    resp = requests.post(
        f"{config.DEEPSEEK_BASE_URL}/chat/completions",
        headers={"Authorization": f"Bearer {config.DEEPSEEK_API_KEY}"},
        json={
            "model": model,
            "messages": messages,
            "response_format": {"type": "json_object"},
            "temperature": 0.1,
        },
        timeout=config.REQUEST_TIMEOUT,
    )
    if resp.status_code != 200:
        raise DeepSeekError(f"DeepSeek API {resp.status_code}: {resp.text[:500]}")

    content = resp.json()["choices"][0]["message"].get("content") or ""
    try:
        return json.loads(content)
    except json.JSONDecodeError as e:
        raise DeepSeekError(f"模型没有返回合法 JSON: {content[:500]}") from e
