"""音标听力(2026-11-03)

用户拿来《飞鹰英语专用教材听力练习本》一页: 每题一行「3—4 尾2」「4—5 [k]照抄 尾2」,
学生听老师读一个词,在下面的横线上写。「3—4」是教材里的小节,后面是拼写提示(尾2 = 词尾两个字母
那种写法、[k]照抄 = /k/ 按例词那样写……),**这些老师自己填**。

用户 11-03 定的三件事:
1. 学生在 App 里听音打字(不是写纸上拍照)
2. 默认系统读(全站同一个 Sonia 女声),某一题老师可以传自己的录音换掉
3. 每题**单词和音标都要写**,两个都对才算这题对

一份听力 = 一张练习页(ListeningSet),题目一行一个(ListeningItem)。
挂在音标教材(PhoneticBook)下面,可见性跟着教材走: 本机构的 + 平台预置的。
答案(单词、音标)只在判分接口里用,题目列表**不下发** —— 听力就是要听出来写。
"""
from sqlalchemy import (
    Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text,
)
from sqlalchemy.sql import func

from app.core.database import Base


class ListeningSet(Base):
    """一张听力练习页(纸书上「听-2」「听-3」那样一组 10 题)"""
    __tablename__ = "phonetic_listening_sets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    book_id = Column(Integer, ForeignKey("phonetic_books.id"), nullable=False)
    title = Column(String(100), nullable=False)          # 「听-2」
    sort_order = Column(Integer, nullable=False, default=0)
    is_active = Column(Boolean, nullable=False, default=True)
    # 这套归哪个机构(建它的老师的机构;平台 admin 建的 NULL = 所有机构都能用)。
    # 教材可能是平台预置的(生产只有那一本),套的归属不看教材
    org_id = Column(Integer, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (Index("idx_listening_sets_book", "book_id", "sort_order"),)


class ListeningItem(Base):
    """一题: 听一个词,写单词 + 写音标"""
    __tablename__ = "phonetic_listening_items"

    id = Column(Integer, primary_key=True, autoincrement=True)
    set_id = Column(Integer, ForeignKey("phonetic_listening_sets.id"), nullable=False)
    order_index = Column(Integer, nullable=False, default=0)
    word = Column(String(100), nullable=False)
    meaning = Column(String(200), nullable=True)
    # 音标 token 数组(和音标教材同一套切分,services/phonetic_tokenize)
    answer_json = Column(Text, nullable=False)
    answer_display = Column(String(100), nullable=True)
    core_indexes_json = Column(Text, nullable=True)
    # 老师写的提示,原样给学生看: 「3—4 尾2」「4—5 [k]照抄 尾2」。最多 40 字
    hint = Column(String(60), nullable=True)
    # 老师指定的发音文字(cede 读 seed),和音标教材同一个口径;没填按单词读
    tts_text = Column(String(200), nullable=True)
    # 老师自己的录音(private_media/phonetic_listening/,不进 UPLOAD_DIR —— 那里公开无鉴权)
    audio_path = Column(String(200), nullable=True)
    audio_mime = Column(String(60), nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (Index("idx_listening_items_set", "set_id", "order_index"),)


class ListeningAttempt(Base):
    """学生每次交一题记一行(第二遍也记)。只为老师看学情、以后重算,不进掌握度"""
    __tablename__ = "phonetic_listening_attempts"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    item_id = Column(Integer, ForeignKey("phonetic_listening_items.id"), nullable=False)
    set_id = Column(Integer, ForeignKey("phonetic_listening_sets.id"), nullable=False)
    pass_number = Column(Integer, nullable=False, default=1)
    word_submitted = Column(String(100), nullable=True)
    word_correct = Column(Boolean, nullable=False, default=False)
    phonetic_submitted_json = Column(Text, nullable=True)
    phonetic_correct = Column(Boolean, nullable=False, default=False)
    is_correct = Column(Boolean, nullable=False, default=False)
    gave_up = Column(Boolean, nullable=False, default=False)
    duration_ms = Column(Integer, nullable=True)
    org_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("idx_listening_attempts_user_set", "user_id", "set_id"),
        Index("idx_listening_attempts_set", "set_id", "created_at"),
    )
