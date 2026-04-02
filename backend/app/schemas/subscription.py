"""
单词本兑换码相关Schema
"""
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


class RedemptionCodeGenerate(BaseModel):
    """批量生成兑换码请求"""
    count: int = Field(..., ge=1, le=100, description="生成数量(1-100)")
    book_id: int = Field(..., description="绑定的单词本ID")
    batch_note: Optional[str] = Field(None, max_length=200, description="批次备注")


class RedeemRequest(BaseModel):
    """兑换请求"""
    code: str = Field(..., min_length=19, max_length=19, description="兑换码 XXXX-XXXX-XXXX-XXXX")


class RedeemResponse(BaseModel):
    """兑换响应"""
    success: bool
    message: str
    book_name: Optional[str] = None


class RedemptionCodeResponse(BaseModel):
    """兑换码响应"""
    id: int
    code: str
    book_id: int
    book_name: Optional[str] = None
    status: str
    created_by: int
    created_at: datetime
    code_expires_at: datetime
    used_by: Optional[int] = None
    used_at: Optional[datetime] = None
    batch_note: Optional[str] = None

    class Config:
        from_attributes = True


class RedemptionCodeListResponse(BaseModel):
    """兑换码列表响应"""
    total: int
    codes: List[RedemptionCodeResponse]


class SubscriptionStatsResponse(BaseModel):
    """兑换码统计响应"""
    total_codes: int
    unused_codes: int
    used_codes: int
    expired_codes: int
    disabled_codes: int
