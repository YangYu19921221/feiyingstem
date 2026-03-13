"""
竞赛系统核心服务 - 积分计算、排名更新
"""
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, desc, and_
from typing import Dict, List, Optional
from datetime import datetime
import json

from app.models.competition import (
    CompetitionSeason, UserScore, AnswerRecord, UnitChallenge, ChallengeRanking
)
from app.models.user import User
from app.models.word import Word
from app.services.websocket_manager import websocket_manager
from app.services.anti_cheat import anti_cheat_service


class CompetitionService:
    """竞赛服务"""

    # 段位体系
    RANK_TIERS = [
        {"name": "bronze", "label": "青铜", "emoji": "🥉", "min_points": 0},
        {"name": "silver", "label": "白银", "emoji": "⚪", "min_points": 100},
        {"name": "gold", "label": "黄金", "emoji": "🥇", "min_points": 300},
        {"name": "platinum", "label": "铂金", "emoji": "💎", "min_points": 600},
        {"name": "diamond", "label": "钻石", "emoji": "💠", "min_points": 1000},
        {"name": "king", "label": "王者", "emoji": "👑", "min_points": 1500},
    ]

    @staticmethod
    def get_tier_for_points(points: int) -> dict:
        """根据积分获取段位信息"""
        current_tier = CompetitionService.RANK_TIERS[0]
        for tier in CompetitionService.RANK_TIERS:
            if points >= tier["min_points"]:
                current_tier = tier
            else:
                break
        return current_tier

    @staticmethod
    def get_next_tier(current_tier_name: str) -> dict | None:
        """获取下一个段位"""
        tiers = CompetitionService.RANK_TIERS
        for i, tier in enumerate(tiers):
            if tier["name"] == current_tier_name and i + 1 < len(tiers):
                return tiers[i + 1]
        return None

    @staticmethod
    def update_rank_points(user_score, is_correct: bool) -> dict:
        """更新段位积分，返回变化信息"""
        old_points = user_score.rank_points or 0
        old_tier = CompetitionService.get_tier_for_points(old_points)

        if is_correct:
            new_points = old_points + 25
        else:
            new_points = max(0, old_points - 15)

        new_tier = CompetitionService.get_tier_for_points(new_points)

        user_score.rank_points = new_points
        user_score.rank_tier = new_tier["name"]

        tier_changed = old_tier["name"] != new_tier["name"]
        return {
            "old_points": old_points,
            "new_points": new_points,
            "points_delta": new_points - old_points,
            "old_tier": old_tier,
            "new_tier": new_tier,
            "tier_changed": tier_changed,
            "promoted": tier_changed and new_points > old_points,
            "demoted": tier_changed and new_points < old_points,
        }

    @staticmethod
    def calculate_answer_score(
        is_correct: bool,
        difficulty: int,
        time_spent_ms: int,
        current_combo: int,
        is_first_correct: bool
    ) -> Dict:
        """
        计算答题得分

        参数:
            is_correct: 是否答对
            difficulty: 难度等级 (1-5)
            time_spent_ms: 答题耗时(毫秒)
            current_combo: 当前连击数
            is_first_correct: 是否首次答对该单词

        返回:
            分数详情字典
        """
        if not is_correct:
            return {
                "base_score": -3,
                "difficulty_bonus": 0,
                "speed_bonus": 0,
                "combo_bonus": 0,
                "first_time_bonus": 0,
                "total_score": -3,
                "combo_broken": True,
                "multiplier": 1.0
            }

        # 基础分
        base_score = 10

        # 难度加成 (1-5难度对应5-25分)
        difficulty_bonus = difficulty * 5

        # 速度奖励 (3秒内满分10分,每多1秒-2分)
        time_spent_sec = time_spent_ms / 1000
        if time_spent_sec <= 3:
            speed_bonus = 10
        elif time_spent_sec <= 8:
            speed_bonus = max(0, int(10 - (time_spent_sec - 3) * 2))
        else:
            speed_bonus = 0

        # 连击奖励 (2连击开始,每连击+2分)
        combo_bonus = current_combo * 2 if current_combo >= 2 else 0

        # 首次答对奖励
        first_time_bonus = 5 if is_first_correct else 0

        # 连击倍数
        if current_combo >= 10:
            multiplier = 3.0
        elif current_combo >= 5:
            multiplier = 2.0
        elif current_combo >= 2:
            multiplier = 1.5
        else:
            multiplier = 1.0

        # 总分
        total_score = int((base_score + difficulty_bonus + speed_bonus + combo_bonus + first_time_bonus) * multiplier)

        return {
            "base_score": base_score,
            "difficulty_bonus": difficulty_bonus,
            "speed_bonus": speed_bonus,
            "combo_bonus": combo_bonus,
            "first_time_bonus": first_time_bonus,
            "total_score": total_score,
            "combo_broken": False,
            "multiplier": multiplier
        }

    @staticmethod
    async def submit_answer(
        db: AsyncSession,
        user_id: int,
        word_id: int,
        is_correct: bool,
        time_spent_ms: int,
        question_type: str = "choice",
        season_id: int = 1
    ) -> Dict:
        """
        提交答题并更新积分排名

        返回:
            答题结果详情
        """
        # 0. 防作弊验证
        validation = await anti_cheat_service.validate_answer_submission(
            db=db,
            user_id=user_id,
            word_id=word_id,
            time_spent_ms=time_spent_ms,
            season_id=season_id
        )

        if not validation["valid"]:
            raise ValueError(validation["reason"])

        # 1. 获取单词难度
        word = await db.get(Word, word_id)
        if not word:
            raise ValueError("单词不存在")

        difficulty = word.difficulty or 3

        # 2. 获取或创建用户积分记录
        stmt = select(UserScore).where(
            and_(
                UserScore.user_id == user_id,
                UserScore.season_id == season_id
            )
        )
        result = await db.execute(stmt)
        user_score = result.scalar_one_or_none()

        if not user_score:
            user_score = UserScore(
                user_id=user_id,
                season_id=season_id
            )
            db.add(user_score)
            await db.flush()

        # 3. 检查是否首次答对该单词
        stmt = select(AnswerRecord).where(
            and_(
                AnswerRecord.user_id == user_id,
                AnswerRecord.word_id == word_id,
                AnswerRecord.is_correct == True
            )
        )
        result = await db.execute(stmt)
        is_first_correct = result.first() is None

        # 4. 记录答题前的排名
        old_rank = user_score.rank_daily

        # 5. 计算得分
        score_result = CompetitionService.calculate_answer_score(
            is_correct=is_correct,
            difficulty=difficulty,
            time_spent_ms=time_spent_ms,
            current_combo=user_score.current_combo,
            is_first_correct=is_first_correct
        )

        # 6. 更新用户积分
        user_score.total_score += score_result["total_score"]
        user_score.daily_score += score_result["total_score"]
        user_score.weekly_score += score_result["total_score"]
        user_score.monthly_score += score_result["total_score"]
        user_score.questions_answered += 1

        if is_correct:
            user_score.correct_count += 1
            user_score.current_combo += 1
            user_score.max_combo = max(user_score.max_combo, user_score.current_combo)
        else:
            user_score.current_combo = 0

        # 更新段位积分
        rank_change_info = CompetitionService.update_rank_points(user_score, is_correct)

        # 更新正确率
        user_score.accuracy_rate = round(
            (user_score.correct_count / user_score.questions_answered) * 100, 2
        )
        user_score.last_answer_time = datetime.now()

        # 7. 创建答题记录
        answer_record = AnswerRecord(
            user_id=user_id,
            word_id=word_id,
            season_id=season_id,
            question_type=question_type,
            is_correct=is_correct,
            time_spent=time_spent_ms,
            base_score=score_result["base_score"],
            difficulty_bonus=score_result["difficulty_bonus"],
            speed_bonus=score_result["speed_bonus"],
            combo_bonus=score_result["combo_bonus"],
            first_time_bonus=score_result["first_time_bonus"],
            total_score=score_result["total_score"],
            combo_count=user_score.current_combo,
            is_first_correct=is_first_correct
        )
        db.add(answer_record)

        await db.commit()
        await db.refresh(user_score)

        # 8. 重新计算排名
        await CompetitionService.recalculate_ranks(db, season_id)

        # 9. 获取更新后的排名
        await db.refresh(user_score)
        new_rank = user_score.rank_daily

        # 10. WebSocket实时推送
        await CompetitionService.broadcast_rank_change(
            db=db,
            user_id=user_id,
            season_id=season_id,
            old_rank=old_rank,
            new_rank=new_rank,
            score_delta=score_result["total_score"]
        )

        # 11. 连击里程碑通知
        if is_correct and user_score.current_combo in [5, 10, 20, 50]:
            await websocket_manager.notify_combo_milestone(
                user_id=user_id,
                combo=user_score.current_combo,
                multiplier=score_result["multiplier"]
            )

        # 12. 返回结果
        user = await db.get(User, user_id)

        return {
            "success": True,
            "result": {
                "is_correct": is_correct,
                "base_score": score_result["base_score"],
                "difficulty_bonus": score_result["difficulty_bonus"],
                "speed_bonus": score_result["speed_bonus"],
                "combo_bonus": score_result["combo_bonus"],
                "first_time_bonus": score_result["first_time_bonus"],
                "total_score": score_result["total_score"],
                "multiplier": score_result["multiplier"],
                "current_combo": user_score.current_combo,
                "total_score_today": user_score.daily_score,
                "rank_change": (old_rank - new_rank) if old_rank and new_rank else 0,
                "old_rank": old_rank,
                "new_rank": new_rank
            },
            "combo_status": {
                "current": user_score.current_combo,
                "max": user_score.max_combo,
                "multiplier": score_result["multiplier"],
                "next_milestone": CompetitionService.get_next_combo_milestone(user_score.current_combo)
            },
            "rank_tier": {
                "tier": rank_change_info["new_tier"]["name"],
                "tier_label": rank_change_info["new_tier"]["label"],
                "tier_emoji": rank_change_info["new_tier"]["emoji"],
                "rank_points": user_score.rank_points,
                "points_delta": rank_change_info["points_delta"],
                "tier_changed": rank_change_info["tier_changed"],
                "promoted": rank_change_info["promoted"],
            }
        }

    @staticmethod
    def get_next_combo_milestone(current_combo: int) -> int:
        """获取下一个连击里程碑"""
        milestones = [2, 5, 10, 20, 50, 100]
        for milestone in milestones:
            if current_combo < milestone:
                return milestone
        return 200

    @staticmethod
    async def recalculate_ranks(db: AsyncSession, season_id: int):
        """重新计算所有用户排名"""
        # 每日排名
        stmt = select(UserScore).where(
            UserScore.season_id == season_id
        ).order_by(desc(UserScore.daily_score))

        result = await db.execute(stmt)
        users = result.scalars().all()

        for rank, user_score in enumerate(users, start=1):
            user_score.rank_daily = rank

        # 每周排名
        stmt = select(UserScore).where(
            UserScore.season_id == season_id
        ).order_by(desc(UserScore.weekly_score))

        result = await db.execute(stmt)
        users = result.scalars().all()

        for rank, user_score in enumerate(users, start=1):
            user_score.rank_weekly = rank

        # 总排名
        stmt = select(UserScore).where(
            UserScore.season_id == season_id
        ).order_by(desc(UserScore.total_score))

        result = await db.execute(stmt)
        users = result.scalars().all()

        for rank, user_score in enumerate(users, start=1):
            user_score.rank_overall = rank

        await db.commit()

    @staticmethod
    async def broadcast_rank_change(
        db: AsyncSession,
        user_id: int,
        season_id: int,
        old_rank: Optional[int],
        new_rank: Optional[int],
        score_delta: int
    ):
        """广播排名变化"""
        user = await db.get(User, user_id)

        # 广播排名更新
        rank_data = {
            "user_id": user_id,
            "nickname": user.full_name or user.username,
            "avatar_url": user.avatar_url,
            "old_rank": old_rank,
            "new_rank": new_rank,
            "score_delta": score_delta
        }

        await websocket_manager.broadcast_rank_update(rank_data, season_id)

        # 如果排名上升,通知被超越的用户
        if old_rank and new_rank and new_rank < old_rank:
            # 查找被超越的用户
            stmt = select(UserScore).where(
                and_(
                    UserScore.season_id == season_id,
                    UserScore.rank_daily >= new_rank,
                    UserScore.rank_daily < old_rank,
                    UserScore.user_id != user_id
                )
            )
            result = await db.execute(stmt)
            overtaken_users = result.scalars().all()

            for overtaken_score in overtaken_users:
                await websocket_manager.notify_user_overtaken(
                    overtaken_user_id=overtaken_score.user_id,
                    overtaker_name=user.full_name or user.username,
                    new_rank=overtaken_score.rank_daily
                )

            # 通知答题用户超越了别人
            if overtaken_users:
                overtaken_user = await db.get(User, overtaken_users[0].user_id)
                await websocket_manager.notify_user_overtake(
                    user_id=user_id,
                    overtaken_name=overtaken_user.full_name or overtaken_user.username,
                    new_rank=new_rank
                )

    @staticmethod
    async def get_leaderboard(
        db: AsyncSession,
        season_id: int = 1,
        board_type: str = "daily",
        limit: int = 100,
        user_id: Optional[int] = None
    ) -> Dict:
        """
        获取排行榜

        参数:
            board_type: daily/weekly/overall
            limit: 返回前N名
            user_id: 当前用户ID(用于标记)
        """
        # 根据类型选择排序字段
        order_field_map = {
            "daily": desc(UserScore.daily_score),
            "weekly": desc(UserScore.weekly_score),
            "overall": desc(UserScore.total_score)
        }

        order_field = order_field_map.get(board_type, desc(UserScore.daily_score))

        # 查询排行榜
        stmt = select(UserScore).where(
            UserScore.season_id == season_id
        ).order_by(order_field).limit(limit)

        result = await db.execute(stmt)
        user_scores = result.scalars().all()

        # 构建排行榜数据
        rankings = []
        my_rank = None
        my_score = None

        for idx, user_score in enumerate(user_scores, start=1):
            user = await db.get(User, user_score.user_id)

            score_value = {
                "daily": user_score.daily_score,
                "weekly": user_score.weekly_score,
                "overall": user_score.total_score
            }.get(board_type, user_score.daily_score)

            rank_item = {
                "rank": idx,
                "user_id": user_score.user_id,
                "nickname": user.full_name or user.username,
                "avatar_url": user.avatar_url,
                "score": score_value,
                "accuracy_rate": float(user_score.accuracy_rate),
                "max_combo": user_score.max_combo,
                "is_me": user_score.user_id == user_id,
                "rank_tier_emoji": CompetitionService.get_tier_for_points(user_score.rank_points or 0)["emoji"],
            }

            rankings.append(rank_item)

            if user_score.user_id == user_id:
                my_rank = idx
                my_score = score_value

        return {
            "type": board_type,
            "updated_at": datetime.now().isoformat(),
            "my_rank": my_rank,
            "my_score": my_score,
            "rankings": rankings,
            "total_participants": len(user_scores),
            "online_users": websocket_manager.get_online_users_count(season_id)
        }


# 导出服务实例
competition_service = CompetitionService()
