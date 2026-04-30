"""学生监控 - 按组成绩 + 单词级下钻"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func, Integer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.auth import get_current_teacher
from app.api.v1.teacher._permissions import assert_student_in_my_class
from app.services.scope_service import get_unit_groups, get_group_words
from app.models.user import User
from app.models.word import Unit, Word
from app.models.learning import WordMastery

router = APIRouter()


@router.get("/students/{student_id}/groups")
async def student_group_scores(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """该学生在所有已学单元的每组聚合成绩"""
    await assert_student_in_my_class(db, current_user.id, student_id)

    # 1. Find all units where this student has mastery records (via UnitWord join)
    from app.models.word import UnitWord
    studied_units_res = await db.execute(
        select(Unit.id).distinct()
        .join(UnitWord, UnitWord.unit_id == Unit.id)
        .join(WordMastery, (WordMastery.word_id == UnitWord.word_id) & (WordMastery.user_id == student_id))
        .order_by(Unit.id)
    )
    studied_unit_ids = [row[0] for row in studied_units_res.all()]
    if not studied_unit_ids:
        return []

    # 2. Load those units
    units_res = await db.execute(
        select(Unit).where(Unit.id.in_(studied_unit_ids)).order_by(Unit.book_id, Unit.unit_number)
    )
    units = list(units_res.scalars().all())

    out: list[dict] = []
    for u in units:
        groups = await get_unit_groups(db, u.id)
        for g in groups:
            wids = g["word_ids"]
            if not wids:
                continue
            # Single query: count, correct, attempts, mastered, last_at
            mres = await db.execute(
                select(
                    func.count(WordMastery.id),
                    func.sum(WordMastery.correct_count),
                    func.sum(WordMastery.total_encounters),
                    func.sum(func.cast(WordMastery.mastery_level >= 4, Integer)),
                    func.max(WordMastery.last_practiced_at),
                ).where(
                    WordMastery.user_id == student_id,
                    WordMastery.word_id.in_(wids),
                )
            )
            cnt, correct, encounters, mastered, last_at = mres.one()
            if not cnt:
                continue
            enc_v = int(encounters or 0)
            cor_v = int(correct or 0)
            out.append({
                "unit_id": u.id, "unit_name": u.name,
                "group_index": g["index"], "word_count": len(wids),
                "learned_count": int(cnt or 0),
                "mastered_count": int(mastered or 0),
                "accuracy": round(cor_v / enc_v, 4) if enc_v else 0.0,
                "last_studied_at": last_at.isoformat() if last_at else None,
            })
    return out


@router.get("/students/{student_id}/groups/{unit_id}/{group_index}/words")
async def student_group_words(
    student_id: int, unit_id: int, group_index: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """组内每个单词的对错明细"""
    await assert_student_in_my_class(db, current_user.id, student_id)
    try:
        words = await get_group_words(db, unit_id, group_index)
    except ValueError as e:
        raise HTTPException(422, str(e))
    word_ids = [w.id for w in words]

    mres = await db.execute(
        select(WordMastery).where(
            WordMastery.user_id == student_id,
            WordMastery.word_id.in_(word_ids),
        )
    )
    by_wid = {m.word_id: m for m in mres.scalars().all()}
    out = []
    for w in words:
        m = by_wid.get(w.id)
        out.append({
            "word_id": w.id, "word": w.word,
            "mastery_level": m.mastery_level if m else 0,
            "correct_count": m.correct_count if m else 0,
            "total_attempts": m.total_encounters if m else 0,
            "last_practiced_at": (m.last_practiced_at.isoformat()
                if m and m.last_practiced_at else None),
        })
    return out
