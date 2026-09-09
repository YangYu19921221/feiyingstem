"""开播前踢残留推流者(RtcStreamBusy/502 根治)的单测。

不连真 SRS:用假 httpx.AsyncClient 记录请求。覆盖四条:
1. 命中残留(publish + url 匹配)→ 精确 DELETE 掉,返回踢掉数
2. 首播无残留(clients 为空 / 无匹配)→ 不 DELETE,返回 0(幂等无副作用)
3. 只踢 publish==True 且 url 结尾匹配本 stream 的,不误伤别的课/拉流者(WHEP)
4. SRS API 异常(超时/坏响应)→ 吞掉不抛,返回 0(不阻断开播)
"""
import asyncio
import pytest

from app.services import live_service
from app.core.config import settings


class _FakeResp:
    def __init__(self, status_code=200, json_data=None):
        self.status_code = status_code
        self._json = json_data or {}

    def json(self):
        return self._json

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")


class _FakeClient:
    """记录 GET/DELETE 调用;GET 返回预设 clients,DELETE 记录被踢的 cid。"""
    def __init__(self, clients, *, get_raises=False, delete_status=200):
        self._clients = clients
        self._get_raises = get_raises
        self._delete_status = delete_status
        self.deleted = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url):
        if self._get_raises:
            raise RuntimeError("SRS 不可达")
        return _FakeResp(200, {"clients": self._clients})

    async def delete(self, url):
        cid = url.rstrip("/").rsplit("/", 1)[-1]
        self.deleted.append(cid)
        return _FakeResp(self._delete_status)


@pytest.fixture(autouse=True)
def _live_cfg(monkeypatch):
    # 固定配置,和真实生产口径一致
    monkeypatch.setattr(settings, "LIVE_KICK_BEFORE_PUBLISH", True)
    monkeypatch.setattr(settings, "LIVE_SRS_API_HOST", "")
    monkeypatch.setattr(settings, "LIVE_API_HOST", "live.feiyingsteam.com")
    monkeypatch.setattr(settings, "LIVE_ORIGIN_HOST", "live.feiyingsteam.com")
    monkeypatch.setattr(settings, "LIVE_SCHEME", "https")
    monkeypatch.setattr(settings, "LIVE_PUSH_PATH", "/live")
    # 别让 sleep 拖慢测试(捕获真 sleep 再替换,避免 lambda 引用被替换后的自己)
    _real_sleep = asyncio.sleep
    monkeypatch.setattr(live_service.asyncio, "sleep", lambda *_a, **_k: _real_sleep(0))


def _patch_client(monkeypatch, fake):
    monkeypatch.setattr(live_service.httpx, "AsyncClient", lambda *a, **k: fake)
    return fake


@pytest.mark.asyncio
async def test_kick_hits_residual(monkeypatch):
    """残留推流者(publish + url 匹配)被精确踢掉"""
    fake = _patch_client(monkeypatch, _FakeClient([
        {"id": "cid_a", "publish": True, "url": "/live/abc123", "type": "rtc-publish"},
    ]))
    n = await live_service.kick_stream_publisher("abc123")
    assert n == 1
    assert fake.deleted == ["cid_a"]


@pytest.mark.asyncio
async def test_no_residual_is_noop(monkeypatch):
    """首播无残留 → 不踢任何人,返回 0(幂等)"""
    fake = _patch_client(monkeypatch, _FakeClient([]))
    n = await live_service.kick_stream_publisher("abc123")
    assert n == 0
    assert fake.deleted == []


@pytest.mark.asyncio
async def test_only_matching_publisher_kicked(monkeypatch):
    """只踢本 stream 的 publisher,不误伤别的课 / 拉流者(WHEP publish=False)"""
    fake = _patch_client(monkeypatch, _FakeClient([
        {"id": "other_course", "publish": True, "url": "/live/OTHERKEY", "type": "rtc-publish"},
        {"id": "a_player", "publish": False, "url": "/live/abc123", "type": "rtc-play"},
        {"id": "the_one", "publish": True, "url": "/live/abc123", "type": "rtc-publish"},
    ]))
    n = await live_service.kick_stream_publisher("abc123")
    assert n == 1
    assert fake.deleted == ["the_one"]


@pytest.mark.asyncio
async def test_srs_api_error_does_not_raise(monkeypatch):
    """SRS API 异常 → 吞掉不抛,返回 0(不阻断开播)"""
    fake = _patch_client(monkeypatch, _FakeClient([], get_raises=True))
    n = await live_service.kick_stream_publisher("abc123")
    assert n == 0
    assert fake.deleted == []


@pytest.mark.asyncio
async def test_kick_disabled_switch(monkeypatch):
    """开关关闭时直接返回 0,不发任何请求"""
    monkeypatch.setattr(settings, "LIVE_KICK_BEFORE_PUBLISH", False)
    fake = _patch_client(monkeypatch, _FakeClient([
        {"id": "cid_a", "publish": True, "url": "/live/abc123", "type": "rtc-publish"},
    ]))
    n = await live_service.kick_stream_publisher("abc123")
    assert n == 0
    assert fake.deleted == []
