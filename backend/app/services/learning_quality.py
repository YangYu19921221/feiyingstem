"""
学习质量分析服务 - 防划水系统核心

分析学生学习行为，识别可疑的划水行为，计算学习质量分数。
"""
from typing import List, Dict, Any
from statistics import stdev, mean
from dataclasses import dataclass


@dataclass
class LearningRecord:
    """学习记录数据类"""
    word_id: int
    is_correct: bool
    time_spent: int  # 毫秒
    first_letter_correct: bool = True


class LearningQualityService:
    """学习质量分析服务"""

    # 配置参数
    MIN_NORMAL_TIME_MS = 1000  # 正常最短答题时间（毫秒）
    MAX_NORMAL_TIME_MS = 30000  # 正常最长答题时间（毫秒）
    SUSPICIOUS_TIME_THRESHOLD = 1500  # 可疑快速答题阈值
    MECHANICAL_STD_THRESHOLD = 300  # 机械答题时间标准差阈值

    @staticmethod
    def calculate_quality_score(records: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        计算本次学习的质量分数

        参数:
            records: 学习记录列表，每条记录包含:
                - word_id: int
                - is_correct: bool
                - time_spent: int (毫秒)
                - first_letter_correct: bool (可选)

        返回:
            {
                "score": 0-100,
                "flags": [],  # 异常标记列表
                "suspicious": bool,  # 是否可疑
                "avg_time": float,  # 平均答题时间
                "accuracy": float,  # 正确率
                "details": {}  # 详细分析数据
            }
        """
        if not records or len(records) < 5:
            return {
                "score": 50,
                "flags": [],
                "suspicious": False,
                "avg_time": 0,
                "accuracy": 0,
                "details": {"reason": "记录不足，无法分析"}
            }

        times = [r.get("time_spent", 0) for r in records]
        correct_count = sum(1 for r in records if r.get("is_correct", False))

        score = 50  # 基础分
        flags = []
        details = {}

        # 1. 时间分布分析
        avg_time = mean(times) if times else 0
        time_std = stdev(times) if len(times) > 1 else 0
        details["avg_time_ms"] = round(avg_time, 2)
        details["time_std_ms"] = round(time_std, 2)

        if avg_time < LearningQualityService.SUSPICIOUS_TIME_THRESHOLD:
            # 平均用时过短，扣分
            penalty = min(20, int((LearningQualityService.SUSPICIOUS_TIME_THRESHOLD - avg_time) / 50))
            score -= penalty
            flags.append(f"答题过快(平均{avg_time:.0f}ms)")
        elif avg_time > 3000:
            # 认真思考，加分
            score += 10
            details["bonus"] = "认真思考奖励"

        if time_std < LearningQualityService.MECHANICAL_STD_THRESHOLD and len(times) >= 10:
            # 时间过于规律（可能机械点击）
            score -= 15
            flags.append(f"行为机械(标准差{time_std:.0f}ms)")

        # 2. 正确率分析
        accuracy = correct_count / len(records) if records else 0
        details["accuracy"] = round(accuracy, 3)
        details["correct_count"] = correct_count
        details["total_count"] = len(records)

        if accuracy > 0.95 and avg_time < 2000:
            # 高正确率 + 快速度 = 可疑
            score -= 10
            flags.append("高正确率+快速度=可疑")
        elif accuracy < 0.3:
            # 正确率过低
            score -= 10
            flags.append("正确率过低")
        else:
            # 正常范围，根据正确率加分
            score += int(accuracy * 30)

        # 3. 首字母验证通过率分析（如果有数据）
        first_letter_checks = [r for r in records if "first_letter_correct" in r]
        if first_letter_checks:
            first_letter_correct_count = sum(
                1 for r in first_letter_checks if r.get("first_letter_correct", True)
            )
            first_letter_rate = first_letter_correct_count / len(first_letter_checks)
            details["first_letter_rate"] = round(first_letter_rate, 3)

            if first_letter_rate < 0.5:
                score -= 15
                flags.append(f"首字母验证失败多({first_letter_rate:.0%})")

        # 4. 连续快速答题检测
        fast_streak = 0
        max_fast_streak = 0
        for time in times:
            if time < 1000:
                fast_streak += 1
                max_fast_streak = max(max_fast_streak, fast_streak)
            else:
                fast_streak = 0

        if max_fast_streak >= 5:
            score -= 10
            flags.append(f"连续快速答题{max_fast_streak}次")
            details["max_fast_streak"] = max_fast_streak

        # 5. 答题节奏变化分析
        if len(times) >= 10:
            first_half_avg = mean(times[:len(times)//2])
            second_half_avg = mean(times[len(times)//2:])
            details["first_half_avg"] = round(first_half_avg, 2)
            details["second_half_avg"] = round(second_half_avg, 2)

            # 后半段明显变快可能是疲劳划水
            if second_half_avg < first_half_avg * 0.6:
                score -= 5
                flags.append("后期答题明显加速")

        # 确保分数在有效范围内
        score = max(0, min(100, score))

        # 判断是否可疑
        suspicious = score < 30

        return {
            "score": score,
            "flags": flags,
            "suspicious": suspicious,
            "avg_time": round(avg_time, 2),
            "accuracy": round(accuracy, 3),
            "details": details
        }

    @staticmethod
    def get_quality_level(score: int) -> str:
        """
        根据分数获取质量等级

        返回: "excellent" | "good" | "normal" | "poor" | "suspicious"
        """
        if score >= 80:
            return "excellent"
        elif score >= 60:
            return "good"
        elif score >= 40:
            return "normal"
        elif score >= 20:
            return "poor"
        else:
            return "suspicious"

    @staticmethod
    def calculate_combo_bonus(combo_count: int) -> int:
        """
        计算连击奖励积分

        参数:
            combo_count: 当前连击数

        返回:
            奖励积分
        """
        if combo_count == 5:
            return 10
        elif combo_count == 10:
            return 25
        elif combo_count == 20:
            return 50
        elif combo_count > 20 and combo_count % 10 == 0:
            return 30
        return 0


# 导出服务实例
learning_quality_service = LearningQualityService()
