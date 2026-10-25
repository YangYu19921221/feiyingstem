"""发音组件夜间自检 + 自动升级(2026-10-24)

背景: 微软按客户端版本号拒旧版 edge-tts。2026-10-17 起生产的 7.2.8 被 403 拒,
已缓存的词照常响、没缓存过的文本全部无声,整整一周没人发现(句子朗读才暴露)。

每晚由 systemd 定时器跑 scripts/tts_guard.py 一次:
1. 用一句**从没合成过**的话试一次(带随机编号,本地缓存和微软那边都不可能命中)。正常 → 只记一条「正常」
2. 失败 → 在临时 venv 里装最新版 edge-tts 再试:
   - 新版能出声 → 线上 venv 升到这个版本 → 再试一次 → 重启服务 → 经接口再验一遍
   - 新版也不行(或最新版就是现在这个)→ 不是版本问题(网络/微软故障),不动线上,记失败等人看
   - 线上装上新版仍失败 → 退回原版本,不重启
3. **白天不升级不重启**(7–23 点有人上课,重启会断开 PK 房间/实时课堂),只记录;要强制加 --any-time
4. 结果写 private_media/tts_guard/status.json(最近 30 条),管理端首页「发音检查」卡片读它

所有外部动作(子进程 / 重启 / 接口验证)都走本模块的函数,测试里逐个替换。
"""
import json
import os
import random
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from app.services import edge_tts_service

_BJ = timezone(timedelta(hours=8))
BACKEND_DIR = Path(__file__).resolve().parents[2]
STATUS_FILE = BACKEND_DIR / "private_media" / "tts_guard" / "status.json"
SERVICE_NAME = "english-helper"
LOCAL_TTS_URL = "http://127.0.0.1:8000/api/v1/pronunciation/edge-tts"
HISTORY_KEEP = 30
NIGHT_START, NIGHT_END = 23, 7   # 23 点到次日 7 点算夜里

# 子进程里跑: 合成一句话,打印音频字节数;没出音频退出码 3
PROBE_CODE = r'''
import asyncio, sys, edge_tts
async def main():
    n = 0
    async for ch in edge_tts.Communicate(sys.argv[1], sys.argv[2]).stream():
        if ch["type"] == "audio":
            n += len(ch["data"])
    print(n)
    sys.exit(0 if n > 0 else 3)
asyncio.run(main())
'''
VERSION_CODE = "import importlib.metadata as m; print(m.version('edge-tts'))"


def _now() -> datetime:
    return datetime.now(_BJ)


def is_night(now: Optional[datetime] = None) -> bool:
    h = (now or _now()).hour
    return h >= NIGHT_START or h < NIGHT_END


def fresh_text() -> str:
    """一句没合成过的话: 带随机编号,缓存不可能命中"""
    return f"This is the nightly sound check number {random.randint(10000, 99999)}."


def _run(cmd: list[str], timeout: int = 120) -> tuple[int, str]:
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, (r.stdout + r.stderr).strip()
    except subprocess.TimeoutExpired:
        return -1, f"超时 {timeout}s"
    except Exception as e:  # noqa: BLE001
        return -1, str(e)


def probe(python: str) -> tuple[bool, str]:
    """用指定 python(对应某个 venv 里的 edge-tts)合成一句新话。返回 (成功, 出错信息)"""
    code, out = _run([python, "-c", PROBE_CODE, fresh_text(), edge_tts_service.VOICE], timeout=60)
    return code == 0, ("" if code == 0 else out[-300:])


def installed_version(python: str) -> Optional[str]:
    code, out = _run([python, "-c", VERSION_CODE], timeout=30)
    return out.strip().splitlines()[-1] if code == 0 and out.strip() else None


def pip_install(python: str, spec: str) -> tuple[bool, str]:
    code, out = _run([python, "-m", "pip", "install", "-q", "--disable-pip-version-check", spec], timeout=300)
    return code == 0, out[-300:]


def try_latest_in_temp() -> tuple[Optional[str], bool, str]:
    """临时 venv 里装最新版试一次,不碰线上。返回 (最新版本号, 能否出声, 出错信息)"""
    with tempfile.TemporaryDirectory(prefix="eh-tts-probe-") as d:
        code, out = _run([sys.executable, "-m", "venv", d], timeout=120)
        if code != 0:
            return None, False, f"建临时环境失败: {out[-200:]}"
        py = str(Path(d) / "bin" / "python")
        ok, out = pip_install(py, "edge-tts")
        if not ok:
            return None, False, f"下载最新版失败: {out[-200:]}"
        ver = installed_version(py)
        works, err = probe(py)
        return ver, works, err


# 工作进程服务(2026-10-25 起后端多进程,见 deploy/multiproc): 发音接口多数落在工作进程上,
# 升完 edge-tts 只重启主进程的话工作进程还在用旧版本
WORKERS_SERVICE = "english-helper-workers"


def _workers_enabled() -> bool:
    return _run(["systemctl", "is-enabled", WORKERS_SERVICE], timeout=20)[0] == 0


def restart_service() -> tuple[bool, str]:
    ok = _run(["systemctl", "restart", SERVICE_NAME], timeout=120)[0] == 0
    if ok and _workers_enabled():
        # 主进程先起来(工作进程启动时要等它的 /health)
        ok = _run(["systemctl", "restart", WORKERS_SERVICE], timeout=240)[0] == 0
    return ok, ""


def http_ok(wait_seconds: int = 60) -> bool:
    """重启后经线上接口取一句新话的发音,确认服务起来了且能出声。用完删掉这句的缓存文件"""
    text = fresh_text()
    url = f"{LOCAL_TTS_URL}?word={urllib.parse.quote(text)}"
    deadline = time.monotonic() + wait_seconds
    try:
        while time.monotonic() < deadline:
            try:
                with urllib.request.urlopen(url, timeout=30) as r:
                    if r.status == 200 and len(r.read()) > 0:
                        return True
            except Exception:  # noqa: BLE001  服务还没起来
                pass
            time.sleep(2)
        return False
    finally:
        try:
            edge_tts_service._cache_path(text).unlink(missing_ok=True)
        except OSError:
            pass


def run_check(python: Optional[str] = None, any_time: bool = False,
              now: Optional[datetime] = None) -> dict:
    """跑一次自检(可能升级 + 重启),写状态文件并返回这一条记录"""
    python = python or sys.executable
    now = now or _now()
    before = installed_version(python)
    entry = {"checked_at": now.isoformat(timespec="seconds"), "version_before": before,
             "version_after": before, "ok": True, "action": "none", "message": "", "detail": ""}

    ok, err = probe(python)
    if ok:
        entry["message"] = f"发音正常(edge-tts {before})"
        return _save(entry)

    entry.update(ok=False, detail=err)
    if not any_time and not is_night(now):
        entry.update(action="skipped_daytime",
                     message="发音生成失败。白天不自动升级(重启会打断上课),今晚会再试;着急可以手动跑")
        return _save(entry)

    latest, works, temp_err = try_latest_in_temp()
    if not works:
        entry.update(action="failed", detail=temp_err or err,
                     message=f"发音生成失败,最新版 edge-tts {latest or '?'} 也不行。"
                             "可能是网络或微软服务出问题,需要人工看")
        return _save(entry)
    if latest == before:
        # 临时环境里同一个版本能出声、线上不能 → 不是版本问题,升级没用
        entry.update(action="failed",
                     message=f"线上发音失败,但同版本 {before} 在临时环境里正常。不是版本问题,需要人工看")
        return _save(entry)

    installed, out = pip_install(python, f"edge-tts=={latest}")
    if not installed:
        entry.update(action="failed", detail=out, message=f"升级到 {latest} 时安装失败,线上没动,需要人工看")
        return _save(entry)
    ok2, err2 = probe(python)
    if not ok2:
        pip_install(python, f"edge-tts=={before}")
        entry.update(action="failed", detail=err2,
                     message=f"装上 {latest} 后发音仍失败,已退回 {before},需要人工看")
        return _save(entry)

    entry["version_after"] = latest
    restarted, _ = restart_service()
    if restarted and http_ok():
        entry.update(ok=True, action="upgraded",
                     message=f"发音组件被拒,已自动从 {before} 升到 {latest} 并重启服务,发音已恢复。"
                             f"记得把 requirements.txt 里的版本改成 {latest}")
    else:
        entry.update(action="failed",
                     message=f"已升级到 {latest},但重启服务后发音还是不正常,需要人工看")
    return _save(entry)


def _save(entry: dict) -> dict:
    history = read_history()
    history.insert(0, entry)
    STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATUS_FILE.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(history[:HISTORY_KEEP], ensure_ascii=False, indent=1))
    os.replace(tmp, STATUS_FILE)
    return entry


def read_history() -> list[dict]:
    try:
        data = json.loads(STATUS_FILE.read_text())
        return data if isinstance(data, list) else []
    except (OSError, ValueError):
        return []


def read_status() -> Optional[dict]:
    """给管理端首页: 最近一次检查 + 最近 7 天内有没有自动升级过"""
    history = read_history()
    if not history:
        return None
    last = dict(history[0])
    week_ago = (_now() - timedelta(days=7)).isoformat(timespec="seconds")
    last["recent_upgrade"] = next((h for h in history
                                   if h.get("action") == "upgraded" and h.get("checked_at", "") >= week_ago), None)
    return last
