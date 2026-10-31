"""学习时离开了多久 + 摄像头看人在不在(2026-10-31)

规则真源 services/focus_watch.py 文件头。三张新表都由 create_all 建,不进 tenancy 锚点,
查询一律按学生 id(家长按绑定关系、老师按本班名单)。
"""
from sqlalchemy import Column, Integer, String, DateTime, Date, ForeignKey, Index, UniqueConstraint
from sqlalchemy.sql import func

from app.core.database import Base


class FocusAwayEvent(Base):
    """一次离开: 切出学习页面(switch)或摄像头里看不到人(no_face)。

    switch 只记离开满 5 秒的(和切屏次数同一道门,输入法弹窗那种 1-2 秒的不算);
    no_face 只记连续 NO_FACE_MS 以上的。left_at 是离开的那一刻(UTC),away_ms 封顶 4 小时。
    """
    __tablename__ = "focus_away_events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    study_date = Column(Date, nullable=False)        # 北京日(按回来那一刻算)
    kind = Column(String(10), nullable=False)        # switch / no_face
    left_at = Column(DateTime, nullable=False)
    away_ms = Column(Integer, nullable=False, default=0)
    page = Column(String(80), nullable=True)         # 离开时在哪个学习页(路径),给老师 / 家长看在做什么
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("ix_focus_away_user_day", "user_id", "study_date"),
    )


class CameraConsent(Base):
    """家长同意用摄像头看孩子在不在(一个孩子一行)。

    《人脸识别技术应用安全管理办法》第七条: 不满十四周岁要父母或其他监护人同意。
    method: parent = 家长在家长端自己点的;paper = 家长签了纸质同意书,老师登记的。
    status: granted / revoked;撤回只改 status 和 revoked_*,同意那一次的记录留着。
    notice_version = 同意时看到的那一版告知(services/focus_watch.NOTICE_VERSION)。
    """
    __tablename__ = "camera_consents"

    student_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    status = Column(String(10), nullable=False, default="granted")
    method = Column(String(10), nullable=False)
    notice_version = Column(String(20), nullable=False)
    granted_by = Column(Integer, nullable=True)
    granted_by_name = Column(String(100), nullable=True)
    granted_at = Column(DateTime, nullable=True)
    revoked_by = Column(Integer, nullable=True)
    revoked_by_name = Column(String(100), nullable=True)
    revoked_at = Column(DateTime, nullable=True)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class CameraDayStatus(Base):
    """孩子这台设备今天摄像头开没开得起来(一人一天一行,留最后一次)。

    on 开着 / denied 孩子没允许 / unavailable 这台设备没有摄像头 / error 别的原因没开起来。
    家长看到「同意了但今天没开」时要知道是哪一种。
    """
    __tablename__ = "camera_day_status"

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    study_date = Column(Date, nullable=False)
    status = Column(String(12), nullable=False)
    updated_at = Column(DateTime, nullable=True)

    __table_args__ = (
        UniqueConstraint("user_id", "study_date", name="uq_camera_day_status_user_day"),
    )
