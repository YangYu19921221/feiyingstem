"""补 5 个物种的重复立绘。

问题:这 5 个物种的进化形态复用了同一张图,学生进化后立绘不变、毫无成就感。
- eevee(伊布):三个形态全是 eevee.png —— 最严重
- jigglypuff / vulpix / growlithe / magikarp:中间形态复用了基础形态图
  (这几只宝可梦原设只有 2 阶进化,系统固定 3 形态就凑了重复图)

策略:
- 伊布用它真实的进化(雷之伊布 / 火之伊布),形象有据可依
- 其余 4 只出「成长版」:同一只但体型更大、气场更足,和基础形态明显区分

出图:走项目现有的 image_service(gpt-image-2 / hueling 中转)。
中转返回 b64 或 url 两种都兼容;背景要白底再本地抠图(直接要 transparent 会
触发上游 500,这坑踩过)。产物 475x475 透明底 PNG,与现有立绘一致。

用法:
    python scripts/gen_pet_midforms.py --list          # 只看要生成什么
    python scripts/gen_pet_midforms.py --only eevee_thunder
    python scripts/gen_pet_midforms.py                 # 全部生成
已存在的文件默认跳过(可 --force 覆盖),支持断点续跑。
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
    "frontend", "public", "pets",
)

# 统一画风:对齐现有立绘(官方风、干净描边、扁平上色、白底、全身站姿)
STYLE = (
    "cute cartoon monster mascot illustration, clean bold outlines, flat cel shading, "
    "bright saturated colors, full body, standing three-quarter side view, facing left, "
    "centered, pure solid white background, no text, no watermark, no shadow on ground, "
    "friendly appearance suitable for children"
)

# ⚠️ 提示词里绝对不要写具体宝可梦角色名(Jolteon/Flareon/Vulpix…):
# 实测上游会因版权过滤直接返回 500 Upstream gateway error。
# "Pokemon" 这个词本身可用,但具体角色名不行 → 全部改成纯描述性外观。
TARGETS = [
    # 伊布的两个进化:按电系/火系外观描述
    dict(key="eevee_thunder", file="eevee_thunder.png",
         subject="a yellow electric fox-like creature with bristling spiky fur, "
                 "a white spiky ruffled collar, large expressive eyes, long ears, "
                 "crackling with energy, alert energetic stance"),
    dict(key="eevee_flame", file="eevee_flame.png",
         subject="a red-orange fluffy fox-like creature with a flame-shaped cream mane, "
                 "a big bushy cream tail, large expressive eyes, warm confident stance"),
    # 其余 4 只:成长版(比基础形态更大更精悍)
    dict(key="vulpix_grown", file="vulpix_grown.png",
         subject="a young six-tailed fox creature with reddish-brown fur and curled "
                 "orange-cream tails, sturdy build, confident stance, tails full and fluffy"),
    dict(key="growlithe_grown", file="growlithe_grown.png",
         subject="an orange puppy-like creature with black tiger stripes and a fluffy "
                 "cream mane and tail, taller and more muscular build, brave alert stance"),
    dict(key="magikarp_grown", file="magikarp_grown.png",
         subject="a large orange fish creature with big shiny scales, long white whisker "
                 "barbels and stiff fins, strong-looking, splashing upward energetically"),
    dict(key="jigglypuff_grown", file="jigglypuff_grown.png",
         subject="a round pink balloon-like creature with big blue eyes and a curled "
                 "tuft of hair on its forehead, short arms, cheerful singing pose"),
]


async def _request_image(prompt: str, attempts: int = 6) -> bytes | None:
    """调中转出图,返回原始图片字节。兼容 b64_json 与 url 两种返回。

    ⚠️ 中转会**间歇性**返回 500 Upstream gateway error —— 同一个 prompt 可能这次挂
    下次就成,和内容/长度无关(实测同一请求重复发,结果不稳定)。所以必须重试而不是
    改 prompt。这里退避重试到 attempts 次。
    trust_env=False:本机 SOCKS 代理会让 httpx 崩,必须绕开环境代理。
    """
    if not settings.IMAGE_API_KEY:
        print("  !! IMAGE_API_KEY 未配置")
        return None
    payload = {
        "model": settings.IMAGE_MODEL,
        "prompt": prompt,
        "size": "1024x1024",
        "quality": "low",   # 立绘用 low 足够,快且省
        "n": 1,
    }
    async with httpx.AsyncClient(timeout=200.0, trust_env=False) as client:
        for i in range(attempts):
            try:
                r = await client.post(
                    settings.IMAGE_API_URL,
                    headers={"Authorization": f"Bearer {settings.IMAGE_API_KEY}",
                             "Content-Type": "application/json"},
                    json=payload,
                )
                if r.status_code == 200:
                    item = ((r.json().get("data") or [{}])[0])
                    if item.get("b64_json"):
                        return base64.b64decode(item["b64_json"])
                    if item.get("url"):
                        img = await client.get(item["url"])
                        if img.status_code == 200:
                            return img.content
                    print("  !! 200 但无图片数据")
                else:
                    print(f"  .. 第{i+1}次 HTTP {r.status_code},重试中")
            except Exception as e:
                print(f"  .. 第{i+1}次异常 {type(e).__name__},重试中")
            if i < attempts - 1:
                await asyncio.sleep(min(3 * (i + 1), 15))
    return None


def _to_transparent_475(raw: bytes) -> Image.Image:
    """白底图 → 透明底 475x475(四角 flood fill,只抠外围白,保留内部白色部位)。"""
    im = Image.open(io.BytesIO(raw)).convert("RGBA")
    w, h = im.size
    px = im.load()
    thresh = 236
    seen = set()
    stack = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    while stack:
        x, y = stack.pop()
        if not (0 <= x < w and 0 <= y < h) or (x, y) in seen:
            continue
        r, g, b, a = px[x, y]
        if a == 0 or (r >= thresh and g >= thresh and b >= thresh):
            seen.add((x, y))
            px[x, y] = (r, g, b, 0)
            stack.extend([(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)])
    # 裁到内容边界再等比缩放居中,和现有立绘构图一致
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    im.thumbnail((475, 475), Image.LANCZOS)
    canvas = Image.new("RGBA", (475, 475), (0, 0, 0, 0))
    canvas.paste(im, ((475 - im.width) // 2, (475 - im.height) // 2))
    return canvas


async def main(only: str | None, force: bool, list_only: bool) -> None:
    todo = [t for t in TARGETS if not only or t["key"] == only]
    if list_only:
        for t in todo:
            path = os.path.join(OUT_DIR, t["file"])
            print(f"{'[已存在]' if os.path.exists(path) else '[待生成]'} {t['file']}  <- {t['subject'][:60]}...")
        return

    ok, skip, fail = 0, 0, []
    for t in todo:
        path = os.path.join(OUT_DIR, t["file"])
        if os.path.exists(path) and not force:
            print(f"跳过(已存在): {t['file']}")
            skip += 1
            continue
        print(f"生成 {t['file']} ...")
        raw = await _request_image(f"{t['subject']}. {STYLE}")
        if not raw:
            fail.append(t["file"])
            continue
        try:
            img = _to_transparent_475(raw)
            img.save(path)
            # 背面图:对战用,水平翻转即可(与 petSpecies.ts 的 /pets/back/ 约定一致)
            back_dir = os.path.join(OUT_DIR, "back")
            os.makedirs(back_dir, exist_ok=True)
            img.transpose(Image.FLIP_LEFT_RIGHT).save(os.path.join(back_dir, t["file"]))
            print(f"  ✓ {t['file']} (含 back/)")
            ok += 1
        except Exception as e:
            print(f"  !! 处理失败: {e}")
            fail.append(t["file"])

    print(f"\n完成: 成功 {ok}, 跳过 {skip}, 失败 {len(fail)}")
    if fail:
        print("失败清单(可重跑本脚本续补):", ", ".join(fail))


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="只生成某个 key")
    ap.add_argument("--force", action="store_true", help="覆盖已存在文件")
    ap.add_argument("--list", dest="list_only", action="store_true", help="只列出计划")
    a = ap.parse_args()
    asyncio.run(main(a.only, a.force, a.list_only))
