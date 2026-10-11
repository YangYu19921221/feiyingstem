"""学生端句子背诵(2026-10-11): 分组学习流程的取数 / 记作答 / 记过关。

流程(前端 pages/SentenceLearning.tsx): 听读 → 连词成句 → 开口背 → 默写 → 过关检测 → 单元复习。
- GET  /units/{id}/learn   取整单元 + 服务端分好的组 + 每句关键词 + 断点(已过关几组)
- POST /records            首答批量上报(连词/默写/检测),进句子掌握度与学习日历
- POST /units/{id}/group-pass  一组过关检测通过,推进断点;最后一组过关记完成
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_student
from app.api.v1.student.learning_records import claim_client_batch, update_study_calendar
from app.core.database import get_db
from app.core.rate_limit import check_rate
from app.models.sentence import Sentence
from app.models.sentence_learning import SentenceUnitProgress
from app.models.user import User
from app.services import sentence_learning as sl

router = APIRouter()


class LearnSentence(BaseModel):
    id: int
    english: str
    marked: Optional[str] = None   # 带 # 的高频词标记,显示时上色
    chinese: str
    tts_text: Optional[str] = None
    is_dialogue: bool
    key_word: Optional[str] = None


class LearnUnitOut(BaseModel):
    unit_id: int
    unit_name: str
    book_name: str
    groups: List[List[LearnSentence]]
    groups_passed: int          # 断点: 已过关的组数(0 = 从第 1 组开始)
    completed: bool


@router.get("/sentences/units/{unit_id}/learn", response_model=LearnUnitOut)
async def learn_unit(
    unit_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    check_rate(str(current_user.id), "sentence_content", [(10.0, 40), (60.0, 120), (300.0, 400)])
    unit, book = await sl.visible_unit(db, unit_id, current_user)
    sentences = list((await db.execute(
        select(Sentence).where(Sentence.unit_id == unit_id).order_by(Sentence.order_index, Sentence.id)
    )).scalars())
    groups = sl.split_groups(sentences)
    prog = (await db.execute(select(SentenceUnitProgress).where(
        SentenceUnitProgress.user_id == current_user.id, SentenceUnitProgress.unit_id == unit_id,
    ))).scalar_one_or_none()
    passed = min(prog.groups_passed, len(groups)) if prog else 0
    return LearnUnitOut(
        unit_id=unit.id, unit_name=unit.name, book_name=book.name,
        groups=[[LearnSentence(
            id=s.id, english=s.english, marked=s.english_marked, chinese=s.chinese, tts_text=s.tts_text,
            is_dialogue=sl.is_dialogue_line(s.english), key_word=sl.key_word(s.english, s.english_marked),
        ) for s in g] for g in groups],
        groups_passed=passed,
        completed=bool(prog and prog.completed_at),
    )


class SentenceAnswer(BaseModel):
    sentence_id: int
    stage: str = Field(..., pattern="^(arrange|dictation|exam)$")
    is_correct: bool
    answer: Optional[str] = Field(None, max_length=500)


class SentenceRecordsIn(BaseModel):
    unit_id: int
    answers: List[SentenceAnswer] = Field(..., max_length=200)
    session_seconds: int = Field(0, ge=0)
    client_batch_id: Optional[str] = None


@router.post("/sentences/records")
async def submit_records(
    data: SentenceRecordsIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """首答上报。句子 id 必须都在这个单元里 —— 否则改一下请求就能给任意句子刷掌握度"""
    await sl.visible_unit(db, data.unit_id, current_user)
    if not await claim_client_batch(db, data.client_batch_id, current_user.id):
        return {"success": True, "duplicate": True}
    ids = {a.sentence_id for a in data.answers}
    if ids:
        valid = set((await db.execute(
            select(Sentence.id).where(Sentence.unit_id == data.unit_id, Sentence.id.in_(ids))
        )).scalars())
        if ids - valid:
            raise HTTPException(400, "有句子不属于这个单元")
    for a in data.answers:
        await sl.apply_answer(db, current_user.id, a.sentence_id, a.stage, a.is_correct, a.answer)
    await update_study_calendar(db, current_user.id, total_time_ms=0,
                                session_seconds=data.session_seconds)
    await db.commit()
    return {"success": True, "recorded": len(data.answers)}


class GroupPassIn(BaseModel):
    group_index: int = Field(..., ge=0)
    score: int = Field(..., ge=0, le=100)
    client_batch_id: Optional[str] = None


PASS_SCORE = 80   # 与分类学习过关线同值(VictoryScreen)


@router.post("/sentences/units/{unit_id}/group-pass")
async def group_pass(
    unit_id: int,
    data: GroupPassIn,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """一组过关。断点只前进不后退: 学生回头重学第 1 组,不该把已过的第 3 组抹掉"""
    if data.score < PASS_SCORE:
        raise HTTPException(400, f"过关要 {PASS_SCORE} 分")
    await sl.visible_unit(db, unit_id, current_user)
    if not await claim_client_batch(db, data.client_batch_id, current_user.id):
        return {"success": True, "duplicate": True}
    sentences = list((await db.execute(
        select(Sentence).where(Sentence.unit_id == unit_id).order_by(Sentence.order_index, Sentence.id)
    )).scalars())
    total = len(sl.split_groups(sentences))
    if data.group_index >= total:
        raise HTTPException(400, "没有这一组")
    await db.execute(
        sqlite_insert(SentenceUnitProgress.__table__).values(
            user_id=current_user.id, unit_id=unit_id, groups_passed=0, best_score=0,
        ).on_conflict_do_nothing(index_elements=["user_id", "unit_id"])
    )
    prog = (await db.execute(select(SentenceUnitProgress).where(
        SentenceUnitProgress.user_id == current_user.id, SentenceUnitProgress.unit_id == unit_id,
    ))).scalar_one()
    prog.groups_passed = max(prog.groups_passed or 0, data.group_index + 1)
    prog.best_score = data.score
    unit_done = prog.groups_passed >= total
    if unit_done and prog.completed_at is None:
        prog.completed_at = datetime.utcnow()
    await db.commit()
    return {"success": True, "groups_passed": prog.groups_passed, "total_groups": total,
            "unit_completed": unit_done}
