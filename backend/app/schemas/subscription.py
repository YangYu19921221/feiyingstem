"""
单词本兑换码相关Schema
"""
from pydantic import BaseModel, Field, model_validator
from typing import Optional, List
from datetime import datetime


class RedemptionCodeGenerate(BaseModel):
    """批量生成兑换码请求"""
    count: int = Field(..., ge=1, le=100, description="生成数量(1-100)")
    # 一码多书(2026-08-29): book_ids 传一批书;book_id 是旧调用形态(等价于单元素列表)。
    # 两者都可省,但至少给一个 —— 校验在 _check_books
    book_id: Optional[int] = Field(None, description="绑定的单词本ID(单书,旧字段)")
    book_ids: Optional[List[int]] = Field(
        None, min_length=1, max_length=200,
        description="绑定的单词本ID列表(按分组/学段批量开书)")
    batch_note: Optional[str] = Field(None, max_length=200, description="批次备注")
    # 卡种: permanent=永久(默认,兼容旧调用) / period=包月 / times=次卡
    grant_type: str = Field("permanent", pattern="^(permanent|period|times)$", description="卡种")
    grant_days: Optional[int] = Field(None, ge=1, le=3650, description="包月卡有效天数")
    grant_times: Optional[int] = Field(None, ge=1, le=1000, description="次卡可用天数")
    # 发码条件留痕(仅展示/追溯,不参与判活)
    scope_series: Optional[str] = Field(None, max_length=30, description="按此分组发的码")
    scope_stage: Optional[str] = Field(
        None, pattern="^(primary|junior|senior|other)$", description="按此学段发的码")

    @model_validator(mode="after")
    def _check_grant(self):
        if self.grant_type == "period" and not self.grant_days:
            raise ValueError("包月卡必须填写有效天数")
        if self.grant_type == "times" and not self.grant_times:
            raise ValueError("次卡必须填写可用天数")
        return self

    @model_validator(mode="after")
    def _check_books(self):
        if not self.book_ids and self.book_id is None:
            raise ValueError("请至少选择一本单词本")
        return self


class RedeemRequest(BaseModel):
    """兑换请求"""
    code: str = Field(..., min_length=19, max_length=19, description="兑换码 XXXX-XXXX-XXXX-XXXX")


class RedeemResponse(BaseModel):
    """兑换响应"""
    success: bool
    message: str
    book_name: Optional[str] = None
    # 一码多书: 这张卡覆盖的书与逐本结果(老前端只读 message/book_name 仍工作)
    books: Optional[List[dict]] = None
    granted: Optional[List[str]] = None
    renewed: Optional[List[str]] = None
    skipped: Optional[List[str]] = None


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
    # 一码多书(2026-08-29)
    scope_kind: str = "book"            # book=单书 | group=按分组/学段批量
    scope_series: Optional[str] = None  # 发码时选的分组
    scope_stage: Optional[str] = None   # 发码时选的学段
    book_count: int = 1                 # 覆盖几本书
    books: Optional[List[dict]] = None  # [{id,name}] 前若干本,列表展开用

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
