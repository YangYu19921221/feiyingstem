"""音标跟读: 本地判不清楚的,请讯飞再判一次(2026-10-31,用户「如果判断不清楚的就用讯飞？」)

## 为什么不全用讯飞
讯飞语音评测按次收费(10-31 官网: 新用户实名送 1 万次 / 企业 10 万次,90 天;套餐 20 万次 1200 元 = 0.006 元 / 次),
一次约 2 秒;本地判定免费、0.5 秒。本地分得清的就不花这个钱:
  - **本地直接过**: 两道门过了(不是靠口音放宽)、贴合分 ≥ CLEAR_PASS_GOP
  - **本地直接拦**: 元音不对 / 爆破音开头没听到辅音 / 明显读成了别的词 / 贴合分 < CLEAR_FAIL_GOP
  - 其余(口音放宽的、差一点的、贴合分在中间的)→ 问讯飞
线上判定服务的数据(10-31): 读对 100 次里 32 次要问讯飞;240 段乱读里 68 段要问;本地直接过的乱读 0 段。

## 讯飞怎么判(read_word,0–5 分,这里存的是 ×20 后的 0–100)
10-31 用同一批录音实测(72 + 21 次):
  - 乱读 / 中文 / 别的英语词 / 用户读的「ooo」: **全部 is_rejected=true**(except_info 28676 / 28689)
  - 读对的(英美标准音 + 中国口音): 不拒,65–99 分;10-03 认真读的孩子 9 条 8 条 72–99 分,1 条拒(52 分)
  - 用户带口音读 cab(模型听成 kha): 不拒的 33–56 分
所以: 拒了 → 没过(≥ 40 分标黄「差一点」,否则红);没拒 → ≥ 70 绿、≥ 40 黄(过)、≥ 20 黄(差一点没过)、更低红。

## 讯飞不可用就照本地的来
没配 / 关了(管理端「AI 配置」里讯飞那一行的启用开关)/ 超时 / 报错 / 今天用到上限 → 用本地结果,和以前一样。
上限: 全平台一天 DAILY_CAP 次、一个孩子一天 PER_STUDENT_CAP 次(防一个孩子刷光);讯飞报错后 DOWN_SECONDS 内不再问。
"""
import asyncio
import logging
from typing import Optional

from app.core.shared_store import store
from app.core.timeutil import local_today

logger = logging.getLogger(__name__)

CLEAR_PASS_GOP = -3.5
CLEAR_FAIL_GOP = -10.0

GREEN_SCORE = 70.0
PASS_SCORE = 40.0
NEAR_SCORE = 20.0

DAILY_CAP = 5000
PER_STUDENT_CAP = 300
DOWN_SECONDS = 600
TIMEOUT = 6.0      # 本地判定最多 8 秒 + 这 6 秒 < 前端判定请求的 15 秒

_TTL = 2 * 86400
_SEM = asyncio.Semaphore(4)
_PASSED = ("pass", "confused", "uncertain")


def needs_referee(local: dict) -> bool:
    """本地结果分不清 → True(要问讯飞)"""
    v = local.get("verdict")
    gop = local.get("gop")
    if v in ("silent", "off") or gop is None:
        return False
    if local.get("error_code") in ("wrong_vowel", "missing_onset") or v == "wrong_word":
        return False                      # 本地有明确证据: 拦
    if gop < CLEAR_FAIL_GOP:
        return False
    if v in _PASSED and not local.get("accent") and gop >= CLEAR_PASS_GOP:
        return False                      # 本地很有把握: 过
    return True


def merge(local: dict, ise: dict) -> dict:
    """本地结果 + 讯飞分数 → 最终结果。讯飞的分说了算,本地的「词尾多带一个音」提示留着"""
    score = float(ise.get("total_score") or 0.0)
    rejected = bool(ise.get("is_rejected"))
    out = {**local, "referee": "ise", "ise_score": round(score, 1), "ise_rejected": rejected,
           "ise_except": ise.get("except_info"), "accent": False}
    if rejected or score < PASS_SCORE:
        near = score >= PASS_SCORE if rejected else score >= NEAR_SCORE
        out.update(verdict="not_close", note="讯飞判没过",
                   ise_grade="yellow" if near else "red")
        return out
    out.update(verdict="pass", note="讯飞判过",
               ise_grade="green" if score >= GREEN_SCORE else "yellow")
    return out


def grade_of(final: dict) -> Optional[str]:
    """讯飞判过的颜色;没问讯飞返回 None(调用方走 phoneme_closed_set.grade)"""
    if final.get("referee") != "ise":
        return None
    g = final.get("ise_grade")
    # 讯飞给绿但本地听出词尾多带了一个音: 黄(能照着改的具体毛病)
    if g == "green" and final.get("error_code") == "extra_final_vowel":
        return "yellow"
    return g


async def _budget_ok(user_id: int) -> bool:
    if await store.get("ise:down"):
        return False
    day = local_today().isoformat()
    if not await store.incr_if_below(f"ise:{day}:all", DAILY_CAP, _TTL):
        return False
    if not await store.incr_if_below(f"ise:{day}:u{user_id}", PER_STUDENT_CAP, _TTL):
        return False
    return True


async def used_today() -> int:
    v = await store.get(f"ise:{local_today().isoformat()}:all")
    return int(v) if v else 0


async def referee(audio: bytes, word: str, local: dict, user_id: int,
                  timeout: float = TIMEOUT) -> dict:
    """判不清就问讯飞,返回最终结果;不用问 / 问不了都原样返回本地结果"""
    if not needs_referee(local) or not audio or not word:
        return local
    from app.services import iflytek_ise_service
    try:
        if not await iflytek_ise_service.get_config():
            return local                  # 没配或在管理端关掉了
        if not await _budget_ok(user_id):
            return local
        async with _SEM:
            ise = await asyncio.wait_for(
                iflytek_ise_service.evaluate(audio, word, "read_word"), timeout=timeout)
    except asyncio.TimeoutError:
        logger.info("讯飞评测超时,用本地判定")
        return local
    except Exception as e:
        # 额度用完 / Key 失效 / 网络: 10 分钟内不再问,免得每个孩子都白等 2 秒
        logger.warning("讯飞评测失败,%s 秒内用本地判定: %s", DOWN_SECONDS, e)
        await store.set("ise:down", str(e)[:200], DOWN_SECONDS)
        return local
    return merge(local, ise)
