"""
单词本兑换码相关Schema
"""
from pydantic import BaseModel, Field, model_validator
from typing import Optional, List
from datetime import datetime


class RedemptionCodeGenerate(BaseModel):
    """批量生成兑换码请求"""
    count: int = Field(..., ge=1, le=100, description="生成数量(1-100)")
    book_id: int = Field(..., description="绑定的单词本ID")
    batch_note: Optional[str] = Field(None, max_length=200, description="批次备注")
    # 卡种: permanent=永久(默认,兼容旧调用) / period=包月 / times=次卡
    grant_type: str = Field("permanent", pattern="^(permanent|period|times)$", description="卡种")
    grant_days: Optional[int] = Field(None, ge=1, le=3650, description="包月卡有效天数")
    grant_times: Optional[int] = Field(None, ge=1, le=1000, description="次卡可用天数")

    @model_validator(mode="after")
    def _check_grant(self):
        if self.grant_type == "period" and not self.grant_days:
            raise ValueError("包月卡必须填写有效天数")
        if self.grant_type == "times" and not self.grant_times:
            raise ValueError("次卡必须填写可用天数")
        return self


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
    created_by_name: Optional[str] = None  # 发码人姓名(查"这批码谁发的")
    created_at: datetime
    code_expires_at: datetime
    used_by: Optional[int] = None
    used_at: Optional[datetime] = None
    batch_note: Optional[str] = None
    grant_type: str = "permanent"
    grant_days: Optional[int] = None
    grant_times: Optional[int] = None

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
