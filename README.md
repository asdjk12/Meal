# Meal

根据家里已有食材推荐餐食。

## 第一步：食材录入

两种方式，输出同一种结构（`meal.Ingredient`：name / quantity / unit / category / confidence）：

| 方式 | 函数 | 实现 |
|---|---|---|
| 图片识别 | `recognize_from_image(path_or_bytes)` | 本地 YOLOv8m 果蔬检测（63 类），按检测框计数 |
| 文字输入 | `parse_from_text(text)` | DeepSeek `deepseek-flash` |

图片识别**只认识果蔬**（类别见 [meal/detector.py](meal/detector.py) 的 `CLASS_MAP`），鸡蛋、肉类、包装食品等请用文字录入。

### 安装

```bash
pip install torch torchvision --index-url https://download.pytorch.org/whl/cpu
pip install -r requirements.txt
```

权重文件放在 `weight/`（不进 git）：

- `weight/fruit_vegetable_yolov8m.pt`：<https://huggingface.co/Senu-12/snapstock-fruit-vegetable-detector>（`yolov8/fruit_vegetable_yolov8m.pt`）。原始来源是 Henning Heyen 的 Fruits-And-Vegetables-Detection-Dataset，许可证标注为 other，商用前需确认。

文字录入需要环境变量 `DEEPSEEK_API_KEY`。

### 测试页面（聊天式 UI）

```bash
python -m uvicorn meal.web:app --reload --port 8000
```

打开 http://localhost:8000 ：输入文字，或点 📎 / 粘贴 / 拖入果蔬照片；图片结果会附带画好检测框的预览图。

API：`POST /api/ingredients/text` `{"text": "..."}`；`POST /api/ingredients/image`（multipart：`file`，响应里 `preview` 为检测框预览图）。

### 命令行

```bash
python -m meal image fruits.jpg --save detected.jpg
python -m meal text "两个番茄、半斤五花肉、几个鸡蛋"
python -m unittest discover -s tests -t .
```

可选环境变量：`MEAL_YOLO_WEIGHTS`（权重路径）、`MEAL_YOLO_CONF`（置信度阈值，默认 0.3）、`MEAL_TEXT_MODEL`、`MEAL_REQUEST_TIMEOUT`。
