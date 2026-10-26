"""单词记忆图(2026-10-27,用户「GPT Image 2.5 Sunburst…你看看这个 agent 怎么配合,这个定价 3 毛一张,你设计下」)

小鹰老师讲完一个难记的词,可以给孩子画一张绘本风格的记忆插图;错题本每个词也能「看记忆图」。

## 一个词全平台只画一张
- 按「小写拼写 + 主释义」(pic_key)一张图,画好存公开目录 UPLOAD_DIR/word-pics(图里只有单词的画面,
  没有任何孩子的信息,与封面图同性质),之后**谁看都秒出、不扣次数**
- 第一个点「画」的孩子扣 1 次学习助手次数(加盟机构进货价 ¥0.3/次 = 3 毛一张);画不出来退回
- 正在画(pending)的别人再点,不扣次数,等同一张
- 每人每天最多画 DAILY_LIMIT 张新图(防刷);看已有的不限
- 原图约 1.5MB,压成长边 768 的 JPEG(约 100KB)再存: 服务器出口 12M,原图几十个孩子一起看就堵了

## 只给学习助手画图用的 Key
存 ai_providers 一行 provider_name='image_tutor'(加密),**不能设默认**,别的 AI 功能读不到它
(admin/ai_config + ai_service 三处查询都排除 DEDICATED_PROVIDERS)。原来做卡面 / 封面的 IMAGE_API_KEY(.env)不动。
模型默认 gpt-image-2.5-sunburst,quality=low(10-27 实测: low 27 秒、标准 81 秒,画面看不出差别;
low 每张扣中转钱包 0.15,标准约 1.25)

## 画什么由服务器定
提示词 = 固定风格(绘本、白底、不写字)+ 单词 + 课本主释义 + 一句记忆画面(助手给的,截 80 字)。
孩子不能自己写画什么(画出来不可控,也没法按词复用)。

## 进程
画图要 20–90 秒,在后台任务里跑(自己开数据库会话),前端每 3 秒问一次状态。
进程中途重启: pending 超过 STALE_SEC 的算卡住,下一个人点时重新画,并退回上一个人扣的那次。
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import logging
import os
import re
import time
from datetime import timedelta
from typing import Optional

import httpx
from sqlalchemy import or_, select, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.shared_store import store
from app.core.timeutil import local_today, utc_now
from app.models.system_config import AIProvider, SystemConfig
from app.models.tutor import WordPicture
from app.models.user import User
from app.models.word import Word, WordDefinition

logger = logging.getLogger(__name__)

PROVIDER_NAME = "image_tutor"
SETTINGS_KEY = "tutor_picture_settings"
DEFAULT_MODEL = "gpt-image-2.5-sunburst"
DEFAULT_QUALITY = "low"
QUALITIES = ("low", "medium", "high")
DEFAULT_SETTINGS = {"enabled": True, "daily_limit": 5}
COST = 1                  # 画一张新图扣几次学习助手次数(合同第三条第 10 款)
STALE_SEC = 300           # pending 超过这么久算卡住(进程重启等)
TIMEOUT_SEC = 180
SAVE_DIM = 768
SUBDIR = "word-pics"
URL_PREFIX = f"/api/v1/files/{SUBDIR}/"
MAX_PARALLEL = 2          # 每个进程同时最多画几张
IDEA_MAX = 80

_sem = asyncio.Semaphore(MAX_PARALLEL)
_running: set[asyncio.Task] = set()
# 测试里换成共用测试会话的工厂
session_factory = None


def _session():
    if session_factory is not None:
        return session_factory()
    from app.core.database import AsyncSessionLocal
    return AsyncSessionLocal()


def new_client() -> httpx.AsyncClient:
    """trust_env=False: 本机 SOCKS 代理会让 httpx 崩。测试替换这个函数"""
    return httpx.AsyncClient(timeout=httpx.Timeout(TIMEOUT_SEC, connect=10.0), trust_env=False, follow_redirects=True)


# ---------------------------------------------------------------- 配置

async def get_settings(db: AsyncSession) -> dict:
    row = (await db.execute(select(SystemConfig).where(SystemConfig.config_key == SETTINGS_KEY))).scalar_one_or_none()
    out = dict(DEFAULT_SETTINGS)
    if row and row.config_value:
        try:
            data = json.loads(row.config_value)
        except ValueError:
            data = {}
        if isinstance(data, dict):
            if isinstance(data.get("enabled"), bool):
                out["enabled"] = data["enabled"]
            try:
                v = int(data.get("daily_limit", out["daily_limit"]))
                if 1 <= v <= 50:
                    out["daily_limit"] = v
            except (TypeError, ValueError):
                pass
    return out


async def save_settings(db: AsyncSession, enabled: bool, daily_limit: int) -> None:
    value = json.dumps({"enabled": enabled, "daily_limit": daily_limit})
    row = (await db.execute(select(SystemConfig).where(SystemConfig.config_key == SETTINGS_KEY))).scalar_one_or_none()
    if row is None:
        db.add(SystemConfig(config_key=SETTINGS_KEY, config_value=value, config_type="json",
                            description="学习助手画记忆图: 开没开、每人每天最多画几张新图"))
    else:
        row.config_value = value


async def provider_row(db: AsyncSession) -> Optional[AIProvider]:
    return (await db.execute(select(AIProvider).where(AIProvider.provider_name == PROVIDER_NAME))).scalar_one_or_none()


async def image_conf(db: AsyncSession) -> Optional[dict]:
    """画图用的那一行;没配 / 停用 / 密钥解不开返回 None"""
    from app.api.v1.admin.ai_config import decrypt_api_key

    row = await provider_row(db)
    if row is None or not row.enabled or not row.api_key:
        return None
    key = decrypt_api_key(row.api_key)
    if not key or key == "DECRYPTION_FAILED":
        return None
    base = (row.base_url or "").strip().rstrip("/")
    if base.endswith("/v1"):
        base = base[:-3]
    if not base:
        return None
    extra = row.extra_config or {}
    quality = extra.get("quality") if extra.get("quality") in QUALITIES else DEFAULT_QUALITY
    return {"key": key, "base": base, "model": (row.model_name or DEFAULT_MODEL).strip(), "quality": quality}


async def available(db: AsyncSession) -> bool:
    return (await get_settings(db))["enabled"] and await image_conf(db) is not None


# ---------------------------------------------------------------- 一个词 = 一张图

def _norm_meaning(meaning: Optional[str]) -> str:
    m = re.sub(r"[(（][^)）]*[)）]", "", meaning or "")
    m = re.sub(r"^\s*[a-z]+\.\s*", "", m.strip(), flags=re.I)        # 去掉开头的词性 n. / v.
    return re.split(r"[;；,，、]", m)[0].strip()[:40]


def pic_key(word: str, meaning: Optional[str]) -> str:
    return hashlib.sha1(f"{word.strip().lower()}|{_norm_meaning(meaning)}".encode()).hexdigest()


async def find_word(db: AsyncSession, word_id: Optional[int] = None, text: Optional[str] = None) -> Optional[tuple[str, Optional[str]]]:
    """(拼写, 主释义)。按 id 找或按拼写找(有释义的优先)"""
    from app.services.tutor import _find_word

    w = await db.get(Word, word_id) if word_id else await _find_word(db, text or "")
    if w is None:
        return None
    meaning = (await db.execute(
        select(WordDefinition.meaning).where(WordDefinition.word_id == w.id)
        .order_by(WordDefinition.is_primary.desc(), WordDefinition.id).limit(1)
    )).scalar_one_or_none()
    return w.word, meaning


async def lookup(db: AsyncSession, word: str, meaning: Optional[str]) -> Optional[WordPicture]:
    return (await db.execute(select(WordPicture).where(WordPicture.pic_key == pic_key(word, meaning)))).scalar_one_or_none()


def out(p: WordPicture) -> dict:
    status = p.status
    if status == "pending" and p.started_at and utc_now() - p.started_at > timedelta(seconds=STALE_SEC):
        status = "failed"
    return {"pic_id": p.id, "word": p.word, "meaning": p.meaning, "status": status,
            "url": p.url if status == "ready" else None,
            "error": "这张图没画出来,过一会儿再试一次(没扣次数)" if status == "failed" else None}


def build_prompt(word: str, meaning: Optional[str], idea: str) -> str:
    idea = re.sub(r"\s+", " ", idea or "").strip()[:IDEA_MAX]
    scene = idea or "用一个简单、有趣、一看就懂的画面表现这个意思"
    return (f"儿童绘本风格的英语单词记忆插图,给中国中小学生记单词用。单词: {word}"
            + (f"(意思: {_norm_meaning(meaning)})" if meaning else "")
            + f"。画面: {scene}。要求: 白色背景,主体居中,暖色明亮,线条干净可爱,适合小学生;"
              "画面里不要出现文字和数字(画面里明确要某个字母形状时才画那个字母);不画真实人物的脸、品牌标志。")


def _day_key(user_id: int) -> str:
    return f"tutor:pic:{user_id}:{local_today().isoformat()}"


class PictureRefused(Exception):
    """画不了(次数不够 / 今天画满了 / 没开)。message 直接给孩子看"""


async def request(db: AsyncSession, user: User, word: str, meaning: Optional[str], idea: str = "") -> dict:
    """要一张图: 有就直接给;正在画就等;没有(或上次没画出来)就扣 1 次开画。返回 out() + charged"""
    from app.services import tutor as tt

    if not await available(db):
        raise PictureRefused("画图功能现在没开")
    key = pic_key(word, meaning)
    p = (await db.execute(select(WordPicture).where(WordPicture.pic_key == key))).scalar_one_or_none()
    if p is not None:
        o = out(p)
        if o["status"] in ("ready", "pending"):
            return {**o, "charged": 0}

    settings_ = await tt.get_settings(db)
    limit = (await get_settings(db))["daily_limit"]
    if not await store.incr_if_below(_day_key(user.id), limit, 2 * 86400):
        raise PictureRefused(f"今天已经画了 {limit} 张新图,明天再画吧(画过的图随时能看)")
    if not await tt.consume(db, user.id, COST, settings_["free_total"]):
        await store.incr(_day_key(user.id), -1, 2 * 86400)
        raise PictureRefused("次数不够了,画一张新图要用掉 1 次")

    now = utc_now()
    prev = None
    if p is None:
        r = await db.execute(sqlite_insert(WordPicture).values(
            pic_key=key, word=word[:100], meaning=(meaning or "")[:200] or None, status="pending",
            requested_by=user.id, charged=COST, started_at=now, created_at=now,
        ).on_conflict_do_nothing(index_elements=[WordPicture.pic_key]))
        claimed = r.rowcount == 1
    else:
        prev = (p.requested_by, p.charged)
        claimed = await reclaim(db, p.id, user.id, now)
    await db.commit()
    p = (await db.execute(select(WordPicture).where(WordPicture.pic_key == key)
                          .execution_options(populate_existing=True))).scalar_one()
    if not claimed:
        # 别人刚好同时开画了: 这次不算,等那一张
        await tt.refund(db, user.id, COST)
        await store.incr(_day_key(user.id), -1, 2 * 86400)
        return {**out(p), "charged": 0}
    if prev and prev[0] and prev[1]:
        # 上一次卡住了(进程重启,没来得及写结果): 那次扣的退回去(同一个孩子再点也一样,不能扣两次)
        await tt.refund(db, prev[0], prev[1])
    _spawn(p.id, build_prompt(word, meaning, idea))
    return {**out(p), "charged": COST}


async def reclaim(db: AsyncSession, pic_id: int, user_id: int, now) -> bool:
    """条件认领一张要重画的图: 只有「没画出来 / 删掉了 / 卡住了」的才认领成功。
    两个孩子同时点同一个没画出来的词,都扣了次数,只有一个认领到,另一个退回(request 里)。不 commit"""
    stale = now - timedelta(seconds=STALE_SEC)
    r = await db.execute(
        update(WordPicture)
        .where(WordPicture.id == pic_id,
               or_(WordPicture.status.in_(("failed", "removed")),
                   (WordPicture.status == "pending") & (WordPicture.started_at < stale)))
        .values(status="pending", requested_by=user_id, charged=COST, started_at=now, finished_at=None,
                error=None, removed_by=None)
        .execution_options(synchronize_session=False))
    return r.rowcount == 1


def _spawn(pic_id: int, prompt: str) -> None:
    task = asyncio.create_task(_generate(pic_id, prompt))
    _running.add(task)
    task.add_done_callback(_running.discard)


async def call_image_api(conf: dict, prompt: str) -> bytes:
    body = {"model": conf["model"], "prompt": prompt, "n": 1, "size": "1024x1024", "quality": conf["quality"]}
    async with new_client() as c:
        r = await c.post(f"{conf['base']}/v1/images/generations",
                         headers={"Authorization": f"Bearer {conf['key']}"}, json=body)
        if r.status_code != 200:
            raise RuntimeError(f"{r.status_code} {r.text[:150]}")
        d = (r.json().get("data") or [{}])[0]
        if d.get("b64_json"):
            return base64.b64decode(d["b64_json"])
        if d.get("url"):
            img = await c.get(d["url"])
            img.raise_for_status()
            return img.content
        raise RuntimeError("没有返回图片")


def shrink(raw: bytes) -> bytes:
    from PIL import Image

    img = Image.open(io.BytesIO(raw))
    if img.mode in ("RGBA", "LA", "P"):
        img = img.convert("RGBA")
        bg = Image.new("RGB", img.size, (255, 255, 255))
        bg.paste(img, mask=img.split()[-1])
        img = bg
    elif img.mode != "RGB":
        img = img.convert("RGB")
    img.thumbnail((SAVE_DIM, SAVE_DIM))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=84, optimize=True)
    return buf.getvalue()


def _pic_dir() -> str:
    d = os.path.join(settings.UPLOAD_DIR, SUBDIR)
    os.makedirs(d, exist_ok=True)
    return d


def _remove_file(url: Optional[str]) -> None:
    if not url or not url.startswith(URL_PREFIX):
        return
    name = os.path.basename(url[len(URL_PREFIX):].split("?")[0])
    path = os.path.join(_pic_dir(), name)
    try:
        os.remove(path)
    except FileNotFoundError:
        pass


async def _generate(pic_id: int, prompt: str) -> None:
    from app.services import tutor as tt

    async with _sem:
        err: Optional[str] = None
        url: Optional[str] = None
        model = None
        try:
            async with _session() as db:
                conf = await image_conf(db)
            if conf is None:
                raise RuntimeError("画图没配置")
            model = conf["model"]
            raw = await call_image_api(conf, prompt)
            jpg = await asyncio.to_thread(shrink, raw)
            ts = int(time.time())
            name = f"{pic_id}_{ts}.jpg"
            tmp = os.path.join(_pic_dir(), name + ".tmp")
            with open(tmp, "wb") as f:
                f.write(jpg)
            os.replace(tmp, os.path.join(_pic_dir(), name))
            url = f"{URL_PREFIX}{name}?v={ts}"
        except Exception as e:  # noqa: BLE001
            logger.warning("画记忆图失败 pic=%s: %s", pic_id, e)
            err = str(e)[:200] or type(e).__name__
        try:
            async with _session() as db:
                p = await db.get(WordPicture, pic_id)
                if p is None:
                    return
                if err is None:
                    old = p.url
                    p.status, p.url, p.model, p.finished_at, p.error = "ready", url, model, utc_now(), None
                    await db.commit()
                    if old and old != url:
                        _remove_file(old)
                else:
                    who, charged = p.requested_by, p.charged
                    p.status, p.error, p.finished_at, p.charged = "failed", err, utc_now(), 0
                    await db.commit()
                    if who and charged:
                        await tt.refund(db, who, charged)
                        await store.incr(_day_key(who), -1, 2 * 86400)
        except Exception:  # noqa: BLE001
            logger.exception("记忆图写库失败 pic=%s", pic_id)


async def remove(db: AsyncSession, pic_id: int, by: int) -> Optional[WordPicture]:
    """管理员删掉一张不合适的图(下次有人点再重画)。不 commit"""
    p = await db.get(WordPicture, pic_id)
    if p is None:
        return None
    _remove_file(p.url)
    p.status, p.url, p.removed_by, p.charged = "removed", None, by, 0
    return p


# ---------------------------------------------------------------- 学习助手的工具

async def tool_draw(db: AsyncSession, user: User, word: str, idea: str) -> tuple[dict, Optional[dict]]:
    found = await find_word(db, text=word)
    if found is None:
        return {"ok": False, "reason": "课本里没有这个词,画不了"}, None
    w, meaning = found
    try:
        res = await request(db, user, w, meaning, idea)
    except PictureRefused as e:
        return {"ok": False, "reason": str(e)}, None
    card = {"type": "picture", "pic_id": res["pic_id"], "word": w, "status": res["status"], "url": res["url"]}
    if res["status"] == "ready":
        note = "这张图已经显示在回答下面了(以前画过,这次没用次数)。回答里接着讲记忆方法,别描述图里每个细节"
    else:
        note = (f"图正在画,大约 20–30 秒后显示在回答下面{'(用掉了 1 次次数)' if res['charged'] else ''}。"
                "回答里一句话告诉孩子图在画,然后接着讲记忆方法")
    return {"ok": True, "word": w, "status": res["status"], "note": note}, card
