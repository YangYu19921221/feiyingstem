"""进程角色: 主进程 + 工作进程池(2026-10-25)

以前后端只有一个 uvicorn 进程,Python 一个进程只能用满 1 核(GIL),4 核机器只用 1 核。
现在拆成两种:

- **主进程**(PROCESS_ROLE 不设 / =all,端口 8000,就是原来那个 english-helper 服务):
  什么都能处理。下面 MAIN_ONLY 这些**只能**在它这里 —— 状态在它的内存里,别的进程拿不到:
  PK 房间 / 竞赛排行广播 / 直播弹幕 / 宠物对战的 WebSocket 连接对象、开口背录音转写进程池、
  Whisper 语音模型(一个进程一份,约 500MB,不能每个工作进程都加载一份)、
  音标视频 COS 清单(services/cos_video,只有主进程的同步线程在维护)、服务器监控采样;
  另外金币每日结算、转写调度、COS 同步这些后台任务也只在主进程跑(跑多份会重复发币)。
- **工作进程**(PROCESS_ROLE=worker,端口 8001,uvicorn --workers N,个数见 core/worker_plan):
  其余所有接口。限流、AI 次数、验证码、在线状态、考试答案等跨请求的小数据都放在
  core/shared_store(Redis),所以哪个进程接到请求都一样。

nginx 按路径分流(deploy/multiproc/nginx/api-locations.inc),那份路径清单必须覆盖这里的
MAIN_ONLY + PREFER_MAIN(测试解析那个文件核对)。两类的区别:
- MAIN_ONLY: 工作进程万一收到(nginx 配错了)**直接 503 拒掉**,不悄悄处理 —— 悄悄处理的后果是
  PK 房间「找不到」、弹幕收不到、每个工作进程各加载一份 500MB 的语音模型,很难查
- PREFER_MAIN: 落到工作进程也能用,只是差一点(视频不跳 COS 改本机串流、监控曲线按进程分段),不拦
"""
from __future__ import annotations

import json
import logging
import os
import re

logger = logging.getLogger(__name__)

ROLE = (os.environ.get("PROCESS_ROLE") or "all").strip().lower()
if ROLE not in ("all", "worker"):
    logger.warning("PROCESS_ROLE=%r 不认识,按 all(主进程)处理", ROLE)
    ROLE = "all"

# 只能由主进程处理的路径
MAIN_ONLY_PREFIXES = (
    "/api/v1/pk/",                     # PK 房间 / 晋级赛: 房间状态在主进程内存 + WebSocket
    "/api/v1/competition/",            # 竞赛: 答题接口会往 WebSocket 连接广播排行
    "/api/v1/live/ws/",                # 直播弹幕 WebSocket
    "/api/v1/student/battle/ws/",      # 宠物对战 WebSocket
)
PREFER_MAIN_PREFIXES = (
    "/api/v1/admin/server/",           # 服务器监控: 采样曲线存在处理请求的那个进程里
)
MAIN_ONLY_EXACT = (
    "/api/v1/pronunciation/verify-word",   # 本机 Whisper 模型
    "/api/v1/assessment/evaluate",         # 同上
)
# 落到工作进程也能用,但放主进程更好(nginx 照样分到主进程)
PREFER_MAIN_PATTERNS = (
    re.compile(r"^/api/v1/phonetics/videos/\d+/stream$"),   # COS 跳转清单只有主进程在维护,工作进程会改走本机串流
)


def is_worker() -> bool:
    return ROLE == "worker"


def label() -> str:
    """响应头 X-EH-Proc 的值: 部署后 curl 一下就知道请求落在哪种进程上"""
    return "worker" if is_worker() else "main"


def is_main_only(path: str) -> bool:
    return path.startswith(MAIN_ONLY_PREFIXES) or path in MAIN_ONLY_EXACT


def prefers_main(path: str) -> bool:
    return path.startswith(PREFER_MAIN_PREFIXES) or any(p.match(path) for p in PREFER_MAIN_PATTERNS)


class ProcessRoleMiddleware:
    """纯 ASGI 中间件(http 和 websocket 都要管,@app.middleware("http") 管不到 websocket):
    ①所有 http 响应加 X-EH-Proc ②工作进程收到 MAIN_ONLY 请求 → http 503 / websocket 关闭(1013 稍后再试)"""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        kind = scope.get("type")
        if kind not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        path = scope.get("path") or ""
        if is_worker() and is_main_only(path):
            logger.error("工作进程收到只该主进程处理的请求(检查 nginx 分流): %s", path)
            if kind == "websocket":
                await receive()   # websocket.connect;不接受直接关 = 握手失败,前端会重连
                await send({"type": "websocket.close", "code": 1013})
                return
            body = json.dumps({"detail": "服务正在调整,请稍后再试"}, ensure_ascii=False).encode()
            await send({"type": "http.response.start", "status": 503, "headers": [
                (b"content-type", b"application/json; charset=utf-8"),
                (b"content-length", str(len(body)).encode()),
                (b"x-eh-proc", label().encode()),
            ]})
            await send({"type": "http.response.body", "body": body})
            return
        if kind == "websocket":
            return await self.app(scope, receive, send)

        tag = label().encode()

        async def _send(message):
            if message["type"] == "http.response.start":
                message = dict(message)
                message["headers"] = list(message.get("headers") or []) + [(b"x-eh-proc", tag)]
            await send(message)

        return await self.app(scope, receive, _send)


async def init_worker() -> None:
    """工作进程启动: 不建表不迁移(主进程做;systemd 等主进程 /health 通了才起工作进程),
    只把模型都导进来(关系映射要全)并注册租户过滤 —— 这一步漏了,工作进程上的查询就不按机构隔离"""
    from app.models import user, word, learning, pet, assessment  # noqa: F401
    from app.models import organization, coin, phonetic, card_pack  # noqa: F401
    for mod in ("competition", "sentence", "sentence_learning", "sentence_speech"):
        try:
            __import__(f"app.models.{mod}")
        except Exception:  # noqa: BLE001  与 init_db 同口径: 可选模块缺了不拦启动
            pass
    from app.core.tenancy import register_tenant_models
    register_tenant_models()
