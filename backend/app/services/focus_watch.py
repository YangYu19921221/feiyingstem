"""学习时离开了多久 + 摄像头看人在不在 + 家长端「今天」(2026-10-31)

起因: 用户「学生在用我们的系统,表面是在学习但是自己在发呆」「家长端也可以看到可以做到吗」。
网页只知道孩子离开了这个页面,不知道他去了哪个应用;想让他玩不了别的,要靠系统的
「引导式访问 / 屏幕固定」(家长端有教程)。系统能做的是把「离开了几次、每次多久」记下来给家长和老师看。

规则:
1. **切出页面**(switch): 离开满 SWITCH_MIN_MS(5 秒)才算(和切屏次数同一道门),记几点走的、离开多久,
   单次封顶 AWAY_MAX_MS(4 小时,页面开着人走了)。次数仍以 study_calendar.switch_count 为准
   (老页面只报次数不报时长),时长从 focus_away_events 加。
2. **摄像头**(no_face): 只在家长同意后(camera_consents.status=granted)才开;画面只在孩子自己的设备上
   每 2 秒判断一次「画面里有没有人脸」—— **不上传、不保存、不认人**,服务器只收到「几点离开、离开多久」。
   连续 NO_FACE_MS(10 秒)看不到人才算一次离开。没同意时上报 no_face 一律 403(前端也不会开)。
   依据《人脸识别技术应用安全管理办法》(2025-06-01 施行): 第五条告知(NOTICE 就是那份告知)、
   第六条单独同意和便捷撤回、第七条不满十四周岁要监护人同意、第八条人脸信息留在设备里不往外传、
   第九条事前影响评估(docs/摄像头看人在不在-个人信息保护影响评估.md,要公司自己定稿留存 3 年)。
3. **同意**: 家长在家长端自己点(method=parent,要勾「我已看过上面的说明」);家长签了纸质同意书的,
   本班老师登记(method=paper,进操作记录)。家长、本班老师都能随时撤回,撤回只改状态、同意那次的记录留着。
4. **留多久**: 离开记录留 RETENTION_DAYS(180 天),每次写入时顺手删这个孩子更早的;家长可以一键删掉摄像头那部分。
5. **家长「今天」**: 作业做完几份(today_report 同口径)、学了多久 / 多少词、切出去几次一共多久、
   摄像头里离开几次、60 秒没操作几次、听写卡住的词;孩子正在学的时候带实时状态(实时课堂同一份 presence)。
"""
from datetime import date, datetime, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.timeutil import local_day_utc_range, local_today, utc_now
from app.models.focus_watch import CameraConsent, CameraDayStatus, FocusAwayEvent

SWITCH_MIN_MS = 5_000
NO_FACE_MS = 10_000
AWAY_MAX_MS = 4 * 3600 * 1000
RETENTION_DAYS = 180
AWAY_KINDS = ("switch", "no_face")
CAMERA_STATUSES = ("on", "denied", "unavailable", "error")
CONSENT_METHODS = ("parent", "paper")
NOTICE_VERSION = "2026-10-31"
EPISODES_SHOWN = 8


def notice(org_name: str | None) -> dict:
    """摄像头告知(第五条要求的五项)。家长端同意前看的、老师打印的纸质同意书,都用这一份。"""
    who = f"飞鹰AI英语和{org_name}" if org_name else "飞鹰AI英语和孩子所在的校区"
    return {
        "version": NOTICE_VERSION,
        "title": "用摄像头看孩子在不在座位前",
        "sections": [
            {"h": "谁来做、找谁问", "p": f"{who}。有问题可以直接问孩子的老师。"},
            {"h": "用来做什么", "p": "孩子在家用系统学习时,看他是不是还坐在屏幕前;离开了就在页面上提醒他回来,"
                                     "并让您知道他今天离开了几次、每次多久。"},
            {"h": "怎么做", "p": "孩子打开学习页面时,用这台设备的前置摄像头,每 2 秒在孩子自己的设备上判断一次"
                                 "「画面里有没有人脸」。画面不上传、不保存,也不认是谁、不和任何照片比对;"
                                 "传到服务器的只有「几点离开、离开了多久」。学习页面上会一直显示「摄像头开着」和一个小画面。"},
            {"h": "保存多久", "p": f"画面不保存。离开记录保存 {RETENTION_DAYS} 天,到期自动删除;您也可以随时一键删掉。"},
            {"h": "对孩子的影响", "p": "不开摄像头,系统照样能用。摄像头只能看出人在不在,看不出孩子是不是在认真想题。"
                                       "设备没有摄像头、或孩子在浏览器里没允许,就不会开,您这里会看到原因。"},
            {"h": "您可以怎么做", "p": "随时可以在家长端关掉,关掉后马上停止;也可以请老师帮您关掉。"
                                       "孩子不满 14 周岁,需要您(父母或其他监护人)同意才会打开。"},
        ],
    }


async def consent_row(db: AsyncSession, student_id: int) -> CameraConsent | None:
    return (await db.execute(
        select(CameraConsent).where(CameraConsent.student_id == student_id)
    )).scalar_one_or_none()


async def consent_active(db: AsyncSession, student_id: int) -> bool:
    row = await consent_row(db, student_id)
    return bool(row and row.status == "granted")


def consent_out(row: CameraConsent | None) -> dict | None:
    if row is None:
        return None
    bj = lambda v: (v + timedelta(hours=8)).strftime("%Y-%m-%d %H:%M") if v else None  # noqa: E731
    return {
        "status": row.status,
        "method": row.method,
        "granted_by_name": row.granted_by_name,
        "granted_at": bj(row.granted_at),
        "revoked_by_name": row.revoked_by_name,
        "revoked_at": bj(row.revoked_at),
    }


async def set_consent(db: AsyncSession, student_id: int, *, enabled: bool, method: str,
                      actor_id: int, actor_name: str) -> CameraConsent | None:
    """打开 / 撤回。没同意过就撤回 = 什么都不做(返回 None)。调用方 commit。"""
    row = await consent_row(db, student_id)
    now = utc_now()
    if enabled:
        if row is None:
            row = CameraConsent(student_id=student_id)
            db.add(row)
        row.status = "granted"
        row.method = method
        row.notice_version = NOTICE_VERSION
        row.granted_by = actor_id
        row.granted_by_name = actor_name
        row.granted_at = now
        row.revoked_by = None
        row.revoked_by_name = None
        row.revoked_at = None
        return row
    if row is None or row.status != "granted":
        return row
    row.status = "revoked"
    row.revoked_by = actor_id
    row.revoked_by_name = actor_name
    row.revoked_at = now
    return row


async def record_away(db: AsyncSession, user_id: int, kind: str, away_ms: int, page: str | None) -> None:
    """记一次离开(调用方 commit)。顺手删这个孩子 RETENTION_DAYS 天前的记录。"""
    ms = max(0, min(int(away_ms or 0), AWAY_MAX_MS))
    now = utc_now()
    today = local_today()
    db.add(FocusAwayEvent(
        user_id=user_id, study_date=today, kind=kind,
        left_at=now - timedelta(milliseconds=ms), away_ms=ms,
        page=(page or "")[:80] or None, created_at=now,
    ))
    await db.execute(delete(FocusAwayEvent).where(
        FocusAwayEvent.user_id == user_id,
        FocusAwayEvent.study_date < today - timedelta(days=RETENTION_DAYS),
    ))


async def set_camera_status(db: AsyncSession, user_id: int, status: str) -> None:
    stmt = sqlite_insert(CameraDayStatus).values(
        user_id=user_id, study_date=local_today(), status=status, updated_at=utc_now())
    stmt = stmt.on_conflict_do_update(
        index_elements=["user_id", "study_date"],
        set_={"status": stmt.excluded.status, "updated_at": stmt.excluded.updated_at},
    )
    await db.execute(stmt)


def _bj_hm(v: datetime) -> str:
    return (v + timedelta(hours=8)).strftime("%H:%M")


def _minutes(ms: int) -> int:
    """毫秒 → 分钟,不满 1 分钟但有离开的记 1(家长看到「0 分钟」会以为没离开)。"""
    if ms <= 0:
        return 0
    return max(1, round(ms / 60000))


async def away_summary(db: AsyncSession, student_id: int, d: date) -> dict:
    """某天的离开: 每种几次、一共几分钟、最长一次,和最长的几次(几点、多久)。"""
    rows = (await db.execute(
        select(FocusAwayEvent.kind, FocusAwayEvent.left_at, FocusAwayEvent.away_ms, FocusAwayEvent.page)
        .where(FocusAwayEvent.user_id == student_id, FocusAwayEvent.study_date == d)
        .order_by(FocusAwayEvent.left_at)
    )).all()
    out = {}
    for kind in AWAY_KINDS:
        mine = [r for r in rows if r.kind == kind]
        total = sum(int(r.away_ms or 0) for r in mine)
        longest = sorted(mine, key=lambda r: -(r.away_ms or 0))[:EPISODES_SHOWN]
        out[kind] = {
            "count": len(mine),
            "minutes": _minutes(total),
            "seconds": round(total / 1000),   # 不满 1 分钟时前端写「N 秒」,别把 8 秒写成 1 分钟
            "longest_minutes": _minutes(int(longest[0].away_ms or 0)) if longest else 0,
            "longest_seconds": round((longest[0].away_ms or 0) / 1000) if longest else 0,
            "episodes": [
                {"at": _bj_hm(r.left_at), "minutes": _minutes(int(r.away_ms or 0)),
                 "seconds": round((r.away_ms or 0) / 1000)}
                for r in sorted(longest, key=lambda r: r.left_at)
            ],
        }
    return out


async def camera_status_on(db: AsyncSession, student_id: int, d: date) -> str | None:
    return (await db.execute(
        select(CameraDayStatus.status).where(
            CameraDayStatus.user_id == student_id, CameraDayStatus.study_date == d)
    )).scalar_one_or_none()


async def stuck_words_on(db: AsyncSession, student_id: int, d: date, limit: int = 10) -> list[dict]:
    from app.models.learning import WordStuckEvent
    from app.models.word import Word
    rows = (await db.execute(
        select(Word.word, WordStuckEvent.ms, WordStuckEvent.outcome)
        .join(Word, Word.id == WordStuckEvent.word_id)
        .where(WordStuckEvent.user_id == student_id, WordStuckEvent.study_date == d)
        .order_by(WordStuckEvent.ms.desc())
        .limit(limit)
    )).all()
    return [{"word": w, "seconds": round((ms or 0) / 1000), "outcome": oc} for w, ms, oc in rows]


async def live_status(student_id: int) -> dict | None:
    """孩子现在在不在学(实时课堂同一份 presence,多进程共享);没在学习页 = None。"""
    from app.services import presence_service
    snap = await presence_service.snapshot([student_id])
    if not snap:
        return None
    s = snap[0]
    if s["status"] == "offline":
        return None
    return {
        "status": s["status"],
        "unit_name": s.get("unit_name"),
        "away_seconds": s.get("away_seconds", 0),
        "no_face": bool(s.get("no_face")),
        "last_seen_ago": s.get("last_seen_ago"),
    }


async def parent_today(db: AsyncSession, student, d: date | None = None) -> dict:
    """家长端「今天」卡片。"""
    from app.models.user import StudyCalendar
    from app.services.today_report import build_today_report
    d = d or local_today()
    rep = await build_today_report(db, student, d)
    cal = (await db.execute(
        select(StudyCalendar.switch_count, StudyCalendar.distracted_count)
        .where(StudyCalendar.user_id == student.id, StudyCalendar.study_date == d)
    )).first()
    away = await away_summary(db, student.id, d)
    switch_count = max(int(cal.switch_count or 0) if cal else 0, away["switch"]["count"])
    consent = await consent_row(db, student.id)
    return {
        "date": d.isoformat(),
        "tasks_total": rep["today_total"],
        "tasks_done": rep["today_done"],
        "all_done": rep["all_done"],
        "tasks": [
            {"title": t["title"], "status": t["status"], "completed_time": t.get("completed_time"),
             "is_today": t.get("is_today", True)}
            for t in rep["tasks"]
        ],
        "study_minutes": rep["study_seconds"] // 60,
        "words_learned": rep["words_learned"],
        "switch": {**away["switch"], "count": switch_count},
        "no_face": away["no_face"],
        "distracted_count": int(cal.distracted_count or 0) if cal else 0,
        "stuck_words": await stuck_words_on(db, student.id, d),
        "camera": {
            "consent": consent_out(consent),
            "active": bool(consent and consent.status == "granted"),
            "status_today": await camera_status_on(db, student.id, d),
        },
        "live": await live_status(student.id),
    }
