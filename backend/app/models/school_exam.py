"""学校考试 · 丢分分析(2026-11-26)。规则见 services/school_exam.py 文件头。

老师建一次考试(哪个班、哪天、这次考试的卷子在试卷库里拆好的那份)→
① 录分项分(听力 / 单选 / 完形 / 阅读 / 作文 … 各得几分)
② 孩子(或老师)拍学校批改过的卷子 → 阅卷模型认出每题孩子写了什么、老师怎么批的 → 对上试卷库里拆好的题和知识点
→ 每个孩子一份「这次考试丢分在哪」+ 全班汇总;确认了的题记进孩子的把握度(paper_kp_mastery),每日小卷先补这些点。

几张表:
- school_exams          一次考试(属于一个班)
- school_exam_scores    一个孩子这次考试的分数: 总分 + 每道大题得分(老师录的 / 从照片上读的)
- school_exam_sheets    孩子拍的一份卷子(一次上传,可以好几页)和模型读出来的结果。**照片不存**,只存读出来的字
- school_exam_answers   这次考试里一个孩子一道题最后算对还是错(一题一行,只写一次 —— 记进把握度也只记一次)
"""
from sqlalchemy import JSON, Boolean, Column, Date, DateTime, Float, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.sql import func

from app.core.database import Base


class SchoolExam(Base):
    __tablename__ = "school_exams"

    id = Column(Integer, primary_key=True, autoincrement=True)
    org_id = Column(Integer, nullable=True, index=True)
    class_id = Column(Integer, nullable=False, index=True)
    teacher_id = Column(Integer, nullable=False)                   # 班主任(助教建的也记主老师,见 core/actor)
    name = Column(String(60), nullable=False)                      # 「七上期中考试」
    exam_date = Column(Date, nullable=True)
    doc_id = Column(Integer, nullable=True)                        # 这次考试的卷子(试卷库 paper_docs.id);没有就只能录分
    paper_title = Column(String(120), nullable=True)               # 那份文件里有好几套卷时,是哪一套(空 = 整份文件)
    sections = Column(JSON, nullable=False)                        # [{"name": "听力", "full": 20}] 按卷子上的顺序
    full_score = Column(Float, nullable=True)                      # 满分(没填 = 各大题满分加起来)
    open_upload = Column(Boolean, nullable=False, default=True, server_default="1")   # 孩子能不能自己拍卷子传
    created_by = Column(Integer, nullable=True)
    created_by_name = Column(String(100), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
    deleted_at = Column(DateTime, nullable=True)

    __table_args__ = (Index("ix_school_exams_class_date", "class_id", "exam_date"),)


class SchoolExamScore(Base):
    __tablename__ = "school_exam_scores"

    id = Column(Integer, primary_key=True, autoincrement=True)
    exam_id = Column(Integer, nullable=False, index=True)
    student_id = Column(Integer, nullable=False, index=True)
    total = Column(Float, nullable=True)
    sections = Column(JSON, nullable=True)                         # {"听力": 18, "单项选择": 13.5}
    # 每一项是谁填的: {"total": "teacher", "听力": "photo"} —— 老师录的不被照片覆盖
    sources = Column(JSON, nullable=True)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (UniqueConstraint("exam_id", "student_id", name="uq_school_exam_score"),)


class SchoolExamSheet(Base):
    __tablename__ = "school_exam_sheets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    exam_id = Column(Integer, nullable=False, index=True)
    student_id = Column(Integer, nullable=False, index=True)
    org_id = Column(Integer, nullable=True)
    uploaded_by = Column(Integer, nullable=True)
    uploaded_by_role = Column(String(10), nullable=True)          # student / teacher
    pages = Column(Integer, nullable=False, default=1, server_default="1")
    # pending 在读 / done 读好了 / failed 没读出来
    status = Column(String(8), nullable=False, default="pending", server_default="pending")
    reason = Column(Text, nullable=True)                           # 给孩子 / 老师看的话
    error = Column(Text, nullable=True)
    model = Column(String(60), nullable=True)
    input_tokens = Column(Integer, nullable=True)
    output_tokens = Column(Integer, nullable=True)
    # 每道题读出来的: [{"item_id", "no", "given", "mark", "lost", "unsure", "found", "judged", "state"}]
    # state: recorded 记下了 / confirm 要老师确认 / missing 照片里没找到
    items = Column(JSON, nullable=True)
    read_sections = Column(JSON, nullable=True)                    # 卷子上写的各大题得分 [{"name", "score", "full"}]
    read_total = Column(Float, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    finished_at = Column(DateTime, nullable=True)

    __table_args__ = (Index("ix_school_exam_sheets_exam_student", "exam_id", "student_id"),)


class SchoolExamAnswer(Base):
    __tablename__ = "school_exam_answers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    exam_id = Column(Integer, nullable=False, index=True)
    student_id = Column(Integer, nullable=False, index=True)
    item_id = Column(Integer, nullable=False)
    sheet_id = Column(Integer, nullable=True)
    answer = Column(String(200), nullable=True)                    # 孩子写的
    correct = Column(Boolean, nullable=False)
    code = Column(String(40), nullable=True)                       # 错法
    lost = Column(Float, nullable=True)                            # 这题扣了几分(卷子上写了才有)
    source = Column(String(10), nullable=False, default="photo", server_default="photo")   # photo / teacher(老师改判)
    applied = Column(Boolean, nullable=False, default=False, server_default="0")             # 记进把握度了没有
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (UniqueConstraint("exam_id", "student_id", "item_id", name="uq_school_exam_answer"),)
