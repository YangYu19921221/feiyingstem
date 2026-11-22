"""试卷库 + 专项小卷(唯一真源,2026-11-22)

用户 11-22「老师传高分高频的试卷,学生背单词出现薄弱,从试卷库匹配出卷子给学生做,也能打印下载」
→ 我给的方案「按题入库、按知识点和薄弱单词组卷、每天一小份、回头考」→「按你建议来,拆卷用 claude」。

## 规矩
1. **老师核对过的题才进题库**(status=approved)。答案错一个,系统就会把孩子做对的判成错。拆卷模型拿不准的标黄(flags),
   老师重点看黄的;没标黄的可以一键全部通过
2. **题只给上传的人所在机构用**(org_id 显式过滤,不押在隐式租户过滤上)。卷子多是买来的教辅,不跨机构共享
3. **一个孩子一天一份小卷**(paper_quizzes,第一次打开时挑好存下,当天不变)。默认 QUIZ_SIZE 题:
   - 刚开始(在题库里做过的题不到 COLD_START 道): 摸底,按题库里考得最多的知识点每个点一道,加几道考他薄弱单词的
   - 之后: 两个最该补的点(题库里考得多 × 他不会 × 老犯同一种错),第一个点带一道对比题(三单配「不加 s」);
     几道考他薄弱单词的(背单词里真错过、还没掌握的词);到期该回头考的点;一道混合题;不够再按优先级补
   - 难度挑「跳一跳够得着」的(按他现在的把握度,预计做对 TARGET_P 左右);同一道题不给同一个孩子出第二次;
     同一个点不连着出
   - 只用年级不高于他的卷子(年级 = 他设的 > 按在学的书推,推不出不限)
4. **答案只在服务器**: 发给孩子的题没有答案和讲解;每道题**只认第一次交的**,交了才告诉他对没对、错在哪(挂的错法)
5. **孩子的把握度按知识点记**(paper_kp_mastery,Elo 打分): 每答一题先算「按他现在的水平这题该有多大可能做对」,
   出乎意料地做对了加得多、意料之中加得少;四选一能蒙对,选择题做对加得少;
   题里有他还没掌握的单词、又做错了的,这次的错大半算在单词上(语法这边只记 WORD_DRAG_W);
   很久没碰的点把握度往回落;同一种错法犯 MISCONCEPTION 次以上算「老犯这种错」;做了不到 MIN_EVIDENCE 题写「还看不出」
6. **回头考**: 1 → 3 → 7 天(和小鹰老师笔记同一个口径);只有到期那天或以后做对才升一级,做错回到明天。
   升到第 2 级算「点亮」,第 3 级算「学会」
7. 不发金币、不进单词数和学习记录(learning_records)—— 那些口径十几处在用,别处的数不能因为这里变
8. 小卷可以布置成作业(content_homework kind=paper_quiz,一天一份,当天做完就算完成),算进「今天的任务」
"""
from __future__ import annotations

import json
import math
import random
from datetime import date, datetime, timedelta
from typing import Any, Iterable, Optional

from sqlalchemy import and_, case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.tenancy import DEFAULT_ORG_ID
from app.core.timeutil import local_today, utc_now
from app.models.learning import LearningRecord, WordMastery
from app.models.paper_bank import PaperAnswer, PaperDoc, PaperItem, PaperKpMastery, PaperQuiz
from app.models.system_config import SystemConfig
from app.models.user import User
from app.models.word import Word
from app.services import paper_kp as kpm
from app.services import paper_parse as pp

SETTINGS_KEY = "paper_bank_settings"
SCOPES = ("off", "hq", "all")
# 默认关着: 填好拆卷 Key、用真模型试拆一份没问题以后,平台管理员在管理端首页卡片里改成「只开直营」。
# 默认开着的话,别的会话从 main 构建上线时,老师会先看到一个还用不了的功能和公告
DEFAULT_SETTINGS = {"scope": "off", "daily_pages": 80, "daily_pages_all": 400, "quiz_size": 10}
SETTING_RANGES = {"daily_pages": (5, 400), "daily_pages_all": (20, 3000), "quiz_size": (5, 20)}

QUIZ_SIZE = 10
COLD_START = 6          # 题库里做过不到这么多题: 先摸底
MIN_BANK = 5            # 能出给他的题不到这么多: 不出小卷
MIN_EVIDENCE = 4        # 一个点做了不到这么多题: 写「还看不出」
MISCONCEPTION = 2
WORD_DRAG_W = 0.4
TARGET_P = 0.7
FORGET_DAYS = 45        # 多少天没碰,把握度落一半
LADDER = (1, 3, 7)      # 第 0→1、1→2、2→3 级之间隔几天
WEAK_WORDS_MAX = 80

LABELS = {"diagnose": "摸底", "weak_kp": "要补的点", "contrast": "对比着练", "weak_word": "没记牢的词",
          "review": "回头考", "mixed": "混合题", "fill": "多练一题"}


# ---------------------------------------------------------------- 设置 / 开放范围

async def get_settings(db: AsyncSession) -> dict:
    row = (await db.execute(select(SystemConfig).where(SystemConfig.config_key == SETTINGS_KEY))).scalar_one_or_none()
    out = dict(DEFAULT_SETTINGS)
    if row and row.config_value:
        try:
            data = json.loads(row.config_value)
        except ValueError:
            data = {}
        if isinstance(data, dict):
            if data.get("scope") in SCOPES:
                out["scope"] = data["scope"]
            for k, (lo, hi) in SETTING_RANGES.items():
                try:
                    v = int(data.get(k, out[k]))
                except (TypeError, ValueError):
                    continue
                if lo <= v <= hi:
                    out[k] = v
    return out


async def save_settings(db: AsyncSession, values: dict) -> dict:
    cur = await get_settings(db)
    if values.get("scope") in SCOPES:
        cur["scope"] = values["scope"]
    for k, (lo, hi) in SETTING_RANGES.items():
        if k in values and values[k] is not None:
            v = int(values[k])
            if not lo <= v <= hi:
                raise ValueError(f"{k} 要在 {lo}–{hi} 之间")
            cur[k] = v
    text = json.dumps(cur)
    row = (await db.execute(select(SystemConfig).where(SystemConfig.config_key == SETTINGS_KEY))).scalar_one_or_none()
    if row is None:
        db.add(SystemConfig(config_key=SETTINGS_KEY, config_value=text, config_type="json",
                            description="试卷库: 开放范围、每天能拆几页、小卷几题"))
    else:
        row.config_value = text
    await db.flush()
    return cur


def scope_allows(scope: str, org_id: Optional[int]) -> bool:
    if scope == "off":
        return False
    if scope == "all":
        return True
    return (org_id or DEFAULT_ORG_ID) == DEFAULT_ORG_ID


async def availability(db: AsyncSession, user: User) -> tuple[bool, str, dict]:
    s = await get_settings(db)
    if not scope_allows(s["scope"], user.org_id):
        return False, "试卷库还在试用,你们学校暂时没开放", s
    return True, "", s


# ---------------------------------------------------------------- 年级

GRADES = ("一年级", "二年级", "三年级", "四年级", "五年级", "六年级", "初一", "初二", "初三", "高一", "高二", "高三")
_GRADE_ALIASES = {"七年级": "初一", "八年级": "初二", "九年级": "初三"}


def norm_grade(g: Optional[str]) -> Optional[str]:
    g = (g or "").strip()
    g = _GRADE_ALIASES.get(g, g)
    return g if g in GRADES else None


def grade_rank(g: Optional[str]) -> Optional[int]:
    g = norm_grade(g)
    return GRADES.index(g) if g else None


async def student_grade(db: AsyncSession, user: User) -> Optional[str]:
    """孩子几年级: 他(或老师)设的 > 按最近在学的书推;推不出 None(不按年级挑题)"""
    from app.models.tutor import TutorPref
    from app.services import tutor_level as tl
    pref = await db.get(TutorPref, user.id)
    if pref is not None and norm_grade(pref.grade):
        return norm_grade(pref.grade)
    guess, _book, _band = await tl._book_guess(db, user.id)
    return norm_grade(guess)


# ---------------------------------------------------------------- 题: 给谁看什么

def public_item(it: PaperItem) -> dict:
    """发给孩子的: 没有答案、讲解、错法"""
    out = {"id": it.id, "kind": it.kind, "stem": it.stem, "base_word": it.base_word or "",
           "has_image": bool(it.needs_image)}
    if it.kind == "mc":
        out["options"] = list(it.options or [])
    else:
        out["blanks"] = max(1, (it.stem or "").count("___"))
    return out


def teacher_item(it: PaperItem) -> dict:
    kps = list(it.kps or [])
    return {
        "id": it.id, "doc_id": it.doc_id, "paper_title": it.paper_title or "", "section": it.section or "",
        "no": it.no or "", "kind": it.kind, "stem": it.stem, "options": list(it.options or []),
        "answer": it.answer, "alts": it.alts or [], "base_word": it.base_word or "", "explain": it.explain or "",
        "kps": kps, "kp_names": [kpm.BY_ID[k].name for k in kps if k in kpm.BY_ID],
        "wrong": it.wrong or {}, "traps": it.traps or [], "answer_source": it.answer_source or "ai",
        "flags": list(it.flags or []), "needs_image": bool(it.needs_image), "status": it.status,
        "page_no": it.page_no, "tile_idx": it.tile_idx, "y0": it.y0, "y1": it.y1,
        "test_words": it.test_words or [], "difficulty": round(it.difficulty or 0.0, 2),
        "n_answers": it.n_answers or 0, "n_correct": it.n_correct or 0, "grade": it.grade,
    }


def answer_text(it: PaperItem) -> str:
    if it.kind == "mc":
        L = it.answer or ""
        i = "ABCDEF".find(L)
        opt = (it.options or [])[i] if 0 <= i < len(it.options or []) else ""
        return f"{L}. {opt}" if L else ""
    return " / ".join(it.answer or [])


def doc_out(d: PaperDoc, counts: Optional[dict] = None) -> dict:
    c = counts or {}
    return {"id": d.id, "title": d.title, "grade": d.grade, "note": d.note or "", "file_name": d.file_name,
            "file_kind": d.file_kind, "pages": d.pages, "pages_done": d.pages_done, "status": d.status,
            "reason": d.reason or "", "skipped": d.skipped or [], "uploaded_by_name": d.uploaded_by_name or "",
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "finished_at": d.finished_at.isoformat() if d.finished_at else None,
            "item_count": c.get("total", 0), "approved": c.get("approved", 0), "pending": c.get("pending", 0),
            "rejected": c.get("rejected", 0), "flagged": c.get("flagged", 0),
            "tokens": (d.input_tokens or 0) + (d.output_tokens or 0)}


async def doc_counts(db: AsyncSession, doc_ids: list[int]) -> dict[int, dict]:
    if not doc_ids:
        return {}
    out: dict[int, dict] = {i: {"total": 0, "approved": 0, "pending": 0, "rejected": 0, "flagged": 0} for i in doc_ids}
    for did, status, flags in (await db.execute(select(PaperItem.doc_id, PaperItem.status, PaperItem.flags)
                                                .where(PaperItem.doc_id.in_(doc_ids)))).all():
        c = out[did]
        c["total"] += 1
        c[status] = c.get(status, 0) + 1
        if status == "pending" and flags:
            c["flagged"] += 1
    return out


# ---------------------------------------------------------------- 老师改题

class Invalid(Exception):
    """改得不对,message 给老师看"""


def validate_edit(it: PaperItem, data: dict) -> dict:
    """老师改一道题: 只改给了的字段(键在才改,显式分支),改完要能判分"""
    out: dict = {}
    if "stem" in data:
        stem = pp.norm_stem(pp._s(data["stem"], 700))
        if len(stem) < 3:
            raise Invalid("题目不能空着")
        out["stem"] = stem
    stem = out.get("stem", it.stem)
    if it.kind == "mc":
        opts = list(it.options or [])
        if "options" in data:
            opts = [pp._OPT_PREFIX.sub("", pp._s(o, 160)) for o in (data["options"] or [])]
            opts = [o for o in opts if o]
            if not 2 <= len(opts) <= 6:
                raise Invalid("选择题要有 2–6 个选项")
            out["options"] = opts
        if "answer" in data:
            L = str(data["answer"] or "").strip().upper()[:1]
            if not L or "ABCDEF".find(L) < 0 or "ABCDEF".index(L) >= len(opts):
                raise Invalid("答案要选一个选项")
            out["answer"] = L
        L = out.get("answer", it.answer)
        if not L or "ABCDEF".index(L) >= len(opts):
            raise Invalid("答案要选一个选项")
    else:
        blanks = stem.count("___")
        if blanks == 0:
            raise Invalid("题目里要有空(用 ___ 表示)")
        if "answer" in data:
            ans = data["answer"]
            if isinstance(ans, str):
                ans = [a for a in (x.strip() for x in ans.split("/")) if a] if blanks > 1 else [ans.strip()]
            ans = [pp._s(a, 60) for a in (ans or []) if pp._s(a, 60)]
            out["answer"] = ans
        ans = out.get("answer", it.answer) or []
        if len(ans) != blanks:
            raise Invalid(f"有 {blanks} 个空,要填 {blanks} 个答案")
        if "alts" in data:
            alts = []
            for a in (data["alts"] or [])[:blanks]:
                if isinstance(a, str):
                    a = [x.strip() for x in a.split("/")]
                alts.append([pp._s(x, 60) for x in (a or []) if pp._s(x, 60)][:4])
            while len(alts) < blanks:
                alts.append([])
            out["alts"] = alts
        if "base_word" in data:
            out["base_word"] = pp._s(data["base_word"], 40) or None
    if "explain" in data:
        out["explain"] = pp._s(data["explain"], 160)
    if "kps" in data:
        kps = kpm.clean_kps(data["kps"])
        if not kps:
            raise Invalid("至少选一个知识点")
        out["kps"] = kps
    if "needs_image" in data:
        out["needs_image"] = bool(data["needs_image"])
    return out


def retag(it: PaperItem) -> None:
    x = {"kind": it.kind, "stem": it.stem, "options": it.options, "answer": it.answer, "base_word": it.base_word}
    it.test_words, it.context_words = pp.tag_words(x)


# ---------------------------------------------------------------- 判分

def _canon(s: Any) -> str:
    from app.services.homework_check import _canon as hc_canon
    return hc_canon(s)


def grade(it: PaperItem, given: Any) -> tuple[bool, Optional[str], str, str]:
    """(对不对, 错法 code, 选它错在哪, 孩子交的原样文字)。大小写、首尾空格、弯撇号、句末标点、缩写和全写不算错"""
    if it.kind == "mc":
        L = str(given if not isinstance(given, list) else (given[0] if given else "")).strip().upper()[:1]
        if L == (it.answer or "").upper():
            return True, None, "", L
        info = (it.wrong or {}).get(L) or {}
        return False, info.get("code") or kpm.OTHER, info.get("why") or "", L
    vals = given if isinstance(given, list) else [given]
    vals = [str(v or "") for v in vals]
    answers = list(it.answer or [])
    alts = list(it.alts or [])
    ok = len(vals) == len(answers) and all(
        _canon(v) and _canon(v) in {_canon(a) for a in [answers[i], *(alts[i] if i < len(alts) else [])]}
        for i, v in enumerate(vals))
    shown = " / ".join(v.strip() for v in vals)[:200]
    if ok:
        return True, None, "", shown
    for t in it.traps or []:
        if any(_canon(v) == _canon(t.get("text")) for v in vals):
            return False, t.get("code") or kpm.OTHER, t.get("why") or "", shown
    return False, kpm.OTHER, "", shown


# ---------------------------------------------------------------- 孩子的把握度

def _sig(x: float) -> float:
    return 1.0 / (1.0 + math.exp(-x))


def _days_since(dt: Optional[datetime], now: datetime) -> float:
    if dt is None:
        return 0.0
    return max(0.0, (now - dt).total_seconds() / 86400)


def theta_now(m: PaperKpMastery, now: datetime) -> float:
    """很久没碰的点往回落: 每 FORGET_DAYS 天落一半"""
    return (m.theta or 0.0) * (0.5 ** (_days_since(m.last_at, now) / FORGET_DAYS))


def guess_rate(it: PaperItem) -> float:
    if it.kind == "mc":
        return 1.0 / max(2, len(it.options or []))
    return 0.0


def p_correct(theta: float, it: PaperItem) -> float:
    c = guess_rate(it)
    return c + (1 - c) * _sig(theta - (it.difficulty or 0.0))


def _ladder_next(stage: int, due: Optional[str], ok: bool, today: date) -> tuple[int, str]:
    """回头考: 1 → 3 → 7 天;到期那天或以后做对才升级,做错回到明天"""
    if not ok:
        return 0, (today + timedelta(days=1)).isoformat()
    if due is None:
        return 1, (today + timedelta(days=LADDER[1])).isoformat()
    if today >= date.fromisoformat(due):
        nxt = min(3, stage + 1)
        gap = LADDER[min(nxt, len(LADDER) - 1)] if nxt < 3 else 14
        return nxt, (today + timedelta(days=gap)).isoformat()
    return stage, due


async def mastery_of(db: AsyncSession, user_id: int) -> dict[str, PaperKpMastery]:
    return {m.kp: m for m in (await db.execute(select(PaperKpMastery).where(PaperKpMastery.user_id == user_id))).scalars()}


async def apply_answer(db: AsyncSession, user_id: int, it: PaperItem, ok: bool, code: Optional[str],
                       drag: bool, now: Optional[datetime] = None, today: Optional[date] = None) -> float:
    """把一次作答记进他的把握度和这道题的难度;返回作答前「该有多大可能做对」"""
    now = now or utc_now()
    today = today or local_today()
    kps = kpm.diagnostic(it.kps)
    have = await mastery_of(db, user_id)
    rows = []
    for k in kps:
        m = have.get(k)
        if m is None:
            m = PaperKpMastery(user_id=user_id, kp=k, theta=0.0, n=0, right=0, stage=0, due=None, codes={})
            db.add(m)
        rows.append(m)
    theta = sum(theta_now(m, now) for m in rows) / len(rows) if rows else 0.0
    p = p_correct(theta, it)
    r = 1.0 if ok else 0.0
    w = WORD_DRAG_W if (drag and not ok) else 1.0
    for i, m in enumerate(rows):
        share = 1.0 if i == 0 else 0.5
        k_fac = 1.0 / (1.0 + 0.15 * (m.n or 0))
        m.theta = theta_now(m, now) + k_fac * share * w * (r - p)
        m.n = (m.n or 0) + 1
        m.right = (m.right or 0) + (1 if ok else 0)
        if not ok and code and code != kpm.OTHER and code in kpm.BY_ID[m.kp].codes:
            codes = dict(m.codes or {})
            codes[code] = codes.get(code, 0) + 1
            m.codes = codes
        if i == 0 or ok is False:
            m.stage, m.due = _ladder_next(m.stage or 0, m.due, ok, today)
        m.last_at = now
    ki = 0.3 / (1.0 + 0.02 * (it.n_answers or 0))
    it.difficulty = (it.difficulty or 0.0) - ki * (r - p)
    it.n_answers = (it.n_answers or 0) + 1
    it.n_correct = (it.n_correct or 0) + (1 if ok else 0)
    return p


def kp_state(m: Optional[PaperKpMastery], now: datetime) -> dict:
    """一个点现在怎么样(老师、孩子看的同一份)。p = 做一道中等难度的填空大概能对几成"""
    if m is None or (m.n or 0) == 0:
        return {"n": 0, "p": None, "level": "none", "label": "还没做过", "stage": 0, "due": None, "misconceptions": []}
    p = _sig(theta_now(m, now))
    mis = [{"code": c, "label": kpm.code_label(c), "count": n} for c, n in sorted((m.codes or {}).items(),
                                                                               key=lambda x: -x[1]) if n >= MISCONCEPTION]
    if (m.n or 0) < MIN_EVIDENCE:
        level, label = "unknown", "还看不出"
    elif p >= 0.8:
        level, label = "good", "掌握得不错"
    elif p >= 0.6:
        level, label = "shaky", "还不稳"
    else:
        level, label = "weak", "要补"
    return {"n": m.n, "right": m.right, "p": round(p, 2), "level": level, "label": label, "stage": m.stage or 0,
            "due": m.due, "misconceptions": mis}


# ---------------------------------------------------------------- 薄弱单词(背单词那边的口径)

async def weak_word_stems(db: AsyncSession, user_id: int, limit: int = WEAK_WORDS_MAX) -> dict[str, str]:
    """{词干: 原拼写}: 掌握度 < 3 且在计分模式里真答错过的词(services/weak_words 同一个口径),错得多的在前"""
    from app.services.weak_words import MASTERY_LINE, SCORING_MODES
    wrong = func.sum(case((LearningRecord.is_correct == False, 1), else_=0))  # noqa: E712
    rows = (await db.execute(
        select(func.lower(Word.word), wrong)
        .select_from(LearningRecord).join(Word, Word.id == LearningRecord.word_id)
        .where(LearningRecord.user_id == user_id, LearningRecord.learning_mode.in_(SCORING_MODES))
        .group_by(func.lower(Word.word)).having(wrong > 0).order_by(wrong.desc()).limit(limit * 3)
    )).all()
    if not rows:
        return {}
    mastered = {sp for (sp,) in (await db.execute(
        select(func.lower(Word.word)).select_from(WordMastery).join(Word, Word.id == WordMastery.word_id)
        .where(WordMastery.user_id == user_id, WordMastery.mastery_level >= MASTERY_LINE)
        .where(func.lower(Word.word).in_([r[0] for r in rows]))
    )).all()}
    out: dict[str, str] = {}
    for sp, _n in rows:
        if sp in mastered or " " in (sp or "").strip():
            continue
        for st in pp.content_stems(sp):
            out.setdefault(st, sp)
        if len(out) >= limit:
            break
    return out


# ---------------------------------------------------------------- 组卷

async def candidates(db: AsyncSession, org_id: Optional[int], max_rank: Optional[int]) -> list[PaperItem]:
    """这个机构题库里能出的题(核对通过、卷子没删、年级不高于他)"""
    q = (select(PaperItem).join(PaperDoc, PaperDoc.id == PaperItem.doc_id)
         .where(PaperItem.status == "approved", PaperDoc.status != "deleted"))
    q = q.where(PaperItem.org_id.is_(None) if org_id is None else PaperItem.org_id == org_id)
    rows = list((await db.execute(q)).scalars())
    out = []
    for it in rows:
        if not kpm.diagnostic(it.kps):
            continue
        if max_rank is not None:
            r = grade_rank(it.grade)
            if r is not None and r > max_rank:
                continue
        out.append(it)
    return out


async def answered_ids(db: AsyncSession, user_id: int) -> set[int]:
    return {i for (i,) in (await db.execute(select(PaperAnswer.item_id).where(PaperAnswer.user_id == user_id))).all()}


def _primary(it: PaperItem) -> str:
    d = kpm.diagnostic(it.kps)
    return d[0] if d else (it.kps or [kpm.OTHER])[0]


def pick_quiz(pool: list[PaperItem], done: set[int], mastery: dict[str, PaperKpMastery], weak: dict[str, str],
              today: date, now: datetime, size: int, seed: int) -> tuple[list[dict], str]:
    """挑一份小卷(纯函数,不碰库): → ([{id, why, label, kp}], mode)。规则见文件头第 3 条"""
    rnd = random.Random(seed)
    freq: dict[str, int] = {}
    for it in pool:
        for k in kpm.diagnostic(it.kps):
            freq[k] = freq.get(k, 0) + 1
    fmax = max(freq.values()) if freq else 1
    avail = [it for it in pool if it.id not in done]
    rnd.shuffle(avail)
    chosen: list[dict] = []
    used: set[int] = set()

    def theta_of(k: str) -> float:
        m = mastery.get(k)
        return theta_now(m, now) if m is not None else 0.0

    def item_theta(it: PaperItem) -> float:
        ks = kpm.diagnostic(it.kps)
        return sum(theta_of(k) for k in ks) / len(ks) if ks else 0.0

    def take(cands: list[PaperItem], why: str, n: int, kp: Optional[str] = None, note: str = "") -> int:
        got = 0
        cands = [c for c in cands if c.id not in used]
        cands.sort(key=lambda c: abs(p_correct(item_theta(c), c) - TARGET_P))
        for c in cands:
            if got >= n or len(chosen) >= size:
                break
            used.add(c.id)
            chosen.append({"id": c.id, "why": why, "kp": kp or _primary(c), "note": note})
            got += 1
        return got

    def of_kp(k: str) -> list[PaperItem]:
        return [it for it in avail if k in kpm.diagnostic(it.kps)]

    def with_words(items: list[PaperItem]) -> list[tuple[PaperItem, str]]:
        out = []
        for it in items:
            hit = [w for w in (it.test_words or []) if w in weak]
            if hit:
                out.append((it, weak[hit[0]]))
        return out

    total_n = sum((m.n or 0) for m in mastery.values())
    if total_n < COLD_START:
        mode = "diagnose"
        for k in sorted(freq, key=lambda k: -freq[k]):
            if len(chosen) >= size - 3:
                break
            take(of_kp(k), "diagnose", 1, k)
        for it, w in with_words(avail)[:3]:
            take([it], "weak_word", 1, note=w)
    else:
        mode = "daily"

        def prio(k: str) -> float:
            m = mastery.get(k)
            f = freq.get(k, 0) / fmax
            if m is None or (m.n or 0) < 2:
                return f * 0.45
            p = _sig(theta_now(m, now))
            mis = any(n >= MISCONCEPTION for n in (m.codes or {}).values())
            return f * (1 - p) * (1.3 if mis else 1.0)

        weak_kps = [k for k in sorted(freq, key=lambda k: -prio(k))
                    if mastery.get(k) is not None and (mastery[k].n or 0) >= 2 and _sig(theta_now(mastery[k], now)) < 0.75][:2]
        # 前面的点也不会: 先补前面的(三单总错,往下查 be 和 do)
        if weak_kps:
            first = kpm.BY_ID[weak_kps[0]]
            for r in first.prereq:
                m = mastery.get(r)
                if r in freq and (m is None or _sig(theta_now(m, now)) < 0.6) and r not in weak_kps:
                    weak_kps = [r] + weak_kps[:1]
                    break
        for i, k in enumerate(weak_kps):
            pt = kpm.BY_ID[k]
            if i == 0 and pt.contrast and pt.contrast in freq:
                take(of_kp(k), "weak_kp", 2, k)
                take(of_kp(pt.contrast), "contrast", 1, pt.contrast)
            else:
                take(of_kp(k), "weak_kp", 2, k)
        ww = with_words([it for it in avail if it.id not in used])
        ww.sort(key=lambda x: 0 if _primary(x[0]) in weak_kps else 1)
        for it, w in ww[:2]:
            take([it], "weak_word", 1, note=w)
        due = [k for k, m in mastery.items() if k in freq and (m.stage or 0) >= 1 and m.due
               and date.fromisoformat(m.due) <= today and k not in weak_kps]
        due.sort(key=lambda k: mastery[k].due)
        for k in due[:2]:
            take(of_kp(k), "review", 1, k)
        others = [k for k in sorted(freq, key=lambda k: -freq[k]) if k not in weak_kps and k not in due[:2]]
        for k in others:
            if take(of_kp(k), "mixed", 1, k):
                break
    rest = sorted([it for it in avail if it.id not in used],
                  key=lambda it: -(freq.get(_primary(it), 0)) * (1 - p_correct(item_theta(it), it)))
    take(rest, "fill", size - len(chosen))
    return _interleave(chosen, rnd), mode


def _interleave(items: list[dict], rnd: random.Random) -> list[dict]:
    """同一个点不连着出(贪心: 每次挑一个和上一道不同点的)"""
    left = list(items)
    rnd.shuffle(left)
    out: list[dict] = []
    while left:
        idx = next((i for i, x in enumerate(left) if not out or x["kp"] != out[-1]["kp"]), 0)
        out.append(left.pop(idx))
    return out


async def homework_grade_for(db: AsyncSession, user_id: int, d: date) -> Optional[str]:
    """今天有老师布置的小卷作业、指定了用哪个年级的题 → 那个年级;没有 None(按孩子自己的年级)"""
    from app.models.content_homework import KIND_PAPER_QUIZ, ContentHomework, ContentHomeworkStudent
    from app.core.timeutil import local_day_utc_range
    start, _end = local_day_utc_range(d)
    rows = (await db.execute(
        select(ContentHomework.target_id).join(ContentHomeworkStudent, ContentHomeworkStudent.homework_id == ContentHomework.id)
        .where(ContentHomeworkStudent.student_id == user_id, ContentHomework.kind == KIND_PAPER_QUIZ,
               ContentHomework.is_closed.is_(False))
        .where(ContentHomework.available_from >= start - timedelta(seconds=1),
               ContentHomework.available_from <= start + timedelta(seconds=1))
    )).all()
    for (tid,) in rows:
        if tid and 1 <= tid <= len(GRADES):
            return GRADES[tid - 1]
    return None


async def get_quiz(db: AsyncSession, user: User, d: Optional[date] = None, *, create: bool = True,
                   size: Optional[int] = None) -> tuple[Optional[PaperQuiz], str]:
    """他这一天的那份小卷;没有就挑一份存下(当天不变)。挑不出来 → (None, 原因)"""
    d = d or local_today()
    q = (await db.execute(select(PaperQuiz).where(PaperQuiz.user_id == user.id, PaperQuiz.quiz_date == d))).scalar_one_or_none()
    if q is not None or not create:
        return q, ""
    settings = await get_settings(db)
    size = size or settings["quiz_size"]
    g = await homework_grade_for(db, user.id, d) or await student_grade(db, user)
    pool = await candidates(db, user.org_id, grade_rank(g))
    done = await answered_ids(db, user.id)
    if len([it for it in pool if it.id not in done]) < MIN_BANK:
        why = "题库里适合你的题还不够,等老师再传几份卷子" if pool else "题库里还没有适合你的题,等老师传了卷子再来"
        return None, why
    mastery = await mastery_of(db, user.id)
    weak = await weak_word_stems(db, user.id)
    now = utc_now()
    picked, mode = pick_quiz(pool, done, mastery, weak, d, now, size, seed=user.id * 100003 + d.toordinal())
    if not picked:
        return None, "题库里适合你的题还不够,等老师再传几份卷子"
    from sqlalchemy.dialects.sqlite import insert as sqlite_insert
    await db.execute(sqlite_insert(PaperQuiz).values(
        user_id=user.id, org_id=user.org_id, quiz_date=d, mode=mode, items=picked, total=len(picked),
        answered=0, right=0, status="open").on_conflict_do_nothing(index_elements=["user_id", "quiz_date"]))
    await db.commit()
    q = (await db.execute(select(PaperQuiz).where(PaperQuiz.user_id == user.id, PaperQuiz.quiz_date == d)
                          .execution_options(populate_existing=True))).scalar_one_or_none()
    return q, ""


async def quiz_items(db: AsyncSession, q: PaperQuiz) -> dict[int, PaperItem]:
    ids = [x["id"] for x in (q.items or [])]
    if not ids:
        return {}
    return {it.id: it for it in (await db.execute(select(PaperItem).where(PaperItem.id.in_(ids)))).scalars()}


async def quiz_answers(db: AsyncSession, q: PaperQuiz) -> dict[int, PaperAnswer]:
    return {a.item_id: a for a in (await db.execute(select(PaperAnswer).where(PaperAnswer.quiz_id == q.id))).scalars()}


def reveal(it: PaperItem, a: PaperAnswer) -> dict:
    """交了以后才给: 对没对、正确答案、讲解、选它错在哪"""
    why = ""
    if not a.correct:
        if it.kind == "mc":
            why = ((it.wrong or {}).get(a.answer or "") or {}).get("why") or ""
        else:
            for t in it.traps or []:
                if _canon(t.get("text")) and _canon(t.get("text")) in [_canon(x) for x in (a.answer or "").split(" / ")]:
                    why = t.get("why") or ""
                    break
        if not why and a.code and a.code != kpm.OTHER:
            why = kpm.code_label(a.code)
    return {"correct": bool(a.correct), "yours": a.answer or "", "answer": it.answer, "answer_text": answer_text(it),
            "explain": it.explain or "", "why": why}


async def quiz_out(db: AsyncSession, q: PaperQuiz) -> dict:
    items = await quiz_items(db, q)
    answers = await quiz_answers(db, q)
    out_items = []
    for x in q.items or []:
        it = items.get(x["id"])
        if it is None:
            continue
        row = public_item(it)
        a = answers.get(it.id)
        row["result"] = reveal(it, a) if a else None
        out_items.append(row)
    return {"id": q.id, "date": q.quiz_date.isoformat(), "mode": q.mode, "status": q.status, "total": len(out_items),
            "answered": sum(1 for r in out_items if r["result"]), "right": sum(1 for r in out_items if r["result"] and r["result"]["correct"]),
            "items": out_items}


class QuizRule(Exception):
    """不能这样交,message 给孩子看"""


async def submit(db: AsyncSession, user: User, quiz_id: int, item_id: int, given: Any, ms: Optional[int]) -> dict:
    q = await db.get(PaperQuiz, quiz_id)
    if q is None or q.user_id != user.id:
        raise QuizRule("没有这份小卷")
    if item_id not in [x["id"] for x in (q.items or [])]:
        raise QuizRule("这道题不在你的小卷里")
    it = await db.get(PaperItem, item_id)
    if it is None:
        raise QuizRule("这道题没有了")
    old = (await db.execute(select(PaperAnswer).where(PaperAnswer.quiz_id == q.id, PaperAnswer.item_id == item_id))).scalar_one_or_none()
    if old is not None:
        # 只认第一次交的: 再交一遍给的还是第一次的结果
        return {"result": reveal(it, old), "first": False, **(await _progress(db, q))}
    ok, code, _why, shown = grade(it, given)
    weak = await weak_word_stems(db, user.id)
    drag = bool(set((it.test_words or []) + (it.context_words or [])) & set(weak))
    # 两台设备同时交同一题: 唯一约束兜着,后到的那次什么都不写、读第一次的结果(不 rollback,免得会话里的对象过期)
    from sqlalchemy.dialects.sqlite import insert as sqlite_insert
    r = await db.execute(sqlite_insert(PaperAnswer).values(
        user_id=user.id, quiz_id=q.id, item_id=item_id, answer=shown, correct=ok, code=code,
        ms=max(0, min(int(ms or 0), 30 * 60 * 1000)) or None, word_drag=bool(drag and not ok),
    ).on_conflict_do_nothing(index_elements=["quiz_id", "item_id"]))
    a = (await db.execute(select(PaperAnswer).where(PaperAnswer.quiz_id == q.id, PaperAnswer.item_id == item_id))).scalar_one()
    if r.rowcount != 1:
        return {"result": reveal(it, a), "first": False, **(await _progress(db, q))}
    await apply_answer(db, user.id, it, ok, code, drag)
    prog = await _progress(db, q)
    await db.commit()
    return {"result": reveal(it, a), "first": True, **prog}


async def _progress(db: AsyncSession, q: PaperQuiz) -> dict:
    await db.flush()
    n, right = (await db.execute(select(func.count(PaperAnswer.id), func.coalesce(func.sum(case((PaperAnswer.correct == True, 1), else_=0)), 0))  # noqa: E712
                                 .where(PaperAnswer.quiz_id == q.id))).one()
    total = len(q.items or [])
    q.answered, q.right = int(n), int(right)
    if n >= total and q.status != "done":
        q.status = "done"
        q.finished_at = utc_now()
    return {"answered": int(n), "right": int(right), "total": total, "done": q.status == "done"}


async def quiz_summary(db: AsyncSession, user: User, q: PaperQuiz) -> list[dict]:
    """做完给孩子看的: 今天练了哪些点、各对了几道、这个点现在怎么样(只和自己比,不出现「弱」字)"""
    items = await quiz_items(db, q)
    answers = await quiz_answers(db, q)
    mastery = await mastery_of(db, user.id)
    now = utc_now()
    per: dict[str, dict] = {}
    for x in q.items or []:
        it = items.get(x["id"])
        a = answers.get(x["id"])
        if it is None or a is None:
            continue
        k = _primary(it)
        if k not in kpm.BY_ID:
            continue
        r = per.setdefault(k, {"kp": k, "kid": kpm.BY_ID[k].kid, "n": 0, "right": 0})
        r["n"] += 1
        r["right"] += 1 if a.correct else 0
    for k, r in per.items():
        st = kp_state(mastery.get(k), now)
        r["stage"] = st["stage"]
        r["lit"] = st["stage"] >= 2
    return sorted(per.values(), key=lambda r: (r["right"] / r["n"], -r["n"]))


# ---------------------------------------------------------------- 作业(content_homework kind=paper_quiz)

async def completion_times(db: AsyncSession, user_ids: Iterable[int], days: Iterable[date]) -> dict[tuple[int, date], datetime]:
    """这些孩子这几天的小卷做完的时刻 {(user_id, 日期): 完成时刻}。那天没打开过小卷 = 没做"""
    user_ids, days = set(user_ids), set(days)
    if not user_ids or not days:
        return {}
    out = {}
    for uid, d, at in (await db.execute(select(PaperQuiz.user_id, PaperQuiz.quiz_date, PaperQuiz.finished_at).where(
            PaperQuiz.user_id.in_(user_ids), PaperQuiz.quiz_date.in_(days), PaperQuiz.status == "done"))).all():
        dd = d if isinstance(d, date) else date.fromisoformat(str(d))
        out[(uid, dd)] = at or utc_now()
    return out


# ---------------------------------------------------------------- 老师看全班

async def bank_stats(db: AsyncSession, org_id: Optional[int]) -> dict:
    """题库里每个知识点有几道核对通过的题(按年级分),给老师看「哪个点题不够」"""
    q = (select(PaperItem.kps, PaperItem.grade).join(PaperDoc, PaperDoc.id == PaperItem.doc_id)
         .where(PaperItem.status == "approved", PaperDoc.status != "deleted"))
    if org_id is not None:          # None = 平台管理员看全部
        q = q.where(PaperItem.org_id == org_id)
    per: dict[str, int] = {}
    grades: dict[str, int] = {}
    total = 0
    for kps, g in (await db.execute(q)).all():
        total += 1
        grades[g or "未填"] = grades.get(g or "未填", 0) + 1
        for k in kpm.diagnostic(kps):
            per[k] = per.get(k, 0) + 1
    return {"total": total, "by_kp": per, "by_grade": grades}


async def class_overview(db: AsyncSession, students: list[User], org_id: Optional[int]) -> dict:
    now = utc_now()
    today = local_today()
    uids = [s.id for s in students]
    rows: dict[int, dict[str, PaperKpMastery]] = {u: {} for u in uids}
    if uids:
        for m in (await db.execute(select(PaperKpMastery).where(PaperKpMastery.user_id.in_(uids)))).scalars():
            rows[m.user_id][m.kp] = m
    quizzes = {q.user_id: q for q in (await db.execute(select(PaperQuiz).where(
        PaperQuiz.user_id.in_(uids), PaperQuiz.quiz_date == today))).scalars()} if uids else {}
    week_start = now - timedelta(days=7)
    recent: dict[int, tuple[int, int]] = {}
    if uids:
        for uid, correct in (await db.execute(select(PaperAnswer.user_id, PaperAnswer.correct)
                                              .where(PaperAnswer.user_id.in_(uids), PaperAnswer.created_at >= week_start))).all():
            n, r = recent.get(uid, (0, 0))
            recent[uid] = (n + 1, r + (1 if correct else 0))
    stats = await bank_stats(db, org_id)
    kp_rows = []
    codes: dict[str, set[int]] = {}
    for p in kpm.POINTS:
        if not p.diagnose:
            continue
        weak = shaky = good = unknown = 0
        for uid in uids:
            st = kp_state(rows[uid].get(p.id), now)
            if st["level"] == "weak":
                weak += 1
            elif st["level"] == "shaky":
                shaky += 1
            elif st["level"] == "good":
                good += 1
            elif st["level"] == "unknown":
                unknown += 1
            for mc in st["misconceptions"]:
                codes.setdefault(mc["code"], set()).add(uid)
        if weak or shaky or good or unknown or stats["by_kp"].get(p.id):
            kp_rows.append({"kp": p.id, "name": p.name, "weak": weak, "shaky": shaky, "good": good, "unknown": unknown,
                            "bank": stats["by_kp"].get(p.id, 0)})
    kp_rows.sort(key=lambda r: (-(r["weak"] * 2 + r["shaky"]), -r["bank"]))
    people = []
    for s in students:
        mine = rows[s.id]
        tops = []
        for k, m in mine.items():
            if k not in kpm.BY_ID:
                continue
            st = kp_state(m, now)
            if st["level"] in ("weak", "shaky"):
                tops.append({"kp": k, "name": kpm.BY_ID[k].name, "label": st["label"], "p": st["p"],
                             "misconceptions": [x["label"] for x in st["misconceptions"]][:2],
                             "_score": (1 - (st["p"] or 0)) * (1.3 if st["misconceptions"] else 1)})
        tops.sort(key=lambda x: -x["_score"])
        for t in tops:
            t.pop("_score", None)
        q = quizzes.get(s.id)
        n7, r7 = recent.get(s.id, (0, 0))
        people.append({"id": s.id, "name": s.full_name or s.username, "top": tops[:3],
                       "answered": sum((m.n or 0) for m in mine.values()),
                       "week": {"n": n7, "right": r7},
                       "today": ({"status": q.status, "answered": q.answered, "total": q.total} if q else None)})
    people.sort(key=lambda p: (-len(p["top"]), p["name"]))
    top_codes = sorted(({"code": c, "label": kpm.code_label(c), "students": len(v)} for c, v in codes.items()),
                       key=lambda x: -x["students"])[:8]
    return {"kps": kp_rows, "students": people, "codes": top_codes, "bank": stats}
