"""晋级赛编排服务:分组 → 小组循环 → 自动出线 → 淘汰赛 → 冠军,全自动流转。

核心设计:
- 蛇形分组:按已学词数排名 1-8-9-16 分组,组间实力均衡
- 小组赛:组内单循环,胜3分;打完自动按 积分>胜场>总正确>用时 排名,前2出线
- 淘汰赛:出线者按「A组第1 vs B组第2」交叉配对,单败;人数不是2^n 时高种子轮空
- 安慰赛:小组未出线者进平行淘汰赛,冠军=黑马奖(所有人全程有比赛打)
- 对局结果由 pk_websocket 的 game_finished 钩子回调 record_match_result,
  一场打完立即检查:本轮全结束→自动生成下一轮;决赛结束→产生冠军收官
"""
from __future__ import annotations
import asyncio
import json
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy import select, text, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.pk_tournament import PkTournament, PkTournamentPlayer, PkTournamentMatch

logger = logging.getLogger(__name__)

# 赛事级进程内锁:record_match_result 的"写结果→查 pending→推进→提交"必须整体原子。
# 两场对局几乎同时打完时,两个 DB 会话各自标记 finished 但都未提交,互相看不见对方,
# 双双以为"还有别场没打完"跳过推进 → 赛程永久卡死(再无对局结束事件能触发它);
# 反向时序则双双推进 → 下一轮生成两份。单 uvicorn worker 下 asyncio.Lock 足以串行化。
_TOURNAMENT_LOCKS: dict[int, asyncio.Lock] = {}


def _tournament_lock(tournament_id: int) -> asyncio.Lock:
    lk = _TOURNAMENT_LOCKS.get(tournament_id)
    if lk is None:
        lk = asyncio.Lock()
        _TOURNAMENT_LOCKS[tournament_id] = lk
    return lk


# ---------- 分组 ----------

def snake_groups(user_ids_ranked: list[int], group_size: int) -> dict[int, list[int]]:
    """蛇形分组:[1,2,3,4,5,6,7,8] size=4 → 组1:[1,4,5,8] 组2:[2,3,6,7]"""
    n_groups = max(1, (len(user_ids_ranked) + group_size - 1) // group_size)
    groups: dict[int, list[int]] = {g: [] for g in range(1, n_groups + 1)}
    direction, g = 1, 1
    for uid in user_ids_ranked:
        groups[g].append(uid)
        g += direction
        if g > n_groups:
            g, direction = n_groups, -1
        elif g < 1:
            g, direction = 1, 1
    return groups


def round_robin_pairs(members: list[int]) -> list[tuple[int, Optional[int]]]:
    """组内单循环全部对阵(不分轮,顺序即打;奇数组不需要轮空——都是独立对局)"""
    pairs = []
    for i in range(len(members)):
        for j in range(i + 1, len(members)):
            pairs.append((members[i], members[j]))
    return pairs


async def seed_metric_for(db: AsyncSession, user_ids: list[int]) -> dict[int, int]:
    """分组实力依据:已学词数(word_mastery 里 encounters>0 的词数)"""
    if not user_ids:
        return {}
    marks = ",".join(f":u{i}" for i in range(len(user_ids)))
    params = {f"u{i}": v for i, v in enumerate(user_ids)}
    res = await db.execute(
        text(f"SELECT user_id, COUNT(*) FROM word_mastery "
             f"WHERE user_id IN ({marks}) AND total_encounters > 0 GROUP BY user_id"),
        params,
    )
    metric = {uid: 0 for uid in user_ids}
    for uid, cnt in res.fetchall():
        metric[uid] = cnt
    return metric


async def create_tournament(
    db: AsyncSession, *, name: str, teacher_id: int,
    student_ids: list[int], unit_ids: list[int], class_ids: list[int],
    group_size: int = 4, word_count: int = 8, has_consolation: bool = True,
) -> PkTournament:
    """建赛:落库赛事+选手(蛇形分组)+全部小组赛对局。"""
    metric = await seed_metric_for(db, student_ids)
    ranked = sorted(student_ids, key=lambda u: -metric.get(u, 0))
    groups = snake_groups(ranked, group_size)

    t = PkTournament(
        name=name, teacher_id=teacher_id, status="running",
        group_size=group_size, word_count=word_count,
        unit_ids=json.dumps(unit_ids), class_ids=json.dumps(class_ids),
        has_consolation=has_consolation,
    )
    db.add(t)
    await db.flush()

    for gno, members in groups.items():
        for uid in members:
            db.add(PkTournamentPlayer(
                tournament_id=t.id, user_id=uid,
                seed_metric=metric.get(uid, 0), group_no=gno,
            ))
        # 单人组(极端情况):直接出线,无对局
        if len(members) == 1:
            continue
        for pos, (a, b) in enumerate(round_robin_pairs(members)):
            db.add(PkTournamentMatch(
                tournament_id=t.id, stage="group", round_no=1,
                bracket_pos=pos, group_no=gno, p1_id=a, p2_id=b,
            ))
    await db.commit()
    logger.info("Tournament created: id=%d groups=%d players=%d", t.id, len(groups), len(student_ids))
    return t


# ---------- 结果回写 + 自动推进 ----------

async def record_match_result(
    db: AsyncSession, match_id: int, *,
    winner_id: int,
    stats: dict[int, dict],  # user_id -> {correct, score, time_ms}
    room_db_id: Optional[int] = None,
) -> None:
    """一场对局打完:写结果 → 若整轮/整阶段完成则自动生成下一步。幂等(已 finished 直接跳过)。"""
    tid = (await db.execute(
        select(PkTournamentMatch.tournament_id).where(PkTournamentMatch.id == match_id)
    )).scalar_one_or_none()
    if tid is None:
        return
    async with _tournament_lock(tid):
        await _record_match_result_locked(
            db, match_id, winner_id=winner_id, stats=stats, room_db_id=room_db_id,
        )


async def _record_match_result_locked(
    db: AsyncSession, match_id: int, *,
    winner_id: int, stats: dict[int, dict], room_db_id: Optional[int],
) -> None:
    # populate_existing:调用方会话可能在锁外就加载过这行(expire_on_commit=False,
    # identity map 会返回旧对象),必须强制刷新才能看到别的会话刚提交的 finished
    m = (await db.execute(
        select(PkTournamentMatch).where(PkTournamentMatch.id == match_id)
        .execution_options(populate_existing=True)
    )).scalar_one_or_none()
    if m is None or m.status != "pending":
        return
    m.status = "finished"
    m.winner_id = winner_id
    m.room_db_id = room_db_id
    m.finished_at = datetime.utcnow()
    s1 = stats.get(m.p1_id, {})
    s2 = stats.get(m.p2_id, {}) if m.p2_id else {}
    m.p1_correct, m.p1_score, m.p1_time_ms = s1.get("correct"), s1.get("score"), s1.get("time_ms")
    m.p2_correct, m.p2_score, m.p2_time_ms = s2.get("correct"), s2.get("score"), s2.get("time_ms")

    # 小组积分/双方战绩累计
    if m.stage == "group":
        for uid, st_ in ((m.p1_id, s1), (m.p2_id, s2)):
            if uid is None:
                continue
            p = (await db.execute(
                select(PkTournamentPlayer).where(
                    PkTournamentPlayer.tournament_id == m.tournament_id,
                    PkTournamentPlayer.user_id == uid,
                )
            )).scalar_one_or_none()
            if p is None:
                continue
            won = uid == winner_id
            p.points += 3 if won else 0
            p.wins += 1 if won else 0
            p.losses += 0 if won else 1
            p.correct_total += st_.get("correct") or 0
            p.time_total_ms += st_.get("time_ms") or 0

    await db.flush()
    await _advance(db, m.tournament_id)
    await db.commit()


async def ensure_advanced(db: AsyncSession, tournament_id: int) -> None:
    """自愈:对 running 中的赛事补跑一次推进检查。

    正常流转全靠"对局结束"事件触发推进;该事件若曾丢失(历史并发 bug、
    回写异常被吞),赛程会停在"本轮全打完却没有下一轮"的死局——之后再无
    任何事件能触发推进。挂在读赛事详情处,老师/学生刷新页面即可自动修复。
    没卡时等价于几个只读查询,幂等、开销极小。
    """
    async with _tournament_lock(tournament_id):
        t = (await db.execute(
            select(PkTournament).where(PkTournament.id == tournament_id)
            .execution_options(populate_existing=True)
        )).scalar_one_or_none()
        if t is None or t.status != "running":
            return
        await _advance(db, tournament_id)
        await db.commit()


async def _advance(db: AsyncSession, tournament_id: int) -> None:
    """检查赛程:小组赛全完→生成淘汰赛(+安慰赛);某轮淘汰赛全完→生成下一轮;决赛完→收官。

    调用方必须已持有 _tournament_lock(见 record_match_result / ensure_advanced)。
    """
    t = (await db.execute(
        select(PkTournament).where(PkTournament.id == tournament_id)
        .execution_options(populate_existing=True)  # 会话可能在锁外加载过旧状态
    )).scalar_one()
    if t.status == "finished":
        return

    pending_group = (await db.execute(
        select(func.count(PkTournamentMatch.id)).where(
            PkTournamentMatch.tournament_id == tournament_id,
            PkTournamentMatch.stage == "group",
            PkTournamentMatch.status == "pending",
        )
    )).scalar()
    ko_exists = (await db.execute(
        select(func.count(PkTournamentMatch.id)).where(
            PkTournamentMatch.tournament_id == tournament_id,
            PkTournamentMatch.stage == "ko",
        )
    )).scalar()

    # ── 阶段1→2:小组赛刚全部打完,生成淘汰赛+安慰赛 ──
    if pending_group == 0 and not ko_exists:
        players = (await db.execute(
            select(PkTournamentPlayer).where(PkTournamentPlayer.tournament_id == tournament_id)
        )).scalars().all()
        by_group: dict[int, list[PkTournamentPlayer]] = {}
        for p in players:
            by_group.setdefault(p.group_no, []).append(p)

        qualified: list[tuple[int, int, PkTournamentPlayer]] = []  # (group_no, place, player)
        eliminated: list[PkTournamentPlayer] = []
        for gno, members in sorted(by_group.items()):
            # 组内排名:积分 > 胜场 > 总正确 > 用时少
            ranked = sorted(members, key=lambda p: (-p.points, -p.wins, -p.correct_total, p.time_total_ms))
            take = min(2, len(ranked))
            for place, p in enumerate(ranked[:take], start=1):
                p.qualified = True
                qualified.append((gno, place, p))
            eliminated.extend(ranked[take:])

        # 交叉配对:第1名序列 与 逆序的第2名序列 配对(A1-B2, B1-A2 …)
        firsts = [p for (_, place, p) in qualified if place == 1]
        seconds = [p for (_, place, p) in qualified if place == 2]
        seconds.reverse()
        seeds: list[PkTournamentPlayer] = []
        for i in range(max(len(firsts), len(seconds))):
            if i < len(firsts):
                seeds.append(firsts[i])
            if i < len(seconds):
                seeds.append(seconds[i])
        _make_ko_round(db, tournament_id, "ko", 1, [p.user_id for p in seeds])

        if t.has_consolation and len(eliminated) >= 2:
            # 安慰赛种子:小组战绩弱者优先轮空?不——黑马组按同规则排,强者先配
            elim_ranked = sorted(eliminated, key=lambda p: (-p.points, -p.wins, -p.correct_total, p.time_total_ms))
            _make_ko_round(db, tournament_id, "consolation", 1, [p.user_id for p in elim_ranked])
        await db.flush()
        # 生成后立刻再检查一次:轮空对局可能让整轮直接完成
        await _advance_stage_rounds(db, t)
        return

    if ko_exists:
        await _advance_stage_rounds(db, t)


def _make_ko_round(db, tournament_id: int, stage: str, round_no: int, seeds: list[int]) -> None:
    """按种子序生成一轮单败对阵。奇数人时最高种子轮空(bye 直接晋级)。"""
    i, pos = 0, 0
    ids = list(seeds)
    # 轮空给最前面的种子:人数为奇数时第一个直接进下一轮
    if len(ids) % 2 == 1:
        db.add(PkTournamentMatch(
            tournament_id=tournament_id, stage=stage, round_no=round_no,
            bracket_pos=pos, p1_id=ids[0], p2_id=None,
            winner_id=ids[0], status="bye", finished_at=datetime.utcnow(),
        ))
        ids = ids[1:]
        pos += 1
    while i + 1 < len(ids):
        db.add(PkTournamentMatch(
            tournament_id=tournament_id, stage=stage, round_no=round_no,
            bracket_pos=pos, p1_id=ids[i], p2_id=ids[i + 1],
        ))
        i += 2
        pos += 1


async def _advance_stage_rounds(db: AsyncSession, t: PkTournament) -> None:
    """ko / consolation 两条线各自独立推进:本轮全完(finished/bye)→ 胜者进下一轮;只剩1人→ 该线收官。"""
    all_done = True
    for stage in ("ko", "consolation"):
        matches = (await db.execute(
            select(PkTournamentMatch).where(
                PkTournamentMatch.tournament_id == t.id,
                PkTournamentMatch.stage == stage,
            ).order_by(PkTournamentMatch.round_no, PkTournamentMatch.bracket_pos)
        )).scalars().all()
        if not matches:
            if stage == "ko":
                all_done = False  # ko 还没生成,不能收官
            continue
        last_round = max(m.round_no for m in matches)
        cur = [m for m in matches if m.round_no == last_round]
        if any(m.status == "pending" for m in cur):
            all_done = False
            continue
        # 用 p1_id 兜底 winner 为空的已结束对局:正常不会发生(记结果时必判胜者),
        # 但若真出现(极端掉线时序),丢掉这条会让下一轮少一人、对阵错位。
        # 宁可用 p1 补位保持对阵树完整,也不静默丢人。
        winners = []
        for m in cur:
            if m.status == "bye":
                winners.append(m.winner_id)
            elif m.winner_id:
                winners.append(m.winner_id)
            elif m.p1_id:
                logger.warning("对局 %d 已结束但无 winner_id,用 p1 兜底避免对阵树错位", m.id)
                winners.append(m.p1_id)
        winners = [w for w in winners if w]
        if len(winners) >= 2:
            _make_ko_round(db, t.id, stage, last_round + 1, winners)
            await db.flush()
            # 新轮次可能又含轮空 → 递归推进(轮空数≤log2 轮次,递归极浅)
            await _advance_stage_rounds(db, t)
            return
        # 只剩1人 = 该线冠军
        if winners:
            if stage == "ko" and t.champion_id is None:
                t.champion_id = winners[0]
            elif stage == "consolation" and t.consolation_champion_id is None:
                t.consolation_champion_id = winners[0]

    # ko 冠军已出、(有安慰赛的话)黑马也出 → 整个赛事收官
    if all_done and t.champion_id is not None:
        cons_pending = False
        if t.has_consolation:
            cnt = (await db.execute(
                select(func.count(PkTournamentMatch.id)).where(
                    PkTournamentMatch.tournament_id == t.id,
                    PkTournamentMatch.stage == "consolation",
                    PkTournamentMatch.status == "pending",
                )
            )).scalar()
            cons_pending = cnt > 0
        if not cons_pending:
            t.status = "finished"
            t.finished_at = datetime.utcnow()
            logger.info("Tournament finished: id=%d champion=%s", t.id, t.champion_id)
