"""试卷库 + 专项小卷(2026-11-22)。规则见 services/paper_bank.py 文件头。

老师传一份卷子(PDF / 照片 / Word) → 拆卷用的 Claude 把单项选择和填空题拆成一道道题、标知识点和错法 →
老师核对通过的题进题库 → 系统按每个孩子的薄弱知识点和薄弱单词,每天给他出一份小卷(在网页上做,也能打印)。

几张表:
- paper_docs      一份上传的文件(一份文件里常有好几套卷,比如一本测评卷 9 套)
- paper_pages     文件的每一页: 切好的小图存在 private_media/paper_bank/{doc_id}/,模型拆出来的原样结果存 result
- paper_items     一道题。正确答案只在服务器,发给孩子的那份去掉(见 services/paper_bank.public_item)
- paper_quizzes   一个孩子一天一份小卷(题目 id 和每道为什么出给他)
- paper_answers   孩子做的每一题(只认第一次交的)
- paper_kp_mastery 一个孩子一个知识点一行: 把握度、回头考到第几级、哪天到期、犯过哪些错法

卷子文件不放 UPLOAD_DIR(那个目录整个公开无鉴权),放 private_media,只有本机构老师经接口看得到。
"""
from sqlalchemy import (
    JSON, Boolean, Column, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint,
)
from sqlalchemy.sql import func

from app.core.database import Base


class PaperDoc(Base):
    __tablename__ = "paper_docs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    org_id = Column(Integer, nullable=True, index=True)          # 上传的人所在机构;题只给这个机构用
    title = Column(String(120), nullable=False)
    grade = Column(String(10), nullable=True)                     # 卷子是几年级的(tutor_level.GRADE_OPTIONS)
    note = Column(String(200), nullable=True)
    file_name = Column(String(120), nullable=True)
    file_kind = Column(String(10), nullable=True)                 # pdf / image / docx
    file_sha1 = Column(String(40), nullable=True, index=True)     # 同一份文件不重复拆
    pages = Column(Integer, nullable=False, default=0, server_default="0")
    pages_done = Column(Integer, nullable=False, default=0, server_default="0")
    # queued 排队 / parsing 在拆 / review 等老师核对 / failed 没拆出来 / deleted 删了(软删,做过的题记录还在)
    status = Column(String(10), nullable=False, default="queued", server_default="queued")
    reason = Column(Text, nullable=True)                          # 给老师看的话(没拆出来的原因)
    error = Column(Text, nullable=True)
    model = Column(String(60), nullable=True)
    input_tokens = Column(Integer, nullable=False, default=0, server_default="0")
    output_tokens = Column(Integer, nullable=False, default=0, server_default="0")
    skipped = Column(JSON, nullable=True)                         # 没拆的大题(听力、完形、阅读…)[{paper, name, reason}]
    uploaded_by = Column(Integer, nullable=True)
    uploaded_by_name = Column(String(100), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    deleted_at = Column(DateTime, nullable=True)

    __table_args__ = (Index("ix_paper_docs_org_created", "org_id", "created_at"),)


class PaperPage(Base):
    __tablename__ = "paper_pages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    doc_id = Column(Integer, ForeignKey("paper_docs.id", ondelete="CASCADE"), nullable=False, index=True)
    page_no = Column(Integer, nullable=False)                     # 从 1 开始
    tiles = Column(JSON, nullable=True)                           # 切好的小图文件名,按阅读顺序
    text = Column(Text, nullable=True)                            # Word 文档: 这一页的文字(没有图)
    status = Column(String(10), nullable=False, default="pending", server_default="pending")  # pending / done / failed
    result = Column(JSON, nullable=True)                          # 模型交的原样结果(查问题用)
    error = Column(Text, nullable=True)
    input_tokens = Column(Integer, nullable=False, default=0, server_default="0")
    output_tokens = Column(Integer, nullable=False, default=0, server_default="0")
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (UniqueConstraint("doc_id", "page_no", name="uq_paper_page"),)


class PaperItem(Base):
    __tablename__ = "paper_items"

    id = Column(Integer, primary_key=True, autoincrement=True)
    doc_id = Column(Integer, ForeignKey("paper_docs.id", ondelete="CASCADE"), nullable=False, index=True)
    org_id = Column(Integer, nullable=True, index=True)
    grade = Column(String(10), nullable=True)                     # 跟着文件走,老师改文件年级时一起改
    paper_title = Column(String(120), nullable=True)              # 属于文件里的哪一套卷
    section = Column(String(60), nullable=True)                   # 大题名: 单项选择 / 用所给词的正确形式填空 …
    no = Column(String(10), nullable=True)                        # 卷子上的题号
    seq = Column(Integer, nullable=False, default=0, server_default="0")   # 在文件里的先后
    kind = Column(String(6), nullable=False)                      # mc 选择 / fill 填空
    stem = Column(Text, nullable=False)                           # 题干,空用 ___ 表示
    options = Column(JSON, nullable=True)                         # 选择题的选项(不带 A. B.)
    answer = Column(JSON, nullable=False)                         # 选择: "A";填空: ["likes"](一个空一项)
    alts = Column(JSON, nullable=True)                            # 填空: 每个空另外也算对的写法 [[...], ...]
    base_word = Column(String(40), nullable=True)                 # 填空给的词(括号里 / 方框里的)
    explain = Column(Text, nullable=True)                         # 为什么是这个答案(做完才给孩子看)
    kps = Column(JSON, nullable=True)                             # 知识点 id(services/paper_kp)
    wrong = Column(JSON, nullable=True)                           # 选择题每个错选项 {"B": {"code", "why"}}
    traps = Column(JSON, nullable=True)                           # 填空常见填错 [{"text", "code", "why"}]
    answer_source = Column(String(6), nullable=True)              # page 卷面上标了 / key 答案页 / ai 模型自己做的
    flags = Column(JSON, nullable=True)                           # 模型拿不准的地方(老师重点看)
    needs_image = Column(Boolean, nullable=False, default=False, server_default="0")
    page_no = Column(Integer, nullable=True)
    tile_idx = Column(Integer, nullable=True)
    y0 = Column(Float, nullable=True)                             # 在那块小图里的上下位置(0–1),截原题图用
    y1 = Column(Float, nullable=True)
    test_words = Column(JSON, nullable=True)                      # 考的词(答案 / 选项里的实词),词形归一后的
    context_words = Column(JSON, nullable=True)                   # 题干里的实词
    difficulty = Column(Float, nullable=False, default=0.0, server_default="0")   # 越大越难,按孩子作答自己调
    n_answers = Column(Integer, nullable=False, default=0, server_default="0")
    n_correct = Column(Integer, nullable=False, default=0, server_default="0")
    # pending 等核对 / approved 进题库 / rejected 不要
    status = Column(String(10), nullable=False, default="pending", server_default="pending")
    reviewed_by = Column(Integer, nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (Index("ix_paper_items_org_status", "org_id", "status"),)


class PaperQuiz(Base):
    __tablename__ = "paper_quizzes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, index=True)
    org_id = Column(Integer, nullable=True)
    quiz_date = Column(Date, nullable=False)                      # 北京日
    mode = Column(String(10), nullable=False, default="daily", server_default="daily")  # daily / diagnose
    items = Column(JSON, nullable=False)                          # [{"id", "why", "label"}] 按出题顺序
    total = Column(Integer, nullable=False, default=0, server_default="0")
    answered = Column(Integer, nullable=False, default=0, server_default="0")
    right = Column(Integer, nullable=False, default=0, server_default="0")
    status = Column(String(6), nullable=False, default="open", server_default="open")   # open / done
    created_at = Column(DateTime, server_default=func.now())
    finished_at = Column(DateTime, nullable=True)

    __table_args__ = (UniqueConstraint("user_id", "quiz_date", name="uq_paper_quiz_user_day"),)


class PaperAnswer(Base):
    __tablename__ = "paper_answers"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False, index=True)
    quiz_id = Column(Integer, ForeignKey("paper_quizzes.id", ondelete="CASCADE"), nullable=False)
    item_id = Column(Integer, nullable=False, index=True)
    answer = Column(String(200), nullable=True)
    correct = Column(Boolean, nullable=False)
    code = Column(String(40), nullable=True)                      # 错法(选了哪个错选项 / 填成了哪种错)
    ms = Column(Integer, nullable=True)
    word_drag = Column(Boolean, nullable=False, default=False, server_default="0")   # 题里有他没掌握的单词
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (UniqueConstraint("quiz_id", "item_id", name="uq_paper_answer_once"),)


class PaperKpMastery(Base):
    __tablename__ = "paper_kp_mastery"

    user_id = Column(Integer, primary_key=True)
    kp = Column(String(30), primary_key=True)
    theta = Column(Float, nullable=False, default=0.0, server_default="0")    # 把握度(Elo 打分,0 = 一半一半)
    n = Column(Integer, nullable=False, default=0, server_default="0")        # 做过几题
    right = Column(Integer, nullable=False, default=0, server_default="0")
    stage = Column(Integer, nullable=False, default=0, server_default="0")    # 回头考到第几级(0–3)
    due = Column(String(10), nullable=True)                                    # 下次回头考的北京日 YYYY-MM-DD
    codes = Column(JSON, nullable=True)                                        # {错法: 次数}
    last_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
