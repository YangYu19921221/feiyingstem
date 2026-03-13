"""
竞赛系统API路由
"""
from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from typing import Optional
from pydantic import BaseModel

from app.core.database import get_db
from app.api.v1.auth import get_current_user
from app.models.user import User
from app.services.competition_service import competition_service
from app.services.websocket_manager import websocket_manager


router = APIRouter()


# ========================================
# Pydantic Models
# ========================================

class SubmitAnswerRequest(BaseModel):
    """提交答题请求"""
    question_id: int
    user_answer: str
    time_spent_ms: int
    season_id: int = 1


class LeaderboardQuery(BaseModel):
    """排行榜查询参数"""
    board_type: str = "daily"  # daily/weekly/overall
    limit: int = 100
    season_id: int = 1


# ========================================
# WebSocket连接
# ========================================

@router.websocket("/ws/competition")
async def websocket_endpoint(
    websocket: WebSocket,
    token: str = Query(...),
    season_id: int = Query(default=1),
    db: AsyncSession = Depends(get_db)
):
    """
    WebSocket连接端点

    客户端连接: ws://localhost:8000/api/v1/competition/ws/competition?token=xxx&season_id=1
    """
    # 先accept连接
    await websocket.accept()

    # 验证token
    try:
        from jose import jwt, JWTError
        from app.core.config import settings

        # 解码JWT token
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
        user_id_str = payload.get("sub")
        if user_id_str is None:
            raise ValueError("Token中缺少user_id")
        user_id = int(user_id_str)

        # 验证用户存在且激活
        from app.models.user import User
        from sqlalchemy import select
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()

        if user is None or not user.is_active:
            raise ValueError("用户不存在或已禁用")

    except (JWTError, ValueError, Exception) as e:
        print(f"❌ WebSocket认证失败: {e}")
        await websocket.close(code=1008, reason=f"认证失败: {str(e)}")
        return

    # 注册到连接管理器(不需要再次accept)
    websocket_manager.active_connections[user_id] = websocket
    if season_id not in websocket_manager.season_connections:
        websocket_manager.season_connections[season_id] = set()
    websocket_manager.season_connections[season_id].add(user_id)

    try:
        # 发送欢迎消息和当前排行榜
        leaderboard = await competition_service.get_leaderboard(
            db=db,
            season_id=season_id,
            board_type="daily",
            user_id=user_id
        )

        await websocket.send_json({
            "type": "connected",
            "message": "WebSocket连接成功!",
            "leaderboard": leaderboard
        })

        # 保持连接,接收客户端消息
        while True:
            data = await websocket.receive_json()

            # 处理客户端请求
            if data.get("type") == "get_leaderboard":
                board_type = data.get("board_type", "daily")
                leaderboard = await competition_service.get_leaderboard(
                    db=db,
                    season_id=season_id,
                    board_type=board_type,
                    user_id=user_id
                )
                await websocket.send_json({
                    "type": "leaderboard_update",
                    "data": leaderboard
                })

            elif data.get("type") == "pong":
                # 心跳响应
                pass

    except WebSocketDisconnect:
        # 清理连接
        if user_id in websocket_manager.active_connections:
            del websocket_manager.active_connections[user_id]
        if season_id in websocket_manager.season_connections:
            websocket_manager.season_connections[season_id].discard(user_id)
    except Exception as e:
        print(f"WebSocket错误: {e}")
        # 清理连接
        if user_id in websocket_manager.active_connections:
            del websocket_manager.active_connections[user_id]
        if season_id in websocket_manager.season_connections:
            websocket_manager.season_connections[season_id].discard(user_id)


# ========================================
# REST API
# ========================================

@router.post("/submit-answer")
async def submit_answer(
    request: SubmitAnswerRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    提交答题并更新积分排名

    实时推送:
    - 答题用户收到自己的得分详情和排名变化
    - 所有在线用户收到排行榜更新
    - 被超越的用户收到通知
    """
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from app.models.competition import CompetitionQuestion
    import json

    # 1. 获取题目信息
    query = select(CompetitionQuestion).options(
        selectinload(CompetitionQuestion.options)
    ).where(CompetitionQuestion.id == request.question_id)
    result_q = await db.execute(query)
    question = result_q.scalar_one_or_none()

    if not question:
        raise HTTPException(status_code=404, detail="题目不存在")

    # 2. 判断答案是否正确
    is_correct = False
    if question.question_type == 'choice':
        # 选择题:匹配option_key
        correct_answer_data = json.loads(question.correct_answer)
        correct_key = correct_answer_data.get('answer', '')
        is_correct = request.user_answer.upper() == correct_key.upper()
    else:
        # 其他题型:直接比较答案(忽略大小写和首尾空格)
        is_correct = request.user_answer.strip().lower() == question.correct_answer.strip().lower()

    # 3. 更新题目统计
    question.total_attempts += 1
    question.use_count += 1
    if is_correct:
        question.correct_count += 1

    # 4. 提交答案到竞赛系统(使用word_id,如果没有则用question_id)
    word_id = question.word_id or request.question_id
    result = await competition_service.submit_answer(
        db=db,
        user_id=current_user.id,
        word_id=word_id,
        is_correct=is_correct,
        time_spent_ms=request.time_spent_ms,
        question_type=question.question_type,
        season_id=request.season_id
    )

    # 5. 添加正确答案和解析到返回结果
    if question.question_type == 'choice':
        # 选择题:返回正确选项
        correct_answer_data = json.loads(question.correct_answer)
        correct_key = correct_answer_data.get('answer', '')
        correct_option = next((opt for opt in question.options if opt.option_key == correct_key), None)
        result['correct_answer'] = {
            'key': correct_key,
            'text': correct_option.option_text if correct_option else ''
        }
    else:
        result['correct_answer'] = question.correct_answer

    result['answer_explanation'] = question.answer_explanation
    result['question_type'] = question.question_type

    await db.commit()

    return result


@router.get("/leaderboard")
async def get_leaderboard(
    board_type: str = Query(default="daily", regex="^(daily|weekly|overall)$"),
    limit: int = Query(default=100, ge=1, le=500),
    season_id: int = Query(default=1),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    获取排行榜

    参数:
        board_type: daily(每日榜)/weekly(每周榜)/overall(总榜)
        limit: 返回前N名
        season_id: 赛季ID
    """
    leaderboard = await competition_service.get_leaderboard(
        db=db,
        season_id=season_id,
        board_type=board_type,
        limit=limit,
        user_id=current_user.id
    )

    return leaderboard


@router.get("/my-stats")
async def get_my_stats(
    season_id: int = Query(default=1),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """获取个人竞赛统计"""
    from sqlalchemy import select, and_
    from app.models.competition import UserScore

    # 查询用户积分
    stmt = select(UserScore).where(
        and_(
            UserScore.user_id == current_user.id,
            UserScore.season_id == season_id
        )
    )
    result = await db.execute(stmt)
    user_score = result.scalar_one_or_none()

    if not user_score:
        return {
            "today": {"score": 0, "rank": None, "questions_answered": 0, "accuracy_rate": 0, "max_combo": 0},
            "this_week": {"score": 0, "rank": None, "questions_answered": 0, "accuracy_rate": 0, "max_combo": 0},
            "overall": {"total_score": 0, "rank": None, "questions_answered": 0, "accuracy_rate": 0, "max_combo": 0}
        }

    return {
        "today": {
            "score": user_score.daily_score,
            "rank": user_score.rank_daily,
            "questions_answered": user_score.questions_answered,
            "accuracy_rate": float(user_score.accuracy_rate),
            "max_combo": user_score.max_combo
        },
        "this_week": {
            "score": user_score.weekly_score,
            "rank": user_score.rank_weekly,
            "questions_answered": user_score.questions_answered,
            "accuracy_rate": float(user_score.accuracy_rate),
            "max_combo": user_score.max_combo
        },
        "overall": {
            "total_score": user_score.total_score,
            "rank": user_score.rank_overall,
            "questions_answered": user_score.questions_answered,
            "accuracy_rate": float(user_score.accuracy_rate),
            "max_combo": user_score.max_combo
        }
    }


@router.get("/my-rank")
async def get_my_rank(
    season_id: int = Query(default=1),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """获取个人段位信息"""
    from sqlalchemy import select, and_
    from app.models.competition import UserScore

    stmt = select(UserScore).where(
        and_(
            UserScore.user_id == current_user.id,
            UserScore.season_id == season_id
        )
    )
    result = await db.execute(stmt)
    user_score = result.scalar_one_or_none()

    rank_points = (user_score.rank_points or 0) if user_score else 0
    total_score = (user_score.total_score or 0) if user_score else 0

    current_tier = competition_service.get_tier_for_points(rank_points)
    next_tier = competition_service.get_next_tier(current_tier["name"])

    progress_to_next = 0.0
    if next_tier:
        range_size = next_tier["min_points"] - current_tier["min_points"]
        if range_size > 0:
            progress_to_next = round(
                (rank_points - current_tier["min_points"]) / range_size, 3
            )

    return {
        "tier": current_tier["name"],
        "tier_label": current_tier["label"],
        "tier_emoji": current_tier["emoji"],
        "rank_points": rank_points,
        "next_tier": {
            "name": next_tier["name"],
            "label": next_tier["label"],
            "min_points": next_tier["min_points"],
        } if next_tier else None,
        "progress_to_next": progress_to_next,
        "total_score": total_score,
    }


@router.get("/online-users")
async def get_online_users(
    season_id: int = Query(default=1),
    current_user: User = Depends(get_current_user)
):
    """获取在线用户数"""
    return {
        "season_id": season_id,
        "online_users": websocket_manager.get_online_users_count(season_id),
        "total_connections": len(websocket_manager.active_connections)
    }


@router.get("/random-question")
async def get_random_question(
    question_type: Optional[str] = Query(None, regex="^(choice|fill_blank|spelling|reading)$"),
    difficulty: Optional[str] = Query(None, regex="^(easy|medium|hard)$"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """
    获取随机竞赛题目

    参数:
        question_type: 题型筛选 (choice/fill_blank/spelling/reading)
        difficulty: 难度筛选 (easy/medium/hard)

    返回:
        包含题目信息和选项的完整题目数据
    """
    from sqlalchemy import select, func
    from sqlalchemy.orm import selectinload
    from app.models.competition import CompetitionQuestion

    # 构建查询 - 只获取激活的题目
    query = select(CompetitionQuestion).options(
        selectinload(CompetitionQuestion.options)
    ).where(
        CompetitionQuestion.is_active == True
    )

    # 筛选条件
    if question_type:
        query = query.where(CompetitionQuestion.question_type == question_type)
    if difficulty:
        query = query.where(CompetitionQuestion.difficulty == difficulty)

    # 随机排序并取一条
    query = query.order_by(func.random()).limit(1)

    result = await db.execute(query)
    question = result.scalar_one_or_none()

    if not question:
        raise HTTPException(
            status_code=404,
            detail="没有找到符合条件的题目,请联系教师添加题目"
        )

    # 返回题目数据
    return {
        "id": question.id,
        "question_type": question.question_type,
        "title": question.title,
        "content": question.content,
        "passage": question.passage,
        "difficulty": question.difficulty,
        "word_id": question.word_id,
        "options": [
            {
                "id": opt.id,
                "option_key": opt.option_key,
                "option_text": opt.option_text,
                "display_order": opt.display_order
            }
            for opt in sorted(question.options, key=lambda x: x.display_order)
        ] if question.options else [],
        "source": question.source,
        "tags": question.tags
    }
