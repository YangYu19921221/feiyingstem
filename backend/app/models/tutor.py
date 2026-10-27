"""AI 学习助手对话(2026-10-26)

学生和助手的一段对话 = 一行 tutor_conversations,每条消息一行 tutor_messages。
- 孩子发的题目照片**不落盘**(只过内存给模型看),消息上只记 has_image;
  助手回答第一行会写「我看到的题目: …」,老师看记录时知道孩子问的是什么
- 每条助手消息记模型和用量(input/output/cache tokens),管理端按天汇总控成本
- 只有本班老师能看(api/v1/tutor.py 的 teacher_router)
- 次数: 每个学生总共送 N 次(管理端设,默认 20),用完了老师加(tutor_allowances.extra),
  不按天清零(用户 10-26「每个学生总共 20,需要多的需要教师给增加额度」)
规则见 services/tutor.py。
"""
from sqlalchemy import JSON, Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.sql import func

from app.core.database import Base


class TutorConversation(Base):
    __tablename__ = "tutor_conversations"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    org_id = Column(Integer, nullable=True)
    title = Column(String(60), nullable=False, default="")
    message_count = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now())
    # 对话记录(2026-10-27,services/tutor_history): 收藏的不会到期自动删;
    # deleted_at = 孩子删了(孩子那边看不到,老师 30 天内还看得到,之后真删)
    starred = Column(Boolean, nullable=False, default=False, server_default="0")
    deleted_at = Column(DateTime, nullable=True)

    __table_args__ = (Index("ix_tutor_conv_user", "user_id", "updated_at"),)


class TutorMessage(Base):
    __tablename__ = "tutor_messages"

    id = Column(Integer, primary_key=True, autoincrement=True)
    conversation_id = Column(Integer, ForeignKey("tutor_conversations.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, nullable=False)          # 学生本人(助手消息也记学生 id,方便按人汇总)
    role = Column(String(10), nullable=False)          # user / assistant
    text = Column(Text, nullable=False, default="")
    has_image = Column(Boolean, nullable=False, default=False, server_default="0")
    # 助手消息上的卡片/按钮(默写卡、去复习),刷新后照样能重新画出来
    cards = Column(JSON, nullable=True)
    tools = Column(String(200), nullable=True)         # 这次用了哪些工具,逗号分隔
    model = Column(String(60), nullable=True)
    # fast = 快速回答 / deep = 深度思考(更强的模型 + 先想再答,算 2 次)。NULL = 10-26 加这列之前的(都是快速)
    mode = Column(String(10), nullable=True)
    # 孩子这条提问扣了几次(只记在 user 消息上): 0 = 同一道题的追问,不另算(services/tutor.followup_state);
    # NULL = 10-26 晚加这列之前的提问(按 mode 算: 快速 1 / 深度 deep_cost)
    cost = Column(Integer, nullable=True)
    input_tokens = Column(Integer, nullable=True)
    output_tokens = Column(Integer, nullable=True)
    cache_read_tokens = Column(Integer, nullable=True)
    cache_write_tokens = Column(Integer, nullable=True)
    error = Column(String(200), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("ix_tutor_msg_conv", "conversation_id", "id"),
        Index("ix_tutor_msg_day", "created_at"),
    )


class TutorAllowance(Base):
    """每个学生的学习助手次数。总数 = 管理端「每个学生送几次」+ extra(老师加的),不按天清零。
    used 只在提问时用条件 UPDATE 加(两台设备同时问不会超),调用彻底失败退回"""
    __tablename__ = "tutor_allowances"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    used = Column(Integer, nullable=False, default=0, server_default="0")
    extra = Column(Integer, nullable=False, default=0, server_default="0")
    # 孩子点了「请老师加次数」;老师加过就清空
    requested_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, server_default=func.now())


class TutorOrgPool(Base):
    """机构的学习助手次数池(2026-10-26 用户「免费 20 次后后续需要付费」→「按你建议,写进合同」)。

    加盟机构向平台**按次进货**(合同第三条),平台在这里给机构加次数(total);
    老师给本机构学生加次数时从池里扣(used),池里不够就加不了 —— 不然老师「加次数」就成了
    免费送平台的模型费。直营(org 1)不走池子,平台自己的。
    used 只用一条条件 UPDATE 加(used + n <= total),两位老师同时加不会超
    """
    __tablename__ = "tutor_org_pools"

    org_id = Column(Integer, primary_key=True)
    total = Column(Integer, nullable=False, default=0, server_default="0")
    used = Column(Integer, nullable=False, default=0, server_default="0")
    updated_at = Column(DateTime, server_default=func.now())


class TutorPoolLedger(Base):
    """次数池到账记录(只加不改): purchase=机构进货到账 / adjust=平台扣回(times 为负)"""
    __tablename__ = "tutor_pool_ledger"

    id = Column(Integer, primary_key=True, autoincrement=True)
    org_id = Column(Integer, nullable=False, index=True)
    times = Column(Integer, nullable=False)
    source = Column(String(10), nullable=False)
    note = Column(String(200), nullable=True)
    created_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class TutorGrantLog(Base):
    """给学生加次数的明细(只加不改): teacher=老师加(ref_id=老师 id)/ card=兑换学习卡带的(ref_id=兑换码 id)。
    同一张卡只送一次(card 那支 ref_id 唯一,部分唯一索引);孩子 / 家长问「卡带的次数去哪了」查这里"""
    __tablename__ = "tutor_grant_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False)
    times = Column(Integer, nullable=False)
    source = Column(String(10), nullable=False)
    ref_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("ix_tutor_grant_user", "user_id"),
        Index("uq_tutor_grant_card", "ref_id", unique=True, sqlite_where=text("source = 'card'")),
    )


class WordPicture(Base):
    """单词记忆图(2026-10-27,用户「GPT Image 2.5 Sunburst…3 毛一张,你设计下」)。规则见 services/word_picture.py

    **一个词(拼写 + 主释义)全平台只画一张**(pic_key 唯一): 画过的谁看都不扣次数;
    第一个点「画」的孩子扣 1 次学习助手次数,画不出来退回。
    图是按单词和课本释义画的,不含任何孩子的信息,存在公开目录 UPLOAD_DIR/word-pics(与封面图同性质)
    """
    __tablename__ = "word_pictures"

    id = Column(Integer, primary_key=True, autoincrement=True)
    pic_key = Column(String(64), nullable=False, unique=True)   # sha1(小写拼写 | 归一后的主释义)
    word = Column(String(100), nullable=False)
    meaning = Column(String(200), nullable=True)
    # pending 正在画 / ready 画好了 / failed 没画出来(已退回)/ removed 老师或管理员删掉了(下次有人点再画)
    status = Column(String(10), nullable=False, default="pending", server_default="pending")
    url = Column(String(255), nullable=True)
    model = Column(String(60), nullable=True)
    requested_by = Column(Integer, nullable=True)                # 这一次是谁点的「画」(扣的是他的次数)
    charged = Column(Integer, nullable=False, default=0, server_default="0")  # 这一次扣了几次(退回时用,退过清 0)
    error = Column(String(200), nullable=True)
    started_at = Column(DateTime, nullable=True)
    finished_at = Column(DateTime, nullable=True)
    removed_by = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())


class TutorNote(Base):
    """小鹰老师给每个孩子记的笔记(2026-10-27,用户「按你建议来」: 跨对话记住讲过什么、哪些还卡着,隔几天回头考)。
    规则见 services/tutor_notes.py。

    一条 = 一个知识点或一个单词(topic 归一后唯一)。stage 0 = 刚讲 / 刚错,答对一次升一级,
    复习间隔 1 → 3 → 7 天,第 3 次答对算掌握;答错回到 0、明天再考。
    只记学习内容,不记姓名学校"""
    __tablename__ = "tutor_notes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    topic_key = Column(String(80), nullable=False)          # 归一后的 topic(去空白标点、小写),去重用
    topic = Column(String(40), nullable=False)               # 显示用,如「一般现在时第三人称加 s」/ beautiful
    kind = Column(String(10), nullable=False, default="point", server_default="point")   # point 知识点 / word 单词
    detail = Column(String(120), nullable=True)              # 卡在哪(「常忘 does 后面动词还原」)
    stage = Column(Integer, nullable=False, default=0, server_default="0")
    mastered = Column(Boolean, nullable=False, default=False, server_default="0")
    due_date = Column(String(10), nullable=True)             # 北京日 YYYY-MM-DD(字符串比较,不碰 datetime 微秒格式坑)
    times_right = Column(Integer, nullable=False, default=0, server_default="0")
    times_wrong = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("uq_tutor_note_topic", "user_id", "topic_key", unique=True),
        Index("ix_tutor_note_due", "user_id", "mastered", "due_date"),
    )


class TutorQuiz(Base):
    """小鹰老师在聊天里出的一组练习(2026-10-27)。规则见 services/tutor_quiz.py。

    **答案只存在这里,不下发**: 消息里存的卡片(cards)是去掉答案的,孩子交了以后服务器判分,
    结果和正确答案才回给前端,再把结果发给小鹰老师点评。
    不进学习记录 / 掌握度(聊天里随手练,算进去会变成刷分入口),但会记进小鹰老师的笔记(tutor_notes)"""
    __tablename__ = "tutor_quizzes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    conversation_id = Column(Integer, nullable=True)
    topic = Column(String(40), nullable=True)            # 语法题考的知识点(记笔记用);单词卡为空,按单词记
    items = Column(JSON, nullable=False)                 # 含答案
    answers = Column(JSON, nullable=True)                # 孩子第一次交的
    results = Column(JSON, nullable=True)                # 第一次交的判分结果
    score = Column(Integer, nullable=True)
    total = Column(Integer, nullable=False, default=0, server_default="0")
    submitted_at = Column(DateTime, nullable=True)
    feedback_at = Column(DateTime, nullable=True)        # 结果已经发给小鹰老师点评了(一份练习只点评一次)
    # 点评这份练习不扣次数。点评那一轮里又出的练习为 False(不然「做题 → 免费点评 → 又出题」能一直白用)
    free_feedback = Column(Boolean, nullable=False, default=True, server_default="1")
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (Index("ix_tutor_quiz_user", "user_id", "id"),)


class TutorPref(Base):
    """小鹰老师按什么讲(2026-10-27,规则见 services/tutor_level.py)。没有这一行 = 年级按书推断、讲解方式自动。
    grade / pace 都可以由孩子自己设,也可以由本班老师替他设(*_by 记是谁设的);后设的为准"""
    __tablename__ = "tutor_prefs"

    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    grade = Column(String(10), nullable=True)        # 一年级…高三;NULL = 按在学的书推断
    grade_by = Column(String(10), nullable=True)     # student / teacher
    pace = Column(Integer, nullable=True)            # -1 讲简单一点 / 0 正常 / 1 讲深一点;NULL = 自动
    pace_by = Column(String(10), nullable=True)
    updated_at = Column(DateTime, server_default=func.now())


class TutorAlert(Base):
    """孩子在学习助手里说到难过、被欺负、想伤害自己(2026-10-27)。规则见 services/tutor_safety.py。

    一条提问最多一条(message_id 唯一,关键词和模型都命中时合并)。孩子删了对话、对话到期清理,提醒都留着 ——
    这是给老师的,出了事要有据。excerpt 存孩子那句话(最多 300 字),不存助手的回答"""
    __tablename__ = "tutor_alerts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False)
    org_id = Column(Integer, nullable=True)
    conversation_id = Column(Integer, nullable=True)
    message_id = Column(Integer, nullable=True)
    level = Column(String(10), nullable=False)          # urgent 想伤害自己 / concern 被欺负、很难过
    source = Column(String(20), nullable=False)         # keyword / model / keyword,model
    matched = Column(String(40), nullable=True)         # 关键词命中的那几个字
    reason = Column(String(120), nullable=True)         # 模型写的一句原因
    excerpt = Column(String(300), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    handled_at = Column(DateTime, nullable=True)
    handled_by = Column(Integer, nullable=True)
    handled_by_name = Column(String(60), nullable=True)
    handled_note = Column(String(200), nullable=True)

    __table_args__ = (
        Index("uq_tutor_alert_msg", "message_id", unique=True),
        Index("ix_tutor_alert_user", "user_id", "id"),
        Index("ix_tutor_alert_org", "org_id", "handled_at"),
    )


class TutorVoiceClip(Base):
    """学习助手「按住说话」的一段录音(2026-10-27,services/tutor_voice)。
    录音转完就删(file_path 置空),行里只留文字,1 天后整行删掉"""
    __tablename__ = "tutor_voice_clips"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, nullable=False)
    file_path = Column(String(120), nullable=True)
    status = Column(String(10), nullable=False, default="pending", server_default="pending")   # pending / done / failed
    text = Column(String(200), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    processed_at = Column(DateTime, nullable=True)

    __table_args__ = (Index("ix_tutor_voice_status", "status", "id"),)
