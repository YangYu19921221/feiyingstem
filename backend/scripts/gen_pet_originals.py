"""给原创伙伴出立绘(替换原来 67 个宝可梦种族,2026-11-04)。设计在 pet_original_designs.py。

两步出图,保证一家三张认得出是同一只:
  1. base  : 先用文字出「成长形态」(第 2 张),它的特征最完整
  2. forms : 再拿第 2 张当参考图,走 /v1/images/edits 出幼年(第 1 张)和最终形态(第 3 张)
           只用文字分别出三张的话,颜色、花纹常常对不上,孩子进化完会以为换了一只

出图要用 ai_providers 里 image_tutor 那行的 Key(本机的中转 Key 出不了图),所以出图在生产机上跑:
    venv/bin/python3.12 /tmp/eh_petgen/gen_pet_originals.py gen --out /tmp/eh_petgen/raw -c 10
原图(白底)拉回本机后抠图、缩成 475×475 透明底 + back/ 翻转图:
    python scripts/gen_pet_originals.py process --raw /path/to/raw
重画某几只: gen --only sparkhog,yak --force

⚠️ 提示词只写外观,不写任何现有角色名;中转不认 size,一律回 1672×941 横图,抠图时按外框裁。
"""
import argparse
import asyncio
import base64
import io
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from pet_original_designs import DESIGNS, NEW_DESIGNS  # noqa: E402

ALL_DESIGNS = DESIGNS + NEW_DESIGNS
NEW_IDS = {d['id'] for d in NEW_DESIGNS}

PETS_DIR = os.path.join(os.path.dirname(os.path.dirname(HERE)), "frontend", "public", "pets")

STYLE = (
    "Cute cartoon creature mascot illustration for children, clean bold dark outlines, flat cel shading, "
    "bright saturated colors, full body fully visible, three-quarter side view facing left, centered with "
    "generous margin, pure solid white background, no text, no letters, no watermark, no ground shadow, "
    "no scenery, friendly expression"
)
ORIGINAL = ("Completely original character design (not based on any existing anime, game or cartoon character). ")
# 第二批(2026-11-05): 用户要「有个性的帅气的不要太可爱」
STYLE_COOL = (
    "Cool stylish creature design for a kids' monster-collecting game: confident, sleek, slightly fierce, NOT chibi, "
    "NOT overly cute, no big baby eyes on the grown forms; dynamic heroic pose, sharp silhouette, anime monster art, "
    "clean bold dark outlines, cel shading with dramatic rim light, bright saturated colors, full body fully visible, "
    "three-quarter side view facing left, centered with generous margin, pure solid white background, "
    "no text, no letters, no watermark, no ground shadow, no scenery"
)

LEGEND_OLDS = {"articuno", "zapdos", "moltres", "suicune", "mew", "mewtwo", "rayquaza", "arceus"}
STAGE_WORDS = {
    False: ("baby (first) form", "grown-up (second) form", "final evolved (third) form"),
    True: ("base form", "awakened form", "ultimate form"),
}


def file_for(design: dict, n: int) -> str:
    return f"{design['id']}_{n}.png"


def _is_legend(d: dict) -> bool:
    return d.get("old") in LEGEND_OLDS or d.get("tier", "normal") != "normal"


def _style(d: dict) -> str:
    return STYLE_COOL if d["id"] in NEW_IDS else STYLE


def base_prompt(d: dict) -> str:
    legend = _is_legend(d)
    return (f"{ORIGINAL}{d['look']}. This picture shows its {STAGE_WORDS[legend][1]}: {d['forms'][1]}. {_style(d)}")


def form_prompt(d: dict, n: int) -> str:
    legend = _is_legend(d)
    size_hint = {1: "smaller, rounder and cuter than the reference",
                 3: "bigger, more powerful and more impressive than the reference"}[n]
    return (f"{ORIGINAL}The SAME creature as in the reference image: keep the same species, the same colors, "
            f"markings and art style so it is clearly recognizable as the same family. {d['look']}. "
            f"Now draw its {STAGE_WORDS[legend][n - 1]}, {size_hint}: {d['forms'][n - 1]}. {_style(d)}")


# ------------------------------------------------------------------ 出图(生产机上跑)

async def _conf() -> dict:
    # 用户另给了 Key / 模型时走环境变量(Key 不落盘、不进 git);没给就读库里 image_tutor 那行
    if os.environ.get("PET_IMAGE_KEY"):
        return {"key": os.environ["PET_IMAGE_KEY"], "base": os.environ.get("PET_IMAGE_BASE", "https://hk.hueling.cc"),
                "model": os.environ.get("PET_IMAGE_MODEL", "gpt-image-2.5-sunburst"),
                "quality": os.environ.get("PET_IMAGE_QUALITY", "low")}
    sys.path.insert(0, "/www/wwwroot/english-helper/backend")
    from app.core.database import AsyncSessionLocal
    from app.services.word_picture import image_conf
    async with AsyncSessionLocal() as db:
        cfg = await image_conf(db)
    if not cfg:
        raise SystemExit("image_tutor 没配或停用了")
    return cfg


async def _one(client, cfg, sem, name: str, prompt: str, out: str, ref: str | None, log: list) -> bool:
    import httpx  # noqa: F401
    body = {"model": cfg["model"], "prompt": prompt, "n": 1, "size": "1024x1024", "quality": cfg.get("quality") or "low"}
    for attempt in range(6):
        async with sem:
            t = time.time()
            try:
                hdr = {"Authorization": f"Bearer {cfg['key']}"}
                if ref:
                    with open(ref, "rb") as fh:
                        files = {"image": (os.path.basename(ref), fh.read(), "image/png")}
                    r = await client.post(f"{cfg['base']}/v1/images/edits", headers=hdr,
                                          data={k: str(v) for k, v in body.items()}, files=files)
                else:
                    r = await client.post(f"{cfg['base']}/v1/images/generations", headers=hdr, json=body)
                if r.status_code == 200:
                    item = (r.json().get("data") or [{}])[0]
                    raw = base64.b64decode(item["b64_json"]) if item.get("b64_json") else (
                        (await client.get(item["url"])).content if item.get("url") else b"")
                    if raw:
                        tmp = out + ".tmp"
                        with open(tmp, "wb") as fh:
                            fh.write(raw)
                        os.replace(tmp, out)
                        print(f"ok   {name} {time.time() - t:.0f}s", flush=True)
                        return True
                    print(f"..   {name} 200 无图", flush=True)
                else:
                    print(f"..   {name} HTTP {r.status_code} {r.text[:120]!r}", flush=True)
            except Exception as e:  # noqa: BLE001
                print(f"..   {name} {type(e).__name__} {str(e)[:120]}", flush=True)
        await asyncio.sleep(min(4 * (attempt + 1), 20))
    log.append(name)
    print(f"FAIL {name}", flush=True)
    return False


async def gen(out_dir: str, concurrency: int, only: set | None, force: bool) -> None:
    import httpx
    os.makedirs(out_dir, exist_ok=True)
    cfg = await _conf()
    todo = [d for d in ALL_DESIGNS if not only or d["id"] in only]
    sem = asyncio.Semaphore(concurrency)
    failed: list = []

    def need(d, n):
        return force or not os.path.exists(os.path.join(out_dir, file_for(d, n)))

    async with httpx.AsyncClient(timeout=300, trust_env=False,
                                 limits=httpx.Limits(max_connections=concurrency * 2)) as c:
        async def family(d):
            mid = os.path.join(out_dir, file_for(d, 2))
            if need(d, 2):
                if not await _one(c, cfg, sem, file_for(d, 2), base_prompt(d), mid, None, failed):
                    return
            jobs = [_one(c, cfg, sem, file_for(d, n), form_prompt(d, n),
                         os.path.join(out_dir, file_for(d, n)), mid, failed)
                    for n in (1, 3) if need(d, n)]
            await asyncio.gather(*jobs)

        await asyncio.gather(*(family(d) for d in todo))
    print(f"DONE 失败 {len(failed)}: {','.join(failed)}", flush=True)


# ------------------------------------------------------------------ 抠图(本机跑)

def _matte(path: str):
    """白底 → 透明底 475×475:从四条边往里 flood fill 外围的白,内部白色部位保留。"""
    from PIL import Image, ImageDraw
    src = Image.open(path)
    if src.mode in ("RGBA", "LA", "P"):
        # edits 接口有时直接回透明底 PNG;直接 convert("RGB") 透明处会变成黑底,先垫白再抠
        src = src.convert("RGBA")
        white = Image.new("RGBA", src.size, (255, 255, 255, 255))
        white.alpha_composite(src)
        src = white
    im = src.convert("RGB")
    w, h = im.size
    # 用不会在画里出现的品红做标记,C 实现的 floodfill 比逐像素 Python 快两个数量级
    mark = (255, 0, 255)
    seeds = [(x, 0) for x in range(0, w, 24)] + [(x, h - 1) for x in range(0, w, 24)] + \
            [(0, y) for y in range(0, h, 24)] + [(w - 1, y) for y in range(0, h, 24)]
    for s in seeds:
        r, g, b = im.getpixel(s)
        if r >= 232 and g >= 232 and b >= 232:
            ImageDraw.floodfill(im, s, mark, thresh=46)
    rgba = im.convert("RGBA")
    px = rgba.load()
    for y in range(h):
        for x in range(w):
            if px[x, y][:3] == mark:
                px[x, y] = (255, 255, 255, 0)
    bbox = rgba.getbbox()
    if not bbox:
        raise ValueError("抠完是空的")
    rgba = rgba.crop(bbox)
    rgba.thumbnail((475, 475), Image.LANCZOS)
    canvas = Image.new("RGBA", (475, 475), (0, 0, 0, 0))
    canvas.paste(rgba, ((475 - rgba.width) // 2, (475 - rgba.height) // 2))
    return canvas


def _save_verified(img, path: str) -> None:
    from PIL import Image
    tmp = path + ".tmp"
    # 压成 256 色调色板 PNG: 平涂卡通图看不出区别,一张从 ~320KB 降到 ~60KB。
    # 图鉴一屏 70 张卡,不压的话孩子手机上要下 20MB+
    pal = img.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.FLOYDSTEINBERG)
    pal.save(tmp, format="PNG", optimize=True)   # 必须显式 format,".png.tmp" 猜不出格式
    probe = Image.open(tmp)
    probe.load()                                  # 真解码,截断在这里就抛
    probe.close()
    os.replace(tmp, path)


def _process_one(args):
    raw_dir, name = args
    from PIL import Image
    img = _matte(os.path.join(raw_dir, name))
    _save_verified(img, os.path.join(PETS_DIR, name))
    _save_verified(img.transpose(Image.FLIP_LEFT_RIGHT), os.path.join(PETS_DIR, "back", name))
    return name


def process(raw_dir: str, only: set | None) -> None:
    from multiprocessing import Pool
    names = [file_for(d, n) for d in ALL_DESIGNS for n in (1, 2, 3)
             if (not only or d["id"] in only) and os.path.exists(os.path.join(raw_dir, file_for(d, n)))]
    os.makedirs(os.path.join(PETS_DIR, "back"), exist_ok=True)
    with Pool(max(2, (os.cpu_count() or 4) - 1)) as pool:
        for i, name in enumerate(pool.imap_unordered(_process_one, [(raw_dir, n) for n in names]), 1):
            print(f"[{i}/{len(names)}] {name}", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    g = sub.add_parser("gen")
    g.add_argument("--out", required=True)
    g.add_argument("-c", "--concurrency", type=int, default=10)
    g.add_argument("--only", default="")
    g.add_argument("--force", action="store_true")
    p = sub.add_parser("process")
    p.add_argument("--raw", required=True)
    p.add_argument("--only", default="")
    sub.add_parser("prompts")
    a = ap.parse_args()
    only = {x.strip() for x in getattr(a, "only", "").split(",") if x.strip()} or None
    if a.cmd == "gen":
        asyncio.run(gen(a.out, max(1, a.concurrency), only, a.force))
    elif a.cmd == "process":
        process(a.raw, only)
    else:
        for d in ALL_DESIGNS:
            print(d["id"], "|", base_prompt(d)[:160])
