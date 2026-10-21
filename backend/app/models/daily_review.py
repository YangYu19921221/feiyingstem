"""每日复习(2026-10-21)—— 一人一天一份,当天固定

为什么要存下来、不每次现算: 孩子复习了 10 个再回来,现算会从剩下的池子里再挑 20 个,
永远做不完。所以第一次打开时挑好当天那 20 个存进 word_ids,之后只看「这 20 个今天练了几个」。

completed_at 第一次判到「全做完」时写入,只写不清(作业完成判定读它,隔天再练也不会翻回没完成)。
"""
from sqlalchemy import Column, Date, DateTime, Integer, Text, UniqueConstraint
from sqlalchemy.sql import func

from app.core.database import Base


class DailyReviewPlan(Base):
    __tablename__ = "daily_review_plans"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, index=True)
    plan_date = Column(Date, nullable=False)        # 北京日历日
    word_ids = Column(Text, nullable=False)          # JSON 数组,按优先级排好
    backlog = Column(Integer, nullable=False, default=0)  # 挑的时候一共有多少个到期没复习(按拼写去重)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "plan_date", name="uq_daily_review_user_day"),
    )
