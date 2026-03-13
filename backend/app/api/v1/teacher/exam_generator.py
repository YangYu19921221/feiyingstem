"""
教师端 - AI智能试卷生成
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from app.core.database import get_db
from app.models.user import User
from app.models.word import Word, WordDefinition
from app.models.learning import WordMastery
from app.api.v1.auth import get_current_user, require_role
from app.schemas.exam import (
    GenerateExamRequest,
    GenerateExamResponse,
    StudentMistakeAnalysis,
    ExamPaperCreate,
    ExamPaperResponse,
    ExamQuestionBase
)
from app.services.ai_service import ai_service
from datetime import datetime
import json

router = APIRouter()


@router.post("/analyze-mistakes/{student_id}", response_model=StudentMistakeAnalysis)
async def analyze_student_mistakes(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("teacher"))
):
    """
    分析学生的错题情况

    教师可以查看学生的薄弱点,包括:
    - 错误最多的单词
    - 薄弱的题型
    - 推荐的题型分布
    - 推荐的难度
    """
    # 检查学生是否存在
    result = await db.execute(select(User).where(User.id == student_id, User.role == "student"))
    student = result.scalar_one_or_none()

    if not student:
        raise HTTPException(status_code=404, detail="学生不存在")

    # 获取学生的单词掌握度记录
    result = await db.execute(
        select(WordMastery, Word, WordDefinition)
        .join(Word, WordMastery.word_id == Word.id)
        .join(WordDefinition, Word.id == WordDefinition.word_id)
        .where(
            and_(
                WordMastery.user_id == student_id,
                WordMastery.wrong_count > 0,  # 只看有错误的单词
                WordDefinition.is_primary == True
            )
        )
        .order_by(WordMastery.wrong_count.desc())
    )

    records = result.all()

    if not records:
        # 如果没有错题记录,返回默认分析(参考正规试卷标准)
        return StudentMistakeAnalysis(
            total_words=0,
            weak_words=[],
            weak_question_types=[],
            recommended_distribution={
                "choice": 20,        # 选择题 20题
                "cloze_test": 10,    # 完形填空 10空
                "fill_blank": 10,    # 填空题 10题
                "spelling": 5,       # 拼写题 5题
                "reading": 15        # 阅读理解 15题
            },
            difficulty_level="easy",
            accuracy_rate=0
        )

    # 构建单词掌握度数据
    word_mastery_records = []
    for mastery, word, definition in records:
        word_mastery_records.append({
            "word": word.word,
            "meaning": definition.meaning,
            "wrong_count": mastery.wrong_count,
            "correct_count": mastery.correct_count,
            "quiz_correct": mastery.quiz_correct,
            "quiz_wrong": mastery.quiz_wrong,
            "spelling_correct": mastery.spelling_correct,
            "spelling_wrong": mastery.spelling_wrong,
            "fillblank_correct": mastery.fillblank_correct,
            "fillblank_wrong": mastery.fillblank_wrong,
        })

    # 调用AI服务进行分析
    analysis = await ai_service.analyze_student_mistakes(
        student_id=student_id,
        word_mastery_records=word_mastery_records
    )

    return StudentMistakeAnalysis(**analysis)


@router.post("/generate-exam", response_model=ExamPaperResponse)
async def generate_personalized_exam(
    request: GenerateExamRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("teacher"))
):
    """
    一键生成个性化试卷

    根据学生的错题情况,AI自动生成包含以下题型的试卷:
    - 选择题
    - 填空题
    - 拼写题
    - 阅读理解
    - 判断题(包含在选择题中)

    生成策略:
    1. 分析学生错题情况
    2. 确定薄弱单词和薄弱题型
    3. 智能分配题型比例
    4. AI生成高质量题目
    """
    # 检查学生是否存在
    result = await db.execute(
        select(User).where(User.id == request.student_id, User.role == "student")
    )
    student = result.scalar_one_or_none()

    if not student:
        raise HTTPException(status_code=404, detail="学生不存在")

    # 1. 分析学生错题情况
    result = await db.execute(
        select(WordMastery, Word, WordDefinition)
        .join(Word, WordMastery.word_id == Word.id)
        .join(WordDefinition, Word.id == WordDefinition.word_id)
        .where(
            and_(
                WordMastery.user_id == request.student_id,
                WordDefinition.is_primary == True
            )
        )
        .order_by(WordMastery.wrong_count.desc())
        .limit(30)  # 取最近的30个单词
    )

    records = result.all()

    if not records:
        raise HTTPException(status_code=400, detail="该学生还没有学习记录,无法生成个性化试卷")

    # 构建单词数据
    word_mastery_records = []
    for mastery, word, definition in records:
        word_mastery_records.append({
            "word": word.word,
            "meaning": definition.meaning,
            "wrong_count": mastery.wrong_count,
            "correct_count": mastery.correct_count,
            "quiz_correct": mastery.quiz_correct,
            "quiz_wrong": mastery.quiz_wrong,
            "spelling_correct": mastery.spelling_correct,
            "spelling_wrong": mastery.spelling_wrong,
            "fillblank_correct": mastery.fillblank_correct,
            "fillblank_wrong": mastery.fillblank_wrong,
        })

    # 进行错题分析
    analysis = await ai_service.analyze_student_mistakes(
        student_id=request.student_id,
        word_mastery_records=word_mastery_records
    )

    # 2. 确定题型分布
    distribution = request.custom_distribution or analysis["recommended_distribution"]

    # 确保题目总数正确
    if request.question_count:
        total = sum(distribution.values())
        if total != request.question_count:
            # 按比例调整
            ratio = request.question_count / total
            distribution = {k: max(1, int(v * ratio)) for k, v in distribution.items()}

    # 3. 确定难度
    difficulty = request.difficulty or analysis["difficulty_level"]

    # 4. 准备单词列表
    weak_words = analysis["weak_words"][:15]  # 取最薄弱的15个单词

    # 如果单词数量不足,从全部单词库中补充
    required_words = sum(distribution.values()) // 2  # 至少需要题目数的一半单词
    if len(weak_words) < required_words:
        # 获取所有单词
        all_words_result = await db.execute(
            select(Word, WordDefinition)
            .join(WordDefinition, Word.id == WordDefinition.word_id)
            .where(WordDefinition.is_primary == True)
            .limit(50)
        )
        all_words = all_words_result.all()

        # 补充单词(排除已有的)
        existing_word_texts = {w["word"] for w in weak_words}
        for word, definition in all_words:
            if word.word not in existing_word_texts:
                weak_words.append({
                    "word": word.word,
                    "meaning": definition.meaning,
                    "wrong_count": 0,
                    "correct_count": 0
                })
            if len(weak_words) >= required_words:
                break

    exam_data = await ai_service.generate_personalized_exam(
        student_name=student.full_name or student.username,
        weak_words=weak_words,
        question_distribution=distribution,
        difficulty=difficulty
    )

    # 5. 保存试卷到数据库
    from app.models.learning import ExamPaper, ExamQuestion

    # 创建试卷
    exam_paper = ExamPaper(
        user_id=request.student_id,
        title=exam_data["title"],
        description=exam_data.get("description", ""),
        total_score=exam_data["total_score"],
        generated_by_ai=True,
        generation_strategy=json.dumps({
            "analysis": analysis,
            "distribution": distribution,
            "difficulty": difficulty
        }, ensure_ascii=False)
    )

    db.add(exam_paper)
    await db.flush()  # 获取exam_paper.id

    # 创建题目
    for question in exam_data["questions"]:
        # 处理correct_answer字段
        correct_answer = question.get("correct_answer")
        if isinstance(correct_answer, dict):
            correct_answer = json.dumps(correct_answer, ensure_ascii=False)
        elif not isinstance(correct_answer, str):
            correct_answer = str(correct_answer) if correct_answer else ""

        # 处理content字段 - 完形填空可能没有
        question_text = question.get("content", "")

        # 处理options - 完形填空使用blanks结构
        options = question.get("options", [])
        if question.get("blanks"):
            options = {"blanks": question["blanks"]}

        # 处理阅读理解的passage
        if question.get("passage"):
            question_text = json.dumps({
                "content": question_text,
                "passage": question["passage"],
                "passage_id": question.get("passage_id"),
                "passage_title": question.get("passage_title")
            }, ensure_ascii=False)

        # 完形填空特殊处理
        if question.get("question_type") == "cloze_test" and question.get("passage"):
            question_text = json.dumps({
                "passage": question["passage"],
                "blanks": question.get("blanks", [])
            }, ensure_ascii=False)

        # 查找单词ID
        word_id = None
        if question.get("word"):
            word_result = await db.execute(
                select(Word.id).where(Word.word == question["word"])
            )
            word_obj = word_result.scalar_one_or_none()
            if word_obj:
                word_id = word_obj

        exam_question = ExamQuestion(
            paper_id=exam_paper.id,
            question_type=question["question_type"],
            word_id=word_id,
            question_text=question_text or "题目",
            options=json.dumps(options, ensure_ascii=False) if options else None,
            correct_answer=correct_answer or "-",
            score=question.get("score", 5),
            order_index=question["question_number"]
        )
        db.add(exam_question)

    await db.commit()
    await db.refresh(exam_paper)

    # 6. 返回结果
    return ExamPaperResponse(
        id=exam_paper.id,
        title=exam_paper.title,
        description=exam_paper.description or "",
        total_score=exam_paper.total_score,
        student_id=exam_paper.user_id,
        generated_by_ai=exam_paper.generated_by_ai,
        created_at=exam_paper.created_at,
        questions=[
            ExamQuestionBase(
                question_number=q["question_number"],
                question_type=q["question_type"],
                content=q.get("content", ""),  # 完形填空可能没有content字段
                correct_answer=q.get("correct_answer"),
                explanation=q.get("explanation"),
                score=q.get("score", 5),
                word=q.get("word"),
                options=q.get("options"),
                passage=q.get("passage"),
                blanks=q.get("blanks")  # 完形填空的blanks字段
            )
            for q in exam_data["questions"]
        ]
    )


@router.get("/exams/{exam_id}", response_model=ExamPaperResponse)
async def get_exam_paper(
    exam_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("teacher"))
):
    """
    获取试卷详情
    """
    from app.models.learning import ExamPaper, ExamQuestion

    result = await db.execute(
        select(ExamPaper).where(ExamPaper.id == exam_id)
    )
    exam_paper = result.scalar_one_or_none()

    if not exam_paper:
        raise HTTPException(status_code=404, detail="试卷不存在")

    # 获取试卷题目
    result = await db.execute(
        select(ExamQuestion)
        .where(ExamQuestion.paper_id == exam_id)
        .order_by(ExamQuestion.order_index)
    )
    questions = result.scalars().all()

    # 构建响应
    question_list = []
    for q in questions:
        # 先解析 options
        options = json.loads(q.options) if q.options else None
        correct_answer = q.correct_answer

        # 解析content和passage
        content = q.question_text
        passage = None
        passage_id = None
        passage_title = None
        blanks = None

        # 尝试解析JSON格式的question_text
        if q.question_text and q.question_text.startswith("{"):
            try:
                parsed = json.loads(q.question_text)
                if "passage" in parsed:
                    passage = parsed.get("passage")
                    passage_id = parsed.get("passage_id")
                    passage_title = parsed.get("passage_title")
                    content = parsed.get("content", "")
                if "blanks" in parsed:
                    blanks = parsed.get("blanks")
                    # 完形填空的content可能为空
                    if not content:
                        content = "请阅读短文，完成下列填空题"
            except json.JSONDecodeError:
                pass

        # 处理options - 如果是dict格式(完形填空)则提取blanks
        # 必须在构造 ExamQuestionBase 之前处理，否则 Pydantic 验证会失败
        if isinstance(options, dict):
            if "blanks" in options and not blanks:
                # 只有当 blanks 还没有被 question_text 设置时才从 options 中提取
                blanks = options.get("blanks")
            options = []  # 完形填空没有普通的 options，设置为空列表

        question_list.append(ExamQuestionBase(
            question_number=q.order_index,
            question_type=q.question_type,
            content=content,
            correct_answer=correct_answer,
            explanation=None,
            score=q.score,
            word=None,
            options=options,
            passage=passage,
            passage_id=passage_id,
            passage_title=passage_title,
            blanks=blanks
        ))

    return ExamPaperResponse(
        id=exam_paper.id,
        title=exam_paper.title,
        description=exam_paper.description or "",
        total_score=exam_paper.total_score,
        student_id=exam_paper.user_id,
        generated_by_ai=exam_paper.generated_by_ai,
        created_at=exam_paper.created_at,
        questions=question_list
    )


@router.get("/students/{student_id}/exams")
async def list_student_exams(
    student_id: int,
    skip: int = 0,
    limit: int = 20,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_role("teacher"))
):
    """
    获取学生的试卷列表
    """
    from app.models.learning import ExamPaper

    # 检查学生是否存在
    result = await db.execute(
        select(User).where(User.id == student_id, User.role == "student")
    )
    student = result.scalar_one_or_none()

    if not student:
        raise HTTPException(status_code=404, detail="学生不存在")

    # 获取试卷列表
    result = await db.execute(
        select(ExamPaper)
        .where(ExamPaper.user_id == student_id)
        .order_by(ExamPaper.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    exams = result.scalars().all()

    return {
        "total": len(exams),
        "exams": [
            {
                "id": exam.id,
                "title": exam.title,
                "description": exam.description,
                "total_score": exam.total_score,
                "generated_by_ai": exam.generated_by_ai,
                "created_at": exam.created_at
            }
            for exam in exams
        ]
    }
