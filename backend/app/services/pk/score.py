"""PK 评分与排名(纯函数,无副作用)。"""
from __future__ import annotations


def compute_final_score(correct: int, total_time_ms: int) -> int:
    """final_score = correct * 100 - total_time_ms // 100。"""
    return correct * 100 - total_time_ms // 100


def rank_players(players: list[dict]) -> list[dict]:
    """对玩家按 final_score 倒序排名,同分按 total_time_ms 升序。

    输入 dict 至少含 correct, wrong, total_time_ms。
    返回新 list,每个 dict 添加 final_score, accuracy, rank 字段。
    """
    enriched = []
    for p in players:
        correct = p.get("correct", 0)
        wrong = p.get("wrong", 0)
        total = correct + wrong
        accuracy = round(correct / total * 100, 2) if total > 0 else 0.0
        score = compute_final_score(correct, p.get("total_time_ms", 0))
        enriched.append({**p, "final_score": score, "accuracy": accuracy})

    enriched.sort(key=lambda x: (-x["final_score"], x["total_time_ms"]))
    for idx, p in enumerate(enriched, start=1):
        p["rank"] = idx
    return enriched
