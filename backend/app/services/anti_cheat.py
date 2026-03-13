"""
防作弊系统 - 检测异常答题行为
"""
from datetime import datetime, timedelta
from typing import Dict, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, func
from app.models.competition import AnswerRecord, UserScore


class AntiCheatService:
    """防作弊服务"""

    # 配置参数
    MIN_ANSWER_TIME_MS = 500  # 最小答题时间(毫秒)
    MAX_ANSWERS_PER_MINUTE = 60  # 每分钟最多答题次数
    SUSPICIOUS_ACCURACY_THRESHOLD = 98  # 可疑正确率阈值
    SUSPICIOUS_SPEED_THRESHOLD = 1000  # 可疑平均答题速度(毫秒)

    @staticmethod
    async def validate_answer_submission(
        db: AsyncSession,
        user_id: int,
        word_id: int,
        time_spent_ms: int,
        season_id: int = 1
    ) -> Dict:
        """
        验证答题合法性

        返回:
            {
                "valid": bool,
                "reason": str,
                "warning": bool
            }
        """
        # 1. 检查答题时间是否过短
        if time_spent_ms < AntiCheatService.MIN_ANSWER_TIME_MS:
            return {
                "valid": False,
                "reason": f"答题时间过短({time_spent_ms}ms < {AntiCheatService.MIN_ANSWER_TIME_MS}ms)",
                "warning": True
            }

        # 2. 检查答题频率(防止刷分)
        one_minute_ago = datetime.now() - timedelta(minutes=1)
        stmt = select(func.count(AnswerRecord.id)).where(
            and_(
                AnswerRecord.user_id == user_id,
                AnswerRecord.season_id == season_id,
                AnswerRecord.created_at >= one_minute_ago
            )
        )
        result = await db.execute(stmt)
        recent_answers = result.scalar() or 0

        if recent_answers >= AntiCheatService.MAX_ANSWERS_PER_MINUTE:
            return {
                "valid": False,
                "reason": f"答题频率过高({recent_answers}次/分钟)",
                "warning": True
            }

        # 3. 检查是否重复答题同一单词(短时间内)
        five_seconds_ago = datetime.now() - timedelta(seconds=5)
        stmt = select(AnswerRecord).where(
            and_(
                AnswerRecord.user_id == user_id,
                AnswerRecord.word_id == word_id,
                AnswerRecord.created_at >= five_seconds_ago
            )
        )
        result = await db.execute(stmt)
        duplicate = result.first()

        if duplicate:
            return {
                "valid": False,
                "reason": "重复答题同一单词(5秒内)",
                "warning": True
            }

        # 4. 检查异常模式(高正确率 + 超快速度)
        warning = await AntiCheatService.check_suspicious_pattern(
            db, user_id, season_id
        )

        return {
            "valid": True,
            "reason": "验证通过",
            "warning": warning
        }

    @staticmethod
    async def check_suspicious_pattern(
        db: AsyncSession,
        user_id: int,
        season_id: int
    ) -> bool:
        """
        检查可疑答题模式

        返回:
            True: 可疑行为, False: 正常
        """
        # 获取用户最近20次答题记录
        stmt = select(AnswerRecord).where(
            and_(
                AnswerRecord.user_id == user_id,
                AnswerRecord.season_id == season_id
            )
        ).order_by(AnswerRecord.created_at.desc()).limit(20)

        result = await db.execute(stmt)
        recent_records = result.scalars().all()

        if len(recent_records) < 20:
            return False  # 数据不足,不判定

        # 计算正确率
        correct_count = sum(1 for r in recent_records if r.is_correct)
        accuracy = (correct_count / len(recent_records)) * 100

        # 计算平均答题时间
        avg_time = sum(r.time_spent for r in recent_records) / len(recent_records)

        # 可疑模式: 正确率>98% 且 平均时间<1秒
        if (accuracy > AntiCheatService.SUSPICIOUS_ACCURACY_THRESHOLD and
            avg_time < AntiCheatService.SUSPICIOUS_SPEED_THRESHOLD):

            # 记录可疑行为日志
            print(f"⚠️ 可疑用户行为: user_id={user_id}, 正确率={accuracy:.1f}%, 平均时间={avg_time:.0f}ms")
            return True

        return False

    @staticmethod
    async def get_user_risk_score(
        db: AsyncSession,
        user_id: int,
        season_id: int
    ) -> Dict:
        """
        计算用户风险分数

        返回:
            {
                "risk_score": 0-100,
                "risk_level": "low" | "medium" | "high",
                "flags": []
            }
        """
        flags = []
        risk_score = 0

        # 获取用户积分
        stmt = select(UserScore).where(
            and_(
                UserScore.user_id == user_id,
                UserScore.season_id == season_id
            )
        )
        result = await db.execute(stmt)
        user_score = result.scalar_one_or_none()

        if not user_score or user_score.questions_answered < 10:
            return {
                "risk_score": 0,
                "risk_level": "low",
                "flags": []
            }

        # 1. 检查正确率异常
        if user_score.accuracy_rate > 95:
            risk_score += 20
            flags.append("正确率异常高")

        # 2. 检查连击异常
        if user_score.max_combo > 50:
            risk_score += 15
            flags.append("连击数异常高")

        # 3. 检查答题速度
        stmt = select(func.avg(AnswerRecord.time_spent)).where(
            and_(
                AnswerRecord.user_id == user_id,
                AnswerRecord.season_id == season_id,
                AnswerRecord.is_correct == True
            )
        )
        result = await db.execute(stmt)
        avg_time = result.scalar() or 0

        if avg_time < 1000 and user_score.questions_answered > 20:
            risk_score += 25
            flags.append(f"答题速度异常快({avg_time:.0f}ms)")

        # 4. 检查积分暴涨
        stmt = select(AnswerRecord).where(
            and_(
                AnswerRecord.user_id == user_id,
                AnswerRecord.season_id == season_id
            )
        ).order_by(AnswerRecord.created_at.desc()).limit(10)

        result = await db.execute(stmt)
        recent_records = result.scalars().all()

        if len(recent_records) >= 10:
            recent_score = sum(r.total_score for r in recent_records)
            if recent_score > 1000:
                risk_score += 20
                flags.append("短时间内积分暴涨")

        # 5. 检查答题时间分布(正常人会有波动)
        if len(recent_records) >= 10:
            times = [r.time_spent for r in recent_records]
            # 计算标准差
            import statistics
            try:
                std_dev = statistics.stdev(times)
                if std_dev < 200:  # 时间过于稳定
                    risk_score += 15
                    flags.append("答题时间分布异常稳定")
            except:
                pass

        # 确定风险等级
        if risk_score >= 60:
            risk_level = "high"
        elif risk_score >= 30:
            risk_level = "medium"
        else:
            risk_level = "low"

        return {
            "risk_score": min(risk_score, 100),
            "risk_level": risk_level,
            "flags": flags
        }


# 导出服务实例
anti_cheat_service = AntiCheatService()
