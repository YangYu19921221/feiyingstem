#!/usr/bin/env python3
"""标定 SCORE_FLOOR —— 拿真人录音定门槛,不能拿 TTS 定

## 为什么必须用真人录音
2026-09-03 踩过:SCORE_FLOOR 用 Edge TTS 标准音标定成 -5.0,上线后
**11 条真实录音 100% 被拦**,提示「没听清你在读哪个词」,而音频质量完全正常
(RMS 0.033~0.100 vs TTS 0.051,峰值还更高)。
根因是排序分随录音长度漂移:同一个 bad,0.98 秒的 TTS 得 -0.78,
4.58 秒的真人录音得 -15.19 —— 量的是长度不是发音质量。
现在改用**逐帧分**(rank() 的第 3 个值),与长度无关;门槛必须用真人的数标。

## 输出怎么读
真人读词的逐帧分是**下界**,非语音是**上界**,门槛取两者之间。
两簇若重叠 = 这个门槛做不到既拦噪音又不误伤,应当**放弃拦截**
(宁可漏放:让孩子被误判"没在读"的代价远大于漏过一次噪音)。

用法(生产机上):
    ./venv/bin/python scripts/calibrate_score_floor.py --lesson 1
"""
import argparse
import asyncio
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

JUDGE = os.environ.get("PHONEME_JUDGE_URL", "http://127.0.0.1:8765")


def _mk(lavfi: str, dur: str = "1.2") -> bytes:
    return subprocess.run(
        ["ffmpeg", "-v", "quiet", "-f", "lavfi", "-i", lavfi, "-t", dur,
         "-c:a", "libopus", "-f", "webm", "pipe:1"],
        capture_output=True).stdout


async def _tts(word: str) -> bytes:
    import edge_tts
    buf = b""
    async for c in edge_tts.Communicate(word, "en-GB-SoniaNeural").stream():
        if c["type"] == "audio":
            buf += c["data"]
    return buf


async def _ask(audio: bytes, target: str, cands: dict) -> dict:
    import httpx
    async with httpx.AsyncClient(timeout=120) as c:
        r = await c.post(f"{JUDGE}/judge",
                         files={"audio": ("a.webm", audio, "application/octet-stream")},
                         data={"target": target,
                               "candidates": json.dumps(cands, ensure_ascii=False)})
    return r.json()


def _floor_of(r: dict):
    """判定服务回的 top3 是 [词, 排序分];逐帧分从 score 字段拿(not_speech 时才有)。
    所以这里改看服务端直接给的 per_frame(见 phoneme_judge_server 的 top3f)。"""
    t3f = r.get("top3f")
    if t3f:
        return t3f[0][1]
    return r.get("score")


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--lesson", type=int, default=1)
    ap.add_argument("--db", default="english_helper.db")
    a = ap.parse_args()
    from app.core.config import settings

    con = sqlite3.connect(a.db)
    cands = {w: json.loads(aj) for w, aj in con.execute(
        "SELECT word, answer_json FROM phonetic_items WHERE lesson_id=?",
        (a.lesson,)) if aj}

    print("=== 真人录音(这是下界,门槛必须在它以下) ===")
    human = []
    rows = con.execute(
        """SELECT r.id, i.word, r.file_path FROM phonetic_readings r
           JOIN phonetic_items i ON i.id = r.item_id
           WHERE i.lesson_id = ? ORDER BY r.id""", (a.lesson,)).fetchall()
    for rid, word, fp in rows:
        p = os.path.join(settings.PHONETIC_AUDIO_DIR, os.path.basename(fp))
        if not os.path.isfile(p):
            continue
        r = await _ask(open(p, "rb").read(), word, cands)
        f = _floor_of(r)
        human.append(f)
        print(f"  id{rid:<4} {word:8} 逐帧分={f}  verdict={r.get('verdict')}")

    print("\n=== 标准音(参考,不用来定门槛) ===")
    for w in list(cands)[:5]:
        r = await _ask(await _tts(w), w, cands)
        print(f"  {w:8} 逐帧分={_floor_of(r)}  verdict={r.get('verdict')}")

    print("\n=== 非语音(这是上界,门槛必须在它以上) ===")
    noise = []
    for name, lavfi in [("纯静音", "anullsrc=r=48000:cl=mono"),
                        ("白噪音", "anoisesrc=r=48000:a=0.05"),
                        ("大白噪", "anoisesrc=r=48000:a=0.3"),
                        ("纯音440", "sine=frequency=440:r=48000")]:
        r = await _ask(_mk(lavfi), list(cands)[0], cands)
        f = _floor_of(r)
        noise.append(f)
        print(f"  {name:8} 逐帧分={f}  verdict={r.get('verdict')}")

    print("\n=== 结论 ===")
    hv = [x for x in human if isinstance(x, (int, float))]
    nv = [x for x in noise if isinstance(x, (int, float))]
    if not hv or not nv:
        print("样本不足,拿不出结论")
        return
    print(f"真人最低 = {min(hv):.3f}   非语音最高 = {max(nv):.3f}")
    if min(hv) > max(nv):
        gap = min(hv) - max(nv)
        print(f"两簇分开,间隙 {gap:.3f}。建议 SCORE_FLOOR = {min(hv) - gap * 0.4:.2f}"
              f"  (偏向真人一侧留余量,宁可漏放)")
    else:
        print("⚠️ 两簇重叠 —— 这个门槛做不到既拦噪音又不误伤真人。")
        print("   应当放弃绝对门槛(SCORE_FLOOR 设成极小值如 -99),")
        print("   靠前端 VAD + 服务端最短时长兜静音,不要冤枉在读的孩子。")


if __name__ == "__main__":
    asyncio.run(main())
