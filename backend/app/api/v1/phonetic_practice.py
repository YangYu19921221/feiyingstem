"""音标填空 — 学生端(看单词写音标)

答案是**题目的答案**,不能当展示字段下发给学生:
列表接口只给词和释义,answer_tokens 只在判分接口内部用,不出现在任何 GET 响应里。
否则学生打开开发者工具就能看到答案。
"""
import json
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.tenancy import current_org_id
from app.api.v1.auth import get_current_user
from app.models.user import User
from app.models.phonetic_practice import (
    PhoneticBook, PhoneticLesson, PhoneticItem, PhoneticAttempt,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _loads(raw: Optional[str], default):
    if not raw:
        return default
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return default


def _visible_book(q):
    """按 org 过滤教材可见性

    ⚠️ 只有 PhoneticBook 是租户锚点,lessons/items **不是** —— 按 ID 直查它们时
    tenancy 过滤器罩不住,必须显式 join 回 books 再按 org 过滤。
    (CLAUDE.md 多租户须知 + 音标闯关课方案 §12 红线 4:此类泄漏已踩过两次)
    """
    org_id = current_org_id.get()
    q = q.where(PhoneticBook.is_active == True)  # noqa: E712
    if org_id is not None:
        q = q.where(or_(PhoneticBook.org_id == org_id, PhoneticBook.org_id.is_(None)))
    return q


class LessonBrief(BaseModel):
    id: int
    code: str
    title: str
    lesson_number: int
    item_count: int
    removed_count: int
    has_video: bool


class BookWithLessons(BaseModel):
    id: int
    name: str
    volume: Optional[str] = None
    lessons: List[LessonBrief]


class ItemOut(BaseModel):
    """给学生的题目。**刻意不含答案** —— 只给格子数,不给内容"""
    id: int
    word: str
    meaning: Optional[str] = None
    slot_count: int = Field(description="答案有几个音素,即画几个空格")


class LessonDetail(BaseModel):
    id: int
    code: str
    title: str
    highlight: List[str] = []
    video_id: Optional[int] = None
    items: List[ItemOut]


@router.get("/books", response_model=List[BookWithLessons])
async def list_books(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """音标教材 + 小节目录"""
    # 与 phonetic_videos 同口径:本机构 OR 平台共享(org_id IS NULL)
    q = _visible_book(select(PhoneticBook))
    books = (await db.execute(q.order_by(PhoneticBook.id))).scalars().all()
    if not books:
        return []

    counts = dict(
        (await db.execute(
            select(PhoneticItem.lesson_id, func.count(PhoneticItem.id))
            .group_by(PhoneticItem.lesson_id)
        )).all()
    )
    lessons = (await db.execute(
        select(PhoneticLesson)
        .where(PhoneticLesson.book_id.in_([b.id for b in books]))
        .order_by(PhoneticLesson.book_id, PhoneticLesson.lesson_number)
    )).scalars().all()

    by_book: dict[int, List[LessonBrief]] = {}
    for ls in lessons:
        by_book.setdefault(ls.book_id, []).append(LessonBrief(
            id=ls.id, code=ls.code, title=ls.title,
            lesson_number=ls.lesson_number,
            item_count=counts.get(ls.id, 0),
            removed_count=ls.removed_count or 0,
            has_video=ls.video_id is not None,
        ))

    return [
        BookWithLessons(id=b.id, name=b.name, volume=b.volume,
                        lessons=by_book.get(b.id, []))
        for b in books
    ]


@router.get("/lessons/{lesson_id}", response_model=LessonDetail)
async def get_lesson(
    lesson_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """取一节的题目。不含答案"""
    # join 回 books 按 org 过滤:lessons 不是租户锚点,直查会跨机构泄题
    ls = (await db.execute(_visible_book(
        select(PhoneticLesson)
        .join(PhoneticBook, PhoneticBook.id == PhoneticLesson.book_id)
        .where(PhoneticLesson.id == lesson_id)
    ))).scalars().first()
    if not ls:
        raise HTTPException(status_code=404, detail="这一节不存在")

    items = (await db.execute(
        select(PhoneticItem)
        .where(PhoneticItem.lesson_id == lesson_id)
        .order_by(PhoneticItem.order_index, PhoneticItem.id)
    )).scalars().all()

    return LessonDetail(
        id=ls.id, code=ls.code, title=ls.title,
        highlight=_loads(ls.highlight_json, []),
        video_id=ls.video_id,
        items=[
            ItemOut(
                id=it.id, word=it.word, meaning=it.meaning,
                slot_count=len(_loads(it.answer_json, [])),
            )
            for it in items
        ],
    )


class CheckIn(BaseModel):
    item_id: int
    pass_number: int = Field(1, ge=1, le=3)
    # 学生填的 token,长度应等于答案长度;没填的格传 null
    submitted: List[Optional[str]]
    duration_ms: Optional[int] = None


class CheckOut(BaseModel):
    all_correct: bool
    per_slot: List[Optional[bool]]
    wrong_indexes: List[int]
    next_blanks: List[int]
    # 只在第二遍仍错时给出答案,避免第一遍就泄题
    answer_display: Optional[str] = None
    prefill: Optional[List[Optional[str]]] = None


# 元音音素(含双元音)。第二遍只挖元音格:元音是拼读教学点,辅音是送分的
_VOWELS = {
    'iː', 'ɪ', 'i', 'e', 'æ', 'ɑː', 'ʌ', 'ɒ', 'ɔː', 'ʊ', 'uː', 'ɜː', 'ə',
    'eɪ', 'aɪ', 'ɔɪ', 'əʊ', 'aʊ', 'ɪə', 'eə', 'ʊə',
}


def _grade_one(answer: List[str], core: List[int],
               submitted: List[Optional[str]], pass_number: int):
    """判一道题。返回 (per_slot, wrong, next_blanks)

    单题与整页批量共用这一份,避免两处判分口径漂移。
    """
    # 第一遍全填,第二遍只填元音格
    editable = set(range(len(answer))) if pass_number == 1 else set(core)
    sub = list(submitted) + [None] * max(0, len(answer) - len(submitted))

    per_slot: List[Optional[bool]] = []
    wrong: List[int] = []
    for i, a in enumerate(answer):
        if i not in editable:
            per_slot.append(None)
            continue
        # 重音符宽松处理:938 题里 177 题带重音,小学阶段漏点不该判错整题
        if a == 'ˈ':
            per_slot.append(True)
            continue
        ok = sub[i] == a
        per_slot.append(ok)
        if not ok:
            wrong.append(i)

    wrong_vowels = [i for i in wrong if answer[i] in _VOWELS]
    # 错的全是辅音时退一步挖错的辅音格,否则会「有错但没格可挖」卡死
    return per_slot, wrong, (wrong_vowels or wrong)


@router.post("/check", response_model=CheckOut)
async def check_answer(
    payload: CheckIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """判分。答案只在这里读,不下发

    ⚠️ 判分必须在服务端:放前端等于把答案发给学生。
    """
    # 同上:items 也不是锚点,必须 join 到 books 查 org
    it = (await db.execute(_visible_book(
        select(PhoneticItem)
        .join(PhoneticLesson, PhoneticLesson.id == PhoneticItem.lesson_id)
        .join(PhoneticBook, PhoneticBook.id == PhoneticLesson.book_id)
        .where(PhoneticItem.id == payload.item_id)
    ))).scalars().first()
    if not it:
        raise HTTPException(status_code=404, detail="题目不存在")

    answer: List[str] = _loads(it.answer_json, [])
    core: List[int] = _loads(it.core_indexes_json, [])
    if not answer:
        raise HTTPException(status_code=500, detail="这道题没有答案数据")

    per_slot, wrong, next_blanks = _grade_one(
        answer, core, payload.submitted, payload.pass_number)

    db.add(PhoneticAttempt(
        user_id=current_user.id,
        item_id=it.id,
        lesson_id=it.lesson_id,
        pass_number=payload.pass_number,
        submitted_json=json.dumps(payload.submitted, ensure_ascii=False),
        wrong_indexes_json=json.dumps(wrong),
        is_correct=not wrong,
        duration_ms=payload.duration_ms,
        org_id=current_org_id.get(),
    ))
    await db.commit()

    out = CheckOut(
        all_correct=not wrong,
        per_slot=per_slot,
        wrong_indexes=wrong,
        next_blanks=next_blanks,
    )
    if wrong and payload.pass_number == 1:
        # 进第二遍:把非挖空格的答案回填,学生只需补元音
        b = set(next_blanks)
        out.prefill = [None if i in b else a for i, a in enumerate(answer)]
    elif wrong:
        # 第二遍还错才给答案
        out.answer_display = it.answer_display or f"[{''.join(answer)}]"
    return out


class PageAnswerIn(BaseModel):
    item_id: int
    submitted: List[Optional[str]]


class CheckPageIn(BaseModel):
    lesson_id: int
    pass_number: int = Field(1, ge=1, le=3)
    answers: List[PageAnswerIn]
    duration_ms: Optional[int] = None
    # 幂等键:弱网下学生连点两次交卷必踩重复提交(音标闯关课方案 §12 红线 9)
    attempt_id: Optional[str] = Field(None, max_length=64)


class PageItemResult(BaseModel):
    item_id: int
    all_correct: bool
    per_slot: List[Optional[bool]]
    wrong_indexes: List[int]
    next_blanks: List[int]
    answer_display: Optional[str] = None
    prefill: Optional[List[Optional[str]]] = None


class CheckPageOut(BaseModel):
    right_count: int
    total: int
    results: List[PageItemResult]


@router.post("/check-page", response_model=CheckPageOut)
async def check_page(
    payload: CheckPageIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """整页判分(一节 20 个词一次交)

    纸质教材一页就是 20 个词并排,学生看着一整页填 —— 同韵的词排在一起,
    规律自己会浮出来。所以判分也按页来:20 个词发 20 个请求不合理。
    """
    if not payload.answers:
        raise HTTPException(status_code=400, detail="没有作答内容")
    if len(payload.answers) > 100:
        raise HTTPException(status_code=400, detail="一次最多交 100 题")

    # 一次取本页全部题目,顺带按 org 过滤(items 不是租户锚点)
    ids = [a.item_id for a in payload.answers]
    rows = (await db.execute(_visible_book(
        select(PhoneticItem)
        .join(PhoneticLesson, PhoneticLesson.id == PhoneticItem.lesson_id)
        .join(PhoneticBook, PhoneticBook.id == PhoneticLesson.book_id)
        .where(PhoneticItem.id.in_(ids),
               PhoneticItem.lesson_id == payload.lesson_id)
    ))).scalars().all()
    by_id = {r.id: r for r in rows}
    if not by_id:
        raise HTTPException(status_code=404, detail="题目不存在")

    # 幂等:同一 attempt_id 重复提交时只判分不再写记录,避免弱网连点写两遍
    already = False
    if payload.attempt_id:
        already = bool((await db.execute(
            select(PhoneticAttempt.id).where(
                PhoneticAttempt.user_id == current_user.id,
                PhoneticAttempt.lesson_id == payload.lesson_id,
                PhoneticAttempt.client_batch_id == payload.attempt_id,
            ).limit(1)
        )).scalars().first())

    results: List[PageItemResult] = []
    right = 0
    per_item_ms = (payload.duration_ms // len(payload.answers)) if payload.duration_ms else None

    for a in payload.answers:
        it = by_id.get(a.item_id)
        if not it:
            continue
        answer = _loads(it.answer_json, [])
        core = _loads(it.core_indexes_json, [])
        if not answer:
            continue

        per_slot, wrong, next_blanks = _grade_one(
            answer, core, a.submitted, payload.pass_number)
        if not wrong:
            right += 1

        r = PageItemResult(
            item_id=it.id, all_correct=not wrong, per_slot=per_slot,
            wrong_indexes=wrong, next_blanks=next_blanks,
        )
        if wrong and payload.pass_number == 1:
            b = set(next_blanks)
            r.prefill = [None if i in b else t for i, t in enumerate(answer)]
        elif wrong:
            r.answer_display = it.answer_display or f"[{''.join(answer)}]"
        results.append(r)

        if not already:
            db.add(PhoneticAttempt(
                user_id=current_user.id, item_id=it.id,
                lesson_id=it.lesson_id, pass_number=payload.pass_number,
                submitted_json=json.dumps(a.submitted, ensure_ascii=False),
                wrong_indexes_json=json.dumps(wrong),
                is_correct=not wrong, duration_ms=per_item_ms,
                client_batch_id=payload.attempt_id,
                org_id=current_org_id.get(),
            ))

    if not already:
        await db.commit()

    return CheckPageOut(right_count=right, total=len(results), results=results)
