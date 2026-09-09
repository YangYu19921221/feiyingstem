"""音标教学视频

音标是英语的基础(拼读、听写全都建立在它上面),所以做成独立入口而不是塞在某本
单词本里。视频由老师在教师端上传,标题默认取文件名。

文件存**私有目录**(见 config.PHONETIC_VIDEO_DIR),经鉴权串流端点播放。
⚠️ 不能落 UPLOAD_DIR —— 那个目录整体经 /api/v1/files 公开无鉴权(见 main.py),
放视频等于谁拿到链接都能看。
"""
from sqlalchemy import (
    Column, Integer, String, Text, Boolean, DateTime, ForeignKey,
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

    sort_order = Column(Integer, nullable=False, default=0)  # 同类内排序,小的在前
    is_active = Column(Boolean, nullable=False, default=True)  # 下架不删除,学生端不再列出
    view_count = Column(Integer, nullable=False, default=0)

    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    # 多租户:NULL = 平台共享(所有机构可见),非 NULL = 该机构自建。
    # 与 word_books/reading_passages 同样式(shared_nullable),索引由 init_db 建
    org_id = Column(Integer, nullable=True)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


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
