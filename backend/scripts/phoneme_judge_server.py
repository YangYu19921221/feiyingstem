#!/usr/bin/env python3
"""音标跟读判定服务 —— 独立进程,只做闭集打分

## 为什么独立
模型推理常驻约 2.6GB,生产机可用内存只剩 4.6GB 且 uvicorn 单 worker
(PK 房间/限流是进程内状态,不能加 worker)。跑在主应用里会抢 CPU
拖慢登录/交卷,内存也吃紧。独立进程最坏情况只是判定不可用,课照上。

## 启动
    ./venv_judge/bin/python scripts/phoneme_judge_server.py --port 8765
需要独立 venv(装 torch/transformers/soundfile),主应用的 venv 不装这些。

## 并发
单 worker + 信号量限 2 并发:实测单次 0.25s,2 并发够 40 人同时读
(每人读完到下一个词有几秒间隔)。限并发是必须的 —— 不限会把 4 核打满。
"""
import argparse
import asyncio
import io
import json
import logging
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("judge")

MODEL_DIR = os.environ.get("PHONEME_MODEL_DIR", "/root/wav2vec2-phoneme")
# 实测单次 0.25s。限 2 并发:不限会把 4 核打满,连带拖慢同机的主应用
_SEM = asyncio.Semaphore(2)

_state = {"scorer": None, "err": None}


def _load():
    """懒加载。失败不抛 —— 服务仍要能起,健康检查会报 degraded

    ## 默认 fp32,不量化(与直觉相反,实测的)
    2026-09-03 在生产机(4 核 / 7.9G)实测 wav2vec2-large 317M 参数:

        精度    稳态 RSS    启动峰值    2 秒音频推理
        fp32     1605 MB     1605 MB      0.65 s
        int8     2027 MB     3155 MB      0.33 s

    int8 **更吃内存**,原因是 torch 动态量化会留一份 FBGEMM prepack 缓冲,
    而被换掉的 fp32 权重已被 glibc 留在进程里不还给 OS;量化过程本身还要
    同时持有两份权重,于是启动尖峰冲到 3.1G —— 这台机器主应用+SRS+nginx
    已占 3.3G,那一下太贴边。
    换来的只是 0.3 秒。孩子读完一个词等 0.65 秒完全可接受,所以默认 fp32:
    省 400MB、没有启动尖峰、而且没有量化噪声(要"最好效果"就该用它)。

    ⚠️ 旧注释写的「常驻 2.6G」和「单次 0.25s」两个数都不对,以上表为准。
    想开量化设 PHONEME_QUANTIZE=1,但**必须同时把 systemd 的 MemoryMax
    提到 3.5G 以上**,否则启动尖峰会被 OOM killer 打掉。
    """
    if _state["scorer"] or _state["err"]:
        return
    try:
        import torch
        from transformers import Wav2Vec2FeatureExtractor, Wav2Vec2ForCTC
        from app.services.phoneme_closed_set import ClosedSetScorer

        vocab = json.load(open(f"{MODEL_DIR}/vocab.json", encoding="utf-8"))
        fe = Wav2Vec2FeatureExtractor.from_pretrained(MODEL_DIR)
        model = Wav2Vec2ForCTC.from_pretrained(MODEL_DIR).eval()

        # 默认关。开了反而更吃内存,见上面的实测表
        if os.environ.get("PHONEME_QUANTIZE", "0") == "1":
            model = torch.quantization.quantize_dynamic(
                model, {torch.nn.Linear}, dtype=torch.qint8)
            log.info("已 int8 动态量化(Linear 层)")

        _state["scorer"] = ClosedSetScorer(model, fe, vocab)
        log.info("模型已加载: %s", MODEL_DIR)
    except Exception as e:
        _state["err"] = str(e)
        log.error("模型加载失败(判定将不可用): %s", e)


def _decode_audio(raw: bytes):
    """任意容器 → 16k 单声道 float32。

    孩子的设备可能出 webm/opus(Android/桌面)或 mp4/aac(iOS),
    所以不能假设格式 —— 交给 ffmpeg 按内容探测。
    """
    import subprocess
    import numpy as np
    p = subprocess.run(
        ["ffmpeg", "-v", "quiet", "-i", "pipe:0",
         "-ar", "16000", "-ac", "1", "-f", "f32le", "pipe:1"],
        input=raw, capture_output=True,
    )
    if p.returncode != 0 or not p.stdout:
        raise RuntimeError("ffmpeg 解码失败")
    return np.frombuffer(p.stdout, dtype="<f4")


async def handle_judge(request):
    from aiohttp import web
    from app.services.phoneme_closed_set import judge as verdict_of

    _load()
    if not _state["scorer"]:
        return web.json_response({"verdict": "off", "reason": _state["err"]})

    data = await request.post()
    audio = data["audio"].file.read() if hasattr(data["audio"], "file") else data["audio"]
    target = data["target"]
    candidates = json.loads(data["candidates"])

    try:
        async with _SEM:
            wav = await asyncio.get_event_loop().run_in_executor(
                None, _decode_audio, audio)
            if wav.size < 16000 * 0.2:        # 短于 0.2 秒当没说话
                return web.json_response({"verdict": "silent"})
            # 一次推理同时拿闭集分和听到的音素 —— 分两次调会推理两遍(各 0.65s)
            scores, heard = await asyncio.get_event_loop().run_in_executor(
                None, _state["scorer"].rank_and_hear, wav, candidates)
    except Exception as e:
        log.warning("判定出错: %s", e)
        return web.json_response({"verdict": "off", "reason": str(e)})

    r = verdict_of(scores, target)
    # top3 = 排序分(候选间比大小的那个);top3f = 逐帧分(绝对门槛用的那个)。
    # 两个都回传:标定 SCORE_FLOOR 要看逐帧分,排查误判要看排序分。
    r["top3"] = [[w, round(s, 2)] for w, s, *_ in scores[:3]]
    r["top3f"] = [[w, round(rest[0], 3)] for w, s, *rest in scores[:3] if rest]

    # 错误类型:「更像哪个词」对孩子没用(他没想读 daff),「词尾多带了个音」才有用。
    # 只在能明确指认时给,给不出就不给 —— 不硬凑反馈。
    try:
        from app.services.phoneme_error_pattern import detect
        tgt_toks = candidates.get(target) or []
        hint = detect(heard, tgt_toks)
        if hint:
            r["error_code"] = hint["code"]
            r["error_hint"] = hint["message"]
        r["heard_phonemes"] = ''.join(heard)[:60]   # 排查用,前端不展示
    except Exception as e:
        log.warning("错误类型识别失败(不影响判定): %s", e)
    return web.json_response(r)


async def handle_health(request):
    from aiohttp import web
    _load()
    return web.json_response({
        "ok": _state["scorer"] is not None,
        "error": _state["err"],
        "model_dir": MODEL_DIR,
    }, status=200 if _state["scorer"] else 503)


def main():
    from aiohttp import web
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--host", default="127.0.0.1")   # 只监听本机,不对外
    args = ap.parse_args()

    app = web.Application(client_max_size=4 * 1024 * 1024)
    app.router.add_post("/judge", handle_judge)
    app.router.add_get("/health", handle_health)
    log.info("判定服务启动 %s:%s", args.host, args.port)
    web.run_app(app, host=args.host, port=args.port, print=None)


if __name__ == "__main__":
    main()
