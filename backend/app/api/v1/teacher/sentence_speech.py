"""教师端: 看学生开口背的转写结果(2026-10-11)。只读,只放行本班学生"""
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_teacher
from app.api.v1.teacher._permissions import assert_student_in_my_class
from app.core.database import get_db
from app.models.sentence import Sentence, SentenceUnit
from app.models.sentence_speech import SentenceSpeech
from app.models.user import User
from app.services.sentence_speech import PASS_RATIO

router = APIRouter()


@router.get("/students/{student_id}/sentence-speech")
async def student_sentence_speech(
    student_id: int,
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    await assert_student_in_my_class(db, current_user.id, student_id)
    rows = (await db.execute(
        select(SentenceSpeech, Sentence.english, Sentence.chinese, SentenceUnit.name)
        .join(Sentence, Sentence.id == SentenceSpeech.sentence_id)
        .join(SentenceUnit, SentenceUnit.id == SentenceSpeech.unit_id)
        .where(SentenceSpeech.user_id == student_id)
        .order_by(SentenceSpeech.id.desc()).limit(limit)
        .execution_options(skip_tenant_filter=True)
    )).all()
    items = [{
        "id": s.id, "unit_name": un, "english": en, "chinese": zh, "status": s.status,
        "transcript": s.transcript, "missed_words": [w for w in (s.missed_words or "").split(",") if w],
        "hit_ratio": s.hit_ratio, "passed": s.passed,
        "created_at": s.created_at.isoformat() if s.created_at else None,
    } for s, en, zh, un in rows]
    done = [i for i in items if i["status"] == "done"]
    return {
        "pass_ratio": PASS_RATIO,
        "items": items,
        "summary": {"total": len(items), "done": len(done),
                    "passed": sum(1 for i in done if i["passed"]),
                    "pending": sum(1 for i in items if i["status"] == "pending")},
    }
