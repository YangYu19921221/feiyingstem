"""生成对战技能特效的粒子贴图(黑底 PNG,走 screen 混合)。

为什么是黑底而不是透明底:
- 特效素材在前端用 `mix-blend-mode: screen` 叠加,黑色在 screen 混合下天然消失,
  发光边缘过渡比抠图干净得多(这是特效行业标准做法),同时省掉 flood-fill 抠图,
  也绕开了「直接要 transparent 会触发上游 500」那个坑(见 gen_pet_midforms.py)。

产物:frontend/public/vfx/particle-<key>.webp,256x256。
在 petSpecies.ts 的 SKILL_VFX 配方里用 particle 字段引用。

用法:
    python scripts/gen_skill_particles.py --list
    python scripts/gen_skill_particles.py --only ember
    python scripts/gen_skill_particles.py            # 全部(已存在自动跳过)
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
    "frontend", "public", "vfx",
)

# 统一风格:单个元素、居中、黑底、边缘发光。强调 pure black 让 screen 混合干净。
STYLE = (
    "single isolated VFX sprite for a game particle effect, centered on frame, "
    "glowing bright emissive element, dark edges fading to pure solid black background, "
    "high contrast, no text, no watermark, no border, no character, no scenery"
)

TARGETS = [
    dict(key="spark", subject="a jagged electric spark bolt, brilliant white-blue core with cyan glow"),
    dict(key="ember", subject="a curling flame wisp, white-yellow core fading to deep orange and red"),
    dict(key="bubble", subject="a splash of water droplets, translucent cyan with bright white highlights"),
    dict(key="leaf", subject="a sharp crescent leaf blade, vivid green with glowing lime edge"),
    dict(key="wisp", subject="a ghostly purple flame wisp with wispy trailing smoke, violet glow"),
    dict(key="star", subject="a four-pointed sparkle star with long thin light rays, warm golden yellow"),
    dict(key="shard", subject="an angular rock shard fragment, brown-amber with glowing hot cracks"),
    dict(key="ice", subject="a six-pointed ice crystal snowflake shard, pale cyan with white glow"),
    dict(key="petal", subject="a soft flower petal, bright pink with a luminous rim"),
    dict(key="metal", subject="a sharp steel shrapnel sliver, cold silver-white with a specular gleam"),
]


async def _request_image(prompt: str, attempts: int = 6) -> bytes | None:
    """调中转出图。中转会**间歇性**返回 502/503(与内容无关),必须重试而不是改 prompt。

    trust_env=False:本机 SOCKS 代理会让 httpx 崩,必须绕开环境代理。
    """
    if not settings.IMAGE_API_KEY:
        print("  !! IMAGE_API_KEY 未配置")
        return None
    payload = {
        "model": settings.IMAGE_MODEL,
        "prompt": prompt,
        "size": "1024x1024",
        "quality": "low",
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


def _to_particle(raw: bytes, size: int = 256) -> Image.Image:
    """裁到发光内容的外接方框 → 缩到 size,并把近黑像素压成纯黑(screen 混合下才干净)。"""
    im = Image.open(io.BytesIO(raw)).convert("RGB")

    # 亮度阈值找发光主体,按最长边裁正方形,避免缩放后变形
    gray = im.convert("L").point(lambda v: 255 if v > 28 else 0)
    bbox = gray.getbbox()
    if bbox:
        cx, cy = (bbox[0] + bbox[2]) // 2, (bbox[1] + bbox[3]) // 2
        half = max(bbox[2] - bbox[0], bbox[3] - bbox[1]) // 2 + 12
        left, top = max(0, cx - half), max(0, cy - half)
        right, bottom = min(im.width, cx + half), min(im.height, cy + half)
        im = im.crop((left, top, right, bottom))

    im = im.resize((size, size), Image.LANCZOS)

    # 近黑压纯黑:JPEG/生成噪点留下的暗灰在 screen 混合下会糊成一层灰雾
    px = im.load()
    for y in range(size):
        for x in range(size):
            r, g, b = px[x, y]
            if r < 22 and g < 22 and b < 22:
                px[x, y] = (0, 0, 0)
    return im


async def main(only: str | None, force: bool, list_only: bool) -> None:
    todo = [t for t in TARGETS if not only or t["key"] == only]
    os.makedirs(OUT_DIR, exist_ok=True)

    if list_only:
        for t in todo:
            path = os.path.join(OUT_DIR, f"particle-{t['key']}.webp")
            print(f"{'[已存在]' if os.path.exists(path) else '[待生成]'} particle-{t['key']}.webp  <- {t['subject'][:58]}...")
        return

    ok, skip, fail = 0, 0, []
    for t in todo:
        path = os.path.join(OUT_DIR, f"particle-{t['key']}.webp")
        if os.path.exists(path) and not force:
            print(f"跳过(已存在): particle-{t['key']}.webp")
            skip += 1
            continue
        print(f"生成 particle-{t['key']}.webp ...")
        raw = await _request_image(f"{t['subject']}. {STYLE}")
        if not raw:
            fail.append(t["key"])
            continue
        try:
            _to_particle(raw).save(path, "WEBP", quality=88, method=6)
            print(f"  ✓ particle-{t['key']}.webp ({os.path.getsize(path) // 1024} KB)")
            ok += 1
        except Exception as e:
            print(f"  !! 处理失败: {e}")
            fail.append(t["key"])

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
