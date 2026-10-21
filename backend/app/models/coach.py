"""陪跑点评(2026-10-21)

老师每天给孩子留一句话(系统按当天数据先起草,老师改几个字发出),孩子首页和家长端都看得到。
一个孩子一天一条(UNIQUE student_id + note_date): 同一天再写是改,不是追加 —— 一天十条留言
孩子看不过来,家长也分不清哪条是最新的。

teacher_id 存的是主老师(数据范围),author_id / author_name 存真正写的人(助教写的就是助教),
author_name 是快照: 助教删了,孩子看到的落款还在。
"""
from sqlalchemy import Column, Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.sql import func

from app.core.database import Base


class CoachNote(Base):
    __tablename__ = "coach_notes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    teacher_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    author_id = Column(Integer, nullable=True)
    author_name = Column(String(100), nullable=True)
    org_id = Column(Integer, nullable=True, index=True)
    note_date = Column(Date, nullable=False)          # 北京日历日
    content = Column(Text, nullable=False)
    # 改了内容就清掉这两个(新内容要重新让人看到)
    read_by_student_at = Column(DateTime, nullable=True)
    read_by_parent_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("student_id", "note_date", name="uq_coach_note_student_day"),
    )
