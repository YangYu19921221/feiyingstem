"""每日复习(2026-10-21)—— 学生端取当天那一份。规则真源 services/daily_review.py

复习本身还走原来那条路(classify 复习模式 + /student/review-records),这里只决定「今天复习哪 20 个」。
"""
from fastapi import APIRouter, Depends
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_student
from app.core.database import get_db
from app.models.learning import WordMastery
from app.models.user import User
from app.models.word import Word, WordDefinition
from app.services import daily_review as svc

student_router = APIRouter()


async def _word_rows(db: AsyncSession, user_id: int, ids: list[int]) -> list[dict]:
    if not ids:
        return []
    rows = (await db.execute(
        select(WordMastery, Word, WordDefinition)
        .join(Word, Word.id == WordMastery.word_id)
        .outerjoin(WordDefinition, and_(WordDefinition.word_id == Word.id, WordDefinition.is_primary.is_(True)))
        .where(WordMastery.user_id == user_id, WordMastery.word_id.in_(ids))
    )).all()
    by_id: dict[int, dict] = {}
    for m, w, d in rows:
        if w.id in by_id:
            continue
        by_id[w.id] = {
            "mastery_id": m.id, "word_id": w.id, "mastery_level": m.mastery_level or 0,
            "review_stage": m.review_stage or 0, "next_review_at": m.next_review_at,
            "last_practiced_at": m.last_practiced_at, "word": w.word, "phonetic": w.phonetic,
            "syllables": w.syllables, "meaning": d.meaning if d else None,
            "part_of_speech": d.part_of_speech if d else None,
            "example_sentence": d.example_sentence if d else None,
            "example_translation": d.example_translation if d else None,
            "difficulty": w.difficulty or 1,
        }
    return [by_id[i] for i in ids if i in by_id]


@student_router.get("/daily-review")
async def my_daily_review(
    words: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """今天那一份(第一次打开时挑好,当天不变)。words=true 时带上还没复习的词(按优先级)"""
    st = await svc.status(db, current_user.id)
    out = {
        "date": st["date"], "total": st["total"], "done": st["done"],
        "remaining": len(st["remaining_ids"]), "backlog": st["backlog"],
        "completed": st["completed"], "size": svc.DAILY_SIZE,
    }
    if words:
        out["words"] = await _word_rows(db, current_user.id, st["remaining_ids"])
    return out
