"""音标教学视频

音标是英语的基础(拼读、听写全都建立在它上面),所以做成独立入口而不是塞在某本
单词本里。视频由老师在教师端上传,标题默认取文件名。

文件存**私有目录**(见 config.PHONETIC_VIDEO_DIR),经鉴权串流端点播放。
⚠️ 不能落 UPLOAD_DIR —— 那个目录整体经 /api/v1/files 公开无鉴权(见 main.py),
放视频等于谁拿到链接都能看。
"""
from sqlalchemy import (
    Column, Integer, String, Text, Boolean, DateTime, ForeignKey, Index,
)
from sqlalchemy.sql import func

from app.core.database import Base


class PhoneticVideo(Base):
    __tablename__ = "phonetic_videos"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # 标题:上传时默认取文件名(去扩展名),老师可再改
    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)

    file_path = Column(String(500), nullable=False)     # 私有目录下的文件名(已随机化)

    file_size = Column(Integer, nullable=True)          # 字节,列表展示用
    duration_seconds = Column(Integer, nullable=True)   # 时长(可空,前端拿到元数据后可回填)
    mime_type = Column(String(100), nullable=True)
    cover_image = Column(String(500), nullable=True)    # 缩略图(可空,前端有兜底图)

    # 音标本身,如 /æ/ —— 单独存一列便于老师按音标搜
    phonetic_symbol = Column(String(50), nullable=True)
    # basic=入门总览 / vowel=元音 / consonant=辅音 / other
    category = Column(String(20), nullable=False, default="basic")

    # 讲师姓名(2026-09-17):**自由文本,不是 users 表的外键**。
    # 实际讲课的常是外聘老师/助教(没有系统账号),而有账号的老师也不一定是
    # 视频里讲课的那个人 —— 按 teacher_id 关联会让一半视频无法归属。
    # 学生端按这个字符串分组挑「自己的老师」,所以写法必须归一:
    # 一切写入路径都要过 services/lecturer_name.resolve()(向已有写法靠拢),
    # 否则「王老师」「王 老师」会在学生眼里变成两位老师。
    # NULL / 空 = 不归属任何讲师 = 学生端的「全校通用」(所有人都该看的内容)
    lecturer = Column(String(50), nullable=True)

    sort_order = Column(Integer, nullable=False, default=0)  # 同类内排序,小的在前
    is_active = Column(Boolean, nullable=False, default=True)  # 下架不删除,学生端不再列出
    view_count = Column(Integer, nullable=False, default=0)

    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    # 多租户:NULL = 平台共享(所有机构可见),非 NULL = 该机构自建。
    # 与 word_books/reading_passages 同样式(shared_nullable),索引由 init_db 建
    org_id = Column(Integer, nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class PhoneticVideoView(Base):
    """谁看了哪个音标视频、看了多久、看完没有(一人一视频一行)

    为什么需要它:`phonetic_videos.view_count` 是**打开次数**(每次 GET 详情 +1),
    同一个学生刷新十次就是 10 —— 它回答不了老师真正要问的三件事:
    「有几个人看过」「看进去了还是点开就走」「谁还没看」。这张表把这三件事补上。

    ⚠️ **必须有 UNIQUE(video_id, user_id)**:没有约束时并发心跳会插出多行,
    人数和时长统计当场翻倍(word_mastery 与 live_attendance 都吃过这个亏,
    见 CLAUDE.md「word_mastery 模型缺 UNIQUE 约束」)。

    ## 为什么记三个位置而不是一个

    - `watch_seconds`:净观看时长(心跳累加,**服务端封顶单次增量**,
      否则改前端就能刷出 10 小时)。回答「看进去了没有」。
    - `max_position_seconds`:看到过的最远处。回答「看到结尾了没有」。
    - `last_position_seconds`:上次退出的位置,**续播**用(学生端下次打开接着放)。

    判「看完」必须同时看前两个(见 services/video_watch.is_completed):
    只看 max_position → 把进度条拖到末尾就算看完,完看率变成废数;
    只看 watch_seconds → 反复看开头也能攒够时长,却从没看到结尾。
    """

    __tablename__ = "phonetic_video_views"

    id = Column(Integer, primary_key=True, autoincrement=True)

    video_id = Column(Integer, ForeignKey("phonetic_videos.id"), nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    # 打开次数(老 view_count 的同义物,但按人分开,所以能算「人均打开几次」)
    play_count = Column(Integer, nullable=False, default=0, server_default="0")
    watch_seconds = Column(Integer, nullable=False, default=0, server_default="0")
    max_position_seconds = Column(Integer, nullable=False, default=0, server_default="0")
    last_position_seconds = Column(Integer, nullable=False, default=0, server_default="0")
    # 冗余标记:算一次存下来,列表页不必每行现算(判定口径仍以 video_watch 为唯一真源)
    completed = Column(Boolean, nullable=False, default=False, server_default="0")

    first_viewed_at = Column(DateTime, server_default=func.now())
    # 「今天/近 7 天有多少人看」按这一列筛。UTC naive 存储,分天走 core/timeutil
    last_viewed_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("uq_phonetic_video_view", "video_id", "user_id", unique=True),
        # 「近 7 天谁看了」是教师端最频繁的查询
        Index("idx_phonetic_video_view_recent", "video_id", "last_viewed_at"),
    )


class PhoneticMaterial(Base):
    """音标视频的配套课件(PDF / PPT)

    老师讲音标时手上那份 PPT,学生看完视频想回看讲义 —— 视频与讲义本来是配套的,
    此前只能传视频,讲义只能靠老师课上口述。一个视频可配多份(讲义 + 练习页)。

    **只存渲染后的图给学生看,原文件永不下发**:课件是老师的劳动成果,
    给了原文件就等于给了可二次分发的母版。与直播课件「能看不能下」同一个口径,
    但**不烧水印、不留痕** —— 那套是防付费内容泄露的,音标讲义是教学辅助,
    按人烧水印的代价(每次翻页重新合成、no-store 禁缓存)在这里不值得。

    ⚠️ 渲染页目录**不能**用 watermark_service.material_dir():它只按整数 id 分目录
    (MATERIAL_DIR/rendered/{id}),而 live_materials 与本表的 id 各自从 1 开始,
    id=3 的音标课件会读到 id=3 的直播课件的页 —— 跨功能串号。本表走独立子目录。
    """

    __tablename__ = "phonetic_materials"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # 挂在视频上。删视频时课件一起删(见 teacher/phonetics.py 的删除路径:
    # 库里删行 + 磁盘删原文件与渲染页,SQLite 的外键级联默认不开,靠代码删)
    video_id = Column(Integer, ForeignKey("phonetic_videos.id"), nullable=False, index=True)

    title = Column(String(200), nullable=False)      # 默认取文件名(去扩展名),老师可改
    # pdf = 直接渲染;ppt/pptx = 先经 soffice 转 PDF 再渲染(存原始类型便于排查)
    kind = Column(String(10), nullable=False, default="pdf")

    file_path = Column(String(500), nullable=False)  # 私有目录下的随机化文件名,永不下发
    file_size = Column(Integer, nullable=True)

    page_count = Column(Integer, nullable=False, default=0)
    # 渲染没成的课件学生端直接看不到(而不是看到空白页),错因留给老师看并可重传
    render_ready = Column(Boolean, nullable=False, default=False)
    render_error = Column(String(400), nullable=True)

    sort_order = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)  # 下架不删,学生端不再列出

    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    # 多租户:与 PhoneticVideo 同口径(NULL = 平台共享)。
    # ⚠️ 但本表**不能只靠**租户过滤器 —— 它按 id 直查时罩不住"这份课件属于哪个视频",
    # 取页必须 join 回 phonetic_videos 再判可见性(音标教材那边踩过同样的坑)
    org_id = Column(Integer, nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class PhoneticVideoQuestion(Base):
    """学生在某个音标视频下的提问 + 老师的回答(一问一行,回答就写在同一行)

    ## 为什么是「按视频提问」而不是论坛

    做开放式论坛在这里会死于两件事:
    ① **冷启动** —— 一个机构几十个学生,发帖没人回,两周后是一片荒地。
       而本项目已经吃过「功能上线没人发现等于没做」的亏(纸笔听写那次)。
    ② **未成年人 UGC 的审核责任** —— 开放讨论区意味着要对孩子之间发的每句话负责,
       这是持续的人力成本,不是一次性开发。

    上下文绑定的提问反而小而活:孩子看某节课卡住,就在那节课下面问一句
    (自动带上**播放到第几秒**,老师一看就知道在问哪个音),老师端一个红点逐条回。
    这条路径能渐进长成讨论区(老师把好问题设为公开 → 那节课的常见问答),
    反过来把论坛缩成提问不行。

    ## 可见性:默认仅师生可见,老师可一键公开

    `is_public=False`(默认)= 只有提问者本人和老师看得见 → **零审核负担**,
    孩子也更敢问("怕被同学看见问得蠢"是这个年龄最真实的顾虑)。
    老师发现某个问题很多人问,点「设为公开」→ 它变成那节课下面所有人可见的问答。

    ⚠️ 公开的是**问题 + 回答这一对**,不是评论区: 本表**没有**楼层/回复链,
    一个问题只有一个老师回答。想做多轮讨论再加子表,别把 answer 拆成 JSON
    数组硬塞 —— 那样既查不了"谁还没被回答",也没法给单条回答记时间。
    """

    __tablename__ = "phonetic_video_questions"

    id = Column(Integer, primary_key=True, autoincrement=True)

    video_id = Column(Integer, ForeignKey("phonetic_videos.id"), nullable=False, index=True)
    # 提问的学生。删学生账号的情况见 CLAUDE.md「删用户前必查依赖」——
    # 生产 PRAGMA foreign_keys=0,这里的 FK 只是文档作用,真删要显式处理
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)

    content = Column(Text, nullable=False)
    # 提问时播放到第几秒。**这是这个功能比论坛好用的关键** ——
    # 「3 分 20 秒那个音我读不出来」比「老师这个音怎么读」可回答得多。
    # 可空:从列表页直接提问时没有播放位置
    position_seconds = Column(Integer, nullable=True)

    # ===== 老师的回答(未回答时全为空)=====
    answer = Column(Text, nullable=True)
    answered_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    answered_at = Column(DateTime, nullable=True)

    # 设为公开后,这节课下面所有学生都能看到这一问一答(见类注释)
    is_public = Column(Boolean, nullable=False, default=False, server_default="0")
    # 老师可隐藏不合适的提问:**软删不硬删** —— 硬删之后老师无法举证
    # "这孩子发过什么",而未成年人内容出纠纷时需要留痕
    is_hidden = Column(Boolean, nullable=False, default=False, server_default="0")

    # 多租户:与本文件其它表同口径。⚠️ 提问**必须显式带 org_id** 而不是靠视频推导 ——
    # 平台预置视频的 org_id 是 NULL,靠它推导会让 A 机构的学生看到 B 机构学生
    # 在同一个预置视频下的公开提问(姓名 + 原话都会漏)
    org_id = Column(Integer, nullable=True, index=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        # 学生端取某视频的问答:按视频 + 可见性筛,新的在前
        Index("idx_pvq_video", "video_id", "is_hidden", "created_at"),
        # 教师端红点「几个待回答」:**这是最频繁的查询**(每次进页面都要数),
        # answer IS NULL 的部分索引在 sqlite 上可用,但这里用普通复合索引
        # 保持与本文件其它索引同风格,机构内提问量级不值得上部分索引
        Index("idx_pvq_pending", "org_id", "answered_at"),
    )
