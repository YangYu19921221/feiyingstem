"""识别中国学生读英语的**具体错误类型** —— 不打分,只说"错在哪"

## 为什么需要这个(以及为什么闭集打分不够)
闭集打分回答的是「更像本节哪个词」,于是孩子把 bad 读成两音节时,
它只能说「听起来像 daff」—— 这话对孩子毫无用处,他根本没想读 daff。

而真正的错误是**词尾多加了一个元音**:普通话没有词尾塞音,中文母语者读
/bæd/ 会自然读成「bei-de」两个音节。这是可以明确讲清、也可以练掉的错误。

## 实测依据(2026-09-03,生产真实录音 vs Edge TTS 标准音)
用「识别结果是否以元音结尾」判断,而目标词以辅音结尾:

    真人录音(词尾辅音的 11 个词)   11/11 检出多加元音
    Edge TTS 标准音(12 个词)       0/12  假阳性

两组完全分开。对照样例:
    bad  标准音 → bæd          真人 → pei5tə1pei5tə1  (多了 ə)
    cab  标准音 → kɑːb         真人 → pai5tə1
    bead 标准音 → biːd         真人 → pitəɜ
另用 Edge TTS 故意合成两音节做交叉验证:「bay duh」→ beːda(末音 a),
而正常「bad」→ bæd —— 说明这个信号来自音节结构,不是模型对童声的偏差。

## 边界
- 只对**词尾是辅音**的目标词有效。词尾本来是元音的(fee/bee/ace)不适用,
  那类词多加音听不出来,直接返回 None 不下结论。
- 一个说话人的样本。上线后要看真实学生的假阳性率 —— 宁可漏报:
  报错一次孩子就不敢开口,而漏报一次下节课还能补。
"""
import re
from typing import List, Optional

# 元音字符。**含中文那一侧的韵母字符**:多加的那个音常被 espeak 多语言模型
# 识别成中文韵母(ə1/ɑ5/a),只认英语元音会漏掉大半
_VOWEL_CHARS = set('iɪeæɑʌɒɔʊuɜəaoy')

# 目标词音标里,词尾算「辅音收尾」的音素
_CONSONANTS = set('pbtdkɡfvszθðʃʒmnŋhrlwj')


def _last_real(tokens: List[str]) -> Optional[str]:
    """最后一个有内容的音素(跳过重音符)。声调数字剥掉再看"""
    for t in reversed(tokens):
        core = re.sub(r'\d', '', t or '')
        if not core or core in ('ˈ', 'ˌ'):
            continue
        return core
    return None


def ends_with_vowel(tokens: List[str]) -> bool:
    last = _last_real(tokens)
    return bool(last) and last[-1] in _VOWEL_CHARS


def target_ends_with_consonant(target_tokens: List[str]) -> bool:
    last = _last_real(target_tokens)
    return bool(last) and last[-1] in _CONSONANTS


def detect(heard_tokens: List[str], target_tokens: List[str]) -> Optional[dict]:
    """→ {code, message} 或 None(测不出/不适用)

    code = 'extra_final_vowel':词尾多加了一个元音。
    这是**唯一**目前有实测依据的错误类型,不要凭想象往里加别的 ——
    没有假阳性数据支撑的"错误类型"会变成冤枉孩子的噪音。
    """
    if not heard_tokens or not target_tokens:
        return None
    if not target_ends_with_consonant(target_tokens):
        return None                       # 词尾本来是元音,这个判据不适用
    if not ends_with_vowel(heard_tokens):
        return None                       # 收音干净,没有这个问题
    tail = _last_real(target_tokens)
    return {
        "code": "extra_final_vowel",
        # 说"多带了个音"而不是"你读错了" —— 指出差别,不做评价
        "message": f"词尾的 /{tail}/ 后面多带了一个音,像在读两个字。"
                   f"收住舌头别往后拖,一个音节读完就停",
    }
