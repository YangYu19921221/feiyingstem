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
