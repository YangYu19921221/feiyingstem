"""直播媒体平面服务 —— 只签凭据,不碰媒体流量

## 为什么这么分层
本机出口带宽 12Mbps,**已经是现有容量瓶颈**(管理端容量页三路估算取最小值恒是带宽)。
30 人 720p 一节课要 45Mbps,100 人要 150Mbps —— 视频流量绝对不能过这台机器。
所以:老师推到 SRS 源站 → 源站转推 CDN → 学生从 CDN 边缘拉。本服务只做四件事:
建房、签推流地址、签播放票据、记考勤。带宽消耗 ≈ 0,不受单 worker / SQLite 拖累。

## 弹性
源站负载只跟"同时开几节课"有关,**跟每节课多少人看无关** —— 100 人和 1000 人对源站
都是一路进一路出,扇出全在 CDN。所以:
- 1~3 节并行:1 台 2 核 4G 源站够
- 10 节以上:加源站节点,`pick_origin_node()` 按负载派发,写进 live_sessions.origin_node
- 突发大课:该场 push_provider 切云直播 SaaS,只换本文件的签发分支

## 安全
- stream_key 随机 32 位十六进制 —— 可猜就能蹭课/劫持推流
- 推流地址**只给老师**,任何学生端响应都不含它
- 播放地址按人签发、默认 5 分钟过期(CDN TypeA 防盗链),转发到校外很快失效
"""
from __future__ import annotations

import hashlib
import secrets
import time
from dataclasses import dataclass

from app.core.config import settings


def new_stream_key() -> str:
    """建房时生成。不可猜是安全前提,别用 session_id 之类可枚举的值"""
    return secrets.token_hex(16)


def pick_origin_node() -> str | None:
    """选源站节点。单源站阶段返回 None(用配置里的默认),多节点时在这里做负载派发。

    刻意留成函数而不是直接读配置:扩容时只改这里,调用方和表结构都不动。
    """
    return None


def _origin_host(origin_node: str | None) -> str:
    return origin_node or settings.LIVE_ORIGIN_HOST


def _host_only(host: str) -> str:
    """剥掉 host:port 里的端口。RTMP 要用自己的端口,不能带 HTTP 端口"""
    return host.split(":", 1)[0]


@dataclass
class PushCredentials:
    """老师端推流凭据。**只发给老师**"""
    whip_url: str      # 浏览器一键开播(WHIP,RFC 9725),免装 OBS
    rtmp_url: str      # OBS/推流机备用
    stream_key: str
    expires_at: int


def build_push_credentials(stream_key: str, origin_node: str | None = None) -> PushCredentials:
    """签推流地址。WHIP 优先——老师点网页按钮就能开播,不用教他们装 OBS。"""
    host = _origin_host(origin_node)
    if not host:
        raise RuntimeError("LIVE_ORIGIN_HOST 未配置,直播源站不可用")
    app_path = settings.LIVE_PUSH_PATH.strip("/")
    # WHIP 端点:生产走 Nginx 443 反代(api_host 留空即复用 origin);
    # 本地无反代要直连 SRS 的 HTTP-API 端口
    api_host = settings.LIVE_API_HOST or host
    scheme = settings.LIVE_SCHEME
    return PushCredentials(
        whip_url=f"{scheme}://{api_host}/rtc/v1/whip/?app={app_path}&stream={stream_key}",
        # RTMP 独立端口,不能沿用 host 里的 HTTP 端口
        rtmp_url=f"rtmp://{_host_only(host)}:{settings.LIVE_RTMP_PORT}/{app_path}/{stream_key}",
        stream_key=stream_key,
        expires_at=int(time.time()) + 6 * 3600,  # 一节课不会超过 6 小时
    )


def _cdn_auth_suffix(path: str, expire_ts: int, uid: str) -> str:
    """腾讯云/阿里云 TypeA 防盗链签名。

    md5(key + path + expire + uid) —— 不签的话播放链接被整班转发到校外挡不住。
    LIVE_CDN_AUTH_KEY 没配就返回空串(直连源站的开发环境)。
    """
    if not settings.LIVE_CDN_AUTH_KEY:
        return ""
    raw = f"{settings.LIVE_CDN_AUTH_KEY}{path}{expire_ts}{uid}"
    sign = hashlib.md5(raw.encode()).hexdigest()
    return f"?auth_key={expire_ts}-{uid}-0-{sign}"


@dataclass
class PlayUrls:
    """学生端播放地址。三种协议都给,前端按浏览器能力挑"""
    flv: str           # HTTP-FLV,延迟 1~3 秒,PC 首选
    hls: str           # LLHLS,兼容性最好,iOS Safari 必需
    webrtc: str        # WHEP,亚秒级,想要极低延迟时用
    expires_at: int


def build_play_urls(stream_key: str, viewer_id: int, origin_node: str | None = None) -> PlayUrls:
    """按人签播放地址。**每个学生的 URL 不同且短时过期** —— 这是防转发的关键。

    CDN 域名没配时回退直连源站(仅限试点小规模;上百人必须挂 CDN,
    否则源站上行就是新瓶颈)。
    """
    host = settings.LIVE_CDN_HOST or _origin_host(origin_node)
    if not host:
        raise RuntimeError("直播播放域名未配置")
    app_path = settings.LIVE_PUSH_PATH.strip("/")
    expire_ts = int(time.time()) + settings.LIVE_PLAY_TOKEN_TTL
    uid = str(viewer_id)

    flv_path = f"/{app_path}/{stream_key}.flv"
    hls_path = f"/{app_path}/{stream_key}.m3u8"
    scheme = settings.LIVE_SCHEME
    api_host = settings.LIVE_API_HOST or host
    return PlayUrls(
        flv=f"{scheme}://{host}{flv_path}{_cdn_auth_suffix(flv_path, expire_ts, uid)}",
        hls=f"{scheme}://{host}{hls_path}{_cdn_auth_suffix(hls_path, expire_ts, uid)}",
        # WHEP 和 WHIP 同在 HTTP-API 端口
        webrtc=f"{scheme}://{api_host}/rtc/v1/whep/?app={app_path}&stream={stream_key}",
        expires_at=expire_ts,
    )


def live_available() -> bool:
    """直播是否可用。未配源站时前端隐藏入口,而不是点进去报错"""
    return bool(settings.LIVE_ENABLED and settings.LIVE_ORIGIN_HOST)
