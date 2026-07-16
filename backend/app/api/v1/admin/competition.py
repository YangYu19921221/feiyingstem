"""管理员 - 单词比赛(竞赛)只读视图

竞赛原本只有学生自助视角(competition.py 全是 get_current_user),
管理端没有任何汇总。这里提供只读的 概览 + 排行榜,复用 models/competition.py。

只读统计,不涉及赛季 CRUD。
"""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, func, desc, Integer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.user import User
from app.models.competition import UserScore, AnswerRecord, CompetitionSeason
from app.api.v1.auth import get_current_admin_or_org_admin

router = APIRouter()


@router.get("/competition/overview")
async def competition_overview(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_or_org_admin),
):
    """竞赛概览:参与人数 / 总答题数 / 平均正确率 / 活跃赛季数"""
    # 参与人数 + 总答题数 + 答对数,一次扫 answer_records。
    # join User(租户锚点): AnswerRecord 非锚点表,不 join 的话 org_admin 会看到全平台聚合
    row = (await db.execute(
        select(
            func.count(func.distinct(AnswerRecord.user_id)).label("participants"),
            func.count(AnswerRecord.id).label("total"),
            func.sum(AnswerRecord.is_correct.cast(Integer)).label("correct"),
        ).join(User, User.id == AnswerRecord.user_id)
    )).first()
    participants = (row.participants or 0) if row else 0
    total_answers = (row.total or 0) if row else 0
    correct_answers = (row.correct or 0) if row else 0
    avg_accuracy = (correct_answers / total_answers * 100) if total_answers > 0 else 0

    # 活跃赛季数
    active_seasons = (await db.execute(
        select(func.count(CompetitionSeason.id)).where(CompetitionSeason.is_active.is_(True))
    )).scalar() or 0

    return {
        "participants": participants,
        "total_answers": total_answers,
        "avg_accuracy": round(avg_accuracy, 1),
        "active_seasons": active_seasons,
    }


@router.get("/competition/leaderboard")
async def competition_leaderboard(
    board: str = Query("overall", description="榜单: overall/daily/weekly/monthly"),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_admin_or_org_admin),
):
    """全员竞赛排行榜。按所选榜单的分数倒序,聚合同一用户跨赛季的分数。"""
    score_col = {
        "overall": UserScore.total_score,
        "daily": UserScore.daily_score,
        "weekly": UserScore.weekly_score,
        "monthly": UserScore.monthly_score,
    }.get(board, UserScore.total_score)

    # 同一用户可能在多个赛季有 UserScore,这里按用户聚合求和
    stmt = (
        select(
            User.id,
            User.username,
            User.full_name,
            func.sum(score_col).label("score"),
            func.sum(UserScore.questions_answered).label("answered"),
            func.sum(UserScore.correct_count).label("correct"),
            func.max(UserScore.max_combo).label("max_combo"),
        )
        .join(User, User.id == UserScore.user_id)
        .group_by(User.id, User.username, User.full_name)
        .order_by(desc("score"))
        .limit(limit)
    )
    result = await db.execute(stmt)
    rows = result.all()

    leaderboard = []
    for rank, r in enumerate(rows, start=1):
        answered = r.answered or 0
        correct = r.correct or 0
        leaderboard.append({
            "rank": rank,
            "user_id": r.id,
            "username": r.username,
            "full_name": r.full_name or r.username,
            "score": r.score or 0,
            "questions_answered": answered,
            "correct_count": correct,
            "accuracy": round(correct / answered * 100, 1) if answered > 0 else 0,
            "max_combo": r.max_combo or 0,
        })
    return {"board": board, "items": leaderboard}
