"""机构服务(多租户 P3): 配额统计与校验"""
from fastapi import HTTPException
from sqlalchemy import select, func, distinct
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User, Class, ClassStudent
from app.models.organization import Organization


async def count_active_students(db: AsyncSession, org_id: int) -> int:
    """机构活跃学生数 = 有活跃班级关系的去重学生(计费口径,见设计方案§5.1)"""
    return (await db.execute(
        select(func.count(distinct(ClassStudent.student_id)))
        .join(Class, Class.id == ClassStudent.class_id)
        .where(Class.org_id == org_id, ClassStudent.is_active.is_(True))
        .execution_options(skip_tenant_filter=True)  # 计数需跨上下文准确(如admin视角)
    )).scalar() or 0


async def get_org(db: AsyncSession, org_id: int) -> Organization | None:
    return (await db.execute(
        select(Organization).where(Organization.id == org_id)
    )).scalar_one_or_none()


async def check_student_quota(db: AsyncSession, org_id: int, adding: int = 1):
    """入班/建学生前校验配额,超了抛403(直营 quota=999999 等于不限)"""
    org = await get_org(db, org_id)
    if org is None:
        return  # 机构不存在时不拦(数据异常由其他层兜底)
    current = await count_active_students(db, org_id)
    if current + adding > (org.student_quota or 0):
        raise HTTPException(
            status_code=403,
            detail=f"机构学生名额已满({current}/{org.student_quota})，请联系机构管理员扩容",
        )
