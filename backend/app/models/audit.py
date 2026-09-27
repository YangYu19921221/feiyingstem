"""操作日志(追责用)

起因(2026-09-27): 机构里几位老师共用一个教师账号,作业布置错了查不出是谁。
所以每条都记 IP + 设备 —— 共用账号时「谁」只能靠「哪台设备」区分。
一人一号(班级挂多位老师)做完之后,actor_id 本身就能定位到人。

口径:
- 只追加不修改,没有任何更新/删除端点(改得动的日志不能拿来追责)
- actor_name / target 摘要都存**快照**: 老师改名、作业被删之后,日志照样读得懂
- created_at 只走 Python default,不设 server_default —— 两种写法一个带微秒一个不带,
  混在一张表里按日期范围查会在整点边界翻车(CLAUDE.md「SQLite 日期时间」那条)
- org_id 取操作人的机构,查询端显式按它过滤(不押在 tenancy 隐式过滤器上)
"""
from datetime import datetime

from sqlalchemy import Column, Integer, String, DateTime, Text, Index

from app.core.database import Base


class OperationLog(Base):
    __tablename__ = "operation_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    org_id = Column(Integer, nullable=True)            # 操作人所属机构;平台 admin 为 NULL
    actor_id = Column(Integer, nullable=True)          # 不加外键:删了账号日志也得留着
    actor_name = Column(String(100), nullable=True)    # 快照:显示名(用户名)
    actor_role = Column(String(20), nullable=True)
    action = Column(String(50), nullable=False)        # 如 homework.create / coin.adjust
    target_type = Column(String(30), nullable=True)
    target_id = Column(Integer, nullable=True)
    summary = Column(String(500), nullable=False)      # 一句人话,列表直接显示
    detail = Column(Text, nullable=True)               # JSON:改前/改后、被删对象快照
    ip = Column(String(64), nullable=True)
    user_agent = Column(String(300), nullable=True)
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        Index("idx_oplog_org_time", "org_id", "created_at"),
        Index("idx_oplog_actor_time", "actor_id", "created_at"),
    )
