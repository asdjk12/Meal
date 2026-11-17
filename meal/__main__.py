"""命令行入口：

    python -m meal image 冰箱.jpg [--hint "这是冷藏层"]
    python -m meal text "两个西红柿，半斤五花肉，还有几个鸡蛋"
"""

import argparse
import json
import sys

from .ingredients import parse_from_text, recognize_from_image


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")  # Windows 控制台输出中文

    parser = argparse.ArgumentParser(prog="meal", description="录入家里的食材")
    sub = parser.add_subparsers(dest="mode", required=True)

    p_img = sub.add_parser("image", help="上传图片识别食材")
    p_img.add_argument("path")
    p_img.add_argument("--hint", default="", help="补充说明，可选")

    p_txt = sub.add_parser("text", help="文字输入食材")
    p_txt.add_argument("text")

    args = parser.parse_args()
    if args.mode == "image":
        items = recognize_from_image(args.path, hint=args.hint)
    else:
        items = parse_from_text(args.text)

    print(json.dumps([i.to_dict() for i in items], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
