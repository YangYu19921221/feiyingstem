#!/usr/bin/env python3
"""批量生成 PPT 配图 — 调 hueling gpt-image-2，base64 落地为 PNG。

用法：python gen_images.py manifest.json
manifest.json: [{"id":"cover","prompt":"...","size":"1536x1024","quality":"high"}, ...]
已存在同名 PNG 会跳过，便于断点续跑。
"""
import base64
import concurrent.futures as cf
import json
import sys
import time
from pathlib import Path

import requests

API_URL = "https://hk.hueling.cc/v1/images/generations"
API_KEY = "sk-c309ebcbb06a252922eae4bcc00d2795d515cf76ee51748a5fb3ee478a0faf95"
MODEL = "gpt-image-2"
OUT = Path(__file__).parent / "images"
OUT.mkdir(exist_ok=True)

# 全局画风前缀：统一品牌质感，避免AI淡紫
STYLE = (
    "Modern flat vector illustration for a children's English-learning ed-tech brand. "
    "Vibrant palette built on warm orange #FF6B35, sunny yellow #FFD23F, sky blue #00D9FF, "
    "grass green #5FD35F on clean warm off-white #FFF8F0 background. Soft rounded shapes, "
    "friendly, energetic, professional, crisp edges, subtle depth, generous negative space. "
    "Absolutely NO text, NO letters, NO words, NO watermark anywhere in the image. "
)


def gen_one(item):
    idd = item["id"]
    path = OUT / f"{idd}.png"
    if path.exists() and path.stat().st_size > 5000:
        return idd, "skip(exists)"
    prompt = STYLE + item["prompt"]
    last = ""
    for attempt in range(5):
        try:
            r = requests.post(
                API_URL,
                headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
                json={
                    "model": MODEL,
                    "prompt": prompt,
                    "size": item.get("size", "1024x1024"),
                    "quality": item.get("quality", "high"),
                    "n": 1,
                },
                timeout=240,
            )
            r.raise_for_status()
            data = r.json().get("data") or [{}]
            b64 = data[0].get("b64_json")
            url = data[0].get("url")
            if b64:
                path.write_bytes(base64.b64decode(b64))
                return idd, f"ok({path.stat().st_size//1024}KB)"
            if url:
                img = requests.get(url, timeout=120)
                path.write_bytes(img.content)
                return idd, f"ok-url({path.stat().st_size//1024}KB)"
            last = f"no image: {str(r.json())[:150]}"
        except Exception as e:
            last = f"{type(e).__name__}: {str(e)[:150]}"
            time.sleep(3 * (attempt + 1))  # 退避,给本地代理喘息
    return idd, f"FAIL: {last}"


def main():
    manifest = json.loads(Path(sys.argv[1]).read_text())
    workers = int(sys.argv[2]) if len(sys.argv) > 2 else 2
    results = {}
    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(gen_one, it): it["id"] for it in manifest}
        for f in cf.as_completed(futs):
            idd, status = f.result()
            results[idd] = status
            print(f"  [{idd}] {status}", flush=True)
    ok = sum(1 for v in results.values() if v.startswith("ok") or v.startswith("skip"))
    print(f"\n{ok}/{len(manifest)} images ready")
    fails = {k: v for k, v in results.items() if v.startswith("FAIL")}
    if fails:
        print("FAILURES:", json.dumps(fails, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
