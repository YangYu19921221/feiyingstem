"""
学生端 - 班级光荣榜
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.auth import get_current_student
from app.models.user import User
from app.services.hall_of_fame_service import build_hall_of_fame

router = APIRouter()


@router.get("/class/hall-of-fame")
async def get_class_hall_of_fame(
    current_user: User = Depends(get_current_student),
    db: AsyncSession = Depends(get_db),
):
    """
    返回当前学生所在班级的本月光荣榜（满分王 / 速度之王 / 进步之星）

    若学生未加入班级，返回 class_id=null + 三项 champions=null
    """
    return await build_hall_of_fame(db, current_user.id)
