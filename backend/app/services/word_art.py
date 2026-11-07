"""分类记忆卡的单词配图(2026-11-06)

- 图是 AI 出的,**单词拼写画在图里**(出图时逐张 OCR 核对过)。所以它只能给分类卡用:
  听写 / 拼写 / 填空这些要孩子自己写出单词的模式拿到它就等于拿到答案。
  闸门在 visible_url —— 取词接口(student/progress.start_learning)按学习模式判,不信前端。
- 文件放 UPLOAD_DIR/word-art/{slug}.jpg(经 /api/v1/files 公开 —— 图里只有单词画面,
  没有孩子的信息,和书封、记忆图同性质)。/api/v1/files 是一年 immutable 缓存,
  所以 URL 带 ?v=文件内容散列,换图就换地址。
- 文件名 = 单词拼写的 slug。老师改了拼写(改错字 / fork 出副本改词)以后,
  图上画的还是旧拼写 —— visible_url 发现 slug 对不上就不给,不用去每条改词路径里清字段。
- 只填指定书里的词。全库那批(2026-11-07)一个拼写只画一张,按最低学段那条的第一个意思画;
  别的书里同拼写的词条,释义里没有这个意思就不配(bank 画的是银行,释义是「河岸」的那条不配)。
- 图片目录里有 color/ 就用 color/ 里的(单词按音节上了色),没有才用顶层那张。
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
from dataclasses import dataclass, field
from typing import Iterable, Optional

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.word import Unit, UnitWord, Word, WordBook, WordDefinition

SUBDIR = "word-art"
URL_PREFIX = f"/api/v1/files/{SUBDIR}/"
# 只有分类卡能拿到带字的图(分类那一页本来就把单词写在最上面)
VISIBLE_MODES = {"classify"}


def slug(text: str) -> str:
    """与出图脚本同一个规则(小写,非字母数字一律变下划线)。改这里要连图一起重新导"""
    return re.sub(r"[^a-z0-9]+", "_", (text or "").lower()).strip("_")


def _slug_of_url(url: str) -> Optional[str]:
    if not url.startswith(URL_PREFIX):
        return None
    name = url[len(URL_PREFIX):].split("?", 1)[0]
    return name[:-4] if name.endswith(".jpg") else None


def is_word_art(url: Optional[str]) -> bool:
    return bool(url) and _slug_of_url(url) is not None


def visible_url(word_text: str, image_url: Optional[str], learning_mode: Optional[str]) -> Optional[str]:
    """给学生下发的 image_url。

    配图(word-art)只在分类模式、且拼写和图对得上时给;别的图(老字段,目前生产 0 行)原样。
    """
    if not image_url:
        return None
    s = _slug_of_url(image_url)
    if s is None:
        return image_url
    if learning_mode not in VISIBLE_MODES:
        return None
    return image_url if s == slug(word_text) else None


_CJK = re.compile(r"[^\u4e00-\u9fff]")


def first_sense(m: Optional[str]) -> str:
    """释义里的第一个意思(出图时只把它给模型)"""
    m = (m or "").strip()
    m = re.split(r"\s*(?:[；;]|\s2[\.、]|\[)", m)[0]
    return re.sub(r"^1[\.、]\s*", "", m).strip()


def meaning_matches(img_meaning: Optional[str], word_meaning: Optional[str]) -> bool:
    """图是照 img_meaning 的第一个意思画的;这条词的释义里有这个意思才配。
    按汉字比: 第一个意思里任意两个连着的字出现在词条释义里就算(「名字」对「n. 名字；名称」);
    只有一个汉字的看这个字在不在。没记图的释义(三上那批)不比"""
    if not img_meaning:
        return True
    a, b = _CJK.sub("", first_sense(img_meaning)), _CJK.sub("", word_meaning or "")
    if not a or not b:
        return " ".join((img_meaning or "").lower().split()) == " ".join((word_meaning or "").lower().split())
    if len(a) == 1:
        return a in b
    return any(a[i:i + 2] in b for i in range(len(a) - 1))


@dataclass
class ImportReport:
    matched: int = 0            # 书里有图可配的词条(按 word id 去重)
    filled: int = 0             # 这次写进库的
    unchanged: int = 0          # 本来就是这张图
    kept_other: int = 0         # 已有别的图(不是配图),不覆盖
    unmatched_words: list = field(default_factory=list)   # 书里没图的词
    unused_images: list = field(default_factory=list)     # 有图但书里没这个词
    meaning_mismatch: list = field(default_factory=list)  # 同拼写但意思不一样,没配
    copied: int = 0


def _load_results(src_dir: str) -> dict[str, tuple[str, str]]:
    """results.json → {slug: (文件路径, 画图时用的释义)}。只认 OCR 核对过的(ok)和退回不带字的(no_text)"""
    with open(os.path.join(src_dir, "results.json"), encoding="utf-8") as f:
        results = json.load(f)
    color_dir = os.path.join(src_dir, "color")
    out = {}
    for text, rec in results.items():
        if rec.get("status") not in ("ok", "no_text"):
            continue
        s = rec.get("slug") or slug(text)
        for path in (os.path.join(color_dir, f"{s}.jpg"), os.path.join(src_dir, f"{s}.jpg")):
            if os.path.isfile(path):
                out[s] = (path, rec.get("meaning") or "")
                break
    return out


async def all_book_ids(db: AsyncSession) -> list[int]:
    return [r[0] for r in (await db.execute(select(WordBook.id))).all()]


def _version(path: str) -> str:
    h = hashlib.md5()
    with open(path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()[:8]


async def import_from_dir(
    db: AsyncSession, src_dir: str, book_ids: Iterable[int], upload_dir: str, dry_run: bool = True,
) -> ImportReport:
    """把一批出好的图配给这几本书里的词。dry_run 只报不写(文件也不拷)"""
    book_ids = list(book_ids)
    images = _load_results(src_dir)
    rows = (await db.execute(
        select(Word.id, Word.word, Word.image_url)
        .join(UnitWord, UnitWord.word_id == Word.id)
        .join(Unit, Unit.id == UnitWord.unit_id)
        .where(Unit.book_id.in_(book_ids))
        .distinct()
    )).all()

    # 释义一次读进来(word_definitions.word_id 上没有索引,逐条子查询几万行会很慢)
    meanings: dict[int, str] = {}
    if any(m for _, m in images.values()):
        wanted = {r[0] for r in rows}
        for wid, mn in (await db.execute(
            select(WordDefinition.word_id, WordDefinition.meaning)
            .order_by(WordDefinition.word_id, WordDefinition.is_primary.desc(), WordDefinition.id)
        )).all():
            if wid in wanted and wid not in meanings:
                meanings[wid] = mn or ""

    rep = ImportReport()
    plan: dict[int, str] = {}      # word id → 新 URL
    used: set[str] = set()         # 书里有这个词的图
    needed: set[str] = set()       # 真要用上的图(已有别的图的词不用,不拷)
    versions: dict[str, str] = {}
    for wid, text, cur in rows:
        s = slug(text)
        hit = images.get(s)
        if not hit:
            rep.unmatched_words.append(text)
            continue
        path, img_meaning = hit
        if not meaning_matches(img_meaning, meanings.get(wid)):
            rep.meaning_mismatch.append(f"{text}: 图={first_sense(img_meaning)} / 这条={first_sense(meanings.get(wid))}")
            continue
        rep.matched += 1
        used.add(s)
        if s not in versions:
            versions[s] = _version(path)
        url = f"{URL_PREFIX}{s}.jpg?v={versions[s]}"
        if cur and not is_word_art(cur):
            rep.kept_other += 1
            continue
        needed.add(s)
        if cur == url:
            rep.unchanged += 1
            continue
        plan[wid] = url
    rep.unused_images = sorted(set(images) - used)
    rep.unmatched_words.sort()
    rep.meaning_mismatch.sort()
    rep.filled = len(plan)
    if dry_run:
        return rep

    dest_dir = os.path.join(upload_dir, SUBDIR)
    os.makedirs(dest_dir, exist_ok=True)
    for s in sorted(needed):
        dest = os.path.join(dest_dir, f"{s}.jpg")
        if os.path.isfile(dest) and _version(dest) == versions[s]:
            continue
        tmp = dest + ".tmp"
        shutil.copyfile(images[s][0], tmp)
        os.replace(tmp, dest)       # 原子替换,正在看的孩子不会取到半张图
        rep.copied += 1
    for i, (wid, url) in enumerate(plan.items(), 1):
        # 条件写: 导入过程中老师刚给这个词传了别的图,不覆盖
        await db.execute(
            update(Word).where(Word.id == wid)
            .where(or_(Word.image_url.is_(None), Word.image_url == "", Word.image_url.like(f"{URL_PREFIX}%")))
            .values(image_url=url)
        )
        if i % 500 == 0:
            await db.commit()      # 分批提交: 一次写几万行会把学生的写请求堵在后面
    await db.commit()
    return rep
