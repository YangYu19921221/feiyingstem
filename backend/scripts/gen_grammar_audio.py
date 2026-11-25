"""给语法小课(句子积木)出配音: 一次生成,存成静态文件,之后孩子学不花钱

用法(在 backend 目录里跑):
    ./venv/bin/python scripts/gen_grammar_audio.py --dry-run     # 只数要出多少个、已经有多少个
    ./venv/bin/python scripts/gen_grammar_audio.py               # 缺哪个补哪个(可以反复跑)
    ./venv/bin/python scripts/gen_grammar_audio.py --only 101    # 只出第 101 节用到的
    ./venv/bin/python scripts/gen_grammar_audio.py -c 4          # 并发(默认 4;太高微软那边会断)
    ./venv/bin/python scripts/gen_grammar_audio.py --prune       # 顺手删掉现在已经用不到的旧文件

出到 frontend/public/grammar-media/a/(= blocks.MEDIA_PREFIX)。文件名是 blocks.say_key / en_key 算的:
带着版本号和声音,讲解改了一个字就是新文件,旧文件不会被错用。
- 一句讲解: 中文用 ZH_VOICE(小鹰老师的声音),{花括号} 里的英文用 EN_VOICE(和背单词同一个英式女声),
  一段一段合成再接起来
- 英文整句 / 一块积木上的词: EN_VOICE
- 合成回来的每一小段前面带 0.2 秒、后面带 0.4–0.6 秒空白(11-15 量的),直接接起来一句话里一半是空白、
  一顿一顿。所以每小段先用 ffmpeg 去掉首尾空白,再用很短的固定间隔接起来(中英文之间 GAP_SWITCH,同一种话之间 GAP_SAME)。
  本机没有 ffmpeg 就原样接(能用,只是慢)。**改了去空白 / 间隔的参数要加 --force 全部重出**(文件名不带这些参数)
先写 .tmp,确认不是空的再换上去(半截文件不会被当成好的)。失败的最后列出来,重跑只补缺的。
⚠️ 失败就是没有声音: 页面那边没有声音时保持安静、只有字幕,不用浏览器自带的声音顶替。
"""
from __future__ import annotations

import argparse
import asyncio
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

# 本机的环境变量里常有 socks 代理,合成用的库不认,会直接报错。只去掉 socks 的,别的代理留着
for _k in ("ALL_PROXY", "all_proxy", "HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy"):
    if os.environ.get(_k, "").lower().startswith("socks"):
        os.environ.pop(_k, None)

from app.grammar import blocks as B  # noqa: E402
from app.grammar import course as C  # noqa: E402
from app.grammar import items as I  # noqa: E402
from app.services.grammar_course import LESSONS  # noqa: E402

OUT = BACKEND.parent / "frontend" / "public" / B.MEDIA_PREFIX.strip("/")
RETRIES = 3

FFMPEG = shutil.which("ffmpeg")
# 去掉首尾空白: 前面留 0.04 秒、后面留 0.08 秒(一点不留,词尾的轻音会被削掉)
TRIM = ("silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.04,areverse,"
        "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse")
GAP_SWITCH = 0.10      # 中文和英文之间
GAP_SAME = 0.24        # 同一种话的两小段之间(两个英文例句连着念)
TAIL = 0.12            # 整句最后


def join(segs: list[tuple[str, bytes]]) -> bytes:
    """[(zh|en, 一小段 mp3)] → 一整句 mp3"""
    if not FFMPEG:
        return b"".join(data for _, data in segs)
    with tempfile.TemporaryDirectory() as td:
        args = [FFMPEG, "-v", "error", "-y"]
        chains = []
        for i, (lang, data) in enumerate(segs):
            src = Path(td) / f"{i}.mp3"
            src.write_bytes(data)
            args += ["-i", str(src)]
            last = i == len(segs) - 1
            gap = TAIL if last else (GAP_SAME if segs[i + 1][0] == lang else GAP_SWITCH)
            chains.append(f"[{i}:a]{TRIM},apad=pad_dur={gap}[s{i}]")
        graph = ";".join(chains) + ";" + "".join(f"[s{i}]" for i in range(len(segs)))
        graph += f"concat=n={len(segs)}:v=0:a=1[out]"
        out = Path(td) / "out.mp3"
        args += ["-filter_complex", graph, "-map", "[out]", "-ar", "24000", "-ac", "1",
                 "-c:a", "libmp3lame", "-b:a", "48k", str(out)]
        r = subprocess.run(args, capture_output=True, text=True)
        if r.returncode != 0 or not out.exists() or out.stat().st_size == 0:
            raise RuntimeError(f"ffmpeg 接声音失败: {r.stderr.strip()[-200:]}")
        return out.read_bytes()


def collect(only: int | None) -> tuple[set[str], set[str]]:
    """→ (要配的讲解, 要配的英文)"""
    lessons = [ls for lid, ls in LESSONS.items() if only is None or lid == only]
    if not lessons:
        raise SystemExit(f"没有第 {only} 节")
    say: set[str] = set(C.LINES.values()) | set(I.PRAISE) | set(I.HINTS.values()) | set(I.PROMPTS.values())
    en: set[str] = set()
    for ls in lessons:
        say |= C.say_lines(ls)
        en |= C.en_lines(ls)
    return {s for s in say if s and s.strip()}, {e for e in en if e and e.strip()}


def _en_text(text: str) -> str:
    """补句末标点,语调才会落下来(和 edge_tts_service 同一个做法)"""
    t = text.strip()
    return t if t.endswith((".", "!", "?")) else t + "."


async def _tts(text: str, voice: str, rate: str | None = None) -> bytes:
    import edge_tts
    kwargs = {"rate": rate} if rate else {}
    buf = bytearray()
    async for chunk in edge_tts.Communicate(text, voice, **kwargs).stream():
        if chunk["type"] == "audio":
            buf += chunk["data"]
    if not buf:
        raise RuntimeError("回来的音频是空的")
    return bytes(buf)


async def synth_say(text: str) -> bytes:
    parts = B.say_segments(text)
    if not parts:
        raise RuntimeError("这一句里没有能念的字")
    segs: list[tuple[str, bytes]] = []
    for lang, seg in parts:
        if lang == "en":
            segs.append((lang, await _tts(_en_text(seg), B.EN_VOICE)))
        else:
            segs.append((lang, await _tts(seg, B.ZH_VOICE, B.ZH_RATE)))
    return await asyncio.to_thread(join, segs)


async def synth_en(text: str) -> bytes:
    return await asyncio.to_thread(join, [("en", await _tts(_en_text(text), B.EN_VOICE))])


async def one(sem: asyncio.Semaphore, kind: str, text: str, path: Path, failed: list[tuple[str, str, str]]) -> None:
    async with sem:
        err = ""
        for attempt in range(1, RETRIES + 1):
            try:
                data = await (synth_say(text) if kind == "say" else synth_en(text))
                tmp = path.with_suffix(f".{os.getpid()}.tmp")
                tmp.write_bytes(data)
                if tmp.stat().st_size == 0:
                    raise RuntimeError("写出来是空文件")
                tmp.replace(path)
                print(f"  ok  {path.name}  {text[:40]}")
                return
            except Exception as e:  # noqa: BLE001
                err = f"{type(e).__name__}: {e}"
                await asyncio.sleep(0.6 * attempt)
        failed.append((kind, text, err))
        print(f"  !!  {text[:40]}  {err}")


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--only", type=int, default=None, help="只出某一节(课号,如 101)")
    ap.add_argument("--prune", action="store_true", help="删掉现在用不到的旧文件(不能和 --only 一起用)")
    ap.add_argument("--force", action="store_true", help="已经有的也重出(改了去空白 / 间隔的参数以后用)")
    ap.add_argument("-c", type=int, default=4)
    args = ap.parse_args()
    if args.prune and args.only is not None:
        raise SystemExit("--prune 要看全部课才知道哪些用不到,不能和 --only 一起用")

    say, en = collect(args.only)
    jobs: dict[Path, tuple[str, str]] = {}
    for s in sorted(say):
        jobs[OUT / f"{B.say_key(s)}.mp3"] = ("say", s)
    for e in sorted(en):
        jobs[OUT / f"{B.en_key(e)}.mp3"] = ("en", e)
    todo = {p: v for p, v in jobs.items() if args.force or not (p.exists() and p.stat().st_size > 0)}
    if not FFMPEG:
        print("⚠️ 本机没有 ffmpeg: 每小段的首尾空白去不掉,讲解会一顿一顿")
    print(f"讲解 {len(say)} 句,英文 {len(en)} 条,一共 {len(jobs)} 个文件;已经有 {len(jobs) - len(todo)} 个,要出 {len(todo)} 个")
    print(f"出到 {OUT}")

    stale = []
    if OUT.exists():
        stale = [p for p in OUT.glob("*.mp3") if p not in jobs] if args.only is None else []
    if stale:
        print(f"现在用不到的旧文件 {len(stale)} 个" + ("(加 --prune 删掉)" if not args.prune else ""))
    if args.dry_run:
        return 0

    OUT.mkdir(parents=True, exist_ok=True)
    failed: list[tuple[str, str, str]] = []
    sem = asyncio.Semaphore(max(1, args.c))
    await asyncio.gather(*(one(sem, kind, text, path, failed) for path, (kind, text) in todo.items()))
    if args.prune:
        for p in stale:
            p.unlink()
        print(f"删掉旧文件 {len(stale)} 个")
    print(f"DONE 出了 {len(todo) - len(failed)} 个,失败 {len(failed)} 个")
    for kind, text, err in failed:
        print(f"  失败 [{kind}] {text}  ← {err}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
