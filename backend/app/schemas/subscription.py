"""
订阅兑换码相关Schema
"""
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


class RedemptionCodeGenerate(BaseModel):
    """批量生成兑换码请求"""
    count: int = Field(..., ge=1, le=100, description="生成数量(1-100)")
    duration_days: int = Field(..., description="订阅天数(30/90/180/365)")
    batch_note: Optional[str] = Field(None, max_length=200, description="批次备注")


class RedeemRequest(BaseModel):
    """兑换请求"""
    code: str = Field(..., min_length=19, max_length=19, description="兑换码 XXXX-XXXX-XXXX-XXXX")


class RedeemResponse(BaseModel):
    """兑换响应"""
    success: bool
    message: str
    subscription_expires_at: Optional[datetime] = None


class SubscriptionStatusResponse(BaseModel):
    """订阅状态响应"""
    has_subscription: bool
    subscription_expires_at: Optional[datetime] = None
    is_expired: bool
    days_remaining: int = 0


class RedemptionCodeResponse(BaseModel):
    """兑换码响应"""
    id: int
    code: str
    duration_days: int
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
    """订阅统计响应"""
    total_codes: int
    unused_codes: int
    used_codes: int
    expired_codes: int
    disabled_codes: int
    active_subscribers: int
    expired_subscribers: int
