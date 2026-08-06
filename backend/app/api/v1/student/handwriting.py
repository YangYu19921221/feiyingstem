"""
纸笔听写 - 拍照 AI 批改

流程:学生在 App 里听音频、在纸上按序号手写 → 整页拍一张照上传 →
视觉模型「盲转写」(不给标准答案,防止模型把错的脑补成对的) →
服务端逐题代码比对判分 → 返回逐词对错。
前端确认后走既有 /student/records 提交(learning_mode='handwriting'),
掌握度/学习日历/成就/幂等去重全部复用,本模块不写任何学习数据。

⚠️ 照片是未成年学生的手写内容,只在内存里过一遍即弃,禁止落盘 ——
尤其不能写进 UPLOAD_DIR(该目录经 /api/v1/files 公开无鉴权)。
"""
import base64
import json

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.auth import get_current_student
from app.core.database import get_db
from app.models.user import User
from app.models.word import Word
from app.services.ai_quota import check_and_consume
from app.services.ai_service import ai_service

router = APIRouter()

MAX_IMAGE_BYTES = 8 * 1024 * 1024   # 前端已压缩到 ≤1600px JPEG,正常几百 KB
MAX_WORDS = 100
ALLOWED_MIME = {"image/jpeg", "image/png", "image/webp"}


def _norm(s: str) -> str:
    """比对归一:小写、内部连续空格收敛、去首尾标点。词内的 ' 和 - 原样保留。"""
    s = " ".join((s or "").strip().lower().split())
    return s.strip(".,!?;:\"'()[]")


@router.post("/handwriting/grade")
async def grade_handwriting(
    image: UploadFile = File(...),
    word_ids: str = Form(...),  # JSON 数组,顺序即听写报词顺序
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_student),
):
    """批改一张听写答题纸:返回逐题对错与 AI 认出的内容,不落库不存图。"""
    # 1. 解析题目列表(标准拼写从库里取,不信前端传的答案)
    try:
        ids = [int(x) for x in json.loads(word_ids)]
    except (ValueError, TypeError, json.JSONDecodeError):
        raise HTTPException(status_code=422, detail="word_ids 格式错误")
    if not ids or len(ids) > MAX_WORDS:
        raise HTTPException(status_code=422, detail=f"题目数需在 1~{MAX_WORDS} 之间")

    result = await db.execute(select(Word.id, Word.word).where(Word.id.in_(ids)))
    word_map = {wid: text for wid, text in result.all()}
    if any(wid not in word_map for wid in ids):
        raise HTTPException(status_code=404, detail="部分单词不存在,请返回重新开始听写")

    # 2. 图片只进内存
    content = await image.read()
    if not content:
        raise HTTPException(status_code=422, detail="图片为空,请重新拍照")
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=413, detail="图片太大,请重拍(对准答题纸即可,不需要原图)")
    mime = image.content_type if image.content_type in ALLOWED_MIME else "image/jpeg"

    # 3. AI 限额:一次批改 = 一次视觉调用(拍糊重批也计次,20/天足够宽松)
    check_and_consume(current_user.id, "handwriting_grade", daily_limit=20)

    # 4. 盲转写 → 代码比对
    try:
        lines = await ai_service.transcribe_handwriting(
            base64.b64encode(content).decode(), mime, len(ids)
        )
    except ValueError as e:
        # 配置缺失是管理员的事,识别格式异常是要重拍,分开提示
        msg = str(e)
        if "未配置" in msg:
            raise HTTPException(status_code=503, detail=msg)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI 没认出这张照片,请光线充足、整页入镜后重拍",
        )
    except Exception as e:
        print(f"手写批改识别失败: user_id={current_user.id}, {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="AI 识别失败,请稍后重试或重拍",
        )

    written_by_n = {}
    for item in lines or []:
        try:
            written_by_n[int(item.get("n"))] = str(item.get("text") or "")
        except (ValueError, TypeError, AttributeError):
            continue

    results = []
    correct_count = 0
    for idx, wid in enumerate(ids, start=1):
        expected = word_map[wid]
        written = written_by_n.get(idx, "")
        is_correct = _norm(expected) != "" and _norm(written) == _norm(expected)
        if is_correct:
            correct_count += 1
        results.append({
            "word_id": wid,
            "word": expected,
            # 截断防御:AI 偶发把整行连中文提示一起抄下来,超长会撑爆
            # /records 的 user_answer(max_length=100)校验
            "written": written.strip()[:80],
            "is_correct": is_correct,
        })

    return {"results": results, "correct_count": correct_count, "total": len(ids)}
