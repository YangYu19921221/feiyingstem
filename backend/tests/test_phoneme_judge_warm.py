"""判定服务保温(2026-10-31)

模型权重是从文件映射进内存的(干净文件页),机器内存一紧内核就先扔掉它们。
空闲一夜后第一个孩子来读要从磁盘读回 1.2G: 生产实测 65 秒,主应用 3 秒就超时 → 判定不可用 →
旧前端一律变绿,用户「我怎么乱读都是绿色通过呢」。保温 = 每分钟拿 1 秒静音空跑一次。
"""
import asyncio
import importlib.util
from pathlib import Path

import numpy as np

SRV = Path(__file__).resolve().parent.parent / "scripts" / "phoneme_judge_server.py"


def _load():
    spec = importlib.util.spec_from_file_location("judge_srv_for_test", SRV)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class _Scorer:
    def __init__(self):
        self.calls = []

    def logits(self, audio):
        self.calls.append(np.asarray(audio))
        return None


def test_warm_once_runs_the_model_on_a_second_of_silence():
    m = _load()
    s = _Scorer()
    m._state["scorer"] = s
    m._warm_once()
    assert len(s.calls) == 1, "保温必须真跑一次模型 —— 只碰一下对象,权重页照样会被挤出去"
    a = s.calls[0]
    assert a.size == 16000 and not a.any()


def test_keep_warm_loads_then_repeats(monkeypatch):
    """启动先加载 + 跑一遍(第一个孩子不用等),之后按 WARM_EVERY 一直跑"""
    m = _load()
    s = _Scorer()
    monkeypatch.setattr(m, "_load", lambda: m._state.update(scorer=s))
    monkeypatch.setattr(m, "WARM_EVERY", 0.01)

    async def run():
        t = asyncio.create_task(m._keep_warm(None))
        await asyncio.sleep(0.2)
        t.cancel()
    asyncio.run(run())
    assert len(s.calls) >= 3
    assert m._state["warm_at"] and m._state["warm_sec"] is not None
    assert m.WARM_EVERY == 0.01


def test_server_registers_keep_warm_on_startup():
    """保温挂在 aiohttp 的 on_startup 上,不挂 = 写了等于没写"""
    src = SRV.read_text(encoding="utf-8")
    assert "app.on_startup.append(_start_warm)" in src
    m = _load()
    assert m.WARM_EVERY <= 120
