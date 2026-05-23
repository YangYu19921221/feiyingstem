#!/usr/bin/env python3
"""
一次性生成 8 张 2K 英雄角色立绘并下载到 frontend/public/heroes/

用法：
    IMAGE2_API_KEY=sk-xxx python scripts/generate-heroes.py
    IMAGE2_API_KEY=sk-xxx python scripts/generate-heroes.py --force  # 强制覆盖
    IMAGE2_API_KEY=sk-xxx python scripts/generate-heroes.py --only hero_blaze

要求：API Key 走环境变量 IMAGE2_API_KEY，不写进代码、不入 git。
"""
import os
import sys
import json
import subprocess
import argparse
from pathlib import Path

API_URL = "https://pikachu.claudecode.love/v1/images/generations"
MODEL = "gpt-image-2"
SIZE = "1024x1024"
QUALITY = "high"

PROMPT_PREFIX = (
    "Anime-style heroic illustration, vibrant flat colors with soft gradients, "
    "Genshin Impact main visual aesthetic. Front 2/3 view, upper body portrait, "
    "centered composition, dynamic action pose. "
)
PROMPT_SUFFIX = (
    " Full background scene (not transparent), square 1:1 framing, "
    "no text, no logo, no signature, no watermark, "
    "completely original character with no resemblance to any known anime character."
)

HEROES = {
    "hero_blaze":   "Heroic young boy in red and orange battle robes, holding a flaming fist, fiery aura erupting behind him, golden eyes burning with determination, sunset-orange sky background.",
    "hero_thunder": "Heroic young girl in blue and silver armor, charging an electric longsword, lightning bolts circling her body, stormy purple sky background.",
    "hero_galaxy":  "Heroic warrior in purple and gold cape, holding a starlight staff, swirling galaxy and constellations behind, cosmic deep blue background.",
    "hero_sunny":   "Cheerful young student in yellow and orange sportswear, both thumbs up, beaming smile, sunbeam radiance, bright blue sky with clouds.",
    "hero_wave":    "Joyful young boy in blue and green outfit, holding up a golden trophy, water splash effect around him, cyan ocean wave background.",
    "hero_breeze":  "Sweet young girl in pink and white traditional Chinese-fusion outfit, scattering flower petals, cherry blossoms drifting, soft pastel pink background.",
    "hero_phoenix": "Determined young boy in red and gold robes, fist raised forward, ghostly phoenix silhouette flying behind him, eyes full of resolve, ember-glow background.",
    "hero_dawn":    "Warm-hearted young girl in soft amber and rose outfit, hand reaching out as if inviting forward, gentle dawn light rays behind her, sunrise gradient background.",
}


def call_image2(api_key: str, prompt: str) -> str:
    """调 image2 接口，返回图片 URL。失败抛异常。

    用 curl 调用以避免 Python urllib 在某些 macOS 环境下的 SSL/代理问题。
    """
    payload = json.dumps({
        "model": MODEL,
        "prompt": prompt,
        "size": SIZE,
        "quality": QUALITY,
        "n": 1,
    })
    proc = subprocess.run(
        [
            "curl", "--http1.1", "--max-time", "300", "-sS",
            "--noproxy", "*",  # 绕过本机代理（pikachu 直连即可）
            "-X", "POST", API_URL,
            "-H", f"Authorization: Bearer {api_key}",
            "-H", "Content-Type: application/json",
            "-d", payload,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"curl failed (exit {proc.returncode}): {proc.stderr.strip()}")
    body = json.loads(proc.stdout)
    if "data" not in body or not body["data"]:
        raise RuntimeError(f"unexpected response: {proc.stdout[:300]}")
    return body["data"][0]["url"]


def download(url: str, dest: Path) -> None:
    """下载图片到本地，原子写入（先 .tmp 再 rename）。"""
    tmp = dest.with_suffix(dest.suffix + ".tmp")
    proc = subprocess.run(
        [
            "curl", "--http1.1", "--max-time", "180", "-sS", "-L",
            "--noproxy", "*",
            "-o", str(tmp),
            url,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        if tmp.exists():
            tmp.unlink()
        raise RuntimeError(f"download failed (exit {proc.returncode}): {proc.stderr.strip()}")
    if tmp.stat().st_size < 1024:
        tmp.unlink()
        raise RuntimeError(f"downloaded file too small: {tmp.stat().st_size} bytes")
    tmp.rename(dest)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--force", action="store_true", help="强制覆盖已存在的图片")
    parser.add_argument("--only", help="只生成指定的 hero_id（逗号分隔）")
    args = parser.parse_args()

    api_key = os.environ.get("IMAGE2_API_KEY")
    if not api_key:
        print("ERROR: 必须设置环境变量 IMAGE2_API_KEY", file=sys.stderr)
        return 1

    repo_root = Path(__file__).resolve().parent.parent
    out_dir = repo_root / "frontend" / "public" / "heroes"
    out_dir.mkdir(parents=True, exist_ok=True)

    targets = list(HEROES.items())
    if args.only:
        only = set(args.only.split(","))
        targets = [(k, v) for k, v in targets if k in only]

    for hero_id, variant in targets:
        dest = out_dir / f"{hero_id}.png"
        if dest.exists() and not args.force:
            print(f"SKIP {hero_id} (已存在，加 --force 覆盖)")
            continue
        prompt = f"{PROMPT_PREFIX}{variant}{PROMPT_SUFFIX}"
        print(f"GEN  {hero_id} ...", flush=True)
        try:
            url = call_image2(api_key, prompt)
            download(url, dest)
            print(f"OK   {hero_id} -> {dest.relative_to(repo_root)}")
        except Exception as e:
            print(f"FAIL {hero_id}: {e}", file=sys.stderr)
            return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
