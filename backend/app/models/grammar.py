"""语法小课(句子积木)的上课记录(2026-11-15,第一步: 样课)

内容在 app/grammar/(积木写法、七种题、每节课),规则见 services/grammar_course.py 文件头。
新表,create_all 建(不碰 database.py —— 生产那份有 drift);模型在 models/__init__ 里导入。
北京日存 'YYYY-MM-DD' 字符串(躲开 SQLite datetime 微秒格式的坑);时间列由 Python 写 utc_now()。
"""
from sqlalchemy import JSON, Column, DateTime, Index, Integer, String

from app.core.database import Base
from app.core.timeutil import utc_now


class GrammarRun(Base):
    """上一次小课: 上到哪一步、每道题错了几次。一节课可以上很多次,每次一行"""
    __tablename__ = "grammar_runs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False)
    org_id = Column(Integer, nullable=True, index=True)
    lesson_id = Column(Integer, nullable=False)
    kind = Column(String(10), nullable=False, default="lesson")    # lesson(以后: review 回头考)
    day = Column(String(10), nullable=False)                        # 开始那天(北京日)
    # {"items": {题目 key: {"p": 做到第几步, "t": 这一步错了几次, "w": 这道题一共错了几次, "d": 做完没有}}}
    state = Column(JSON, nullable=False, default=dict)
    version = Column(Integer, nullable=False, default=0)            # 每次作答 +1,条件更新用(两台设备 / 连点)
    total = Column(Integer, nullable=False, default=0)              # 「自己练」有几道(学完时写)
    first_right = Column(Integer, nullable=False, default=0)        # 其中一步都没错的有几道
    started_at = Column(DateTime, nullable=False, default=utc_now)
    finished_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("idx_grammar_run_user", "user_id", "lesson_id", "id"),
    )
