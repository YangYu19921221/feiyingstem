"""
教师端 - 竞赛题目管理API
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import selectinload
from typing import List, Optional
import json

from app.core.database import get_db
from app.models.user import User
from app.models.competition import CompetitionQuestion, CompetitionQuestionOption
from app.models.word import Word
from app.schemas.competition_question import (
    CompetitionQuestionCreate,
    CompetitionQuestionUpdate,
    CompetitionQuestion as CompetitionQuestionSchema,
    CompetitionQuestionList,
    QuestionStatistics,
    AIGenerateQuestionRequest,
    AIGenerateQuestionResponse
)
from app.api.v1.auth import get_current_user
from app.services.ai_service import ai_service
from app.models.word import WordDefinition

router = APIRouter()


@router.post("/competition-questions", response_model=CompetitionQuestionSchema)
async def create_question(
    question: CompetitionQuestionCreate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """创建题目"""
    # 验证用户是教师
    if current_user.role != "teacher":
        raise HTTPException(status_code=403, detail="只有教师可以创建题目")

    # 验证题型
    valid_types = ['choice', 'fill_blank', 'spelling', 'reading']
    if question.question_type not in valid_types:
        raise HTTPException(status_code=400, detail=f"无效的题型,必须是: {', '.join(valid_types)}")

    # 验证难度
    valid_difficulties = ['easy', 'medium', 'hard']
    if question.difficulty not in valid_difficulties:
        raise HTTPException(status_code=400, detail=f"无效的难度,必须是: {', '.join(valid_difficulties)}")

    # 选择题必须有4个选项
    if question.question_type == 'choice' and (not question.options or len(question.options) != 4):
        raise HTTPException(status_code=400, detail="选择题必须有4个选项(A/B/C/D)")

    # 创建题目
    db_question = CompetitionQuestion(
        question_type=question.question_type,
        title=question.title,
        content=question.content,
        passage=question.passage,
        correct_answer=question.correct_answer,
        answer_explanation=question.answer_explanation,
        difficulty=question.difficulty,
        word_id=question.word_id,
        unit_id=question.unit_id,
        tags=question.tags,
        created_by=current_user.id,
        source=question.source
    )

    db.add(db_question)
    await db.flush()

    # 创建选项
    if question.options:
        for option_data in question.options:
            db_option = CompetitionQuestionOption(
                question_id=db_question.id,
                option_key=option_data.option_key,
                option_text=option_data.option_text,
                is_correct=option_data.is_correct,
                display_order=option_data.display_order
            )
            db.add(db_option)

    await db.commit()

    # 重新查询以加载关系
    query = select(CompetitionQuestion).options(
        selectinload(CompetitionQuestion.options)
    ).where(CompetitionQuestion.id == db_question.id)
    result = await db.execute(query)
    db_question = result.scalar_one()

    return db_question


@router.get("/competition-questions", response_model=CompetitionQuestionList)
async def get_questions(
    question_type: Optional[str] = None,
    difficulty: Optional[str] = None,
    word_id: Optional[int] = None,
    unit_id: Optional[int] = None,
    source: Optional[str] = None,
    is_active: Optional[bool] = None,
    search: Optional[str] = None,
    page: int = Query(1, ge=1),
    limit: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """获取题目列表"""
    # 验证用户是教师
    if current_user.role != "teacher":
        raise HTTPException(status_code=403, detail="只有教师可以查看题目")

    # 构建查询
    query = select(CompetitionQuestion).options(
        selectinload(CompetitionQuestion.options)
    ).where(
        CompetitionQuestion.created_by == current_user.id
    )

    # 筛选条件
    if question_type:
        query = query.where(CompetitionQuestion.question_type == question_type)
    if difficulty:
        query = query.where(CompetitionQuestion.difficulty == difficulty)
    if word_id:
        query = query.where(CompetitionQuestion.word_id == word_id)
    if unit_id:
        query = query.where(CompetitionQuestion.unit_id == unit_id)
    if source:
        query = query.where(CompetitionQuestion.source == source)
    if is_active is not None:
        query = query.where(CompetitionQuestion.is_active == is_active)

    # 搜索
    if search:
        query = query.where(
            or_(
                CompetitionQuestion.content.contains(search),
                CompetitionQuestion.title.contains(search)
            )
        )

    # 获取总数
    count_query = select(func.count()).select_from(query.subquery())
    total_result = await db.execute(count_query)
    total = total_result.scalar()

    # 分页
    query = query.order_by(CompetitionQuestion.created_at.desc())
    query = query.offset((page - 1) * limit).limit(limit)

    result = await db.execute(query)
    questions = result.scalars().all()

    return {
        "total": total,
        "questions": questions
    }


@router.get("/competition-questions/{question_id}", response_model=CompetitionQuestionSchema)
async def get_question(
    question_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """获取单个题目详情"""
    query = select(CompetitionQuestion).options(
        selectinload(CompetitionQuestion.options)
    ).where(
        CompetitionQuestion.id == question_id,
        CompetitionQuestion.created_by == current_user.id
    )
    result = await db.execute(query)
    question = result.scalar_one_or_none()

    if not question:
        raise HTTPException(status_code=404, detail="题目不存在")

    return question


@router.put("/competition-questions/{question_id}", response_model=CompetitionQuestionSchema)
async def update_question(
    question_id: int,
    question_update: CompetitionQuestionUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """更新题目"""
    # 获取题目
    query = select(CompetitionQuestion).where(
        CompetitionQuestion.id == question_id,
        CompetitionQuestion.created_by == current_user.id
    )
    result = await db.execute(query)
    db_question = result.scalar_one_or_none()

    if not db_question:
        raise HTTPException(status_code=404, detail="题目不存在")

    # 更新字段
    update_data = question_update.model_dump(exclude_unset=True)

    # 处理选项更新
    if 'options' in update_data:
        options_data = update_data.pop('options')
        # 删除旧选项
        delete_query = select(CompetitionQuestionOption).where(
            CompetitionQuestionOption.question_id == question_id
        )
        result = await db.execute(delete_query)
        old_options = result.scalars().all()
        for opt in old_options:
            await db.delete(opt)

        # 创建新选项
        if options_data:
            for option_data in options_data:
                db_option = CompetitionQuestionOption(
                    question_id=question_id,
                    option_key=option_data.option_key,
                    option_text=option_data.option_text,
                    is_correct=option_data.is_correct,
                    display_order=option_data.display_order
                )
                db.add(db_option)

    # 更新其他字段
    for field, value in update_data.items():
        setattr(db_question, field, value)

    await db.commit()

    # 重新查询以加载关系
    query = select(CompetitionQuestion).options(
        selectinload(CompetitionQuestion.options)
    ).where(CompetitionQuestion.id == question_id)
    result = await db.execute(query)
    db_question = result.scalar_one()

    return db_question


@router.delete("/competition-questions/{question_id}")
async def delete_question(
    question_id: int,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """删除题目"""
    query = select(CompetitionQuestion).where(
        CompetitionQuestion.id == question_id,
        CompetitionQuestion.created_by == current_user.id
    )
    result = await db.execute(query)
    db_question = result.scalar_one_or_none()

    if not db_question:
        raise HTTPException(status_code=404, detail="题目不存在")

    await db.delete(db_question)
    await db.commit()

    return {"message": "题目已删除"}


@router.post("/competition-questions/batch-delete")
async def batch_delete_questions(
    question_ids: List[int],
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """批量删除题目"""
    if current_user.role != "teacher":
        raise HTTPException(status_code=403, detail="只有教师可以删除题目")

    query = select(CompetitionQuestion).where(
        CompetitionQuestion.id.in_(question_ids),
        CompetitionQuestion.created_by == current_user.id
    )
    result = await db.execute(query)
    questions = result.scalars().all()

    deleted_count = len(questions)

    for question in questions:
        await db.delete(question)

    await db.commit()

    return {"message": f"已删除 {deleted_count} 道题目"}


@router.get("/competition-questions/statistics/overview", response_model=QuestionStatistics)
async def get_statistics(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """获取题目统计信息"""
    if current_user.role != "teacher":
        raise HTTPException(status_code=403, detail="只有教师可以查看统计")

    # 总题目数
    total_query = select(func.count()).select_from(CompetitionQuestion).where(
        CompetitionQuestion.created_by == current_user.id
    )
    total_result = await db.execute(total_query)
    total_questions = total_result.scalar()

    # 按题型统计
    type_query = select(
        CompetitionQuestion.question_type,
        func.count(CompetitionQuestion.id)
    ).where(
        CompetitionQuestion.created_by == current_user.id
    ).group_by(CompetitionQuestion.question_type)
    type_result = await db.execute(type_query)
    by_type = {row[0]: row[1] for row in type_result}

    # 按难度统计
    difficulty_query = select(
        CompetitionQuestion.difficulty,
        func.count(CompetitionQuestion.id)
    ).where(
        CompetitionQuestion.created_by == current_user.id
    ).group_by(CompetitionQuestion.difficulty)
    difficulty_result = await db.execute(difficulty_query)
    by_difficulty = {row[0]: row[1] for row in difficulty_result}

    # 按来源统计
    source_query = select(
        CompetitionQuestion.source,
        func.count(CompetitionQuestion.id)
    ).where(
        CompetitionQuestion.created_by == current_user.id
    ).group_by(CompetitionQuestion.source)
    source_result = await db.execute(source_query)
    by_source = {row[0]: row[1] for row in source_result}

    # 总答题次数
    attempts_query = select(
        func.sum(CompetitionQuestion.total_attempts)
    ).where(
        CompetitionQuestion.created_by == current_user.id
    )
    attempts_result = await db.execute(attempts_query)
    total_attempts = attempts_result.scalar() or 0

    # 平均正确率
    accuracy_query = select(
        func.sum(CompetitionQuestion.correct_count),
        func.sum(CompetitionQuestion.total_attempts)
    ).where(
        CompetitionQuestion.created_by == current_user.id,
        CompetitionQuestion.total_attempts > 0
    )
    accuracy_result = await db.execute(accuracy_query)
    correct_sum, attempts_sum = accuracy_result.one_or_none() or (0, 0)
    correct_sum = correct_sum or 0
    attempts_sum = attempts_sum or 0
    avg_accuracy = (correct_sum / attempts_sum * 100) if attempts_sum > 0 else 0.0

    return {
        "total_questions": total_questions,
        "by_type": by_type,
        "by_difficulty": by_difficulty,
        "by_source": by_source,
        "total_attempts": total_attempts,
        "avg_accuracy": round(avg_accuracy, 2)
    }


@router.post("/competition-questions/ai-generate", response_model=AIGenerateQuestionResponse)
async def ai_generate_questions(
    request: AIGenerateQuestionRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db)
):
    """AI生成题目"""
    if current_user.role != "teacher":
        raise HTTPException(status_code=403, detail="只有教师可以生成题目")

    # 获取单词列表
    word_ids = request.word_ids or []
    if request.unit_id:
        # 从单元获取单词
        from app.models.word import UnitWord
        query = select(UnitWord.word_id).where(UnitWord.unit_id == request.unit_id)
        result = await db.execute(query)
        word_ids.extend([row[0] for row in result])

    # 如果没有提供单词ID,从数据库随机选择单词
    if not word_ids:
        from sqlalchemy import func
        query = select(Word.id).order_by(func.random()).limit(request.count * 2)  # 多选一些以防某些单词没有释义
        result = await db.execute(query)
        word_ids = [row[0] for row in result]

        if not word_ids:
            raise HTTPException(status_code=400, detail="数据库中没有可用的单词,请先添加单词")

    # 获取单词信息
    query = select(Word).where(Word.id.in_(word_ids[:request.count]))
    result = await db.execute(query)
    words = result.scalars().all()

    generated_questions = []
    generated_count = 0

    for word in words:
        # 获取单词释义
        query = select(WordDefinition).where(WordDefinition.word_id == word.id).limit(1)
        result = await db.execute(query)
        definition = result.scalar_one_or_none()

        if not definition:
            continue

        # 为每个单词生成指定类型的题目
        for question_type in request.question_types:
            if generated_count >= request.count:
                break

            try:
                # 调用AI生成题目
                question_data = await ai_service.generate_competition_question(
                    word=word.word,
                    meaning=definition.meaning,
                    question_type=question_type,
                    difficulty=request.difficulty,
                    custom_prompt=request.custom_prompt
                )

                # 创建题目
                db_question = CompetitionQuestion(
                    question_type=question_data["question_type"],
                    title=question_data.get("title"),
                    content=question_data["content"],
                    passage=question_data.get("passage"),
                    correct_answer=question_data["correct_answer"],
                    answer_explanation=question_data["answer_explanation"],
                    difficulty=question_data["difficulty"],
                    word_id=word.id,
                    created_by=current_user.id,
                    source="ai"
                )

                db.add(db_question)
                await db.flush()

                # 创建选项(如果有)
                if question_data.get("options"):
                    for opt in question_data["options"]:
                        db_option = CompetitionQuestionOption(
                            question_id=db_question.id,
                            option_key=opt["key"],
                            option_text=opt["text"],
                            is_correct=opt.get("is_correct", False),
                            display_order=opt.get("display_order", 0)
                        )
                        db.add(db_option)

                await db.flush()

                # 重新查询以加载关系
                query = select(CompetitionQuestion).options(
                    selectinload(CompetitionQuestion.options)
                ).where(CompetitionQuestion.id == db_question.id)
                result = await db.execute(query)
                db_question = result.scalar_one()

                generated_questions.append(db_question)
                generated_count += 1

            except Exception as e:
                print(f"生成题目失败: {e}")
                continue

    await db.commit()

    return {
        "success": True,
        "generated_count": generated_count,
        "questions": generated_questions,
        "message": f"成功生成 {generated_count} 道题目"
    }
