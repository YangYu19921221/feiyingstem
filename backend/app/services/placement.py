"""
入学摸底测评服务

题型设计（共12题）：
  认知题（recognition）：每档2题，共10题。看英文单词选正确中文意思，4选1。
  拼写题（spelling）：第2、3档各1题，共2题。看中文意思写英文单词。
  拼写题放在第2、3档——最能暴露「认识但不会写」的典型问题，同时不让低年级学生
  一开始就遇到高难度拼写而直接放弃。

诊断逻辑：
  - band_score[d] = 该档认知题正确率（0.0–1.0）
  - solid_through_band = 最高的「认知题全对」档位；0=第一档就有漏洞
  - first_gap_band = 第一个「认知题有错」的档位；None=全对
  - recognition_accuracy = 认知总正确 / 认知总题数
  - spelling_accuracy = 拼写正确 / 拼写题数（0–2题）
  - placement_difficulty:
      从 solid_through_band + 1 开始，但拼写失败时下调1档；
      最低1，最高5

预埋掌握度（节省已知词的未来学习时间）：
  只走 mastery.apply_answer()，不手写字段，保持全站唯一写入口。
  认知答对 difficulty>=3：写一次正确 flashcard 答题（mastery_level 会升到1，
  review_stage 由 SRS 正常推进——不直接写 mastery_level=3，
  因为测评只是4选1识别，不代表真正掌握）。
"""
import json
import random
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy import select, func, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.word import Word, WordDefinition
from app.models.placement import PlacementTest
from app.services import mastery as mastery_svc

logger = logging.getLogger(__name__)

QUESTIONS_PER_BAND = 2       # 每档抽几道认知题
SPELL_BANDS = [2, 3]         # 哪几档出拼写题（每档1题）
DIFFICULTY_BANDS = [1, 2, 3, 4, 5]
DISTRACTORS = 3              # 干扰项数量

# 难度 → 人类标签
LABEL = {
    1: "小学低段",
    2: "小学高段",
    3: "初中入门",
    4: "初中进阶",
    5: "高中",
}


# ── 出题 ─────────────────────────────────────────────────────────────────────

async def _distractors_for(
    db: AsyncSession, word_id: int, diff: int, correct_meaning: str, n: int
) -> list[str]:
    """同档位或全库干扰释义，确保和正确答案不同。"""
    rows = (await db.execute(
        select(WordDefinition.meaning)
        .join(Word, Word.id == WordDefinition.word_id)
        .where(
            WordDefinition.is_primary == True,
            Word.id != word_id,
            Word.difficulty == diff,
        )
        .order_by(func.random())
        .limit(n * 3)
    )).scalars().all()

    pool = [m for m in rows if m and m.strip() != correct_meaning]
    if len(pool) < n:
        extra = (await db.execute(
            select(WordDefinition.meaning)
            .join(Word, Word.id == WordDefinition.word_id)
            .where(
                WordDefinition.is_primary == True,
                Word.id != word_id,
                WordDefinition.meaning.notin_(pool + [correct_meaning]),
            )
            .order_by(func.random())
            .limit(n - len(pool))
        )).scalars().all()
        pool += [m for m in extra if m]

    return pool[:n]


async def generate_questions(db: AsyncSession) -> list[dict]:
    """
    生成摸底题目列表。
    返回带 correct_index / correct_answer 的完整题目（服务端保留，下发时剔除）。
    """
    questions: list[dict] = []

    for diff in DIFFICULTY_BANDS:
        rows = (await db.execute(
            select(Word, WordDefinition)
            .join(WordDefinition, and_(
                WordDefinition.word_id == Word.id,
                WordDefinition.is_primary == True,
            ))
            .where(Word.difficulty == diff)
            .order_by(func.random())
            # 认知题2个 + 拼写题（若该档需要）1个，最多3个词
            .limit(QUESTIONS_PER_BAND + (1 if diff in SPELL_BANDS else 0))
        )).all()

        word_pool = list(rows)

        # ── 认知题 ──────────────────────────────────────────────────────────
        for word, defn in word_pool[:QUESTIONS_PER_BAND]:
            dist = await _distractors_for(db, word.id, diff, defn.meaning, DISTRACTORS)
            if len(dist) < 2:
                # 词库严重不足时退化成2选1，不直接失败
                dist = dist or ["（无选项）"]
            options = dist[:DISTRACTORS] + [defn.meaning]
            random.shuffle(options)
            questions.append({
                "word_id": word.id,
                "word": word.word,
                "phonetic": word.phonetic or "",
                "question_type": "recognition",
                "options": options,
                "correct_index": options.index(defn.meaning),
                "difficulty": diff,
            })

        # ── 拼写题 ──────────────────────────────────────────────────────────
        if diff in SPELL_BANDS and len(word_pool) > QUESTIONS_PER_BAND:
            spell_word, spell_defn = word_pool[QUESTIONS_PER_BAND]
            questions.append({
                "word_id": spell_word.id,
                "word": spell_word.word,
                "phonetic": spell_word.phonetic or "",
                "question_type": "spelling",
                "prompt": spell_defn.meaning,   # 给学生看中文
                "correct_answer": spell_word.word.lower().strip(),
                "difficulty": diff,
            })

    random.shuffle(questions)
    return questions


# ── 判分 & 画像 ───────────────────────────────────────────────────────────────

def build_skill_profile(answers: list[dict]) -> dict:
    """
    answers: [{difficulty, question_type, is_correct}, ...]
    返回 skill_profile dict，直接序列化进 DB。
    """
    band_right: dict[int, int] = {d: 0 for d in DIFFICULTY_BANDS}
    band_total: dict[int, int] = {d: 0 for d in DIFFICULTY_BANDS}
    spell_right = 0
    spell_total = 0

    for a in answers:
        d = a.get("difficulty", 1)
        qt = a.get("question_type", "recognition")
        ok = bool(a.get("is_correct"))
        if qt == "recognition":
            band_total[d] = band_total.get(d, 0) + 1
            if ok:
                band_right[d] = band_right.get(d, 0) + 1
        else:
            spell_total += 1
            if ok:
                spell_right += 1

    band_scores: dict[str, float] = {}
    for d in DIFFICULTY_BANDS:
        t = band_total.get(d, 0)
        band_scores[str(d)] = round(band_right[d] / t, 2) if t else 0.0

    # solid_through_band: 最高的「该档全对」档
    solid_through = 0
    for d in DIFFICULTY_BANDS:
        t = band_total.get(d, 0)
        if t > 0 and band_right[d] == t:
            solid_through = d
        else:
            break  # 中间有洞就停（连续掌握才算扎实）

    # first_gap_band: 第一个有错的档
    first_gap = None
    for d in DIFFICULTY_BANDS:
        t = band_total.get(d, 0)
        if t > 0 and band_right[d] < t:
            first_gap = d
            break

    # recognition_accuracy
    total_r = sum(band_total.values())
    total_ok = sum(band_right.values())
    rec_acc = round(total_ok / total_r, 2) if total_r else 0.0

    spell_acc = round(spell_right / spell_total, 2) if spell_total else None

    # placement: 从 solid_through+1 开始，拼写全错时下调
    placement = max(1, solid_through + 1)
    if spell_acc is not None and spell_acc < 0.5 and placement > 1:
        placement = max(1, placement - 1)
    placement = min(placement, 5)

    # 诊断文字
    recommendation = _build_recommendation(
        placement, solid_through, first_gap, rec_acc, spell_acc
    )

    return {
        "recognition_accuracy": rec_acc,
        "spelling_accuracy": spell_acc,
        "solid_through_band": solid_through,
        "first_gap_band": first_gap,
        "band_scores": band_scores,
        "placement_difficulty": placement,
        "placement_label": LABEL.get(placement, "小学低段"),
        "recommendation": recommendation,
    }


def _build_recommendation(
    placement: int,
    solid_through: int,
    first_gap: Optional[int],
    rec_acc: float,
    spell_acc: Optional[float],
) -> str:
    """生成一段具体的诊断建议文字，给老师和学生都能直接行动。"""
    parts: list[str] = []

    label_start = LABEL.get(placement, "小学低段")
    parts.append(f"建议从【{label_start}】词汇开始系统学习。")

    if solid_through >= 3:
        parts.append(f"认知测试显示 {LABEL[solid_through]} 以内单词基本认识，")
        parts.append("重点在于拼写与活用，建议跳过纯识别练习，直接进入听写巩固。")
    elif solid_through >= 1:
        parts.append(f"{LABEL[solid_through]} 以内单词有基础，")
        if first_gap:
            parts.append(f"从 {LABEL[first_gap]} 开始出现明显漏洞，需重点补齐。")
    else:
        parts.append("基础词汇尚不稳固，建议从最基础词汇配合图片和发音开始，")
        parts.append("不要急于拼写，先建立认知记忆。")

    if spell_acc is not None:
        if spell_acc >= 1.0:
            parts.append("拼写测试全部正确，说明不仅认识还会写，可以适当提速。")
        elif spell_acc >= 0.5:
            parts.append("拼写有部分错误，需要加强默写练习，建议每天安排5分钟听写。")
        else:
            parts.append("拼写测试较薄弱——认识但写不出是常见问题，"
                         "建议用「看中文写英文」的听写模式作为每日必练项目。")

    if rec_acc >= 0.9:
        parts.append("整体识别能力较强，提升空间在拼写准确率和语境运用。")
    elif rec_acc < 0.5:
        parts.append("需要先扩充词汇量再追求拼写，建议用闪卡模式多轮接触新词。")

    return "".join(parts)


# ── 掌握度预埋 ─────────────────────────────────────────────────────────────────

async def seed_known_words(
    db: AsyncSession, user_id: int, answers: list[dict]
) -> list[dict]:
    """
    认知题答对且 difficulty >= 3 → 通过 mastery.apply_answer() 预埋一次
    正确的 flashcard 记录（不直接写字段，走全站唯一写入口）。
    返回已预埋的词列表（供写入 known_words_json）。
    """
    seeded: list[dict] = []
    for a in answers:
        if (
            a.get("question_type") == "recognition"
            and a.get("is_correct")
            and a.get("difficulty", 0) >= 3
            and a.get("word_id")
        ):
            await mastery_svc.apply_answer(
                db, user_id, a["word_id"],
                learning_mode="flashcard",
                is_correct=True,
                advance_srs=True,
            )
            seeded.append({
                "word_id": a["word_id"],
                "word": a.get("word", ""),
                "difficulty": a["difficulty"],
            })
    if seeded:
        await db.flush()
    return seeded


# ── 查询 ──────────────────────────────────────────────────────────────────────

async def get_latest(
    db: AsyncSession, user_id: int
) -> Optional[PlacementTest]:
    """最新一条已完成/跳过的测评（pending 的不算）。"""
    return (await db.execute(
        select(PlacementTest)
        .where(
            PlacementTest.user_id == user_id,
            PlacementTest.status.in_(["completed", "skipped"]),
        )
        .order_by(PlacementTest.completed_at.desc())
        .limit(1)
    )).scalar_one_or_none()


# ── 学习规划 ──────────────────────────────────────────────────────────────────

# 每日推荐词数档位（根据识别准确率选）
_DAILY_QUOTA = [
    (0.85, 35),   # 强：35词/天
    (0.65, 25),   # 中：25词/天
    (0.0,  15),   # 弱：15词/天
]

# 难度档 → 推荐学习模式顺序
_MODE_SEQUENCE = {
    1: ["flashcard", "quiz"],               # 低段：先认识，不急着拼写
    2: ["flashcard", "quiz", "spelling"],   # 高段：认知+初步拼写
    3: ["flashcard", "spelling", "quiz", "fillblank"],
    4: ["spelling", "fillblank", "quiz"],   # 初中进阶：拼写优先
    5: ["spelling", "fillblank", "quiz"],
}

_STAGE_BOOK_HINT = {
    1: "小学低段（一至二年级）教材，如人教版 PEP 一年级上/下册",
    2: "小学中高段（三至六年级）教材，如人教版 PEP 三年级上册起",
    3: "初中入门教材，如人教版七年级上册",
    4: "初中进阶教材，如人教版八年级上/下册",
    5: "高中词汇教材，如人教版必修一起，或高考词汇专项",
}


def build_study_plan(profile: dict, weak_words: list[dict]) -> dict:
    """
    纯算法生成学习规划，即时返回，不调 LLM。

    返回结构：
    {
      phases: [{name, duration_weeks, goal, focus_modes, daily_quota}],
      gap_remediation: {needed, gap_bands, weak_word_count, strategy},
      teacher_actions: [{priority, action, reason}],
      recommended_book_hint: str,
      daily_quota: int,
    }
    """
    placement = profile.get("placement_difficulty", 1)
    solid = profile.get("solid_through_band", 0)
    first_gap = profile.get("first_gap_band")
    rec_acc = profile.get("recognition_accuracy", 0.0)
    spell_acc = profile.get("spelling_accuracy")   # None = 没有拼写题数据
    band_scores = profile.get("band_scores", {})

    # 每日推荐词数
    daily_quota = next(q for thresh, q in _DAILY_QUOTA if rec_acc >= thresh)

    # 拼写很弱时减量（写不出来硬堆数量只会挫折感）
    if spell_acc is not None and spell_acc < 0.5:
        daily_quota = max(15, daily_quota - 10)

    modes = _MODE_SEQUENCE.get(placement, ["flashcard", "quiz"])

    # ── 阶段规划 ──────────────────────────────────────────────────────────────
    phases = []

    # 第一阶段：认知建立
    phase1_weeks = 2 if rec_acc < 0.7 else 1
    phases.append({
        "name": "认知建立",
        "duration_weeks": phase1_weeks,
        "goal": f"认识 {LABEL.get(placement, '目标')} 词汇，建立词形-词义连接",
        "focus_modes": ["flashcard", "quiz"],
        "daily_quota": daily_quota,
        "note": "重点用闪卡反复接触新词，配合听读音频，不要急于拼写",
    })

    # 第二阶段：拼写巩固
    spell_weeks = 3 if (spell_acc is None or spell_acc < 0.5) else 2
    phases.append({
        "name": "拼写巩固",
        "duration_weeks": spell_weeks,
        "goal": "能听写出已认识的单词，错误率低于20%",
        "focus_modes": ["spelling", "fillblank"],
        "daily_quota": daily_quota,
        "note": "每天安排5分钟听写练习，错词当天重复3遍，不要一次堆太多新词",
    })

    # 第三阶段：查缺补漏（有漏洞时才有）
    gap_bands = [
        d for d in range(1, placement)
        if float(band_scores.get(str(d), 1.0)) < 1.0
    ]
    if gap_bands or weak_words:
        phases.append({
            "name": "查缺补漏",
            "duration_weeks": max(2, len(gap_bands) * 2),
            "goal": f"补齐 {'/'.join(LABEL[d] for d in gap_bands)} 词汇漏洞" if gap_bands
                    else "巩固测评中暴露的薄弱词",
            "focus_modes": ["spelling", "quiz", "fillblank"],
            "daily_quota": max(10, daily_quota // 2),
            "note": "和新词学习并行，补漏不超过当天总量的30%，避免打乱正课节奏",
        })

    # 第四阶段：综合提升
    phases.append({
        "name": "综合提升",
        "duration_weeks": 4,
        "goal": "在真实语境（例句/填空/阅读）中活用词汇，准确率稳定在85%以上",
        "focus_modes": ["fillblank", "quiz"],
        "daily_quota": min(daily_quota + 10, 50),
        "note": "词汇量打牢后可以适当加速，配合阅读理解强化语境记忆",
    })

    # ── 教师行动清单 ──────────────────────────────────────────────────────────
    teacher_actions = []

    teacher_actions.append({
        "priority": 1,
        "action": f"分配「{_STAGE_BOOK_HINT.get(placement, '对应年级')}」给该学生",
        "reason": f"摸底结果：推荐起点为{LABEL.get(placement, '对应档位')}，"
                  f"认知准确率 {int(rec_acc * 100)}%",
    })

    if spell_acc is not None and spell_acc < 0.5:
        teacher_actions.append({
            "priority": 2,
            "action": "在作业管理中将默认模式设为「听写（spelling）」",
            "reason": f"拼写测试准确率仅 {int((spell_acc or 0) * 100)}%，"
                      "认识但写不出是核心问题，需要加强听写训练",
        })

    if gap_bands:
        band_names = "、".join(LABEL[d] for d in gap_bands)
        teacher_actions.append({
            "priority": 3,
            "action": f"开启「查缺补漏」并分配 {band_names} 对应书目",
            "reason": f"这几档在测评中有漏洞（认知未全对），建议用 autopilot "
                      "30%补漏配额自动补齐，不需要老师每天手动安排",
        })

    if solid >= 3:
        teacher_actions.append({
            "priority": 4,
            "action": f"可以跳过 {LABEL.get(solid, '')} 以内词汇的闪卡阶段，直接从听写开始",
            "reason": f"测评显示 {LABEL.get(solid, '')} 以内单词认知已扎实，"
                      "重复闪卡是在浪费时间",
        })

    if weak_words:
        worst = sorted(weak_words, key=lambda w: w.get("difficulty", 0))[:5]
        worst_str = "、".join(w["word"] for w in worst)
        teacher_actions.append({
            "priority": 5,
            "action": f"重点关注这几个薄弱词的掌握情况：{worst_str}",
            "reason": "测评中答错，建议在错题集中优先处理，避免进入正式学习后反复出错",
        })

    return {
        "phases": phases,
        "gap_remediation": {
            "needed": bool(gap_bands or weak_words),
            "gap_bands": gap_bands,
            "gap_band_labels": [LABEL[d] for d in gap_bands],
            "weak_word_count": len(weak_words),
            "strategy": (
                "利用 autopilot 查缺补漏模式（30% 配额），系统自动安排，无需手动干预"
                if gap_bands else
                "当前无明显档位漏洞，重点关注薄弱词的听写巩固"
            ),
        },
        "teacher_actions": teacher_actions,
        "recommended_book_hint": _STAGE_BOOK_HINT.get(placement, ""),
        "daily_quota": daily_quota,
        "total_plan_weeks": sum(p["duration_weeks"] for p in phases),
        "priority_modes": modes,
    }


async def build_ai_narrative(
    student_name: str,
    profile: dict,
    plan: dict,
    weak_words: list[dict],
) -> str:
    """
    调 LLM 生成一段面向教师的人话规划叙述（500字以内）。
    失败时返回 None，调用方降级到 algorithmic plan。
    """
    from app.services.ai_service import ai_service

    placement_label = profile.get("placement_label", "")
    rec_pct = int(profile.get("recognition_accuracy", 0) * 100)
    spell_acc = profile.get("spelling_accuracy")
    spell_pct = int((spell_acc or 0) * 100) if spell_acc is not None else None
    solid = profile.get("solid_through_band", 0)
    first_gap = profile.get("first_gap_band")
    band_scores = profile.get("band_scores", {})
    weak_sample = "、".join(w["word"] for w in weak_words[:6])
    actions = "\n".join(
        f"  {a['priority']}. {a['action']}" for a in plan["teacher_actions"]
    )
    phases = "\n".join(
        f"  第{i+1}阶段（{p['duration_weeks']}周）：{p['name']} - {p['goal']}"
        for i, p in enumerate(plan["phases"])
    )

    prompt = f"""你是一位有15年经验的英语教学顾问，正在为班级老师写一份新学生的入学诊断与学习规划建议。

学生：{student_name}
摸底测评结果：
- 推荐起点：{placement_label}
- 单词认知准确率：{rec_pct}%{f'，拼写准确率：{spell_pct}%' if spell_pct is not None else '（拼写数据不足）'}
- 扎实程度：{LABEL.get(solid, '无') if solid else '第一档就有漏洞'}以内词汇认知稳固
- 第一个漏洞出现在：{LABEL.get(first_gap, '无明显漏洞') if first_gap else '无明显漏洞'}
- 各档得分：{', '.join(f'{LABEL.get(int(k), k)} {int(float(v)*100)}%' for k, v in band_scores.items())}
- 答错的词（部分）：{weak_sample or '无'}

算法规划：
{phases}

建议老师的行动：
{actions}

请用自然的中文写一段面向老师的规划建议，200字以内，要求：
1. 先说孩子目前的状态（优势和问题各一句）
2. 给出最重要的1-2个行动建议（具体到操作层面）
3. 说明预期效果（几周内能看到什么变化）
4. 语气专业但不刻板，像同事间交流

只输出建议文字，不要标题，不要编号。"""

    try:
        result = await ai_service._call_llm(prompt, max_tokens=400)
        return result.strip()
    except Exception as e:
        logger.warning(f"AI规划叙述生成失败: {e}")
        return None
