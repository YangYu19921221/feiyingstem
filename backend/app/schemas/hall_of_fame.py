"""
班级光荣榜响应 schema
"""
from typing import Optional
from pydantic import BaseModel


class ChampionItem(BaseModel):
    """单个上榜学生条目"""
    user_id: int
    nickname: str
    hero_id: Optional[str]
    metric: int  # 数值（次数 / 秒数 / 分数差）
    metric_label: str  # 中文展示，如 "12 次满分通关"


class HallOfFameResponse(BaseModel):
    """班级光荣榜响应（任意一项可能为 null）"""
    class_id: Optional[int]
    class_name: Optional[str]
    period: str  # 如 "2026-05"
    champions: dict
