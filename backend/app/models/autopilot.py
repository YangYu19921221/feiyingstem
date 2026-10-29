"""小鹰老师自动布置作业(2026-10-29)

用户「我的目的就是需要解放老师 让 ai 全自动」→ 规则见 services/autopilot.py 文件头。
全是新表(create_all 建,不碰 database.py —— 生产那份有 drift)。北京日一律存 'YYYY-MM-DD' 字符串:
字符串比较对 ISO 日期是对的,也躲开 SQLite datetime 微秒格式的坑。
"""
from sqlalchemy import Boolean, Column, DateTime, Index, Integer, String, Text, UniqueConstraint, select
from sqlalchemy.sql import func

from app.core.database import Base


class AutopilotClass(Base):
    """每个班一行;没有行 = 手动(默认),小鹰老师只出建议,老师点了才发"""
    __tablename__ = "autopilot_classes"

    class_id = Column(Integer, primary_key=True)
    org_id = Column(Integer, nullable=True, index=True)
    mode = Column(String(10), nullable=False, default="manual")      # manual / auto
    # 每周哪几天来电教室: "0,2,4"(周一 = 0)。空 = 没设,按 default_location
    class_days = Column(String(20), nullable=True)
    default_location = Column(String(10), nullable=False, default="classroom")
    # 临时调整某一天: {"2026-10-30": "home"}
    day_overrides = Column(Text, nullable=True)
    max_words = Column(Integer, nullable=True)        # 全班每天最多派几个词(NULL = 不限)
    pass_line = Column(Integer, nullable=True)        # 全班固定过关线(NULL = 按能力)
    paused = Column(Boolean, nullable=False, default=False)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    updated_by = Column(Integer, nullable=True)
    updated_by_name = Column(String(100), nullable=True)


class AutopilotStudent(Base):
    """一个孩子一行: 每天派多少(档位)、过关线、老师固定的值"""
    __tablename__ = "autopilot_students"

    student_id = Column(Integer, primary_key=True)
    org_id = Column(Integer, nullable=True, index=True)
    tier = Column(Integer, nullable=True)                 # 每天派多少个词(档位)
    tier_reason = Column(String(200), nullable=True)
    tier_day = Column(String(10), nullable=True)          # 档位最近一次变动的那天
    tier_checked_day = Column(String(10), nullable=True)  # 今天看过要不要调(一天只调一次)
    fixed_words = Column(Integer, nullable=True)          # 老师给这个孩子固定的量
    pass_line = Column(Integer, nullable=False, default=80)
    pass_line_reason = Column(String(200), nullable=True)
    pass_line_day = Column(String(10), nullable=True)     # 过关线最近一次评估的那天(一周最多调一档)
    fixed_pass_line = Column(Integer, nullable=True)
    paused = Column(Boolean, nullable=False, default=False)
    book_id = Column(Integer, nullable=True)              # 老师指定学哪本书(NULL = 自动挑)
    start_unit_id = Column(Integer, nullable=True)        # 老师指定从哪个单元开始
    bootstrapped_books = Column(Text, nullable=True)      # 已经按上线前的历史补过轮次的书 "12,35"
    # 第一次被小鹰老师派任务(或老师给他定了量 / 过关线)的时刻。没有 = 还没用上,过关线照旧 80
    enrolled_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class AutopilotGroup(Base):
    """一个孩子 × 一个单元的一组(组号 1 基,和 scope_service.get_unit_groups 同一份切法): 走到第几轮"""
    __tablename__ = "autopilot_groups"

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, nullable=False)
    unit_id = Column(Integer, nullable=False)
    group_index = Column(Integer, nullable=False)
    book_id = Column(Integer, nullable=True)
    word_count = Column(Integer, nullable=False, default=0)
    rounds = Column(Integer, nullable=False, default=0)
    last_day = Column(String(10), nullable=True)      # 最近一轮是哪天
    next_due = Column(String(10), nullable=True)      # 下一轮哪天到期
    try_day = Column(String(10), nullable=True)       # first_score 是哪天的
    first_score = Column(Integer, nullable=True)      # 那天第一次过关检测的分数(学会没有只看它)
    graduated_at = Column(DateTime, nullable=True)    # 学会了(三轮且第一次达到过关线)
    legacy = Column(Boolean, nullable=False, default=False)  # 按上线前的学习记录补的
    extra_day = Column(String(10), nullable=True)     # 自己多背: 哪天
    extra_count = Column(Integer, nullable=False, default=0)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("student_id", "unit_id", "group_index", name="uq_autopilot_group"),
        Index("idx_autopilot_group_due", "student_id", "next_due"),
    )


class AutopilotAttempt(Base):
    """每一次过关检测(过了没过都记)。group_exam_records 只记过了的,别的页面在用,不改它"""
    __tablename__ = "autopilot_attempts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, nullable=False)
    org_id = Column(Integer, nullable=True)
    unit_id = Column(Integer, nullable=False)
    groups = Column(String(100), nullable=True)       # 这次覆盖了哪几组 "1,2"
    word_count = Column(Integer, nullable=False, default=0)
    score = Column(Integer, nullable=False)
    required = Column(Integer, nullable=False)        # 当时的过关线(服务器算的)
    passed = Column(Boolean, nullable=False)
    first_today = Column(Boolean, nullable=False)     # 今天这几组的第一次(过关线只看它)
    counted_round = Column(Integer, nullable=True)    # 这次算成了第几轮(NULL = 不算轮: 重复背 / 没到日子 / 没过)
    day = Column(String(10), nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (Index("idx_autopilot_attempt_day", "student_id", "day"),)


class AutopilotDispatch(Base):
    """一个孩子一天最多一行(UNIQUE): 派了什么、为什么没派、点评写了没有"""
    __tablename__ = "autopilot_dispatches"

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, nullable=False)
    day = Column(String(10), nullable=False)
    class_id = Column(Integer, nullable=True)
    org_id = Column(Integer, nullable=True)
    teacher_id = Column(Integer, nullable=True)
    # dispatched 派了 / claiming 正在派 / skipped_manual 老师今天自己布置了 / paused 暂停
    # / no_book 没书 / finished 书学完了 / waiting 今天没有到期的
    status = Column(String(20), nullable=False)
    source = Column(String(10), nullable=False, default="auto")   # auto 签到自动 / teacher 老师点的
    actor_name = Column(String(100), nullable=True)
    tier = Column(Integer, nullable=True)
    pass_line = Column(Integer, nullable=True)
    words = Column(Integer, nullable=True)
    location = Column(String(10), nullable=True)
    reason = Column(String(300), nullable=True)
    plan = Column(Text, nullable=True)                 # JSON: 派的每一项
    extra_batches = Column(Integer, nullable=False, default=0, server_default="0")  # 今天加练派了几批
    claimed_at = Column(DateTime, nullable=True)      # 开始派的时刻(派到一半进程挂了,5 分钟后可以重来)
    comment_at = Column(DateTime, nullable=True)
    comment_source = Column(String(10), nullable=True)  # ai / rule / skip
    comment_flag = Column(String(20), nullable=True)    # struggling = 小鹰老师觉得今天学得吃力
    comment_tokens = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (UniqueConstraint("student_id", "day", name="uq_autopilot_dispatch_day"),)


class AutopilotTask(Base):
    """派出去的每一份作业(老师「作业管理」里看到的就是这些)"""
    __tablename__ = "autopilot_tasks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    dispatch_id = Column(Integer, nullable=False, index=True)
    student_id = Column(Integer, nullable=False)
    day = Column(String(10), nullable=False)
    kind = Column(String(10), nullable=False)          # new / round / review
    homework_id = Column(Integer, nullable=False)      # homework_assignments.id(review 是 content_homework.id)
    is_content = Column(Boolean, nullable=False, default=False)
    unit_id = Column(Integer, nullable=True)
    group_index = Column(Integer, nullable=True)       # 第一组(homework_assignments.group_index 也写它)
    groups = Column(String(200), nullable=True)        # 这份作业的全部组 "3,4,5"
    round_no = Column(Integer, nullable=True)
    batch = Column(Integer, nullable=False, default=0)  # 加练第几批(0 = 当天的任务)
    words = Column(Integer, nullable=False, default=0)

    __table_args__ = (Index("idx_autopilot_task_hw", "homework_id"),)


def extra_homework_ids():
    """「加练」那几份单词作业的 id(子查询)。今天的任务做完以后孩子自己要的,
    不进金币分母、陪跑看板、今日报告的「今天的任务」—— 否则多练一组反而让「全做完」变成没做完"""
    return select(AutopilotTask.homework_id).where(AutopilotTask.batch > 0, AutopilotTask.is_content.is_(False))


def auto_homework_ids(student_id=None, *, content: bool = False):
    """小鹰老师派的作业 id(子查询),content=True 是复习那种(content_homework)"""
    q = select(AutopilotTask.homework_id).where(AutopilotTask.is_content.is_(content))
    if student_id is not None:
        q = q.where(AutopilotTask.student_id == student_id)
    return q
