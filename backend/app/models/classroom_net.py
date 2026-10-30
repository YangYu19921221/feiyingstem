"""电教室网络 —— 音标视频「只能在电教室看」(2026-10-30)

用户原话: 「音标视频可以通过 ip 判断在机构中使用,家里不能使用」。

先查的生产实情(10 月): 学校出网 IP 几天一换(182.245.66.228 → .245 → .142 → .180 → .249),
同一天还会从 116.249.228.x 出去(多半是第二条线路)。所以**不能让老师填死一个 IP**,
也不能整段放行(那是运营商地址池,隔壁家庭宽带也分得到)。做法:

- 在电教室的电脑上点「这台电脑在电教室」→ 浏览器存一个设备码(只在这台电脑上),
  之后这台电脑发的请求都带着它,服务器记下它是从哪个 IP 来的;
- **电教室 IP = 本机构登记过的电脑最近 7 天报过的 IP** + 老师「今天先把这个网络算作电教室」的(当天 24 点失效)。
  保留 7 天而不是「换了就作废旧的」: 两条线路轮流出网时同一台电脑在两个 IP 间来回跳,作废旧的会让学生一半时间被拦;
- 只认完全相同的 IP,不放行整段。

四张表都是新表(create_all 建,不要 ALTER),**不进 tenancy 锚点**: ping 不带登录,
所有查询在 services/classroom_net.py 里显式写 org_id。
时间列一律在 Python 里写 utc_now()(不用 server_default=func.now(): CURRENT_TIMESTAMP 不带微秒,
和 SQLAlchemy 写的 .000000 混着比会在整点边界翻车,见 CLAUDE.md)。
"""
from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint

from app.core.database import Base


class ClassroomNetSetting(Base):
    """机构的音标视频观看地点开关。没有行 = any(不限,上线时所有机构都没有行 = 零变化)"""
    __tablename__ = "classroom_net_settings"

    org_id = Column(Integer, primary_key=True)
    # any = 在哪都能看 / classroom = 学生只能在电教室网络看
    phonetic_mode = Column(String(12), nullable=False, default="any")
    updated_by = Column(Integer, nullable=True)
    updated_at = Column(DateTime, nullable=True)


class ClassroomDevice(Base):
    """登记过的电教室电脑。设备码只存 sha256(库被拷走也拿不到能用的码)"""
    __tablename__ = "classroom_devices"

    id = Column(Integer, primary_key=True, autoincrement=True)
    org_id = Column(Integer, nullable=False, index=True)
    key_hash = Column(String(64), nullable=False, unique=True)
    name = Column(String(30), nullable=False)
    created_by = Column(Integer, nullable=True)       # 真实操作人(助教就是助教本人)
    created_by_name = Column(String(100), nullable=True)
    created_at = Column(DateTime, nullable=True)
    last_seen_at = Column(DateTime, nullable=True)
    last_ip = Column(String(64), nullable=True)
    # 移除 = 软删: 行留着(谁登记的、从哪些 IP 报过到,出纠纷要查),它报过的 IP 立刻不算
    revoked_at = Column(DateTime, nullable=True)
    revoked_by = Column(Integer, nullable=True)


class ClassroomDeviceIp(Base):
    """某台电教室电脑从哪些 IP 报过到。一台电脑一个 IP 一行"""
    __tablename__ = "classroom_device_ips"
    __table_args__ = (
        UniqueConstraint("device_id", "ip", name="uq_classroom_device_ip"),
        Index("ix_classroom_device_ips_seen", "device_id", "last_seen_at"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    device_id = Column(Integer, ForeignKey("classroom_devices.id"), nullable=False, index=True)
    ip = Column(String(64), nullable=False)
    first_seen_at = Column(DateTime, nullable=True)
    last_seen_at = Column(DateTime, nullable=True)


class ClassroomTempNet(Base):
    """「今天先把这个网络算作电教室」: IP 刚换、登记过的电脑又没开机时,老师在任何设备上点一下。
    只管当天(北京日),**不登记设备** —— 老师的手机带回家不会把家里也变成电教室"""
    __tablename__ = "classroom_temp_nets"
    __table_args__ = (UniqueConstraint("org_id", "ip", "day", name="uq_classroom_temp_net"),)

    id = Column(Integer, primary_key=True, autoincrement=True)
    org_id = Column(Integer, nullable=False, index=True)
    ip = Column(String(64), nullable=False)
    day = Column(String(10), nullable=False)          # 北京日 'YYYY-MM-DD'
    created_by = Column(Integer, nullable=True)
    created_by_name = Column(String(100), nullable=True)
    created_at = Column(DateTime, nullable=True)


class ClassroomHomeAllow(Base):
    """老师给某个孩子开「允许在家看」(请病假那一周等)。一个孩子一行"""
    __tablename__ = "classroom_home_allows"

    student_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    org_id = Column(Integer, nullable=False, index=True)
    until_day = Column(String(10), nullable=True)     # 北京日 'YYYY-MM-DD',含这一天;NULL = 一直允许
    note = Column(String(60), nullable=True)
    created_by = Column(Integer, nullable=True)
    created_by_name = Column(String(100), nullable=True)
    updated_at = Column(DateTime, nullable=True)
