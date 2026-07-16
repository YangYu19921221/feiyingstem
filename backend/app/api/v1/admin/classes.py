"""管理员 - 班级监控 + 跨教师转班"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.auth import get_current_admin_or_org_admin
from app.models.user import User, Class, ClassStudent
from app.models.learning import WordMastery
from app.models.word import Word

router = APIRouter()


class TransferRequest(BaseModel):
    new_class_id: int


@router.get("/classes")
async def list_all_classes(
    teacher_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_or_org_admin),
):
    """列出所有班级（可按 teacher_id 过滤），附带教师用户名与在册学生数"""
    stmt = (
        select(
            Class.id,
            Class.name,
            Class.description,
            Class.teacher_id,
            User.username,
            func.count(ClassStudent.id).label("student_count"),
        )
        .join(User, User.id == Class.teacher_id)
        .outerjoin(
            ClassStudent,
            (ClassStudent.class_id == Class.id) & (ClassStudent.is_active.is_(True)),
        )
        .group_by(Class.id, User.username)
        .order_by(Class.created_at.desc())
    )
    if teacher_id is not None:
        stmt = stmt.where(Class.teacher_id == teacher_id)

    res = await db.execute(stmt)
    return [
        {
            "id": i,
            "name": n,
            "description": d,
            "teacher_id": tid,
            "teacher_username": tu,
            "student_count": sc,
        }
        for i, n, d, tid, tu, sc in res.all()
    ]


@router.get("/classes/{class_id}/overview")
async def admin_class_overview(
    class_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_or_org_admin),
):
    """班级学习概览（管理员无需 teacher_id 校验）"""
    cls_res = await db.execute(select(Class).where(Class.id == class_id))
    cls = cls_res.scalar_one_or_none()
    if not cls:
        raise HTTPException(status_code=404, detail="班级不存在")

    # 查在册学生 ID
    sid_res = await db.execute(
        select(ClassStudent.student_id).where(
            ClassStudent.class_id == class_id,
            ClassStudent.is_active.is_(True),
        )
    )
    sids = [r[0] for r in sid_res.all()]

    if not sids:
        return {
            "class_id": class_id,
            "name": cls.name,
            "student_count": 0,
            "avg_accuracy": 0.0,
            "total_words_studied": 0,
            "mastered_words": 0,
        }

    res = await db.execute(
        select(
            func.count(func.distinct(WordMastery.word_id)),
            func.sum(WordMastery.correct_count),
            func.sum(WordMastery.total_encounters),
        ).where(WordMastery.user_id.in_(sids))
    )
    total_words, correct, encounters = res.one()

    # 已掌握: 按 lower(word) 去重取该拼写最高掌握度,>=3 计为掌握(全站统一口径)
    mastered_res = await db.execute(
        select(func.max(WordMastery.mastery_level).label("lvl"))
        .join(Word, Word.id == WordMastery.word_id)
        .where(WordMastery.user_id.in_(sids))
        .group_by(func.lower(Word.word))
    )
    mastered = sum(1 for r in mastered_res.all() if (r.lvl or 0) >= 3)

    return {
        "class_id": class_id,
        "name": cls.name,
        "student_count": len(sids),
        "avg_accuracy": round(float(correct or 0) / float(encounters or 1), 4),
        "total_words_studied": total_words or 0,
        "mastered_words": mastered or 0,
    }


@router.post("/students/{student_id}/transfer")
async def transfer_student(
    student_id: int,
    body: TransferRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_or_org_admin),
):
    """跨教师转班 — 原子事务"""
    # 1. 校验学生存在
    s_res = await db.execute(
        select(User).where(User.id == student_id, User.role == "student")
    )
    if not s_res.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="学生不存在")

    # 2. 校验目标班级存在
    nc_res = await db.execute(
        select(Class).where(Class.id == body.new_class_id)
    )
    target_class = nc_res.scalar_one_or_none()
    if not target_class:
        raise HTTPException(status_code=404, detail="目标班级不存在")

    # 2.5 多租户配额: 学生原本没有任何活跃班级时,"转班"实为入班(净新增计费学生),需过配额
    has_active = (await db.execute(
        select(ClassStudent.id).where(
            ClassStudent.student_id == student_id,
            ClassStudent.is_active.is_(True),
        ).limit(1)
    )).first()
    if not has_active and target_class.org_id is not None:
        from app.services.org_service import check_student_quota
        await check_student_quota(db, target_class.org_id)

    # 3. 将所有现有 active 记录置为不活跃
    await db.execute(
        update(ClassStudent)
        .where(
            ClassStudent.student_id == student_id,
            ClassStudent.is_active.is_(True),
        )
        .values(is_active=False, left_at=datetime.now(timezone.utc).replace(tzinfo=None))
    )

    # 4. 插入新班级记录
    db.add(
        ClassStudent(
            class_id=body.new_class_id,
            student_id=student_id,
            is_active=True,
        )
    )

    await db.commit()
    return {"transferred": True, "new_class_id": body.new_class_id}
