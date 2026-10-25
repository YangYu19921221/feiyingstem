"""音标视频走腾讯云 COS(2026-10-25)

为什么: 服务器出口只有 12M,9–10 月有 59 分钟光视频就超过 10M(峰值 34M),那几分钟背单词 / PK 一起慢。
视频挪到 COS 后,学生直接从腾讯云下载,不占服务器带宽。

怎么接(播放器一行不用改):
- 换票(/videos/{id}/ticket)照旧过闸门、扣次卡、记访问日志,签出来的仍是我们自己的 /stream?t= 地址
- /stream 验完票后,文件已在 COS 就 **302 跳到 COS 的签名地址**(私有桶,签名 2 小时多一点),
  浏览器自己跟着跳、带着 Range 去 COS 取片段 —— 拖进度条、Safari 要的 206 都由 COS 回
- 不在 COS / COS 没配 / 出错 → 照旧从本机磁盘串流(兜底,学生不会播不了)

什么时候算「在 COS」: 进程内缓存一份「已上传的 key → (大小, mtime)」清单,
和本机文件的大小 + mtime 都对得上才跳(faststart 换过文件、流畅版重压过都会变,对不上就走本机,
等 sync 补传)。清单来源: 启动时 list 一次桶(私有桶几百个对象,一次请求),上传成功时就地加。

防盗与之前同一个级别: COS 地址带签名、2 小时过期;我们自己的票据仍然只能播这一节、顶号即作废。
⚠️ 302 回包**不能被 nginx 缓存**(生产 nginx 在 http 级开着 proxy_cache): 带 Cache-Control: no-store,
否则 nginx 会把一个学生的签名跳转缓存下来发给别人。

CDN(2026-10-25 加): 管理端首页「音标视频加速」开关。开着 → 302 跳 CDN 地址(media.feiyingsteam.com,
回源这个私有桶,TypeA 鉴权);关着 → 跳 COS 签名地址(原来的方式)。
- 开关存文件 CDN_SWITCH_FILE(不放进程内存: 后端是多进程,改了要所有进程都看得到);读不了/坏了一律按关
- 打开前先实测一次 CDN(probe_cdn),测不过不让开 —— 配错了打开 = 全部视频播不了
- 地址带 v=本机文件 mtime: CDN 缓存键含普通参数、不含鉴权参数 sign(10-25 实测),
  faststart / 重压换了文件 v 就变,不会拿到 CDN 缓存的旧文件拼新文件的片段
- CDN_DOMAIN / CDN_AUTH_KEY 在 .env,Key 与 CDN 控制台「鉴权配置」的主 Key 一致
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

PREFIX = "phonetics/"
# 签名比我们自己的票据(2 小时)多留一点: 票据快到期时跳过去的那次也能把这一节放完
SIGN_SEC = 3 * 3600

_client = None
_bucket: Optional[str] = None
_inited = False
_index: dict[str, tuple[int, float]] = {}   # key -> (size, 本机 mtime 上传时的值)
_index_lock = threading.Lock()

BACKEND_DIR = Path(__file__).resolve().parents[2]
CDN_SWITCH_FILE = BACKEND_DIR / "private_media" / "cos_video" / "cdn_switch.json"
CDN_PROBE_BYTES = 1024
_BJ = timezone(timedelta(hours=8))


def _conf() -> tuple[Optional[str], Optional[str], Optional[str], Optional[str]]:
    return (os.environ.get("COS_BUCKET") or _dotenv("COS_BUCKET"),
            os.environ.get("COS_REGION") or _dotenv("COS_REGION"),
            os.environ.get("COS_SECRET_ID") or _dotenv("COS_SECRET_ID"),
            os.environ.get("COS_SECRET_KEY") or _dotenv("COS_SECRET_KEY"))


_dotenv_cache: Optional[dict] = None


def _dotenv(key: str) -> Optional[str]:
    """读 backend/.env(Settings 那边不加字段: config.py 在生产有注释 drift,不想动它)"""
    global _dotenv_cache
    if _dotenv_cache is None:
        _dotenv_cache = {}
        path = os.path.join(os.path.dirname(__file__), "..", "..", ".env")
        try:
            for line in open(path, encoding="utf-8"):
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    _dotenv_cache[k.strip()] = v.strip().strip('"').strip("'")
        except OSError:
            pass
    return _dotenv_cache.get(key) or None


def client():
    """COS 客户端;没配置 / 没装 SDK 返回 None(调用方一律走本机兜底)"""
    global _client, _bucket, _inited
    if _inited:
        return _client
    _inited = True
    bucket, region, sid, skey = _conf()
    if not (bucket and region and sid and skey):
        return None
    try:
        from qcloud_cos import CosConfig, CosS3Client
    except ImportError:
        logger.warning("COS 已配置但没装 cos-python-sdk-v5,视频照旧从本机串流")
        return None
    _client = CosS3Client(CosConfig(Region=region, SecretId=sid, SecretKey=skey, Scheme="https"))
    _bucket = bucket
    return _client


def enabled() -> bool:
    return client() is not None


def redirect_enabled(video_id: Optional[int] = None) -> bool:
    """播放要不要跳 COS。COS_REDIRECT=all 全部跳;=1,2,3 只跳这几节(先切一节验证用);不设/其它 = 都不跳。
    不跳时照旧本机串流 —— 上线顺序: 先只同步不跳 → 挑一节试 → 再切全部,任何时候改回不跳就回到原样"""
    v = (os.environ.get("COS_REDIRECT") or _dotenv("COS_REDIRECT") or "").strip().lower()
    if v == "all":
        return True
    if not v or video_id is None:
        return False
    return str(video_id) in {x.strip() for x in v.split(",")}


def redirect_mode() -> str:
    """给管理端看的: all = 全部跳 / some = 只跳几节 / off = 都不跳(此时 CDN 开关不起作用)"""
    v = (os.environ.get("COS_REDIRECT") or _dotenv("COS_REDIRECT") or "").strip().lower()
    return "all" if v == "all" else ("some" if v else "off")


# ---------- CDN ----------

def cdn_conf() -> tuple[Optional[str], Optional[str]]:
    """(域名, TypeA 主 Key);没配返回 None。域名写成 https://xxx/ 也认"""
    domain = (os.environ.get("CDN_DOMAIN") or _dotenv("CDN_DOMAIN") or "").strip()
    domain = re.sub(r"^https?://", "", domain).rstrip("/")
    key = (os.environ.get("CDN_AUTH_KEY") or _dotenv("CDN_AUTH_KEY") or "").strip()
    return (domain or None, key or None)


_switch_cache: Optional[tuple[tuple, dict]] = None


def read_cdn_switch() -> dict:
    """开关文件内容。文件没有 / 读不了 / 不是合法 JSON → {"enabled": False}(按关: 关 = 原来验证过的方式)。
    每次播放都会调: 按 (路径, mtime, 大小) 缓存,只多一次 stat"""
    global _switch_cache
    path = CDN_SWITCH_FILE
    try:
        st = os.stat(path)
    except OSError:
        return {"enabled": False}
    sig = (str(path), st.st_mtime_ns, st.st_size)
    if _switch_cache is not None and _switch_cache[0] == sig:
        return _switch_cache[1]
    try:
        data = json.loads(Path(path).read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            data = {}
    except (OSError, ValueError):
        data = {}
    data["enabled"] = data.get("enabled") is True
    _switch_cache = (sig, data)
    return data


def write_cdn_switch(enabled: bool, by: Optional[str] = None) -> dict:
    data = {"enabled": bool(enabled), "updated_at": datetime.now(_BJ).isoformat(timespec="seconds"),
            "updated_by": by}
    path = Path(CDN_SWITCH_FILE)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f"{path.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)
    return data


def cdn_enabled() -> bool:
    """开关开着且域名、Key 都配了。只开开关没配 Key → 照旧走 COS"""
    domain, key = cdn_conf()
    return bool(domain and key) and read_cdn_switch()["enabled"]


def cdn_signed_url(key: str, version: int) -> Optional[str]:
    """TypeA: sign = 时间戳-随机串-0-md5("/路径-时间戳-随机串-0-Key")。有效期在 CDN 控制台设(10800 秒),
    从签名时刻算。只签路径,v 参数不进签名"""
    domain, auth_key = cdn_conf()
    if not (domain and auth_key):
        return None
    path = "/" + key
    ts = int(time.time())
    rand = secrets.token_hex(5)
    digest = hashlib.md5(f"{path}-{ts}-{rand}-0-{auth_key}".encode()).hexdigest()
    return f"https://{domain}{path}?v={version}&sign={ts}-{rand}-0-{digest}"


def _pick_probe_file(directory: str) -> Optional[str]:
    """挑一个拿来测 CDN 的视频: 优先清单里已确认在 COS 的;清单是空的(这个进程不维护清单)就挑本机任意一个"""
    try:
        names = sorted(n for n in os.listdir(directory) if n.endswith(".mp4"))
    except OSError:
        return None
    paths = [os.path.join(directory, n) for n in names]
    paths = [p for p in paths if (_stat(p) or (0, 0))[0] >= CDN_PROBE_BYTES]
    for p in paths:
        if is_uploaded(p):
            return p
    # 最早改过的那个: 刚上传、还没同步上去的视频排到最后
    paths.sort(key=lambda p: (_stat(p) or (0, 0))[1])
    return paths[0] if paths else None


async def probe_cdn(directory: str) -> tuple[bool, str]:
    """从服务器按学生的方式取一次: 签 CDN 地址 → 取开头 1KB → 必须 206 且与本机文件一致"""
    import httpx

    domain, auth_key = cdn_conf()
    if not (domain and auth_key):
        return False, "服务器还没配 CDN 地址和鉴权 Key(.env 里的 CDN_DOMAIN / CDN_AUTH_KEY)"
    p = _pick_probe_file(directory)
    if p is None:
        return False, "服务器上还没有音标视频,没法测试"
    st = _stat(p)
    url = cdn_signed_url(key_for(p), int(st[1]) if st else 0)
    try:
        with open(p, "rb") as f:
            head = f.read(CDN_PROBE_BYTES)
        async with httpx.AsyncClient(timeout=10, trust_env=False, follow_redirects=False) as cli:
            r = await cli.get(url, headers={"Range": f"bytes=0-{len(head) - 1}"})
    except (httpx.HTTPError, OSError) as e:
        return False, f"连不上 CDN({domain}): {type(e).__name__}"
    server = (r.headers.get("server") or "").lower()
    if r.status_code == 403 and "cos" in server:
        return False, "CDN 去 COS 取文件被拒了(403): 检查 CDN 源站配置里「私有存储桶访问」开没开、授权了没有"
    if r.status_code == 403:
        return False, "CDN 鉴权没通过(403): 检查 CDN「鉴权配置」是不是 TypeA、主 Key 和服务器 .env 的 CDN_AUTH_KEY 一致不一致"
    if r.status_code == 404:
        return False, "CDN 上找不到视频(404): 检查 CDN 源站是不是这个 COS 桶"
    if r.status_code != 206:
        return False, f"CDN 返回 {r.status_code},不是正常的分段回包(206)"
    if r.content != head:
        return False, "CDN 返回的内容和服务器上的文件对不上"
    return True, f"CDN 正常: 从 {domain} 取到了视频开头,和服务器上的文件一致"


def key_for(local_path: str) -> str:
    return PREFIX + os.path.basename(local_path)


def _stat(local_path: str) -> Optional[tuple[int, float]]:
    try:
        st = os.stat(local_path)
        return st.st_size, st.st_mtime
    except OSError:
        return None


def refresh_index() -> int:
    """list 一遍桶里 phonetics/ 下的对象。对象的元数据里存了上传时本机文件的 mtime(x-cos-meta-mtime)"""
    c = client()
    if c is None:
        return 0
    found: dict[str, tuple[int, float]] = {}
    marker = ""
    while True:
        r = c.list_objects(Bucket=_bucket, Prefix=PREFIX, Marker=marker, MaxKeys=1000)
        for o in r.get("Contents", []) or []:
            key = o["Key"]
            try:
                meta = c.head_object(Bucket=_bucket, Key=key)
                mtime = float(meta.get("x-cos-meta-mtime") or 0)
            except Exception:  # noqa: BLE001
                mtime = 0.0
            found[key] = (int(o["Size"]), mtime)
        if r.get("IsTruncated") == "true":
            marker = r.get("NextMarker") or (r["Contents"][-1]["Key"] if r.get("Contents") else "")
            if not marker:
                break
        else:
            break
    with _index_lock:
        _index.clear()
        _index.update(found)
    return len(found)


def is_uploaded(local_path: str) -> bool:
    st = _stat(local_path)
    if st is None:
        return False
    with _index_lock:
        got = _index.get(key_for(local_path))
    return got is not None and got[0] == st[0] and abs(got[1] - st[1]) < 1.0


def upload(local_path: str) -> bool:
    """传一个文件(大文件自动分块)。成功后记进清单。失败返回 False,不抛"""
    c = client()
    st = _stat(local_path)
    if c is None or st is None:
        return False
    key = key_for(local_path)
    try:
        c.upload_file(Bucket=_bucket, Key=key, LocalFilePath=local_path, PartSize=10, MAXThread=4,
                      ContentType="video/mp4", Metadata={"x-cos-meta-mtime": f"{st[1]:.6f}"})
    except Exception as e:  # noqa: BLE001
        logger.warning("视频传 COS 失败 %s: %s", key, e)
        return False
    # 传的过程中文件被换了(faststart/重压): 记上传前的那份,下次 is_uploaded 对不上就会补传
    with _index_lock:
        _index[key] = st
    return True


def delete(local_path: str) -> None:
    c = client()
    if c is None:
        return
    key = key_for(local_path)
    try:
        c.delete_object(Bucket=_bucket, Key=key)
    except Exception as e:  # noqa: BLE001
        logger.warning("删 COS 视频失败 %s: %s", key, e)
    with _index_lock:
        _index.pop(key, None)


def signed_url(local_path: str) -> Optional[str]:
    """文件在 COS 且与本机一致 → 签名地址(CDN 开关开着给 CDN 地址,关着给 COS 地址);否则 None(调用方走本机串流)"""
    c = client()
    if c is None or not is_uploaded(local_path):
        return None
    if cdn_enabled():
        st = _stat(local_path)
        url = cdn_signed_url(key_for(local_path), int(st[1]) if st else 0)
        if url:
            return url
    try:
        return c.get_presigned_url(Bucket=_bucket, Key=key_for(local_path), Method="GET", Expired=SIGN_SEC)
    except Exception as e:  # noqa: BLE001
        logger.warning("签 COS 地址失败 %s: %s", local_path, e)
        return None


# ---------- 后台同步: 本机有、COS 没有(或不一致)的就补传 ----------

_sync_lock = threading.Lock()


def sync_dir(directory: str) -> dict:
    """把目录里的原片和流畅版(*.mp4)都对齐到 COS。一次只跑一个;返回 {uploaded, skipped, failed}"""
    out = {"uploaded": 0, "skipped": 0, "failed": 0}
    if client() is None or not _sync_lock.acquire(blocking=False):
        return out
    try:
        for name in sorted(os.listdir(directory)):
            if not name.endswith(".mp4"):
                continue      # .tmp(压到一半)/.lite.skip 标记都不传
            p = os.path.join(directory, name)
            if is_uploaded(p):
                out["skipped"] += 1
            elif upload(p):
                out["uploaded"] += 1
            else:
                out["failed"] += 1
        return out
    finally:
        _sync_lock.release()


def start_background_sync(directory: str, every_sec: int = 600) -> None:
    """启动时 list 一次桶,之后每 every_sec 秒补传一次(新上传/重压的视频)。没配 COS 什么都不做"""
    if client() is None:
        return

    def _loop():
        try:
            n = refresh_index()
            logger.info("COS 视频清单: %s 个", n)
        except Exception as e:  # noqa: BLE001
            logger.warning("读 COS 清单失败,先全部走本机: %s", e)
        while True:
            try:
                r = sync_dir(directory)
                if r["uploaded"] or r["failed"]:
                    logger.info("COS 视频同步: %s", r)
            except Exception as e:  # noqa: BLE001
                logger.warning("COS 视频同步出错: %s", e)
            time.sleep(every_sec)

    threading.Thread(target=_loop, name="cos-video-sync", daemon=True).start()
