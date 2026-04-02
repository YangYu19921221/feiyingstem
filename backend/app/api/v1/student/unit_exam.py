"""
单元考试API - 学完单元后的测验
题型：英译中(选择) + 中译英(选择) + 听写 + 拼写填空 + 例句填空
"""
import random
import uuid
import json
import time
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from pydantic import BaseModel, Field
from typing import List, Optional, Dict
from datetime import datetime

from app.core.database import get_db
from app.models.word import Word, Unit, UnitWord, WordDefinition
from app.models.user import User
from app.models.learning import (
    ExamPaper, ExamQuestion, ExamSubmission, ExamAnswer, WordMastery
)
from app.api.v1.auth import get_current_student

router = APIRouter()

# 内存缓存试题答案（带 TTL，生产环境应使用 Redis）
_exam_cache: Dict[str, dict] = {}
EXAM_CACHE_TTL = 1800  # 30分钟


def _cleanup_exam_cache():
    """清理过期的考试缓存"""
    now = time.time()
    expired = [k for k, v in _exam_cache.items() if now - v.get("created_at", 0) > EXAM_CACHE_TTL]
    for k in expired:
        del _exam_cache[k]


# ========== Schemas ==========

class ExamAnswer_(BaseModel):
    question_id: int
    answer: str


class ExamSubmitRequest(BaseModel):
    exam_id: str
    answers: List[ExamAnswer_]
    time_spent: int = Field(ge=0, description="用时(秒)")


# ========== 出题 ==========

@router.get("/generate/{unit_id}")
async def generate_exam(
    unit_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """为指定单元生成一份考试试卷"""
    # 1. 验证单元存在
    result = await db.execute(select(Unit).where(Unit.id == unit_id))
    unit = result.scalar_one_or_none()
    if not unit:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "单元不存在")

    # 2. 获取单元所有单词 + 释义
    result = await db.execute(
        select(Word, WordDefinition)
        .join(UnitWord, Word.id == UnitWord.word_id)
        .outerjoin(WordDefinition, and_(
            WordDefinition.word_id == Word.id,
            WordDefinition.is_primary == True
        ))
        .where(UnitWord.unit_id == unit_id)
        .order_by(UnitWord.order_index)
    )
    word_rows = result.all()

    if len(word_rows) < 4:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "单元单词数不足，至少需要4个单词")

    # 构造单词数据列表
    words_data = []
    for word, definition in word_rows:
        words_data.append({
            "id": word.id,
            "word": word.word,
            "phonetic": word.phonetic,
            "meaning": definition.meaning if definition else "",
            "part_of_speech": definition.part_of_speech if definition else "",
            "example_sentence": definition.example_sentence if definition else "",
            "example_translation": definition.example_translation if definition else "",
        })

    # 过滤掉没有释义的单词
    words_with_meaning = [w for w in words_data if w["meaning"]]
    words_with_sentence = [w for w in words_data if w["example_sentence"]]

    if len(words_with_meaning) < 4:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "有释义的单词不足4个")

    # 3. 按题型分配单词
    shuffled = list(words_with_meaning)
    random.shuffle(shuffled)

    # 根据单词数量动态调整题目数量
    total_words = len(words_with_meaning)
    en_to_cn_count = min(5, total_words)
    cn_to_en_count = min(5, total_words)
    listening_count = min(4, total_words)
    spelling_count = min(4, total_words)
    sentence_count = min(2, len(words_with_sentence))

    # 分配单词（允许重复使用，但尽量分散）
    def pick_words(count: int, pool: list) -> list:
        if count <= len(pool):
            return random.sample(pool, count)
        # 不够时循环取
        result = list(pool)
        random.shuffle(result)
        while len(result) < count:
            result.append(random.choice(pool))
        return result[:count]

    en_to_cn_words = pick_words(en_to_cn_count, words_with_meaning)
    cn_to_en_words = pick_words(cn_to_en_count, words_with_meaning)
    listening_words = pick_words(listening_count, words_with_meaning)
    spelling_words = pick_words(spelling_count, words_with_meaning)
    sentence_words = pick_words(sentence_count, words_with_sentence) if words_with_sentence else []

    # 4. 生成试题
    questions = []
    answer_map = {}  # question_id -> correct_answer
    q_id = 1

    # 英译中（选择）
    all_meanings = [w["meaning"] for w in words_with_meaning]
    for w in en_to_cn_words:
        distractors = [m for m in all_meanings if m != w["meaning"]]
        if len(distractors) < 3:
            distractors = all_meanings[:3]
        else:
            distractors = random.sample(distractors, 3)
        options = distractors + [w["meaning"]]
        random.shuffle(options)
        questions.append({
            "id": q_id, "type": "en_to_cn", "word_id": w["id"],
            "prompt": w["word"], "options": options, "score": 0,
        })
        answer_map[q_id] = w["meaning"]
        q_id += 1

    # 中译英（选择）
    all_words = [w["word"] for w in words_with_meaning]
    for w in cn_to_en_words:
        distractors = [wd for wd in all_words if wd != w["word"]]
        if len(distractors) < 3:
            distractors = all_words[:3]
        else:
            distractors = random.sample(distractors, 3)
        options = distractors + [w["word"]]
        random.shuffle(options)
        questions.append({
            "id": q_id, "type": "cn_to_en", "word_id": w["id"],
            "prompt": w["meaning"], "options": options, "score": 0,
        })
        answer_map[q_id] = w["word"]
        q_id += 1

    # 听写
    for w in listening_words:
        questions.append({
            "id": q_id, "type": "listening", "word_id": w["id"],
            "score": 0,
        })
        answer_map[q_id] = w["word"]
        q_id += 1

    # 拼写填空
    for w in spelling_words:
        word_text = w["word"]
        hint = word_text[0] + "_" * (len(word_text) - 1)
        questions.append({
            "id": q_id, "type": "spelling", "word_id": w["id"],
            "prompt": w["meaning"], "hint": hint, "word_length": len(word_text),
            "score": 0,
        })
        answer_map[q_id] = word_text
        q_id += 1

    # 例句填空
    for w in sentence_words:
        sentence = w["example_sentence"]
        # 将目标词替换为 ______
        blanked = sentence.replace(w["word"], "______")
        # 也处理首字母大写的情况
        blanked = blanked.replace(w["word"].capitalize(), "______")
        if blanked == sentence:
            # 没有成功替换，跳过
            continue
        questions.append({
            "id": q_id, "type": "sentence_fill", "word_id": w["id"],
            "prompt": blanked, "hint": w["meaning"],
            "score": 0,
        })
        answer_map[q_id] = w["word"]
        q_id += 1

    # 分配分数：总分 100，均匀分配到每道题
    if questions:
        base_score = 100 // len(questions)
        remainder = 100 - base_score * len(questions)
        for i, q in enumerate(questions):
            q["score"] = base_score + (1 if i < remainder else 0)

    total_score = 100

    # 5. 创建考试记录
    exam_id = str(uuid.uuid4())[:8]

    exam_paper = ExamPaper(
        user_id=current_user.id,
        title=f"{unit.name} 单元测验",
        description=f"共{len(questions)}题，总分{total_score}分",
        total_score=total_score,
        generated_by_ai=False,
    )
    db.add(exam_paper)
    await db.flush()

    # 保存题目到数据库
    for q in questions:
        eq = ExamQuestion(
            paper_id=exam_paper.id,
            question_type=q["type"],
            word_id=q.get("word_id"),
            question_text=json.dumps(q, ensure_ascii=False),
            options=json.dumps(q.get("options", []), ensure_ascii=False),
            correct_answer=answer_map[q["id"]],
            score=q["score"],
            order_index=q["id"],
        )
        db.add(eq)

    await db.commit()

    # 缓存答案（带时间戳）
    _cleanup_exam_cache()
    _exam_cache[exam_id] = {
        "paper_id": exam_paper.id,
        "answer_map": answer_map,
        "unit_id": unit_id,
        "created_at": time.time(),
    }

    return {
        "exam_id": exam_id,
        "paper_id": exam_paper.id,
        "unit_name": unit.name,
        "total_score": total_score,
        "time_limit": 900,  # 15分钟
        "question_count": len(questions),
        "questions": questions,
    }


# ========== 交卷 ==========

@router.post("/submit")
async def submit_exam(
    data: ExamSubmitRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """提交考试答案并判分"""
    # 获取试卷信息
    cached = _exam_cache.get(data.exam_id)
    if not cached:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "考试不存在或已过期")

    paper_id = cached["paper_id"]
    answer_map = cached["answer_map"]

    # 判分
    total_score = 0
    correct_count = 0
    wrong_word_ids = []
    details = []

    # 获取试题以查分值
    result = await db.execute(
        select(ExamQuestion).where(ExamQuestion.paper_id == paper_id).order_by(ExamQuestion.order_index)
    )
    db_questions = {q.order_index: q for q in result.scalars().all()}

    for ans in data.answers:
        correct_answer = answer_map.get(ans.question_id, "")
        db_q = db_questions.get(ans.question_id)
        score = db_q.score if db_q else 5

        # 判分（严格区分大小写）
        is_correct = ans.answer.strip() == correct_answer.strip()
        earned = score if is_correct else 0
        total_score += earned

        if is_correct:
            correct_count += 1
        elif db_q and db_q.word_id:
            wrong_word_ids.append(db_q.word_id)

        details.append({
            "question_id": ans.question_id,
            "type": db_q.question_type if db_q else "",
            "user_answer": ans.answer,
            "correct_answer": correct_answer,
            "is_correct": is_correct,
            "score": earned,
            "max_score": score,
            "word_id": db_q.word_id if db_q else None,
        })

    # 补充未作答的题
    answered_ids = {a.question_id for a in data.answers}
    for q_id, correct_answer in answer_map.items():
        if q_id not in answered_ids:
            db_q = db_questions.get(q_id)
            if db_q and db_q.word_id:
                wrong_word_ids.append(db_q.word_id)
            details.append({
                "question_id": q_id,
                "type": db_q.question_type if db_q else "",
                "user_answer": "",
                "correct_answer": correct_answer,
                "is_correct": False,
                "score": 0,
                "max_score": db_q.score if db_q else 5,
                "word_id": db_q.word_id if db_q else None,
            })

    max_score = sum(q.score for q in db_questions.values())
    total_questions = len(answer_map)
    accuracy = round(correct_count / total_questions * 100, 1) if total_questions > 0 else 0

    # 等级
    if accuracy >= 90:
        grade = "A"
    elif accuracy >= 80:
        grade = "B"
    elif accuracy >= 60:
        grade = "C"
    else:
        grade = "D"

    # 保存提交记录
    submission = ExamSubmission(
        paper_id=paper_id,
        user_id=current_user.id,
        score=total_score,
        total_score=max_score,
    )
    db.add(submission)
    await db.flush()

    # 保存答题详情
    for d in details:
        ea = ExamAnswer(
            submission_id=submission.id,
            question_id=next(
                (q.id for q in db_questions.values() if q.order_index == d["question_id"]),
                None
            ),
            user_answer=d["user_answer"],
            is_correct=d["is_correct"],
        )
        db.add(ea)

    # 更新错题的掌握度
    for word_id in set(wrong_word_ids):
        result = await db.execute(
            select(WordMastery).where(and_(
                WordMastery.user_id == current_user.id,
                WordMastery.word_id == word_id
            ))
        )
        mastery = result.scalar_one_or_none()
        if mastery:
            mastery.wrong_count += 1
            if mastery.mastery_level > 0:
                mastery.mastery_level = max(0, mastery.mastery_level - 1)

    await db.commit()

    # 清理缓存
    _exam_cache.pop(data.exam_id, None)

    # 按题型统计
    type_stats = {}
    for d in details:
        t = d["type"]
        if t not in type_stats:
            type_stats[t] = {"total": 0, "correct": 0}
        type_stats[t]["total"] += 1
        if d["is_correct"]:
            type_stats[t]["correct"] += 1

    return {
        "submission_id": submission.id,
        "paper_id": paper_id,
        "score": total_score,
        "max_score": max_score,
        "accuracy": accuracy,
        "grade": grade,
        "correct_count": correct_count,
        "total_questions": total_questions,
        "time_spent": data.time_spent,
        "type_stats": type_stats,
        "details": sorted(details, key=lambda d: d["question_id"]),
        "wrong_word_ids": list(set(wrong_word_ids)),
    }


# ========== AI 分析 ==========

@router.get("/result/{paper_id}/ai-analysis")
async def get_ai_analysis(
    paper_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student)
):
    """获取考试结果的AI分析"""
    # 获取提交记录
    result = await db.execute(
        select(ExamSubmission).where(and_(
            ExamSubmission.paper_id == paper_id,
            ExamSubmission.user_id == current_user.id
        )).order_by(ExamSubmission.submitted_at.desc())
    )
    submission = result.scalar_one_or_none()
    if not submission:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "未找到考试记录")

    # 获取答题详情
    result = await db.execute(
        select(ExamAnswer, ExamQuestion)
        .join(ExamQuestion, ExamAnswer.question_id == ExamQuestion.id)
        .where(ExamAnswer.submission_id == submission.id)
    )
    answer_rows = result.all()

    # 收集错题的 word_id
    wrong_answer_data = []
    wrong_word_ids = set()
    for answer, question in answer_rows:
        if not answer.is_correct and question.word_id:
            wrong_word_ids.add(question.word_id)
            wrong_answer_data.append((answer, question))

    # 批量查询所有错题单词（消除 N+1）
    word_map = {}
    if wrong_word_ids:
        word_result = await db.execute(
            select(Word, WordDefinition)
            .outerjoin(WordDefinition, and_(
                WordDefinition.word_id == Word.id,
                WordDefinition.is_primary == True
            ))
            .where(Word.id.in_(wrong_word_ids))
        )
        for word, defn in word_result.all():
            word_map[word.id] = (word, defn)

    wrong_words = []
    for answer, question in wrong_answer_data:
        row = word_map.get(question.word_id)
        if row:
            word, defn = row
            wrong_words.append({
                "word": word.word,
                "meaning": defn.meaning if defn else "",
                "question_type": question.question_type,
                "user_answer": answer.user_answer,
                "correct_answer": question.correct_answer,
            })

    # 调用 AI 分析
    from app.services.ai_service import ai_service

    learning_history = [
        {"word": w["word"], "is_correct": False, "time_spent": 0}
        for w in wrong_words
    ]
    analysis = await ai_service.analyze_weak_points(learning_history)

    # 错误类型归纳
    error_patterns = {}
    type_labels = {
        "en_to_cn": "英译中", "cn_to_en": "中译英",
        "listening": "听写", "spelling": "拼写",
        "sentence_fill": "句子填空",
    }
    for w in wrong_words:
        label = type_labels.get(w["question_type"], w["question_type"])
        error_patterns[label] = error_patterns.get(label, 0) + 1

    return {
        "score": submission.score,
        "total_score": submission.total_score,
        "wrong_words": wrong_words,
        "error_patterns": error_patterns,
        "analysis": analysis,
    }
