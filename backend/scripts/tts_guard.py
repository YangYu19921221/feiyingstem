"""发音组件夜间自检(由 systemd 定时器 eh-tts-guard.timer 每晚 03:37 跑)

逻辑见 app/services/tts_guard.py: 合成一句新话 → 失败就在临时环境试最新版 edge-tts →
能出声才升级线上并重启服务。白天(7–23 点)只检查不升级。

用法(在 backend 目录下):
    ./venv/bin/python scripts/tts_guard.py              # 正常跑(定时器就这么调)
    ./venv/bin/python scripts/tts_guard.py --any-time   # 白天也允许升级 + 重启(会打断上课,慎用)
"""
import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.services import tts_guard  # noqa: E402


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--any-time", action="store_true", help="白天也允许升级并重启服务")
    args = ap.parse_args()
    entry = tts_guard.run_check(any_time=args.any_time)
    print(json.dumps(entry, ensure_ascii=False))
    return 0 if entry["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
