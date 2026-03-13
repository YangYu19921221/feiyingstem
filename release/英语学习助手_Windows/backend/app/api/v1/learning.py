"""
学习模块API
- 学习会话管理
- 学习记录
- 间隔重复算法
"""
from fastapi import APIRouter

router = APIRouter()

@router.post("/start-session")
async def start_learning_session():
    """开始学习会话"""
    return {"message": "待实现"}

@router.post("/submit-answer")
async def submit_answer():
    """提交答案"""
    return {"message": "待实现"}

@router.get("/progress/{user_id}")
async def get_learning_progress(user_id: int):
    """获取学习进度"""
    return {"message": "待实现"}
