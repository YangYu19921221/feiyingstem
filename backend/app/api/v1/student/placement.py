"""
学生端 - 入学摸底测评 API

流程:
  1. POST /placement/start       生成题目，返回 test_id + 脱敏题目（无答案）
  2. POST /placement/submit      提交所有答案，返回双技能诊断报告
  3. POST /placement/skip        跳过，自报年级，返回确认
  4. GET  /placement/result      查最新已完成/跳过的测评（首页用来判断是否要弹引导）

教师端（同文件，不同前缀，在 main.py 分别挂）:
  GET  /teacher/placement/student/{student_id}   查某学生最新测评结果
"""
import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.placement import PlacementTest
from app.models.user import User
from app.api.v1.auth import get_current_student, get_current_teacher
from app.api.v1.teacher._permissions import assert_student_in_my_class, get_my_class_student_ids
from app.services import placement as svc

logger = logging.getLogger(__name__)

student_router = APIRouter()
teacher_router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────

class SubmitAnswer(BaseModel):
    word_id: int
    question_type: str = Field(..., pattern="^(recognition|spelling)$")
    # recognition: 学生选了第几个选项（0-based）
    chosen_index: int | None = Field(None, ge=0, le=3)
    # spelling: 学生输入的英文
    typed_answer: str | None = Field(None, max_length=100)


class SubmitRequest(BaseModel):
    test_id: int
    answers: list[SubmitAnswer] = Field(..., min_length=1)


class SkipRequest(BaseModel):
    self_reported_level: str = Field(..., max_length=30,
                                     description="如「三年级」「初一」")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _strip_secrets(questions: list[dict]) -> list[dict]:
    """下发给前端时去掉答案字段，防止客户端抓包后直接获取答案。"""
    out = []
    for q in questions:
        item = {k: v for k, v in q.items()
                if k not in ("correct_index", "correct_answer")}
        out.append(item)
    return out


def _format_result(test: PlacementTest) -> dict:
    profile = json.loads(test.skill_profile_json or "{}")
    weak = json.loads(test.weak_words_json or "[]")
    known = json.loads(test.known_words_json or "[]")
    return {
        "has_placement": True,
        "test_id": test.id,
        "status": test.status,
        "placement_difficulty": test.placement_difficulty,
        "placement_label": test.placement_label,
        "self_reported_level": test.self_reported_level,
        "correct_count": test.correct_count,
        "total_questions": test.total_questions,
        "skill_profile": profile,
        "weak_words": weak,
        "known_words_seeded": len(known),
        "completed_at": test.completed_at.isoformat() if test.completed_at else None,
    }


# ── 学生端 ────────────────────────────────────────────────────────────────────

@student_router.post("/start")
async def start_placement(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """
    生成摸底测评题目（12题：10道认知+2道拼写）。
    同一学生如有未完成的 pending 测评，续用原题不重出。
    """
    # 续用未提交的
    existing = (await db.execute(
        select(PlacementTest).where(
            PlacementTest.user_id == current_user.id,
            PlacementTest.status == "pending",
        ).order_by(PlacementTest.created_at.desc()).limit(1)
    )).scalar_one_or_none()

    if existing and existing.questions_json:
        questions = json.loads(existing.questions_json)
        return {
            "test_id": existing.id,
            "questions": _strip_secrets(questions),
            "total": len(questions),
            "resumed": True,
        }

    questions = await svc.generate_questions(db)
    if len(questions) < 4:
        raise HTTPException(503,
            "词库题量不足，无法生成摸底测评（至少需要4道题）")

    test = PlacementTest(
        user_id=current_user.id,
        status="pending",
        questions_json=json.dumps(questions, ensure_ascii=False),
        total_questions=len(questions),
    )
    db.add(test)
    await db.commit()
    await db.refresh(test)

    return {
        "test_id": test.id,
        "questions": _strip_secrets(questions),
        "total": len(questions),
        "resumed": False,
    }


@student_router.post("/submit")
async def submit_placement(
    data: SubmitRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """
    提交所有答题，返回双技能诊断报告。

    报告包含：
    - 识别准确率、拼写准确率
    - 扎实到哪个难度档（solid_through_band）
    - 第一个漏洞在哪档（first_gap_band）
    - 推荐起点（placement_difficulty + placement_label）
    - 答错的词清单（weak_words）
    - 具体学习建议文字（recommendation）
    """
    test = (await db.execute(
        select(PlacementTest).where(
            PlacementTest.id == data.test_id,
            PlacementTest.user_id == current_user.id,
        )
    )).scalar_one_or_none()

    if not test:
        raise HTTPException(404, "测评不存在")
    if test.status == "completed":
        raise HTTPException(400, "该测评已经提交过了")
    if test.status == "skipped":
        raise HTTPException(400, "该测评已被跳过")

    questions: list[dict] = json.loads(test.questions_json or "[]")
    if not questions:
        raise HTTPException(500, "测评题目数据异常，请重新开始测评")

    q_index = {q["word_id"]: q for q in questions}

    # ── 核对每道题 ────────────────────────────────────────────────────────────
    scored: list[dict] = []
    for sub in data.answers:
        q = q_index.get(sub.word_id)
        if q is None:
            continue  # 多传的 word_id 忽略

        qt = q["question_type"]
        is_correct = False

        if qt == "recognition":
            if sub.chosen_index is None:
                raise HTTPException(422,
                    f"recognition 题（word_id={sub.word_id}）需要提供 chosen_index")
            is_correct = (sub.chosen_index == q["correct_index"])

        elif qt == "spelling":
            if sub.typed_answer is None:
                raise HTTPException(422,
                    f"spelling 题（word_id={sub.word_id}）需要提供 typed_answer")
            # 大小写不敏感，去除首尾空格
            is_correct = (
                sub.typed_answer.strip().lower() == q["correct_answer"].strip().lower()
            )

        scored.append({
            "word_id": sub.word_id,
            "word": q.get("word", ""),
            "question_type": qt,
            "difficulty": q["difficulty"],
            "is_correct": is_correct,
            # 保留学生的原始回答（供老师或报告展示，不返回给学生端）
            "chosen_index": sub.chosen_index,
            "typed_answer": sub.typed_answer,
        })

    correct_count = sum(1 for a in scored if a["is_correct"])

    # ── 诊断 ──────────────────────────────────────────────────────────────────
    profile = svc.build_skill_profile(scored)

    # ── 薄弱词 ───────────────────────────────────────────────────────────────
    weak_words = [
        {
            "word_id": a["word_id"],
            "word": a["word"],
            "difficulty": a["difficulty"],
            "question_type": a["question_type"],
        }
        for a in scored if not a["is_correct"]
    ]

    # ── 预埋已知词掌握度 ──────────────────────────────────────────────────────
    known_words = await svc.seed_known_words(db, current_user.id, scored)

    # ── 保存 ──────────────────────────────────────────────────────────────────
    test.status = "completed"
    test.answers_json = json.dumps(scored, ensure_ascii=False)
    test.correct_count = correct_count
    test.total_questions = len(questions)
    test.placement_difficulty = profile["placement_difficulty"]
    test.placement_label = profile["placement_label"]
    test.skill_profile_json = json.dumps(profile, ensure_ascii=False)
    test.weak_words_json = json.dumps(weak_words, ensure_ascii=False)
    test.known_words_json = json.dumps(known_words, ensure_ascii=False)
    test.completed_at = datetime.utcnow()
    await db.commit()

    # ── 返回给前端（不含每题的正确答案） ──────────────────────────────────────
    result_items = [
        {
            "word_id": a["word_id"],
            "word": a["word"],
            "question_type": a["question_type"],
            "difficulty": a["difficulty"],
            "is_correct": a["is_correct"],
        }
        for a in scored
    ]

    return {
        "test_id": test.id,
        "correct_count": correct_count,
        "total_questions": len(questions),
        "placement_difficulty": profile["placement_difficulty"],
        "placement_label": profile["placement_label"],
        "recognition_accuracy": profile["recognition_accuracy"],
        "spelling_accuracy": profile["spelling_accuracy"],
        "solid_through_band": profile["solid_through_band"],
        "first_gap_band": profile["first_gap_band"],
        "band_scores": profile["band_scores"],
        "recommendation": profile["recommendation"],
        "weak_words": weak_words,
        "known_words_seeded": len(known_words),
        "results": result_items,
    }


@student_router.post("/skip")
async def skip_placement(
    data: SkipRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """
    跳过测评，学生直接自报年级。
    placement_difficulty 记为 1（由老师分配书后再看）。
    """
    # 把所有 pending 记录标为 skipped
    pendings = (await db.execute(
        select(PlacementTest).where(
            PlacementTest.user_id == current_user.id,
            PlacementTest.status == "pending",
        )
    )).scalars().all()
    for p in pendings:
        p.status = "skipped"

    test = PlacementTest(
        user_id=current_user.id,
        status="skipped",
        self_reported_level=data.self_reported_level,
        placement_difficulty=1,
        placement_label=data.self_reported_level,
        completed_at=datetime.utcnow(),
        total_questions=0,
    )
    db.add(test)
    await db.commit()
    await db.refresh(test)

    return {
        "test_id": test.id,
        "self_reported_level": data.self_reported_level,
        "message": "已记录你的起点，等待老师分配学习内容",
    }


@student_router.get("/result")
async def get_placement_result(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """
    查询最新已完成/跳过的测评结果。
    未做过测评时返回 {"has_placement": false}，前端据此判断是否弹引导。
    """
    test = await svc.get_latest(db, current_user.id)
    if not test:
        return {"has_placement": False}
    return _format_result(test)


# ── 教师端 ────────────────────────────────────────────────────────────────────

@teacher_router.get("/placement/student/{student_id}")
async def teacher_get_student_placement(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """
    查看某学生最新摸底测评结果。
    包含：推荐起点、识别/拼写准确率、按档位得分、薄弱词清单、诊断建议。
    老师分配教材时参考 placement_difficulty 选择合适的书和起始单元。
    """
    await assert_student_in_my_class(db, current_user.id, student_id)

    test = await svc.get_latest(db, student_id)
    if not test:
        return {"has_placement": False, "student_id": student_id}

    result = _format_result(test)
    result["student_id"] = student_id
    return result


@teacher_router.get("/placement/student/{student_id}/plan")
async def teacher_get_student_plan(
    student_id: int,
    ai_narrative: bool = False,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """
    生成该学生的学习规划建议，给老师看。

    默认返回纯算法规划（即时）：
      phases            - 阶段规划（认知建立→拼写巩固→查缺补漏→综合提升）
      gap_remediation   - 漏洞诊断（哪些档有漏洞、补漏策略）
      teacher_actions   - 老师该做什么（按优先级排序的行动清单）
      recommended_book_hint - 推荐分配什么书
      daily_quota       - 每日推荐词数
      priority_modes    - 优先学习模式顺序

    加 ?ai_narrative=true 同时返回 AI 生成的人话叙述（200字以内）。
    AI 失败时只返回算法规划，不报错（ai_narrative 字段为 None）。
    """
    await assert_student_in_my_class(db, current_user.id, student_id)

    test = await svc.get_latest(db, student_id)
    if not test:
        return {
            "has_placement": False,
            "student_id": student_id,
            "message": "该学生尚未完成摸底测评，无法生成规划",
        }

    profile = json.loads(test.skill_profile_json or "{}")
    weak_words = json.loads(test.weak_words_json or "[]")

    plan = svc.build_study_plan(profile, weak_words)

    # 学生名字（AI 叙述用）
    student = (await db.execute(
        select(User).where(User.id == student_id)
    )).scalar_one_or_none()
    student_name = (student.full_name or student.username) if student else "该学生"

    # AI 叙述（可选）
    narrative = None
    if ai_narrative:
        narrative = await svc.build_ai_narrative(
            student_name, profile, plan, weak_words
        )

    return {
        "has_placement": True,
        "student_id": student_id,
        "student_name": student_name,
        "placement_difficulty": test.placement_difficulty,
        "placement_label": test.placement_label,
        "plan": plan,
        "ai_narrative": narrative,
    }


@teacher_router.get("/placement/class-overview")
async def teacher_class_placement_overview(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher),
):
    """
    班级新生摸底完成率总览（教师仪表板用）。

    返回：
      total_students      本班学生总数
      completed           已完成测评
      skipped             跳过测评（自报年级）
      pending             发起了但未提交
      not_started         从未开始
      completion_rate     完成率（completed + skipped）/ total
      distribution        各推荐起点的人数分布
        {"小学低段": 3, "初中入门": 5, ...}
      needs_action        需要老师处理的学生清单
        [{student_id, name, reason}]
        - 未测评的新生（提醒分配书）
        - 测评完成但还没有任何 BookAssignment（书还没开）
    """
    student_ids = await get_my_class_student_ids(db, current_user.id)
    if not student_ids:
        return {
            "total_students": 0,
            "completed": 0, "skipped": 0, "pending": 0, "not_started": 0,
            "completion_rate": 0.0,
            "distribution": {},
            "needs_action": [],
        }

    sid_list = list(student_ids)

    # ── 每个学生的最新测评（pending 也拿，用来区分已发起还是完全没开始）
    # 一次拉出所有相关行，Python 侧分组，避免 N 条子查询
    from sqlalchemy import case as sa_case
    rows = (await db.execute(
        select(
            PlacementTest.user_id,
            PlacementTest.status,
            PlacementTest.placement_difficulty,
            PlacementTest.placement_label,
            PlacementTest.completed_at,
        )
        .where(PlacementTest.user_id.in_(sid_list))
        .order_by(PlacementTest.user_id, PlacementTest.id.desc())
    )).all()

    # 每个学生只取最新一条
    latest: dict[int, dict] = {}
    for uid, status, diff, label, completed_at in rows:
        if uid not in latest:
            latest[uid] = {
                "status": status,
                "placement_difficulty": diff,
                "placement_label": label,
                "completed_at": completed_at,
            }

    # ── 统计
    completed = sum(1 for v in latest.values() if v["status"] == "completed")
    skipped   = sum(1 for v in latest.values() if v["status"] == "skipped")
    pending   = sum(1 for v in latest.values() if v["status"] == "pending")
    not_started = len(student_ids) - len(latest)

    total = len(student_ids)
    rate  = round((completed + skipped) / total, 3) if total else 0.0

    # ── 起点分布
    distribution: dict[str, int] = {}
    for v in latest.values():
        if v["status"] in ("completed", "skipped") and v["placement_label"]:
            distribution[v["placement_label"]] = \
                distribution.get(v["placement_label"], 0) + 1

    # ── 需要老师处理的学生
    # 拉学生基本信息（全班一次查）
    users = {
        u.id: u
        for u in (await db.execute(
            select(User).where(User.id.in_(sid_list))
        )).scalars().all()
    }

    # 有没有 BookAssignment（有的学生不再提示"书还没开"）
    from app.models.learning import BookAssignment
    assigned_sids = {
        sid for (sid,) in (await db.execute(
            select(BookAssignment.student_id)
            .where(BookAssignment.student_id.in_(sid_list))
            .distinct()
        )).all()
    }

    needs_action: list[dict] = []

    for sid in sid_list:
        u = users.get(sid)
        name = (u.full_name or u.username) if u else str(sid)
        info = latest.get(sid)

        if info is None:
            needs_action.append({
                "student_id": sid,
                "name": name,
                "reason": "尚未开始摸底测评，建议提醒学生完成（约3分钟）",
                "priority": 1,
            })
        elif info["status"] == "pending":
            needs_action.append({
                "student_id": sid,
                "name": name,
                "reason": "已开始摸底测评但未提交，可提醒学生完成",
                "priority": 2,
            })
        elif info["status"] in ("completed", "skipped") and sid not in assigned_sids:
            label = info.get("placement_label") or "对应年级"
            needs_action.append({
                "student_id": sid,
                "name": name,
                "reason": f"已完成测评（推荐起点：{label}），但还没有分配任何教材",
                "priority": 3,
            })

    # 按优先级排，同级按名字
    needs_action.sort(key=lambda x: (x["priority"], x["name"]))

    return {
        "total_students": total,
        "completed": completed,
        "skipped": skipped,
        "pending": pending,
        "not_started": not_started,
        "completion_rate": rate,
        "distribution": distribution,
        "needs_action": needs_action,
    }
