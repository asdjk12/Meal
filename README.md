# Meal

根据家里已有食材推荐餐食。

## 第一步：食材录入

两种方式，输出同一种结构（`meal.Ingredient`）：

| 方式 | 函数 | 模型 |
|---|---|---|
| 图片识别（冰箱 / 菜篮 / 小票照片） | `recognize_from_image(path_or_bytes, hint="")` | `deepseek-flash`（支持图片输入） |
| 文字输入（口语化描述） | `parse_from_text(text)` | `deepseek-flash` |

```bash
pip install -r requirements.txt
export DEEPSEEK_API_KEY=...
python -m meal image fridge.jpg --hint "冷藏层"
python -m meal text "两个番茄、半斤五花肉、几个鸡蛋"
python -m unittest discover -s tests -t .
```

可选环境变量：`MEAL_VISION_MODEL`、`MEAL_TEXT_MODEL`、`MEAL_IMAGE_MAX_SIDE`（默认 1568）、`MEAL_REQUEST_TIMEOUT`。
