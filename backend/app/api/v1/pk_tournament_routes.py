"""PK 晋级赛 REST 端点

教师端: POST /tournaments 建赛(自动分组+生成小组赛)
        GET  /tournaments 我的赛事列表
        GET  /tournaments/{id} 赛事全景(分组/积分/对阵树)
        DELETE /tournaments/{id} 删除(级联)
学生端: GET  /tournaments/my-matches 我的待打对局
        POST /tournament-matches/{id}/enter 进入对局(动态开内存房,返回 room_id)
对局结束由 pk_websocket 的 game_finished 钩子自动回写并推进赛程。
"""
from __future__ import annotations
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select, delete as sa_delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.api.v1.auth import get_current_user, get_current_teacher
from app.models.user import User, Class, ClassStudent
from app.models.pk_tournament import PkTournament, PkTournamentPlayer, PkTournamentMatch
from app.services.pk import manager
from app.services.pk import tournament as tsvc
from app.api.v1.pk_routes import load_word_points, load_learned_word_ids

logger = logging.getLogger(__name__)
router = APIRouter()

# 每场对局一把进程内锁:enter_match 的"查房→开房"必须原子,
# 否则两个玩家同时点进入会各开一间房、永远对不上(单 uvicorn worker,锁 asyncio 竞态足够)
import asyncio as _asyncio
_MATCH_LOCKS: dict[int, _asyncio.Lock] = {}


def _match_lock(match_id: int) -> _asyncio.Lock:
    lk = _MATCH_LOCKS.get(match_id)
    if lk is None:
        lk = _asyncio.Lock()
        _MATCH_LOCKS[match_id] = lk
    return lk


class CreateTournamentRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    class_ids: list[int] = Field(min_length=1)
    unit_ids: list[int] = Field(min_length=1)
    group_size: int = Field(default=4, ge=3, le=20)
    word_count: int = Field(default=8, ge=5, le=20)
    has_consolation: bool = True


@router.post("/tournaments")
async def create_tournament(
    body: CreateTournamentRequest,
    user: User = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    # 班级归属校验 + 收参赛学生(去重)
    cls_rows = (await db.execute(
        select(Class).where(Class.id.in_(body.class_ids))
    )).scalars().all()
    if len(cls_rows) != len(set(body.class_ids)):
        raise HTTPException(status_code=404, detail="有班级不存在")
    if user.role != "admin":
        for c in cls_rows:
            if c.teacher_id != user.id:
                raise HTTPException(status_code=403, detail=f"班级「{c.name}」不是你的")

    stu_rows = (await db.execute(
        select(ClassStudent.student_id).where(
            ClassStudent.class_id.in_(body.class_ids),
            ClassStudent.is_active.is_(True),
        )
    )).all()
    student_ids = list({r.student_id for r in stu_rows})
    if len(student_ids) < 4:
        raise HTTPException(status_code=400, detail=f"参赛学生至少 4 人(当前 {len(student_ids)} 人)")

    # 词库校验:所选单元的词要够一场对局
    word_ids = await _unit_word_ids(db, body.unit_ids)
    if len(word_ids) < body.word_count:
        raise HTTPException(
            status_code=400,
            detail=f"所选单元只有 {len(word_ids)} 个词,不够一场 {body.word_count} 词的对局",
        )

    t = await tsvc.create_tournament(
        db, name=body.name, teacher_id=user.id,
        student_ids=student_ids, unit_ids=body.unit_ids, class_ids=body.class_ids,
        group_size=body.group_size, word_count=body.word_count,
        has_consolation=body.has_consolation,
    )
    return {"id": t.id, "name": t.name, "player_count": len(student_ids)}


async def _unit_word_ids(db: AsyncSession, unit_ids: list[int]) -> list[int]:
    from sqlalchemy import text
    marks = ",".join(f":u{i}" for i in range(len(unit_ids)))
    params = {f"u{i}": v for i, v in enumerate(unit_ids)}
    res = await db.execute(
        text(f"SELECT DISTINCT word_id FROM unit_words WHERE unit_id IN ({marks})"), params
    )
    return [r[0] for r in res.fetchall()]


@router.get("/tournaments")
async def list_tournaments(
    user: User = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    q = select(PkTournament).order_by(PkTournament.created_at.desc()).limit(50)
    if user.role != "admin":
        q = q.where(PkTournament.teacher_id == user.id)
    ts = (await db.execute(q)).scalars().all()
    return [
        {
            "id": t.id, "name": t.name, "status": t.status,
            "created_at": t.created_at.isoformat() if t.created_at else None,
            "champion_id": t.champion_id,
        }
        for t in ts
    ]


async def _name_map(db: AsyncSession, user_ids: list[int]) -> dict[int, str]:
    if not user_ids:
        return {}
    rows = (await db.execute(
        select(User.id, User.username, User.full_name).where(User.id.in_(user_ids))
    )).all()
    return {r.id: (r.full_name or r.username or f"学生{r.id}") for r in rows}


def _match_dict(m: PkTournamentMatch, names: dict[int, str]) -> dict:
    return {
        "id": m.id, "stage": m.stage, "round_no": m.round_no,
        "bracket_pos": m.bracket_pos, "group_no": m.group_no,
        "p1_id": m.p1_id, "p1_name": names.get(m.p1_id, "?"),
        "p2_id": m.p2_id, "p2_name": names.get(m.p2_id, "轮空") if m.p2_id else "轮空",
        "winner_id": m.winner_id, "status": m.status,
        "p1_correct": m.p1_correct, "p1_score": m.p1_score,
        "p2_correct": m.p2_correct, "p2_score": m.p2_score,
        "invite_code": m.invite_code,
    }


# ---------- 学生端 ----------
# 注意:必须定义在 /tournaments/{tid} 之前,否则 "my-matches" 会被当作 tid 解析 422

@router.get("/tournaments/my-matches")
async def my_pending_matches(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """我的待打对局(进行中赛事)。"""
    rows = (await db.execute(
        select(PkTournamentMatch, PkTournament)
        .join(PkTournament, PkTournament.id == PkTournamentMatch.tournament_id)
        .where(
            PkTournament.status == "running",
            PkTournamentMatch.status == "pending",
            (PkTournamentMatch.p1_id == user.id) | (PkTournamentMatch.p2_id == user.id),
        )
        .order_by(PkTournamentMatch.id)
    )).all()
    opp_ids = [
        (m.p2_id if m.p1_id == user.id else m.p1_id)
        for m, _t in rows if (m.p2_id if m.p1_id == user.id else m.p1_id)
    ]
    names = await _name_map(db, opp_ids)
    out = []
    for m, t in rows:
        opp = m.p2_id if m.p1_id == user.id else m.p1_id
        out.append({
            "match_id": m.id, "tournament_id": t.id, "tournament_name": t.name,
            "stage": m.stage, "round_no": m.round_no, "group_no": m.group_no,
            "opponent_id": opp, "opponent_name": names.get(opp, "?") if opp else "轮空",
            "invite_code": m.invite_code,
        })
    return out


@router.get("/tournaments/{tid}")
async def tournament_detail(
    tid: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """赛事全景:老师和参赛学生都能看(学生看对阵表也是激励)。"""
    t = (await db.execute(select(PkTournament).where(PkTournament.id == tid))).scalar_one_or_none()
    if t is None:
        raise HTTPException(status_code=404, detail="赛事不存在")
    if t.status == "running":
        # 自愈:若赛程曾因回写异常/并发丢事件卡在"本轮全完却没下一轮",
        # 刷新详情页即补跑推进(教师端每 15s 自动轮询详情,卡死可自动恢复)
        await tsvc.ensure_advanced(db, tid)
    players = (await db.execute(
        select(PkTournamentPlayer).where(PkTournamentPlayer.tournament_id == tid)
    )).scalars().all()
    matches = (await db.execute(
        select(PkTournamentMatch).where(PkTournamentMatch.tournament_id == tid)
        .order_by(PkTournamentMatch.stage, PkTournamentMatch.round_no, PkTournamentMatch.bracket_pos)
    )).scalars().all()
    names = await _name_map(db, [p.user_id for p in players])

    groups: dict[int, list] = {}
    for p in sorted(players, key=lambda p: (p.group_no, -p.points, -p.wins, -p.correct_total, p.time_total_ms)):
        groups.setdefault(p.group_no, []).append({
            "user_id": p.user_id, "name": names.get(p.user_id, "?"),
            "points": p.points, "wins": p.wins, "losses": p.losses,
            "correct_total": p.correct_total, "qualified": p.qualified,
        })

    return {
        "id": t.id, "name": t.name, "status": t.status,
        "group_size": t.group_size, "word_count": t.word_count,
        "has_consolation": t.has_consolation,
        "champion_id": t.champion_id,
        "champion_name": names.get(t.champion_id) if t.champion_id else None,
        "consolation_champion_id": t.consolation_champion_id,
        "consolation_champion_name": names.get(t.consolation_champion_id) if t.consolation_champion_id else None,
        "groups": [{"group_no": g, "players": ps} for g, ps in sorted(groups.items())],
        "matches": [_match_dict(m, names) for m in matches],
    }


@router.delete("/tournaments/{tid}")
async def delete_tournament(
    tid: int,
    user: User = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    t = (await db.execute(select(PkTournament).where(PkTournament.id == tid))).scalar_one_or_none()
    if t is None:
        raise HTTPException(status_code=404, detail="赛事不存在")
    if user.role != "admin" and t.teacher_id != user.id:
        raise HTTPException(status_code=403, detail="不是你的赛事")
    # 生产 SQLite 未开外键,CASCADE 不生效 → 手动级联
    await db.execute(sa_delete(PkTournamentMatch).where(PkTournamentMatch.tournament_id == tid))
    await db.execute(sa_delete(PkTournamentPlayer).where(PkTournamentPlayer.tournament_id == tid))
    await db.execute(sa_delete(PkTournament).where(PkTournament.id == tid))
    await db.commit()
    return {"success": True}


class JudgeMatchRequest(BaseModel):
    winner_id: int  # 判某一方晋级(缺席/弃权/设备问题时,老师手动判胜)


@router.post("/tournament-matches/{match_id}/judge")
async def judge_match(
    match_id: int,
    body: JudgeMatchRequest,
    user: User = Depends(get_current_teacher),
    db: AsyncSession = Depends(get_db),
):
    """老师手动判定一场对局的胜者(弃权/缺席/掉线打不成时用)。

    没有这个出口的话,某个学生请假不来打,他那场就永远 pending,
    整个赛程卡在小组阶段或某轮淘汰赛,冠军永远出不来。走 record_match_result
    同一套逻辑,判完自动推进赛程。
    """
    # 与 enter_match 抢同一把锁:判胜和学生"点开打"并发时序列化,
    # 否则可能判完后学生又开出一间没人管的孤儿房(还占着他的 USER_ACTIVE)
    async with _match_lock(match_id):
        m = (await db.execute(
            select(PkTournamentMatch).where(PkTournamentMatch.id == match_id)
        )).scalar_one_or_none()
        if m is None:
            raise HTTPException(status_code=404, detail="对局不存在")
        t = (await db.execute(select(PkTournament).where(PkTournament.id == m.tournament_id))).scalar_one()
        if user.role != "admin" and t.teacher_id != user.id:
            raise HTTPException(status_code=403, detail="不是你的赛事")
        if m.status != "pending":
            raise HTTPException(status_code=409, detail="这场对局已结束")
        if body.winner_id not in (m.p1_id, m.p2_id):
            raise HTTPException(status_code=400, detail="胜者必须是本场两名选手之一")

        # 判胜方按 0 分/0 用时记(纯轮空性质,不虚增数据);若房间还开着先回收:
        # 必须通知玩家 + 停掉题目计时器,否则房里的学生会不知情地打完一局"幽灵赛",
        # game_finished 还会再落一条无效的对局历史
        if m.invite_code and m.invite_code in manager.INVITE_INDEX:
            room = manager.ROOMS.get(manager.INVITE_INDEX[m.invite_code])
            # 校验归属:invite_code 会被后来的无关房间随机复用,别误杀别人的房
            if room is not None and room.tournament_match_id == m.id:
                from app.api.v1.pk_websocket import _broadcast, _cancel_room_timers
                room.status = "abandoned"  # 若此刻恰好打完落库,历史记为 abandoned 而非正常完赛
                # (真正防"打完的结果覆盖判定"的,是 record_match_result 锁内的 pending 复查)
                _cancel_room_timers(room.room_id)
                try:
                    await _broadcast(room, {"type": "room_closed", "message": "老师已判定本场结果"})
                except Exception:
                    logger.exception("判胜后通知房间失败: room=%d", room.room_id)
                for uid in list(room.players.keys()):
                    manager.USER_ACTIVE.pop(uid, None)
                manager.INVITE_INDEX.pop(room.invite_code, None)
                manager.ROOMS.pop(room.room_id, None)

        await tsvc.record_match_result(
            db, match_id, winner_id=body.winner_id,
            stats={m.p1_id: {"correct": 0, "score": 0, "time_ms": 0},
                   **({m.p2_id: {"correct": 0, "score": 0, "time_ms": 0}} if m.p2_id else {})},
        )
    return {"success": True, "winner_id": body.winner_id}


# ---------- 学生端:进入对局 ----------

@router.post("/tournament-matches/{match_id}/enter")
async def enter_match(
    match_id: int,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """进入一场晋级赛对局:第一个进的人触发开房(词表按赛事单元预置),
    第二个人直接加入同一间房。返回 room_id 供前端跳转 /pk/arena/{room_id}。"""
    import random
    m = (await db.execute(
        select(PkTournamentMatch).where(PkTournamentMatch.id == match_id)
    )).scalar_one_or_none()
    if m is None:
        raise HTTPException(status_code=404, detail="对局不存在")
    if user.id not in (m.p1_id, m.p2_id):
        raise HTTPException(status_code=403, detail="这不是你的对局")
    if m.status != "pending":
        raise HTTPException(status_code=409, detail="MATCH_ALREADY_FINISHED")

    t = (await db.execute(select(PkTournament).where(PkTournament.id == m.tournament_id))).scalar_one()

    # 整个"查房→开房/加入"临界区上锁:两玩家同时进入时序列化,后进的一定能看到先进者开的房
    async with _match_lock(match_id):
        # 锁内重新读最新状态(先进者可能刚写好 invite_code / 老师可能刚判胜)。
        # populate_existing 必须加:本会话锁外已加载过这行,identity map 会原样
        # 返回旧对象,不加则这次"重读"根本看不到别的会话刚提交的数据
        m = (await db.execute(
            select(PkTournamentMatch).where(PkTournamentMatch.id == match_id)
            .execution_options(populate_existing=True)
        )).scalar_one()
        if m.status != "pending":
            raise HTTPException(status_code=409, detail="MATCH_ALREADY_FINISHED")

        # 房间还活着 → 直接进(对手已开好)。必须校验归属:invite_code 会被
        # 后来的无关房间随机复用,不校验会把选手塞进陌生人的普通 PK 房
        live_room = None
        if m.invite_code and m.invite_code in manager.INVITE_INDEX:
            cand = manager.ROOMS.get(manager.INVITE_INDEX[m.invite_code])
            if cand is not None and cand.tournament_match_id == m.id:
                live_room = cand
        if live_room is not None:
            room = live_room
            if user.id not in room.players:
                nickname = user.full_name or user.username or f"User{user.id}"
                try:
                    room = manager.join_room(invite_code=m.invite_code, user_id=user.id, nickname=nickname)
                except manager.UserAlreadyInRoom:
                    raise HTTPException(status_code=409, detail="USER_ALREADY_IN_ROOM")
                except (manager.RoomFull, manager.RoomAlreadyStarted):
                    raise HTTPException(status_code=409, detail="ROOM_ALREADY_STARTED")
            return {"room_id": room.room_id, "invite_code": room.invite_code}

        # 开新房:词表从赛事单元里选,优先「对阵双方都背过」的词(考已学的更公平),
        # 学过的不够一场时,用单元里其余词补齐(晋级赛以赛促学,不因某人没学就缩水题量)
        word_ids = await _unit_word_ids(db, json.loads(t.unit_ids))
        if len(word_ids) < t.word_count:
            raise HTTPException(status_code=400, detail="赛事单元词量不足(单元可能被改动)")

        both = [m.p1_id, m.p2_id] if m.p2_id else [m.p1_id]
        learned = await load_learned_word_ids(db, both, word_ids)
        common = set.intersection(*(learned.get(uid, set()) for uid in both)) if both else set()
        common_list = [w for w in word_ids if w in common]  # 保持单元内顺序稳定
        rest = [w for w in word_ids if w not in common]
        random.shuffle(common_list)
        random.shuffle(rest)
        # 先填学过的,不够再拿其余词补
        chosen = (common_list + rest)[:t.word_count]
        random.shuffle(chosen)

        nickname = user.full_name or user.username or f"User{user.id}"
        try:
            room = manager.create_room(
                host_id=user.id, max_players=2,
                word_ids=chosen, nickname=nickname, word_count=t.word_count,
            )
        except manager.UserAlreadyInRoom:
            raise HTTPException(status_code=409, detail="USER_ALREADY_IN_ROOM")
        room.tournament_match_id = m.id
        room.fixed_words = True
        room.word_points = await load_word_points(db, chosen)

        m.invite_code = room.invite_code
        await db.commit()
        logger.info("Tournament match room opened: match=%d room=%d code=%s", m.id, room.room_id, room.invite_code)
        return {"room_id": room.room_id, "invite_code": room.invite_code}
