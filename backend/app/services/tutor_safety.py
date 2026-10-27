"""孩子说到难过、被欺负、想伤害自己时(2026-10-27,用户问「这个 agent 完美了没有」→「按你的建议全做了」)

学习助手原来的第 1 条规则是「只聊英语学习,别的话题温和地带回英语」—— 孩子说「我被同学欺负了」,
它会把话题拉回背单词。面向未成年人,这类话要先接住,并让真人老师知道。

## 两道识别
1. **服务器关键词**(detect): 孩子自己打的字里有「不想活 / 想死 / 被欺负 / 被打 …」→ 不管模型怎么想都记一条提醒。
   只看孩子写的话,不看他发来的文件和照片(阅读理解里讲校园欺凌的文章不是孩子的事)。
   问翻译的(「自杀 用英语怎么说」)不按关键词记,交给模型判断 —— 否则单词课天天误报,老师就不看了
2. **模型自己判断**(工具 flag_concern): 关键词抓不到的说法(「活着好累」「每天都不想醒」)由小鹰老师调工具记

## 记下来以后
- 表 tutor_alerts,一条提问最多一条提醒(两道都命中时取更严重的那级)。孩子删了对话,提醒照样留着
- urgent = 说到想伤害自己 / 不想活;concern = 被欺负、被打、家里出事、长期很难过
- 本班老师(工作台顶上红条 +「需要关心的孩子」页)、机构管理员、平台管理员看得到;看完点「我处理好了」写一句怎么处理的
- **这一问不扣次数**(cost = COST_CARE,不算追问起点也不占追问次数),次数用完了也能说
  (次数用完的输入区有「想说说心里话」,带 care=1 进来,一天 CARE_BUTTON_DAILY 次,提示词让它只接心里话、不讲题);
  但一个孩子一天最多 CARE_DAILY 次免费(防止有人在每句后面加「被欺负」白用,超过了照常扣)
- 回答怎么说在 RULES 第 1 条的「例外」里: 先回应感受、告诉他说出来是对的、建议告诉信任的大人;
  说到想伤害自己或有人伤害他,再给 12355 青少年服务台,有危险打 110;不承诺保密
"""
from __future__ import annotations

import re
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.shared_store import store
from app.core.timeutil import local_today, utc_now
from app.models.tutor import TutorAlert

LEVELS = ("urgent", "concern")
CARE_DAILY = 10          # 一天最多几次「说到这类事」不扣次数
CARE_BUTTON_DAILY = 3    # 次数用完的孩子点「想说说心里话」一天最多几次(这条路不看关键词,只靠提示词不讲题)
EXCERPT_MAX = 300

# 想伤害自己: 要是第一人称的意思,单个「死」「自杀」不算(问单词的多)
_URGENT = re.compile(
    r"不想活|活着(?:没|好没|真没|一点)?(?:意思|意义)|活不下去|"
    r"(?:我|自己)(?:真的|好|很)?(?:想|要|打算|准备)(?:去)?(?:死|自杀|跳楼|跳河|割腕|吃药死)|"
    r"想自杀|要自杀|想跳楼|割腕|伤害自己|结束(?:自己的)?生命|死了算了|"
    r"(?:我|自己)不(?:想|要)(?:再)?(?:醒|醒来|存在)"
)
# 被人伤害 / 很难过
_CONCERN = re.compile(
    r"被(?:人|同学|他们|她们|他|她)?(?:欺负|霸凌|打|揍|威胁|勒索|孤立|摸)|"
    r"(?:欺负|霸凌|打|揍|威胁|勒索|孤立)(?:我|了我)|"
    r"家暴|离家出走|没(?:有)?人(?:跟|和)我玩|没(?:有)?人喜欢我|"
    r"(?:我|好像)(?:有|得了)?抑郁|天天(?:都)?(?:哭|想哭)|每天都(?:在)?哭"
)
# 问翻译 / 问意思: 这种按关键词不记(模型自己能看出是不是在说自己)
_ASKING_WORD = re.compile(r"用英语|英语怎么|英文怎么|怎么翻译|翻译成|是什么意思|怎么拼|怎么写|单词")


def detect(text: Optional[str]) -> Optional[tuple[str, str]]:
    """(级别, 命中的那几个字);没命中 None"""
    t = re.sub(r"\s+", "", text or "")
    if not t:
        return None
    if _ASKING_WORD.search(t):
        return None
    m = _URGENT.search(t)
    if m:
        return "urgent", m.group(0)
    m = _CONCERN.search(t)
    if m:
        return "concern", m.group(0)
    return None


def stronger(a: Optional[str], b: Optional[str]) -> Optional[str]:
    if "urgent" in (a, b):
        return "urgent"
    return a or b


async def care_is_free(user_id: int) -> bool:
    """今天这类提问还能不能不扣次数(一天 CARE_DAILY 次)"""
    return await store.incr_if_below(f"tutor:care:{user_id}:{local_today().isoformat()}", CARE_DAILY, 26 * 3600)


async def care_button_is_free(user_id: int) -> bool:
    return await store.incr_if_below(f"tutor:carebtn:{user_id}:{local_today().isoformat()}", CARE_BUTTON_DAILY, 26 * 3600)


async def record(db: AsyncSession, *, user_id: int, org_id: Optional[int], conversation_id: Optional[int],
                 message_id: Optional[int], level: str, source: str, matched: Optional[str] = None,
                 reason: Optional[str] = None, excerpt: Optional[str] = None) -> None:
    """记一条提醒;同一条提问再记一次(关键词 + 模型)就合并: 取更严重的级别,原因补上。不 commit"""
    level = level if level in LEVELS else "concern"
    excerpt = (excerpt or "").strip()[:EXCERPT_MAX] or None
    reason = (reason or "").strip()[:120] or None
    if message_id is None:
        db.add(TutorAlert(user_id=user_id, org_id=org_id, conversation_id=conversation_id, level=level,
                          source=source, matched=matched, reason=reason, excerpt=excerpt, created_at=utc_now()))
        return
    await db.execute(
        sqlite_insert(TutorAlert)
        .values(user_id=user_id, org_id=org_id, conversation_id=conversation_id, message_id=message_id,
                level=level, source=source, matched=matched, reason=reason, excerpt=excerpt, created_at=utc_now())
        .on_conflict_do_nothing(index_elements=[TutorAlert.message_id]))
    row = (await db.execute(select(TutorAlert).where(TutorAlert.message_id == message_id))).scalar_one_or_none()
    if row is None:
        return
    values = {}
    if stronger(row.level, level) != row.level:
        values["level"] = "urgent"
    if reason and not row.reason:
        values["reason"] = reason
    if source not in (row.source or "").split(","):
        values["source"] = ",".join(filter(None, [row.source, source]))
    if values:
        await db.execute(update(TutorAlert).where(TutorAlert.id == row.id).values(**values)
                         .execution_options(synchronize_session=False))


async def tool_flag(db: AsyncSession, user, ctx: Optional[dict], inp: dict) -> dict:
    """模型调 flag_concern。记在这次提问上(ctx 里有提问的 id 和孩子写的话)"""
    ctx = ctx or {}
    await record(db, user_id=user.id, org_id=user.org_id, conversation_id=ctx.get("conversation_id"),
                 message_id=ctx.get("user_message_id"), level=str(inp.get("level") or "concern"),
                 source="model", reason=str(inp.get("reason") or ""), excerpt=ctx.get("user_text"))
    await db.commit()
    return {"ok": True, "note": "已经提醒他的老师了。回答里先接住他的感受,按第 1 条的例外说;不用告诉他「我调用了工具」"}


def out(a: TutorAlert, name: Optional[str] = None, class_name: Optional[str] = None,
        org_name: Optional[str] = None) -> dict:
    return {"id": a.id, "student_id": a.user_id, "student_name": name, "class_name": class_name, "org_name": org_name,
            "conversation_id": a.conversation_id, "level": a.level, "source": a.source, "matched": a.matched,
            "reason": a.reason, "excerpt": a.excerpt,
            "created_at": a.created_at.isoformat() if a.created_at else None,
            "handled_at": a.handled_at.isoformat() if a.handled_at else None,
            "handled_by_name": a.handled_by_name, "handled_note": a.handled_note}
