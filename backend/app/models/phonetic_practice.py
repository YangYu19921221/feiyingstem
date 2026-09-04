"""音标填空题库(看单词写音标)

题型来自纸质教材:书上印  bad [bæd] 坏的,答案版括号里是红字音标;
学生做的是  bad [ _ _ _ ] 坏的,自己把音标填进括号,做完再读一遍验发音。

为什么不复用 units/word_books:
音标是独立模块(与 phonetic_videos 并排,见 phonetic.py 的说明),
而且**答案不能当展示字段**——把音标显示在单词卡上就等于泄题。

⚠️ answer_tokens 存**音素 token 的 JSON 数组**而不是音标字符串。原因:
同一个音在三处写法不同 —— 视频教 [ei]、教材印 [eɪ]、词库存 /eɪ/。
学生点软键盘产出的是 token,判分是数组比数组,这些分歧从根上不存在。
归一只发生在导入那一处(前端 utils/ipaPhonemes.ts 的 normalizeIpa)。
"""
from sqlalchemy import (
    Column, Integer, String, Text, Boolean, DateTime, ForeignKey, UniqueConstraint,
)
from sqlalchemy.sql import func

from app.core.database import Base


class PhoneticBook(Base):
    """一册音标教材,如「飞鹰英语专用教材第1册」"""
    __tablename__ = "phonetic_books"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    volume = Column(String(50), nullable=True)          # 册次,如「第1册」
    is_active = Column(Boolean, nullable=False, default=True)

    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    # 多租户:NULL = 平台共享,与 phonetic_videos 同口径(shared_nullable)
    org_id = Column(Integer, nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class PhoneticLesson(Base):
    """一节,如「1—1 拼读」。20 词一节(个别 10 词)"""
    __tablename__ = "phonetic_lessons"
    __table_args__ = (
        UniqueConstraint("book_id", "code", name="uq_phonetic_lesson_code"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    book_id = Column(Integer, ForeignKey("phonetic_books.id"), nullable=False)

    # 小节号保留纸书写法「1—1」(全角破折号),老师和学生看到的与纸书一致
    code = Column(String(20), nullable=False)
    title = Column(String(200), nullable=False)         # 如「1—1 拼读」
    lesson_number = Column(Integer, nullable=False, default=0)   # 顺序解锁用

    # 挂老师自己录的讲解视频。元音填错第二遍还错时跳到这里,
    # 这是「音标和视频在一起」真正落地的地方:错题直接回到讲解
    video_id = Column(Integer, ForeignKey("phonetic_videos.id"), nullable=True)

    # 这一节在教的音素,JSON 数组如 ["æ","eɪ","iː"],键盘上高亮
    highlight_json = Column(Text, nullable=True)

    # 剔除敏感词的节数,>0 时单元名会标「(已剔N词)」,
    # 否则老师照纸书上课会以为系统漏词
    removed_count = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime, server_default=func.now())


class PhoneticItem(Base):
    """一道题 = 一个词"""
    __tablename__ = "phonetic_items"

    id = Column(Integer, primary_key=True, autoincrement=True)
    lesson_id = Column(Integer, ForeignKey("phonetic_lessons.id"), nullable=False)

    word = Column(String(100), nullable=False)
    meaning = Column(String(200), nullable=True)

    # 标准答案:音素 token 的 JSON 数组,如 ["b","æ","d"]
    answer_json = Column(Text, nullable=False)
    # 展示串,如 [bæd] —— 判分不用它,只在「显示正确答案」时用
    answer_display = Column(String(100), nullable=True)
    # 第二遍要挖的格下标(元音格),JSON 数组如 [1]。
    # 元音是拼读的教学点,辅音是送分的
    core_indexes_json = Column(Text, nullable=True)

    order_index = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime, server_default=func.now())


class PhoneticAttempt(Base):
    """作答记录

    ⚠️ 表名是 `phonetic_textbook_attempts` 而不是 `phonetic_attempts`:
    后者被 docs/音标闯关课开发方案.md(2026-08-04 定稿)预留给「48 音七步课」
    存七步数据。这两个模块是不同的东西 —— 那套从零教 48 个音素,
    本模块按纸质教材 48 节练拼读 —— 不该抢它的表名。

    补一个现有缺口:发音分数目前在系统里**完全不落库**,只在前端当卡片学习的
    过关门槛用,老师查不到历史。音标这块从一开始就落。
    """
    __tablename__ = "phonetic_textbook_attempts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("phonetic_items.id"), nullable=False)
    lesson_id = Column(Integer, ForeignKey("phonetic_lessons.id"), nullable=False)

    pass_number = Column(Integer, nullable=False, default=1)     # 1=全空 2=只挖元音
    submitted_json = Column(Text, nullable=True)                 # 学生填的 token 数组
    wrong_indexes_json = Column(Text, nullable=True)             # 错在哪几格
    is_correct = Column(Boolean, nullable=False, default=False)
    duration_ms = Column(Integer, nullable=True)

    # 发音评测分(接上评测服务后回填,现在留空)
    pron_score = Column(Integer, nullable=True)

    # 幂等键:整页交卷时前端生成,弱网连点两次不重复写记录
    # (音标闯关课方案 §12 红线 9,沿用 claim_client_batch 的思路)
    client_batch_id = Column(String(64), nullable=True)

    org_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class PhoneticReading(Base):
    """跟读录音(看音标读出来)

    **第一期刻意不打分**。实测 whisper 判的是拼写相似度不是发音:
    拿 bad 的音频去验 bed 会判 66 分通过 —— 而 æ/e 这组对立正是本教材要教的。
    机器判错一次孩子就不敢开口了,而漏放的代价只是这次没纠到,下节课还能纠。

    所以这一期的反馈是「标准音 → 自己的音 → 标准音」对比回放(本身就是有效教法)
    + 老师抽听(真人纠音 100% 准)。录音攒下来,将来要定阈值时有本校真实童声样本,
    而不是照抄成人朗读场景的 60 分线。
    """
    __tablename__ = "phonetic_readings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("phonetic_items.id"), nullable=False)
    lesson_id = Column(Integer, ForeignKey("phonetic_lessons.id"), nullable=False)

    # 私有目录下的文件名(已随机化),不含路径
    file_path = Column(String(200), nullable=False)
    mime_type = Column(String(60), nullable=True)     # iOS 是 audio/mp4,其余多为 webm
    file_size = Column(Integer, nullable=True)
    duration_ms = Column(Integer, nullable=True)

    # 老师抽听后的标记:None=没听过 / ok=没问题 / retry=要重练
    teacher_mark = Column(String(12), nullable=True)
    teacher_note = Column(String(200), nullable=True)
    marked_by = Column(Integer, ForeignKey("users.id"), nullable=True)

    # 预留:将来接音素级评测再回填,第一期恒为 NULL 且不给学生看
    pron_score = Column(Integer, nullable=True)

    org_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())
