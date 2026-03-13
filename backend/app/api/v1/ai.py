"""
AI功能API
- 生成例句
- 生成选择题干扰项
- 生成试卷
- 分析薄弱点
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from pydantic import BaseModel, Field
from typing import List, Dict, Optional
import random
from app.core.database import get_db
from app.services.ai_service import ai_service
from app.models.word import Word, WordDefinition, Unit, UnitWord

router = APIRouter()

# ========================================
# 请求/响应模型
# ========================================

class GenerateExampleRequest(BaseModel):
    word: str = Field(..., description="单词")
    meaning: str = Field(..., description="中文释义")
    difficulty: str = Field("middle-school", description="难度等级")
    context: str = Field("daily life", description="场景")

class ExampleSentenceResponse(BaseModel):
    sentence: str
    translation: str

class GenerateDistractorsRequest(BaseModel):
    word: str
    correct_meaning: str
    count: int = Field(3, ge=2, le=4)

class ExplainMistakeRequest(BaseModel):
    word: str
    user_input: str
    error_type: str = Field("spelling", description="错误类型")

class GeneratePhoneticRequest(BaseModel):
    word: str = Field(..., description="英文单词")

class GeneratePhoneticResponse(BaseModel):
    word: str
    phonetic: str

class GenerateMeaningRequest(BaseModel):
    word: str = Field(..., description="英文单词")
    part_of_speech: str = Field("", description="词性 (可选)")

class GenerateMeaningResponse(BaseModel):
    word: str
    meaning: str
    part_of_speech: str

class GenerateCompleteRequest(BaseModel):
    word: str = Field(..., description="英文单词")
    part_of_speech: str = Field("n.", description="词性")
    existing_meanings: List[str] = Field(default=[], description="已有的释义列表,用于避免重复")

class GenerateCompleteResponse(BaseModel):
    word: str
    part_of_speech: str
    phonetic: str
    meaning: str
    example_sentence: str
    example_translation: str

class GenerateExamRequest(BaseModel):
    word_ids: List[int] = Field(..., min_items=5, description="单词ID列表")
    question_types: List[str] = Field(
        ["choice", "fill_blank", "spelling"],
        description="题型列表"
    )
    total_count: int = Field(20, ge=5, le=50, description="总题目数")

class ExamQuestion(BaseModel):
    type: str
    question: str
    options: Optional[List[str]] = None
    answer: str
    word_id: Optional[int] = None
    score: int = 5

class GenerateExamResponse(BaseModel):
    title: str
    questions: List[ExamQuestion]
    total_score: int

class AnalyzeWeakPointsRequest(BaseModel):
    user_id: int
    limit: int = Field(100, description="分析最近N条记录")

class WeakPointsAnalysis(BaseModel):
    weak_areas: List[str]
    suggestions: List[str]
    focus_words: List[str]
    accuracy: float

# ========================================
# AI功能接口
# ========================================

@router.post("/generate-example", response_model=ExampleSentenceResponse)
async def generate_example_sentence(
    request: GenerateExampleRequest
):
    """
    为单词生成例句
    - 适合中小学生水平
    - 自动缓存,减少API调用
    """
    result = await ai_service.generate_example_sentence(
        word=request.word,
        meaning=request.meaning,
        difficulty=request.difficulty,
        context=request.context
    )

    return ExampleSentenceResponse(**result)


@router.post("/generate-distractors", response_model=List[str])
async def generate_distractors(
    request: GenerateDistractorsRequest
):
    """
    生成选择题的干扰项
    返回错误选项列表
    """
    distractors = await ai_service.generate_distractors(
        word=request.word,
        correct_meaning=request.correct_meaning,
        count=request.count
    )

    return distractors


@router.post("/explain-mistake", response_model=Dict[str, str])
async def explain_mistake(
    request: ExplainMistakeRequest
):
    """
    解释学生的拼写错误
    提供学习建议
    """
    explanation = await ai_service.explain_mistake(
        word=request.word,
        user_input=request.user_input,
        error_type=request.error_type
    )

    return {"explanation": explanation}


@router.post("/generate-phonetic", response_model=GeneratePhoneticResponse)
async def generate_phonetic(
    request: GeneratePhoneticRequest
):
    """
    使用AI生成单词的国际音标
    - 返回标准IPA格式
    - 自动缓存结果
    """
    phonetic = await ai_service.generate_phonetic(word=request.word)

    return GeneratePhoneticResponse(
        word=request.word,
        phonetic=phonetic
    )


@router.post("/generate-meaning", response_model=GenerateMeaningResponse)
async def generate_meaning(
    request: GenerateMeaningRequest
):
    """
    使用AI生成单词的中文释义
    - 返回简洁的中文释义
    - 支持指定词性
    - 自动缓存结果
    """
    meaning = await ai_service.generate_meaning(
        word=request.word,
        part_of_speech=request.part_of_speech
    )

    return GenerateMeaningResponse(
        word=request.word,
        meaning=meaning,
        part_of_speech=request.part_of_speech
    )


@router.post("/generate-complete", response_model=GenerateCompleteResponse)
async def generate_complete(
    request: GenerateCompleteRequest
):
    """
    一键生成单词的完整信息
    - 音标 (IPA格式)
    - 中文释义
    - 例句
    - 例句翻译
    - 支持传入已有释义,避免重复生成
    """
    result = await ai_service.generate_complete_word_info(
        word=request.word,
        part_of_speech=request.part_of_speech,
        existing_meanings=request.existing_meanings
    )

    return GenerateCompleteResponse(
        word=request.word,
        part_of_speech=request.part_of_speech,
        phonetic=result.get("phonetic", ""),
        meaning=result.get("meaning", ""),
        example_sentence=result.get("example_sentence", ""),
        example_translation=result.get("example_translation", "")
    )


@router.post("/generate-exam", response_model=GenerateExamResponse)
async def generate_exam(
    request: GenerateExamRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    根据单词列表生成试卷
    - 支持多种题型
    - AI智能出题
    """
    # 获取单词信息
    result = await db.execute(
        select(Word).where(Word.id.in_(request.word_ids))
    )
    words = result.scalars().all()

    if len(words) < len(request.word_ids):
        raise HTTPException(status_code=404, detail="部分单词不存在")

    # 获取每个单词的释义
    word_data = []
    for word in words:
        def_result = await db.execute(
            select(WordDefinition)
            .where(WordDefinition.word_id == word.id)
            .order_by(WordDefinition.is_primary.desc())
            .limit(1)
        )
        definition = def_result.scalar_one_or_none()

        word_data.append({
            "id": word.id,
            "word": word.word,
            "meaning": definition.meaning if definition else "",
            "phonetic": word.phonetic,
            "difficulty": word.difficulty
        })

    # 调用AI生成题目
    questions = await ai_service.generate_exam_questions(
        words=word_data,
        question_types=request.question_types,
        total_count=request.total_count
    )

    if not questions:
        raise HTTPException(status_code=500, detail="AI生成试卷失败")

    # 计算总分
    total_score = sum(q.get("score", 5) for q in questions)

    return GenerateExamResponse(
        title=f"英语测试卷 - {len(words)}个单词",
        questions=[ExamQuestion(**q) for q in questions],
        total_score=total_score
    )


@router.post("/analyze-weak-points", response_model=WeakPointsAnalysis)
async def analyze_weak_points(
    request: AnalyzeWeakPointsRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    分析学生的薄弱点
    - 统计错误率
    - 找出需要重点复习的单词
    - 提供学习建议
    """
    from app.models.learning import LearningRecord

    # 获取学习记录
    result = await db.execute(
        select(LearningRecord, Word.word)
        .join(Word, Word.id == LearningRecord.word_id)
        .where(LearningRecord.user_id == request.user_id)
        .order_by(LearningRecord.created_at.desc())
        .limit(request.limit)
    )
    records = result.all()

    # 构建学习历史数据
    learning_history = [
        {
            "word": record.word,
            "is_correct": record.LearningRecord.is_correct,
            "time_spent": record.LearningRecord.time_spent,
            "learning_mode": record.LearningRecord.learning_mode
        }
        for record in records
    ]

    # 调用AI分析
    analysis = await ai_service.analyze_weak_points(learning_history)

    return WeakPointsAnalysis(**analysis)


@router.post("/batch-generate-examples/{word_id}")
async def batch_generate_examples_for_word(
    word_id: int,
    count: int = 3,
    db: AsyncSession = Depends(get_db)
):
    """
    为单词批量生成多个例句
    用于丰富单词库内容
    """
    result = await db.execute(select(Word).where(Word.id == word_id))
    word = result.scalar_one_or_none()

    if not word:
        raise HTTPException(status_code=404, detail="单词不存在")

    # 获取主要释义
    def_result = await db.execute(
        select(WordDefinition)
        .where(WordDefinition.word_id == word_id)
        .order_by(WordDefinition.is_primary.desc())
        .limit(1)
    )
    definition = def_result.scalar_one_or_none()

    if not definition:
        raise HTTPException(status_code=404, detail="单词无释义")

    # 生成多个例句
    examples = []
    contexts = ["daily life", "school", "family", "hobby"]

    for i in range(min(count, len(contexts))):
        example = await ai_service.generate_example_sentence(
            word=word.word,
            meaning=definition.meaning,
            difficulty=word.grade_level or "middle-school",
            context=contexts[i]
        )
        examples.append(example)

    return {"word": word.word, "examples": examples}


# ========================================
# 基于单元的AI练习题生成(新增)
# ========================================

class UnitQuizRequest(BaseModel):
    unit_id: int = Field(..., description="单元ID")
    question_count: int = Field(10, ge=5, le=20, description="题目数量")
    question_type: str = Field("choice", description="题型: choice/spelling/fillblank")

class QuizQuestion(BaseModel):
    word_id: int
    word: str
    question: str
    options: Optional[List[str]] = None
    correct_answer: str
    explanation: Optional[str] = None
    phonetic: Optional[str] = None
    meaning: Optional[str] = None

class UnitQuizResponse(BaseModel):
    unit_id: int
    unit_name: str
    questions: List[QuizQuestion]
    total_count: int

@router.post("/generate-unit-quiz", response_model=UnitQuizResponse)
async def generate_unit_quiz(
    request: UnitQuizRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    基于单元生成AI练习题
    - 题目只包含当前单元的单词
    - 支持选择题、拼写题、填空题
    """
    # 1. 验证单元是否存在
    result = await db.execute(select(Unit).where(Unit.id == request.unit_id))
    unit = result.scalar_one_or_none()

    if not unit:
        raise HTTPException(status_code=404, detail=f"单元ID {request.unit_id} 不存在")

    # 2. 获取单元的所有单词
    result = await db.execute(
        select(Word, WordDefinition, UnitWord.order_index)
        .join(UnitWord, Word.id == UnitWord.word_id)
        .outerjoin(WordDefinition, and_(
            WordDefinition.word_id == Word.id,
            WordDefinition.is_primary == True
        ))
        .where(UnitWord.unit_id == request.unit_id)
        .order_by(UnitWord.order_index)
    )
    word_rows = result.all()

    if not word_rows:
        raise HTTPException(
            status_code=400,
            detail=f"单元 '{unit.name}' 中没有单词,请先添加单词"
        )

    if len(word_rows) < 2:
        raise HTTPException(
            status_code=400,
            detail=f"单元单词数不足,至少需要2个单词才能生成练习题"
        )

    # 3. 组装单词数据
    unit_words = []
    for word, definition, order_idx in word_rows:
        unit_words.append({
            "id": word.id,
            "word": word.word,
            "phonetic": word.phonetic,
            "meaning": definition.meaning if definition else "",
            "part_of_speech": definition.part_of_speech if definition else "",
            "example": definition.example_sentence if definition else ""
        })

    # 4. 根据题型生成题目
    questions = []
    question_count = min(request.question_count, len(unit_words))

    # 随机选择单词(不重复)
    selected_words = random.sample(unit_words, question_count)

    if request.question_type == "choice":
        # 选择题: 看中文选英文
        for word_data in selected_words:
            # 从同单元其他单词中选3个作为干扰项
            other_words = [w for w in unit_words if w["id"] != word_data["id"]]
            distractors = random.sample(other_words, min(3, len(other_words)))

            # 如果干扰项不足3个,调用AI生成
            if len(distractors) < 3:
                ai_distractors = await ai_service.generate_distractors(
                    word=word_data["word"],
                    correct_meaning=word_data["meaning"],
                    count=3 - len(distractors)
                )
                # 补充干扰项
                for ai_dist in ai_distractors:
                    distractors.append({"word": ai_dist})

            # 组装选项
            options = [word_data["word"]] + [d["word"] for d in distractors]
            random.shuffle(options)

            questions.append(QuizQuestion(
                word_id=word_data["id"],
                word=word_data["word"],
                question=f"'{word_data['meaning']}' 的英文是?",
                options=options,
                correct_answer=word_data["word"],
                explanation=f"{word_data['word']} [{word_data['phonetic']}] {word_data['part_of_speech']} {word_data['meaning']}",
                phonetic=word_data.get("phonetic", ""),
                meaning=word_data.get("meaning", ""),
            ))

    elif request.question_type == "spelling":
        # 拼写题: 听音写词
        for word_data in selected_words:
            questions.append(QuizQuestion(
                word_id=word_data["id"],
                word=word_data["word"],
                question=f"请拼写单词: {word_data['meaning']} [{word_data['phonetic']}]",
                options=None,  # 拼写题没有选项
                correct_answer=word_data["word"],
                explanation=f"正确拼写: {word_data['word']}",
                phonetic=word_data.get("phonetic", ""),
                meaning=word_data.get("meaning", ""),
            ))

    elif request.question_type == "fillblank":
        # 填空题: 根据例句填空
        for word_data in selected_words:
            if not word_data["example"]:
                # 如果没有例句,调用AI生成
                example_data = await ai_service.generate_example_sentence(
                    word=word_data["word"],
                    meaning=word_data["meaning"],
                    difficulty=unit.book_id == 1 and "primary-school" or "middle-school"
                )
                example_sentence = example_data["sentence"]
            else:
                example_sentence = word_data["example"]

            # 将单词替换为下划线
            blanked_sentence = example_sentence.replace(word_data["word"], "______")
            blanked_sentence = blanked_sentence.replace(word_data["word"].capitalize(), "______")

            # 生成选项(正确答案+3个干扰项)
            other_words = [w for w in unit_words if w["id"] != word_data["id"]]
            distractors = random.sample(other_words, min(3, len(other_words)))
            options = [word_data["word"]] + [d["word"] for d in distractors]
            random.shuffle(options)

            questions.append(QuizQuestion(
                word_id=word_data["id"],
                word=word_data["word"],
                question=f"选择正确的单词填空:\n{blanked_sentence}",
                options=options,
                correct_answer=word_data["word"],
                explanation=f"完整句子: {example_sentence}",
                phonetic=word_data.get("phonetic", ""),
                meaning=word_data.get("meaning", ""),
            ))

    return UnitQuizResponse(
        unit_id=unit.id,
        unit_name=unit.name,
        questions=questions,
        total_count=len(questions)
    )


# ========================================
# 基于单词ID列表生成练习题(错题练习使用)
# ========================================

class QuizFromWordsRequest(BaseModel):
    word_ids: List[int] = Field(..., description="单词ID列表")
    question_count: int = Field(10, ge=1, le=50, description="题目数量")
    question_type: str = Field("choice", description="题型: choice/spelling/fillblank")

class QuizFromWordsResponse(BaseModel):
    questions: List[QuizQuestion]
    total_count: int

@router.post("/generate-quiz-from-words", response_model=QuizFromWordsResponse)
async def generate_quiz_from_words(
    request: QuizFromWordsRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    根据单词ID列表生成练习题
    - 用于错题本复习、自定义词表练习
    - 支持选择题、拼写题、填空题
    """
    if not request.word_ids:
        raise HTTPException(status_code=400, detail="单词ID列表不能为空")

    # 1. 获取单词信息
    result = await db.execute(
        select(Word, WordDefinition)
        .outerjoin(WordDefinition, and_(
            WordDefinition.word_id == Word.id,
            WordDefinition.is_primary == True
        ))
        .where(Word.id.in_(request.word_ids))
    )
    word_rows = result.all()

    if not word_rows:
        raise HTTPException(status_code=404, detail="未找到任何单词")

    # 2. 组装单词数据
    words_data = []
    for word, definition in word_rows:
        words_data.append({
            "id": word.id,
            "word": word.word,
            "phonetic": word.phonetic or "",
            "meaning": definition.meaning if definition else "",
            "part_of_speech": definition.part_of_speech if definition else "",
            "example": definition.example_sentence if definition else ""
        })

    # 选择题至少需要4个单词(1个正确答案+3个干扰项)
    if request.question_type == "choice" and len(words_data) < 4:
        # 如果单词数不足,使用AI生成干扰项
        pass  # 后续会处理

    # 3. 根据题型生成题目
    questions = []
    question_count = min(request.question_count, len(words_data))

    # 随机选择单词(不重复)
    selected_words = random.sample(words_data, question_count)

    if request.question_type == "choice":
        # 选择题: 看中文选英文
        for word_data in selected_words:
            # 从其他单词中选3个作为干扰项
            other_words = [w for w in words_data if w["id"] != word_data["id"]]

            if len(other_words) >= 3:
                distractors = random.sample(other_words, 3)
                distractor_words = [d["word"] for d in distractors]
            else:
                # 干扰项不足,调用AI生成
                distractor_words = [d["word"] for d in other_words]
                needed = 3 - len(distractor_words)
                if needed > 0:
                    ai_distractors = await ai_service.generate_distractors(
                        word=word_data["word"],
                        correct_meaning=word_data["meaning"],
                        count=needed
                    )
                    distractor_words.extend(ai_distractors)

            # 组装选项
            options = [word_data["word"]] + distractor_words
            random.shuffle(options)

            questions.append(QuizQuestion(
                word_id=word_data["id"],
                word=word_data["word"],
                question=f"'{word_data['meaning']}' 的英文是?",
                options=options,
                correct_answer=word_data["word"],
                explanation=f"{word_data['word']} [{word_data['phonetic']}] {word_data['part_of_speech']} {word_data['meaning']}",
                phonetic=word_data.get("phonetic", ""),
                meaning=word_data.get("meaning", ""),
            ))

    elif request.question_type == "spelling":
        # 拼写题: 听音写词
        for word_data in selected_words:
            questions.append(QuizQuestion(
                word_id=word_data["id"],
                word=word_data["word"],
                question=f"请拼写单词: {word_data['meaning']} [{word_data['phonetic']}]",
                options=None,
                correct_answer=word_data["word"],
                explanation=f"正确拼写: {word_data['word']}",
                phonetic=word_data.get("phonetic", ""),
                meaning=word_data.get("meaning", ""),
            ))

    elif request.question_type == "fillblank":
        # 填空题: 根据例句填空
        for word_data in selected_words:
            if not word_data["example"]:
                # 如果没有例句,调用AI生成
                example_data = await ai_service.generate_example_sentence(
                    word=word_data["word"],
                    meaning=word_data["meaning"],
                    difficulty="middle-school"
                )
                example_sentence = example_data["sentence"]
            else:
                example_sentence = word_data["example"]

            # 将单词替换为下划线
            blanked_sentence = example_sentence.replace(word_data["word"], "______")
            blanked_sentence = blanked_sentence.replace(word_data["word"].capitalize(), "______")

            # 生成选项(正确答案+3个干扰项)
            other_words = [w for w in words_data if w["id"] != word_data["id"]]
            if len(other_words) >= 3:
                distractors = random.sample(other_words, 3)
            else:
                distractors = other_words
            options = [word_data["word"]] + [d["word"] for d in distractors]
            random.shuffle(options)

            questions.append(QuizQuestion(
                word_id=word_data["id"],
                word=word_data["word"],
                question=f"选择正确的单词填空:\n{blanked_sentence}",
                options=options,
                correct_answer=word_data["word"],
                explanation=f"完整句子: {example_sentence}",
                phonetic=word_data.get("phonetic", ""),
                meaning=word_data.get("meaning", ""),
            ))

    return QuizFromWordsResponse(
        questions=questions,
        total_count=len(questions)
    )


# ========================================
# TTS语音合成接口
# ========================================

class TTSRequest(BaseModel):
    text: str = Field(..., description="要转换的文本", max_length=500)

@router.post("/tts")
async def text_to_speech(request: TTSRequest):
    """
    文字转语音 - 使用阿里云TTS
    返回MP3音频流
    """
    from fastapi.responses import Response

    try:
        audio_data = await ai_service.generate_speech(request.text)

        return Response(
            content=audio_data,
            media_type="audio/mpeg",
            headers={
                "Content-Disposition": f'inline; filename="tts.mp3"'
            }
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"语音合成失败: {str(e)}")
