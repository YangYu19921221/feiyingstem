"""教师端班级权限 helper - 教师只能操作自己班级里 active 的学生"""
from dataclasses import dataclass, field
from datetime import datetime, timezone
from fastapi import HTTPException
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import Class, ClassStudent, User


async def get_my_class_student_ids(db: AsyncSession, teacher_id: int) -> set[int]:
    """该教师所有班级里 is_active=True 且 role='student' 的学生 id"""
    res = await db.execute(
        select(ClassStudent.student_id)
        .join(Class, Class.id == ClassStudent.class_id)
        .join(User, User.id == ClassStudent.student_id)
        .where(
            Class.teacher_id == teacher_id,
            ClassStudent.is_active.is_(True),
            User.role == "student",
        )
    )
    return {row[0] for row in res.all()}


async def assert_student_in_my_class(
    db: AsyncSession, teacher_id: int, student_id: int
) -> None:
    """不在则 raise HTTPException(403)"""
    ids = await get_my_class_student_ids(db, teacher_id)
    if student_id not in ids:
        raise HTTPException(status_code=403, detail="无权操作该学生")


@dataclass
class PlaceResult:
    added: int = 0
    transferred: int = 0
    blocked_student_ids: list[int] = field(default_factory=list)
    already_in_student_ids: list[int] = field(default_factory=list)


async def place_students_in_class(
    db: AsyncSession,
    student_ids: list[int],
    target_class_id: int,
    teacher_id: int,
    on_other_teacher: str = "block",
) -> PlaceResult:
    """
    把一批学生放进 target_class_id：
    - 不存在 / 非 active / 非 role=student → 直接跳过（不计 added，也不进 blocked）
    - 已在本班 active → already_in
    - 已在本教师其它班 active → 关旧关系（transferred）
    - 已在其它教师班 active：
        on_other_teacher="block" → blocked
        on_other_teacher="steal" → 同上关旧关系
    - 同班存在 inactive 历史 → 复活；否则插新行
    调用方负责 commit。
    """
    result = PlaceResult()
    if not student_ids:
        return result

    # 1) 先过滤出合法的 active student（防止孤儿插入）
    valid_res = await db.execute(
        select(User.id).where(
            User.id.in_(student_ids),
            User.role == "student",
            User.is_active == True,
        )
    )
    valid_ids = {row[0] for row in valid_res.all()}
    if not valid_ids:
        return result

    cur_links_res = await db.execute(
        select(ClassStudent, Class)
        .join(Class, Class.id == ClassStudent.class_id)
        .where(
            ClassStudent.student_id.in_(valid_ids),
            ClassStudent.is_active.is_(True),
        )
    )
    cur_links = cur_links_res.all()

    already_in = {link.student_id for link, cls in cur_links if link.class_id == target_class_id}
    deactivate_link_ids: list[int] = []
    blocked: set[int] = set()
    transferred_student_ids: set[int] = set()

    for link, cls in cur_links:
        if link.class_id == target_class_id:
            continue
        if cls.teacher_id == teacher_id or on_other_teacher == "steal":
            deactivate_link_ids.append(link.id)
            transferred_student_ids.add(link.student_id)
        else:
            blocked.add(link.student_id)

    now = datetime.now(timezone.utc).replace(tzinfo=None)
    if deactivate_link_ids:
        await db.execute(
            update(ClassStudent)
            .where(ClassStudent.id.in_(deactivate_link_ids))
            .values(is_active=False, left_at=now)
        )

    target_student_ids = [
        sid for sid in valid_ids if sid not in already_in and sid not in blocked
    ]

    if target_student_ids:
        inactive_res = await db.execute(
            select(ClassStudent).where(
                ClassStudent.class_id == target_class_id,
                ClassStudent.student_id.in_(target_student_ids),
                ClassStudent.is_active.is_(False),
            )
        )
        revive_map = {r.student_id: r for r in inactive_res.scalars().all()}

        for sid in target_student_ids:
            if sid in revive_map:
                row = revive_map[sid]
                row.is_active = True
                row.left_at = None
            else:
                db.add(ClassStudent(class_id=target_class_id, student_id=sid, is_active=True))

    result.added = len(target_student_ids)
    result.transferred = len(transferred_student_ids)
    result.blocked_student_ids = sorted(blocked)
    result.already_in_student_ids = sorted(already_in)
    return result
