"""学生端首页「学习工具」小卡片 + 「问小鹰老师」入口卡的插画。

原来十张卡只用了 6 张图,「问小鹰老师 / 纸笔听写 / 句子背诵」三张共用一张发光大脑,
「线上课堂 / 加入班级」共用一张横幅,孩子扫一眼分不出哪个是哪个。现在每张卡按内容单独出一张,
画风统一用首页飞鹰那只折纸鹰(public/eagle-*.jpeg),米白底与首页背景 #FFF8F0 一致。

图里不写字: 生图模型画不准中文和单词,写错了更难看;卡片标题本来就在图下面。
出图中转忽略 size 参数,构图靠提示词;拿回来后裁到内容外框、按目标比例补米白边再缩放,
卡片是 object-cover,主体放在中间裁不掉。

Key 只从环境变量读(IMAGE_API_KEY,可选 IMAGE_API_URL / IMAGE_MODEL),不写进仓库。
用法(本机有 SOCKS 代理变量,httpx 会崩,所以 trust_env=False):
    IMAGE_API_KEY=sk-... venv/bin/python scripts/gen_student_tool_art.py            # 缺哪张出哪张
    IMAGE_API_KEY=sk-... venv/bin/python scripts/gen_student_tool_art.py --force    # 全部重出
    IMAGE_API_KEY=sk-... venv/bin/python scripts/gen_student_tool_art.py --only pk,live
"""
import argparse
import asyncio
import base64
import io
import os
import sys

import httpx
from PIL import Image, ImageChops

OUT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "frontend", "public", "tools",
)
API_URL = os.environ.get("IMAGE_API_URL", "https://hk.hueling.cc/v1/images/generations")
MODEL = os.environ.get("IMAGE_MODEL", "gpt-image-2.5-sunburst")
BG = (255, 248, 240)  # #FFF8F0 温暖米白

STYLE = (
    "Origami paper-craft illustration, the same friendly bald eagle mascot throughout: "
    "white folded-paper head, thin round gold-rimmed glasses, bright yellow-orange beak and feet, "
    "warm brown and tan folded-paper body. Crisp paper folds, soft studio lighting, warm palette "
    "(orange #FF6B35, sunshine yellow, sky blue accents). Plain solid warm cream background (#FFF8F0) "
    "edge to edge, no ground shadow, no frame. Absolutely no text, no letters, no numbers, no words, "
    "no watermark. Cute and suitable for children."
)
WIDE = ("Wide horizontal banner composition, about three times wider than tall: the eagle on the "
        "left-center and its props spread out to the right, everything kept in the middle band "
        "with empty cream space above and below.")
SQUARE = "Centered square composition, the eagle's upper body large in frame with a little margin."

# key -> (比例 w/h, 输出宽, 画面)
ART = {
    "live": (3.0, 960, "The eagle teacher appears on a big paper laptop screen, waving a wing, a small "
             "red paper dot glowing in the screen corner like a live light, a paper slide with simple "
             "shapes next to it."),
    "handwriting": (3.0, 960, "The eagle writes with a yellow pencil on a sheet of paper with four-line "
                    "handwriting guides (only squiggly lines, no readable letters), next to it a paper "
                    "smartphone takes a photo of the sheet with a small flash spark."),
    "sentences": (3.0, 960, "The eagle wears orange paper headphones and speaks happily, a row of three "
                  "linked paper speech bubbles (empty, no text) flows out to the right like a chain."),
    "join_class": (3.0, 960, "The eagle stands at an open paper classroom door holding a small paper "
                   "ticket with a key shape on it, three little origami birds hop through the door to "
                   "join."),
    "leaderboard": (3.0, 960, "The eagle stands on the top step of a three-step paper podium holding a "
                    "gold paper trophy, small paper stars and ribbons around."),
    "reading": (3.0, 960, "The eagle sits reading a big open pop-up storybook, paper trees, a little house "
                "and clouds rising out of the pages, a paper magnifying glass beside the book."),
    "competition": (3.0, 960, "The eagle slams a big round red paper buzzer button with one wing, a "
                    "paper stopwatch and a yellow paper lightning bolt beside it, energetic quiz-show mood."),
    "achievements": (3.0, 960, "The eagle proudly shows a paper shelf of shiny round medals and star badges "
                     "in gold, silver and orange, one medal hanging on its own neck."),
    "analytics": (3.0, 960, "The eagle points with a paper pointer stick at a paper bar chart that grows "
                  "taller step by step with an upward arrow, a small paper calendar beside it."),
    "pk": (3.0, 960, "Two origami eagles face each other in a friendly duel, one with an orange scarf and "
           "one with a sky-blue scarf, a crackling paper lightning spark between them, both smiling."),
    "homework_check": (3.0, 960, "The eagle teacher holds a big red paper pencil and happily checks a sheet of "
                       "homework paper covered in squiggly lines (no readable letters), drawing big red tick marks "
                       "and one small circle on it; a paper smartphone and a small paper webcam beside the sheet."),
    "tutor": (1.0, 512, "The eagle teacher smiles warmly and raises one wing as if answering a question, a "
              "big round sky-blue paper speech bubble with a paper question mark shape and a small paper "
              "lightbulb floating beside its head."),
}


async def request_image(client: httpx.AsyncClient, prompt: str, label: str, quality: str,
                        attempts: int = 4) -> bytes | None:
    """出图并取回字节。中转返回 b64_json 或 url 两种形态都要处理(见 memory: hueling b64)。"""
    payload = {"model": MODEL, "prompt": prompt, "n": 1, "size": "1536x1024", "quality": quality}
    key = os.environ["IMAGE_API_KEY"]
    for i in range(attempts):
        try:
            r = await client.post(API_URL, headers={"Authorization": f"Bearer {key}",
                                                    "Content-Type": "application/json"}, json=payload)
            if r.status_code == 200:
                item = (r.json().get("data") or [{}])[0]
                if item.get("b64_json"):
                    return base64.b64decode(item["b64_json"])
                if item.get("url"):
                    img = await client.get(item["url"])
                    if img.status_code == 200:
                        return img.content
                print(f"  !! {label} 200 但没有图片数据")
            else:
                print(f"  .. {label} 第{i + 1}次 HTTP {r.status_code} {r.text[:120]}")
        except Exception as e:  # 网络抖动/超时,重试
            print(f"  .. {label} 第{i + 1}次异常 {type(e).__name__}")
        if i < attempts - 1:
            await asyncio.sleep(min(5 * (i + 1), 15))
    return None


def fit(raw: bytes, ratio: float, width: int) -> Image.Image:
    """裁到内容外框,按目标比例补米白边,缩到目标尺寸。
    内容判据: 与四角取样的底色差得多的像素(底色不一定正好是 #FFF8F0)。"""
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    w, h = im.size
    corners = [im.getpixel((x, y)) for x, y in ((2, 2), (w - 3, 2), (2, h - 3), (w - 3, h - 3))]
    bg = tuple(sum(c[i] for c in corners) // 4 for i in range(3))
    # 任一通道与底色差 > 22 算内容(取三通道差的最大值)
    diff = ImageChops.difference(im, Image.new("RGB", im.size, bg)).split()
    mask = ImageChops.lighter(ImageChops.lighter(diff[0], diff[1]), diff[2]).point(lambda v: 255 if v > 22 else 0)
    bbox = mask.getbbox() or (0, 0, w, h)
    im = im.crop(bbox)
    # 主体占画布 88% 宽 / 84% 高(取先碰到的那条),四周留米白
    height = round(width / ratio)
    scale = min(width * 0.88 / im.width, height * 0.84 / im.height)
    im = im.resize((max(1, round(im.width * scale)), max(1, round(im.height * scale))), Image.LANCZOS)
    canvas = Image.new("RGB", (width, height), bg)
    canvas.paste(im, ((width - im.width) // 2, (height - im.height) // 2))
    return canvas


def save_verified(img: Image.Image, path: str) -> None:
    """写临时文件 → 真解码验证 → 原子替换(写一半的坏图浏览器还能显示一部分,只有解码抓得到)。"""
    tmp = path + ".tmp"
    img.save(tmp, format="JPEG", quality=86, optimize=True, progressive=True)
    with Image.open(tmp) as probe:
        probe.load()
    os.replace(tmp, path)


async def main(force: bool, only: list[str], quality: str, concurrency: int) -> None:
    if not os.environ.get("IMAGE_API_KEY"):
        sys.exit("先设环境变量 IMAGE_API_KEY")
    os.makedirs(OUT_DIR, exist_ok=True)
    keys = only or list(ART)
    unknown = [k for k in keys if k not in ART]
    if unknown:
        sys.exit(f"没有这几张: {unknown}")
    todo = [k for k in keys if force or only or not os.path.exists(os.path.join(OUT_DIR, f"{k}.jpg"))]
    if not todo:
        print("都在了,要重出加 --force")
        return
    sem = asyncio.Semaphore(concurrency)
    async with httpx.AsyncClient(timeout=300.0, trust_env=False) as client:
        async def one(key: str) -> bool:
            ratio, width, scene = ART[key]
            prompt = f"{scene} {WIDE if ratio > 1 else SQUARE} {STYLE}"
            async with sem:
                print(f"-> {key} 出图中")
                raw = await request_image(client, prompt, key, quality)
            if raw is None:
                print(f"  xx {key} 失败")
                return False
            path = os.path.join(OUT_DIR, f"{key}.jpg")
            save_verified(fit(raw, ratio, width), path)
            print(f"  ok {key} -> {path} ({os.path.getsize(path) // 1024} KB)")
            return True
        results = await asyncio.gather(*(one(k) for k in todo))
    if not all(results):
        sys.exit(1)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="已存在的也重出")
    ap.add_argument("--only", default="", help="逗号分隔,只出这几张(会覆盖)")
    ap.add_argument("--quality", default="low", choices=["low", "medium", "high"])
    ap.add_argument("-c", "--concurrency", type=int, default=4)
    a = ap.parse_args()
    asyncio.run(main(a.force, [k for k in a.only.split(",") if k], a.quality, a.concurrency))
