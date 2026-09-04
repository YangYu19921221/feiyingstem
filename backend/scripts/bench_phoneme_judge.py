#!/usr/bin/env python3
"""量判定准不准 —— 直接打判定服务,不经主应用

## 为什么用 Edge TTS 的音当"标准发音"
它是本 App 全局单词发音用的同一个声音,也就是孩子跟读时听到的范本。
如果连范本音都判不过,孩子的音只会更糟 —— 这是准确率的**上限**测量。
反过来说这个数偏乐观:真实童声更糊,线上会更差(童声 WER 绝对值掉 15-20%)。

## 测两件事
1. 该过的过吗(recall):拿 X 的音去验 X,期望 pass
2. 该拦的拦吗(precision):拿 X 的音去验 Y,期望 confused
   这一节 20 个词互为最小对立对(bad/bed/bade、bee/beef/bead、fee/face…),
   是最难的闭集 —— 拦得住这些才叫真能纠音。

用法(生产机上):
    ./venv/bin/python scripts/bench_phoneme_judge.py --lesson 1
"""
import argparse
import asyncio
import json
import os
import sqlite3
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

JUDGE = os.environ.get("PHONEME_JUDGE_URL", "http://127.0.0.1:8765")


async def tts(word: str) -> bytes:
    """走 edge-tts 出英式女声 mp3(与 App 内单词发音同一个声音)"""
    import edge_tts
    buf = b""
    c = edge_tts.Communicate(word, "en-GB-SoniaNeural")
    async for chunk in c.stream():
        if chunk["type"] == "audio":
            buf += chunk["data"]
    return buf


async def ask(audio: bytes, target: str, candidates: dict) -> dict:
    import httpx
    async with httpx.AsyncClient(timeout=60) as c:
        r = await c.post(f"{JUDGE}/judge",
                         files={"audio": ("a.mp3", audio, "application/octet-stream")},
                         data={"target": target,
                               "candidates": json.dumps(candidates, ensure_ascii=False)})
    return r.json()


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lesson", type=int, default=1)
    ap.add_argument("--db", default="english_helper.db")
    a = ap.parse_args()

    con = sqlite3.connect(a.db)
    rows = con.execute(
        "SELECT word, answer_json FROM phonetic_items WHERE lesson_id=? ORDER BY order_index",
        (a.lesson,)).fetchall()
    cands = {}
    for w, aj in rows:
        toks = json.loads(aj or "[]")
        if toks:
            cands[w] = toks
    words = list(cands)
    print(f"lesson {a.lesson}: {len(words)} 词  {words}\n")

    print("生成标准音…")
    audio = {}
    for w in words:
        audio[w] = await tts(w)
    print(f"完成,平均 {sum(len(v) for v in audio.values())//len(audio)} 字节\n")

    # 1) 该过的过吗
    ok = 0
    bad_cases = []
    for w in words:
        r = await ask(audio[w], w, cands)
        v = r.get("verdict")
        if v == "pass":
            ok += 1
        else:
            bad_cases.append((w, v, r.get("best"), r.get("margin"), r.get("top3")))
    print(f"【该过的】{ok}/{len(words)} 通过 = {ok/len(words)*100:.0f}%")
    for w, v, best, m, t3 in bad_cases:
        print(f"   ✗ {w:8s} → {v} (最像 {best}, 差 {m})  top3={t3}")

    # 2) 该拦的拦吗:每个词拿它的"邻居"当目标
    print()
    caught = tot = 0
    leaks = []
    for i, w in enumerate(words):
        wrong = words[(i + 1) % len(words)]
        r = await ask(audio[w], wrong, cands)
        tot += 1
        if r.get("verdict") == "confused":
            caught += 1
        else:
            leaks.append((w, wrong, r.get("verdict"), r.get("margin"), r.get("top3")))
    print(f"【该拦的】{caught}/{tot} 拦住 = {caught/tot*100:.0f}%")
    for said, tgt, v, m, t3 in leaks:
        print(f"   ✗ 念的是 {said:8s} 目标 {tgt:8s} → {v} (差 {m})  top3={t3}")

    # 3) 静音必须不过
    print()
    r = await ask(b"\x00" * 200, words[0], cands)
    print(f"【静音】verdict={r.get('verdict')}  (应为 silent/off,绝不能 pass)")


if __name__ == "__main__":
    asyncio.run(main())
