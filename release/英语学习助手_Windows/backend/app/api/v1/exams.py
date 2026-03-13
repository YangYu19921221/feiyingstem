"""
试卷系统API
- 创建试卷
- 提交答卷
- 查看成绩
"""
from fastapi import APIRouter

router = APIRouter()

@router.post("/")
async def create_exam():
    """创建试卷"""
    return {"message": "待实现"}

@router.post("/{exam_id}/submit")
async def submit_exam(exam_id: int):
    """提交试卷"""
    return {"message": "待实现"}

@router.get("/{exam_id}/result")
async def get_exam_result(exam_id: int):
    """获取试卷结果"""
    return {"message": "待实现"}
