"""
测评漏斗 API - 匿名测评 → 深度报告 → 电话转化
"""
import uuid
import json
import logging
from fastapi import APIRouter, Depends, HTTPException, Query, File, Form, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, desc
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field

from app.core.database import get_db
from app.models.user import User
from app.models.word import Word, WordDefinition
from app.models.assessment import AssessmentLead
from app.api.v1.auth import get_current_teacher
from app.services.sms_service import code_store, send_sms_code
from app.services import iflytek_ise_service, whisper_service
from app.services.ai_service import ai_service

router = APIRouter()
logger = logging.getLogger(__name__)

MAX_AUDIO_SIZE = 5 * 1024 * 1024


# Schemas

class StartRequest(BaseModel):
    grade_level: str = Field("小学", description="年级: 小学/初中/高中")

class ReportRequest(BaseModel):
    session_id: str
    scores: list

class CapturePhoneRequest(BaseModel):
    session_id: str
    phone: str = Field(..., pattern=r"^1[3-9]\d{9}$")

class VerifyPhoneRequest(BaseModel):
    session_id: str
    phone: str
    code: str

class LeadNotesRequest(BaseModel):
    notes: Optional[str] = None
    converted: Optional[bool] = None


# 公开端点（无需登录）

@router.post("/start")
async def start_assessment(
    data: StartRequest,
    db: AsyncSession = Depends(get_db)
):
    """开始匿名测评，返回 session_id 和诊断单词"""
    session_id = str(uuid.uuid4())

    # 从词库抽取6个诊断词（2易+2中+2难）
    words = []
    for diff_min, diff_max, count in [(1, 2, 2), (3, 3, 2), (4, 5, 2)]:
        result = await db.execute(
            select(Word, WordDefinition)
            .outerjoin(WordDefinition, and_(
                WordDefinition.word_id == Word.id,
                WordDefinition.is_primary == True
            ))
            .where(Word.difficulty >= diff_min, Word.difficulty <= diff_max)
            .order_by(func.random())
            .limit(count)
        )
        for word, defn in result.all():
            words.append({
                "word_id": word.id,
                "word": word.word,
                "phonetic": word.phonetic,
                "meaning": defn.meaning if defn else None,
            })

    # 词库不够时补充
    if len(words) < 4:
        result = await db.execute(
            select(Word, WordDefinition)
            .outerjoin(WordDefinition, and_(
                WordDefinition.word_id == Word.id,
                WordDefinition.is_primary == True
            ))
            .order_by(func.random())
            .limit(6)
        )
        existing_ids = {w["word_id"] for w in words}
        for word, defn in result.all():
            if word.id not in existing_ids and len(words) < 6:
                words.append({
                    "word_id": word.id,
                    "word": word.word,
                    "phonetic": word.phonetic,
                    "meaning": defn.meaning if defn else None,
                })

    lead = AssessmentLead(session_id=session_id, grade_level=data.grade_level)
    db.add(lead)
    await db.commit()

    return {"session_id": session_id, "words": words, "total": len(words)}


@router.post("/evaluate")
async def evaluate_word(
    audio: UploadFile = File(...),
    word: str = Form(...),
    session_id: str = Form(...),
):
    """评测单个单词发音"""
    audio_data = await audio.read()
    if len(audio_data) > MAX_AUDIO_SIZE:
        raise HTTPException(400, "音频文件不能超过5MB")

    # 优先讯飞ISE
    try:
        scores = await iflytek_ise_service.evaluate(audio_data, word, "read_word")
        return {"success": True, "word": word, **scores}
    except RuntimeError as e:
        logger.warning(f"ISE评测失败，尝试Whisper: {e}")

    # Whisper fallback（只做语音识别，不评发音质量，分数上限50）
    if whisper_service.is_available():
        result = await whisper_service.verify_word(audio_data, word)
        whisper_score = min(result.get("score", 0) * 0.5, 50)
        return {
            "success": True, "word": word,
            "total_score": round(whisper_score, 1),
            "accuracy": round(whisper_score, 1),
            "fluency": 0, "integrity": 0,
            "note": "语音识别模式（讯飞ISE未配置，无法评测发音质量）",
        }

    raise HTTPException(500, "语音评测服务不可用")


@router.post("/report")
async def generate_report(
    data: ReportRequest,
    db: AsyncSession = Depends(get_db)
):
    """生成基础测评报告"""
    result = await db.execute(
        select(AssessmentLead).where(AssessmentLead.session_id == data.session_id)
    )
    lead = result.scalar_one_or_none()
    if not lead:
        raise HTTPException(404, "测评会话不存在")
    if not data.scores:
        raise HTTPException(400, "没有测评数据")

    avg_score = sum(s.get("total_score", 0) for s in data.scores) / len(data.scores)
    avg_accuracy = sum(s.get("accuracy", 0) for s in data.scores) / len(data.scores)
    avg_fluency = sum(s.get("fluency", 0) for s in data.scores) / len(data.scores)

    if avg_score >= 85:
        grade_label = "优秀"
    elif avg_score >= 70:
        grade_label = "良好"
    elif avg_score >= 50:
        grade_label = "需提升"
    else:
        grade_label = "薄弱"

    weak_areas = []
    if avg_accuracy < 60:
        weak_areas.append("发音准确度需要加强")
    if avg_fluency < 60:
        weak_areas.append("朗读流利度需要提升")
    weak_words = [s for s in data.scores if s.get("total_score", 0) < 60]
    if weak_words:
        weak_areas.append(f"有{len(weak_words)}个单词发音薄弱")

    lead.scores_json = json.dumps(data.scores, ensure_ascii=False)
    lead.avg_score = round(avg_score, 1)
    lead.avg_accuracy = round(avg_accuracy, 1)
    lead.avg_fluency = round(avg_fluency, 1)
    lead.weak_areas = json.dumps(weak_areas, ensure_ascii=False)
    lead.grade_label = grade_label
    await db.commit()

    return {
        "session_id": data.session_id,
        "avg_score": round(avg_score, 1),
        "avg_accuracy": round(avg_accuracy, 1),
        "avg_fluency": round(avg_fluency, 1),
        "grade_label": grade_label,
        "weak_areas": weak_areas,
        "scores": data.scores,
    }


@router.post("/capture-phone")
async def capture_phone(
    data: CapturePhoneRequest,
    db: AsyncSession = Depends(get_db)
):
    """发送验证码"""
    result = await db.execute(
        select(AssessmentLead).where(AssessmentLead.session_id == data.session_id)
    )
    if not result.scalar_one_or_none():
        raise HTTPException(404, "测评会话不存在")

    can, msg = code_store.can_send(data.phone)
    if not can:
        raise HTTPException(429, msg)

    code = code_store.generate_and_store(data.phone)
    success = await send_sms_code(data.phone, code)
    if not success:
        raise HTTPException(500, "短信发送失败")

    return {"message": "验证码已发送"}


@router.post("/verify-phone")
async def verify_phone(
    data: VerifyPhoneRequest,
    db: AsyncSession = Depends(get_db)
):
    """验证手机号，生成AI深度报告"""
    ok, msg = code_store.verify(data.phone, data.code)
    if not ok:
        raise HTTPException(400, msg)

    result = await db.execute(
        select(AssessmentLead).where(AssessmentLead.session_id == data.session_id)
    )
    lead = result.scalar_one_or_none()
    if not lead:
        raise HTTPException(404, "测评会话不存在")

    lead.phone = data.phone
    lead.phone_verified = True

    # AI 深度报告
    deep_report = _fallback_report(lead)
    try:
        scores = json.loads(lead.scores_json or "[]")
        weak_areas = json.loads(lead.weak_areas or "[]")

        prompt = f"""你是专业英语教学顾问。根据学生口语测评数据生成诊断报告。

测评数据：年级{lead.grade_level or '小学'}，平均{lead.avg_score}分，准确度{lead.avg_accuracy}，流利度{lead.avg_fluency}，评级{lead.grade_label}。
薄弱点：{', '.join(weak_areas)}
各词：{json.dumps(scores, ensure_ascii=False)}

返回JSON：{{"summary":"一句话总评","strengths":["优势2-3条"],"weaknesses":["薄弱点2-3条"],"suggestions":["具体建议3-5条"],"study_plan":"个性化学习计划100字","focus_words":["重点单词"]}}
只返回JSON。"""

        ai_result = await ai_service._call_llm(prompt, max_tokens=800)
        ai_result = ai_result.strip()
        if ai_result.startswith("```"):
            ai_result = ai_result.split("\n", 1)[1].rsplit("```", 1)[0]
        deep_report = json.loads(ai_result)
    except Exception as e:
        logger.warning(f"AI深度报告生成失败，使用兜底: {e}")

    lead.deep_report = json.dumps(deep_report, ensure_ascii=False)
    await db.commit()

    return {
        "session_id": data.session_id,
        "deep_report": deep_report,
        "avg_score": lead.avg_score,
        "grade_label": lead.grade_label,
    }


def _fallback_report(lead: AssessmentLead) -> dict:
    """AI不可用时的兜底报告"""
    scores = json.loads(lead.scores_json or "[]")
    return {
        "summary": f"孩子英语口语测评{lead.grade_label}，平均得分{lead.avg_score}分",
        "strengths": ["勇于开口朗读"],
        "weaknesses": json.loads(lead.weak_areas or "[]"),
        "suggestions": ["每天坚持朗读15分钟", "跟读标准发音注意模仿语调", "重点练习薄弱单词"],
        "study_plan": "建议每天练习15-20分钟，先从基础单词发音开始，逐步提升到句子朗读。",
        "focus_words": [s["word"] for s in scores if s.get("total_score", 0) < 60],
    }


# 教师端（需要认证）

@router.get("/leads")
async def get_leads(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    phone_only: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """获取测评线索列表"""
    query = select(AssessmentLead).order_by(desc(AssessmentLead.created_at))
    count_query = select(func.count(AssessmentLead.id))

    if phone_only:
        query = query.where(AssessmentLead.phone_verified == True)
        count_query = count_query.where(AssessmentLead.phone_verified == True)

    total = (await db.execute(count_query)).scalar() or 0

    # 聚合统计
    phone_count = (await db.execute(
        select(func.count(AssessmentLead.id)).where(AssessmentLead.phone_verified == True)
    )).scalar() or 0
    converted_count = (await db.execute(
        select(func.count(AssessmentLead.id)).where(AssessmentLead.converted == True)
    )).scalar() or 0

    leads = (await db.execute(
        query.offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()

    return {
        "total": total, "page": page, "page_size": page_size,
        "phone_count": phone_count, "converted_count": converted_count,
        "leads": [
            {
                "id": l.id,
                "session_id": l.session_id,
                "grade_level": l.grade_level,
                "avg_score": l.avg_score,
                "grade_label": l.grade_label,
                "phone": l.phone,
                "phone_verified": l.phone_verified,
                "converted": l.converted,
                "notes": l.notes,
                "created_at": l.created_at.isoformat() if l.created_at else None,
            }
            for l in leads
        ],
    }


@router.put("/leads/{lead_id}/notes")
async def update_lead_notes(
    lead_id: int,
    data: LeadNotesRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_teacher)
):
    """更新线索备注"""
    result = await db.execute(
        select(AssessmentLead).where(AssessmentLead.id == lead_id)
    )
    lead = result.scalar_one_or_none()
    if not lead:
        raise HTTPException(404, "线索不存在")

    if data.notes is not None:
        lead.notes = data.notes
    if data.converted is not None:
        lead.converted = data.converted
    await db.commit()
    return {"message": "更新成功"}
