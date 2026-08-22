"""线上授课(直播)+ 课件资料模型

架构要点(与 CLAUDE.md「多租户」「UPLOAD_DIR 红线」两条对齐):

1. **媒体流量不经本服务**。视频走独立 SRS 源站 + CDN 扇出,本表只存"哪节课、
   谁在讲、推拉流凭据、谁看了多久"。所以 100 人和 1000 人对本服务开销一样。
2. **origin_node / push_provider 两列是扩容预留**:并行课时变多时后端按负载派
   发源站;要临时切云直播 SaaS 只改签发逻辑,不动表结构。
3. **课件绝不落 UPLOAD_DIR**(那个目录整体公开无鉴权)。原文件进 MATERIAL_DIR,
   学生永远只拿到「按人烧了水印的渲染页」,原文件没有任何可访问 URL。
4. LiveSession 是**租户锚点表**(org_id NOT NULL),资料/考勤/浏览记录经
   live_session_id 推导归属,靠 tenancy 过滤器自动隔离。
"""
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, Boolean, ForeignKey, Index, func
)

from app.core.database import Base


class LiveSession(Base):
    """直播课堂。一节课一行,老师开播/下课改 status,不删行(考勤和回放要留档)"""
    __tablename__ = "live_sessions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # org_id 不带 FK:organizations 表由 init_db 的原始 SQL 建,不在 metadata 图里
    # (users/coin 等既有锚点表同此惯例)
    org_id = Column(Integer, nullable=False, default=1, server_default="1", index=True)
    teacher_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    class_id = Column(Integer, ForeignKey("classes.id", ondelete="SET NULL"), nullable=True)

    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    # 计划开课时间。学生端「即将开课」列表按它排;NULL=随时开
    scheduled_at = Column(DateTime, nullable=True)

    # created(已建未播) / live(直播中) / ended(已下课) / canceled
    status = Column(String(20), nullable=False, default="created", server_default="created")
    started_at = Column(DateTime, nullable=True)
    ended_at = Column(DateTime, nullable=True)

    # ---- 媒体平面 ----
    # 流标识,进推拉流 URL。**随机不可猜**(可猜就能蹭课),建房时生成
    stream_key = Column(String(64), nullable=False, unique=True, index=True)
    # 源站节点标识(扩容预留)。空=用配置里的默认源站
    origin_node = Column(String(100), nullable=True)
    # srs / tencent / aliyun ...(换厂商预留)
    push_provider = Column(String(20), nullable=False, default="srs", server_default="srs")

    # ---- 回放 ----
    # 录制文件相对路径(已烧「飞鹰教育」水印的那份)。NULL=没有回放
    replay_path = Column(String(500), nullable=True)
    replay_ready = Column(Boolean, default=False, server_default="0", nullable=False)
    replay_duration = Column(Integer, nullable=True)  # 秒
    # 老师可关掉回放(有些课不想留)
    allow_replay = Column(Boolean, default=True, server_default="1", nullable=False)

    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    __table_args__ = (
        Index("idx_live_sessions_org_status", "org_id", "status"),
        Index("idx_live_sessions_teacher", "teacher_id", "scheduled_at"),
    )


class LiveMaterial(Base):
    """课件资料。同步线下用的那份,学生端只能看不能下,每页烧学生自己的水印。

    file_path 指向 MATERIAL_DIR 下的**原文件**,该路径永不出现在任何响应里。
    page_count 由上传时渲染确定;渲染页缓存在 MATERIAL_DIR/rendered/<id>/。
    """
    __tablename__ = "live_materials"

    id = Column(Integer, primary_key=True, autoincrement=True)
    # 可挂在某节课下,也可以是机构公共资料库(session_id 为空)
    live_session_id = Column(Integer, ForeignKey("live_sessions.id", ondelete="CASCADE"),
                             nullable=True, index=True)
    org_id = Column(Integer, nullable=False, default=1, server_default="1", index=True)
    uploader_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    title = Column(String(200), nullable=False)
    # pdf / image / video / office
    kind = Column(String(20), nullable=False)
    file_path = Column(String(500), nullable=False)  # 服务端内部路径,绝不下发
    file_size = Column(Integer, nullable=True)
    page_count = Column(Integer, nullable=True)  # PDF/图片集页数
    # 渲染就绪前学生端显示「处理中」——大 PDF 逐页渲染要时间
    render_ready = Column(Boolean, default=False, server_default="0", nullable=False)
    render_error = Column(Text, nullable=True)

    # 对学生可见(老师可先上传后放开)
    is_published = Column(Boolean, default=True, server_default="1", nullable=False)
    # 授课范围:NULL=本课学生;有值=指定班级
    class_id = Column(Integer, ForeignKey("classes.id", ondelete="SET NULL"), nullable=True)

    sort_order = Column(Integer, default=0, server_default="0", nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("idx_live_materials_org_pub", "org_id", "is_published"),
    )


class LiveAttendance(Base):
    """考勤 + 观看时长。心跳累加 watch_seconds,不按"进出次数"记多行。

    一个学生一节课一行(UNIQUE),重进不新增。**必须有 UNIQUE 约束** ——
    没有约束时并发心跳会写出多行,时长统计直接翻倍(word_mastery 吃过这个亏)。
    """
    __tablename__ = "live_attendance"

    id = Column(Integer, primary_key=True, autoincrement=True)
    live_session_id = Column(Integer, ForeignKey("live_sessions.id", ondelete="CASCADE"),
                             nullable=False, index=True)
    student_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"),
                        nullable=False, index=True)

    first_join_at = Column(DateTime, server_default=func.now())
    last_seen_at = Column(DateTime, server_default=func.now())
    watch_seconds = Column(Integer, default=0, server_default="0", nullable=False)
    # 回放观看时长单独记,别和直播混(学情统计要分得开)
    replay_seconds = Column(Integer, default=0, server_default="0", nullable=False)
    # 切屏/挂后台次数,沿用现有防划水口径
    blur_count = Column(Integer, default=0, server_default="0", nullable=False)

    __table_args__ = (
        Index("uq_live_attendance", "live_session_id", "student_id", unique=True),
    )


class MaterialViewLog(Base):
    """课件浏览留痕。水印能溯源到人,这张表回答「他什么时候看的哪页」。

    出泄露纠纷时:水印图上有学号 → 这里查得到调阅时间和 IP。
    """
    __tablename__ = "material_view_logs"

    id = Column(Integer, primary_key=True, autoincrement=True)
    material_id = Column(Integer, ForeignKey("live_materials.id", ondelete="CASCADE"),
                         nullable=False, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"),
                     nullable=False, index=True)
    page_no = Column(Integer, nullable=True)
    ip = Column(String(64), nullable=True)
    viewed_at = Column(DateTime, server_default=func.now())

    __table_args__ = (
        Index("idx_material_view_user_time", "user_id", "viewed_at"),
    )
