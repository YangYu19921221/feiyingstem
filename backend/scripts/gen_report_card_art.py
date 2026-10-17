"""学习报告图(分类学习结算页「生成学习报告」)的三张吉祥物插画。

报告本身在浏览器里用 canvas 画(文字、单词、分数都来自孩子本次的真实作答),
AI 只负责这三张**不含文字**的插画 —— 生图模型画不准中文和单词表,而且每张 15-60 秒、
按张计费,不能每次学完都现出一张。所以这里一次出好、存成静态图,报告按成绩档位选一张。

三档(与 utils/learningReport.ts 的 tierOf 同口径,门槛跟结算页的段位 90/60 对齐,
孩子在结算页看到「优秀」、家长在报告里看到的也是同一档):
    excellent  一次拼对率 >= 90
    good       60 – 89
    keep       < 60

画风贴着现有的折纸鹰(public/eagle-studying.jpeg),家长看到的是同一只吉祥物。
出白底图、不抠透明: 报告里把它画进白色圆形徽章,白底与徽章融为一体,没有抠图毛边的风险
(见 memory: hueling 透明底会 500、flood-fill 会吃掉鹰头的浅色羽毛)。

用法(本机有 SOCKS 代理变量,httpx 会崩,所以 trust_env=False):
    venv/bin/python scripts/gen_report_card_art.py           # 缺哪张出哪张
    venv/bin/python scripts/gen_report_card_art.py --force   # 全部重出
"""
import argparse
import asyncio
import base64
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import httpx  # noqa: E402
from PIL import Image  # noqa: E402

from app.core.config import settings  # noqa: E402

OUT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
    "frontend", "public", "report-card",
)
SIZE = 512  # 报告里徽章直径 ~260 逻辑像素 × 2 倍图

STYLE = (
    "origami paper-craft illustration of a friendly bald eagle mascot wearing thin round "
    "gold-rimmed glasses, body made of neatly folded paper in cream white, warm brown and tan, "
    "bright yellow-orange beak and feet, crisp paper folds, soft studio lighting, full body, "
    "centered with generous empty margin around the character, pure solid white background, "
    "no text, no letters, no numbers, no watermark, no ground shadow, cute and suitable for children"
)

ART = {
    "excellent": "The eagle stands proudly holding a shiny gold paper trophy cup above its head "
                 "with both wings, a few small yellow paper stars floating around it, joyful expression.",
    "good": "The eagle stands smiling and gives a thumbs-up with one wing while holding an open "
            "orange paper book under the other wing, cheerful expression.",
    "keep": "The eagle sits at a small paper desk writing in an open notebook with a yellow pencil, "
            "focused and encouraging smile.",
}


async def request_image(client: httpx.AsyncClient, prompt: str, label: str, attempts: int = 5) -> bytes | None:
    """出图并取回字节。中转返回 b64_json 或 url 两种形态都要处理(见 memory: hueling b64)。"""
    payload = {"model": settings.IMAGE_MODEL, "prompt": prompt, "n": 1,
               "size": "1024x1024", "quality": "medium"}
    for i in range(attempts):
        try:
            r = await client.post(
                settings.IMAGE_API_URL,
                headers={"Authorization": f"Bearer {settings.IMAGE_API_KEY}",
                         "Content-Type": "application/json"},
                json=payload,
            )
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
                print(f"  .. {label} 第{i + 1}次 HTTP {r.status_code},重试")
        except Exception as e:  # 网络抖动/超时,重试
            print(f"  .. {label} 第{i + 1}次异常 {type(e).__name__},重试")
        if i < attempts - 1:
            await asyncio.sleep(min(4 * (i + 1), 15))
    return None


def fit_square(raw: bytes) -> Image.Image:
    """裁到非白内容的外框、留 6% 白边、补成正方形再缩到 SIZE。
    报告把它画进圆形徽章,内容贴边的话圆角会切掉翅膀尖。"""
    im = Image.open(io.BytesIO(raw)).convert("RGB")
    gray = im.convert("L").point(lambda v: 255 if v < 245 else 0)
    bbox = gray.getbbox() or (0, 0, im.width, im.height)
    im = im.crop(bbox)
    side = int(max(im.width, im.height) * 1.12)
    canvas = Image.new("RGB", (side, side), (255, 255, 255))
    canvas.paste(im, ((side - im.width) // 2, (side - im.height) // 2))
    return canvas.resize((SIZE, SIZE), Image.LANCZOS)


def save_verified(img: Image.Image, path: str) -> None:
    """写临时文件 → 真解码验证 → 原子替换(写一半的坏图浏览器还能显示一部分,只有解码抓得到)。"""
    tmp = path + ".tmp"
    img.save(tmp, format="JPEG", quality=88, optimize=True, progressive=True)
    with Image.open(tmp) as probe:
        probe.load()
    os.replace(tmp, path)


async def main(force: bool) -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    if not settings.IMAGE_API_KEY:
        sys.exit("IMAGE_API_KEY 未配置(backend/.env)")
    todo = [k for k in ART if force or not os.path.exists(os.path.join(OUT_DIR, f"{k}.jpg"))]
    if not todo:
        print("三张都在了,要重出加 --force")
        return
    async with httpx.AsyncClient(timeout=300.0, trust_env=False) as client:
        async def one(key: str) -> bool:
            print(f"-> {key} 出图中")
            raw = await request_image(client, f"{ART[key]} {STYLE}", key)
            if raw is None:
                print(f"  xx {key} 失败")
                return False
            path = os.path.join(OUT_DIR, f"{key}.jpg")
            save_verified(fit_square(raw), path)
            print(f"  ok {key} -> {path} ({os.path.getsize(path) // 1024} KB)")
            return True
        results = await asyncio.gather(*(one(k) for k in todo))
    if not all(results):
        sys.exit(1)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="已存在的也重出")
    asyncio.run(main(ap.parse_args().force))
