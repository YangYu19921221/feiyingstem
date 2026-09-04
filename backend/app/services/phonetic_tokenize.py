"""音标 → 音素 token 的**唯一真源**

## 为什么必须只有一份
音标有三套写法在系统里并存:视频里教 `[ei]`、纸质教材印 `[eɪ]`、词库存 `/eɪ/`。
归一规则一旦有第二份实现,两边就会漂移 —— 而漂移的后果是**学生做不对的死题**:
切出来的 token 只要有一个不在软键盘上,那一格他永远填不出来。

原先这套逻辑只在 `scripts/import_phonetic_book.py` 里(命令行导入),
教师端上传功能要用同一套,所以抽到这里。脚本和 API 都从这里 import,
不准各自复制一份。

## 与前端的约束
`GROUPS` 必须与 `frontend/src/utils/ipaPhonemes.ts` 的 `PHONEME_GROUPS`
**同名同值**。键盘上没有的音素,学生永远打不出来。
"""
import re
from collections import Counter
from typing import List, Optional, Tuple

# 与前端 utils/ipaPhonemes.ts 的 PHONEME_GROUPS 必须一致
GROUPS = [
    ('爆破音', ['p', 'b', 't', 'd', 'k', 'ɡ']),
    ('摩擦音', ['f', 'v', 's', 'z', 'θ', 'ð', 'ʃ', 'ʒ']),
    ('双辅音', ['ts', 'dz', 'tr', 'dr', 'tʃ', 'dʒ']),
    ('鼻音', ['m', 'n', 'ŋ']),
    ('似拼音', ['h', 'r', 'l']),
    ('单元音', ['iː', 'ɪ', 'i', 'e', 'æ', 'ɑː', 'ʌ', 'ɒ', 'ɔː', 'ʊ', 'uː', 'ɜː', 'ə']),
    ('双元音', ['eɪ', 'aɪ', 'ɔɪ', 'əʊ', 'aʊ', 'ɪə', 'eə', 'ʊə']),
    ('半元音', ['w', 'j']),
    ('重音', ['ˈ']),
]
ALL = [k for _, ks in GROUPS for k in ks]
# 先长后短:不排序的话 tʃ 会被切成 t + ʃ,iː 会被切成 i + ː(而 ː 不是音素)
BY_LEN = sorted(ALL, key=len, reverse=True)
VOWELS = set(dict(GROUPS)['单元音']) | set(dict(GROUPS)['双元音'])


def normalize(raw: str) -> str:
    """各种写法 → 本表音素。顺序要紧:长音符和双字符先处理"""
    s = (raw or '').strip()
    s = re.sub(r'^[/\[]|[/\]]$', '', s)
    s = s.replace(':', 'ː').replace('g', 'ɡ')
    s = re.sub(r'ə(?=ː)', 'ɜ', s)              # ə: → ɜː
    for a, b in [('ei', 'eɪ'), ('ai', 'aɪ'), ('ɔi', 'ɔɪ'), ('əu', 'əʊ'),
                 ('au', 'aʊ'), ('iə', 'ɪə'), ('ɛə', 'eə'), ('uə', 'ʊə'),
                 ('oʊ', 'əʊ')]:
        s = s.replace(a, b)
    s = re.sub(r'ɔ(?![ːɪ])', 'ɒ', s)           # 单独 ɔ → ɒ,ɔː/ɔɪ 保留
    s = s.replace('ɹ', 'r')
    return re.sub(r'[ˌ\s]', '', s)


def tokenize(raw: str) -> Tuple[List[str], List[str]]:
    """→ (音素列表, 切不出来的字符)。第二个非空就不该入库"""
    s = normalize(raw)
    toks: List[str] = []
    unknown: List[str] = []
    i = 0
    while i < len(s):
        for p in BY_LEN:
            if s.startswith(p, i):
                toks.append(p)
                i += len(p)
                break
        else:
            unknown.append(s[i])
            i += 1
    return toks, unknown


def core_indexes(toks: List[str]) -> List[int]:
    """元音在第几格。第二遍只挖元音要用 —— 元音才是拼读的关键"""
    return [i for i, t in enumerate(toks) if t in VOWELS]


def check_item(word: str, phonetic: str) -> Tuple[Optional[dict], Optional[str]]:
    """校验一行 → (可入库的 dict, 错误说明)。两者必有其一为 None

    三道校验,每道都对应一种"学生做不对的死题":
      1. 有键盘上没有的符号 → 那一格永远填不出来
      2. 切不出任何音素 → 整题空白
      3. 切不出元音 → 第二遍(只挖元音)无法出题
    """
    toks, unk = tokenize(phonetic)
    if unk:
        return None, f"音标含键盘上没有的符号 {''.join(unk)}(原文 {phonetic})"
    if not toks:
        return None, f"音标切不出音素:{phonetic}"
    core = core_indexes(toks)
    if not core:
        return None, f"切不出元音,第二遍无法挖空:{''.join(toks)}"
    return {"word": word, "answer": toks, "core": core}, None


def lesson_highlight(items: List[dict], top: int = 4, min_hits: int = 3) -> List[str]:
    """这一节主要教哪几个元音 → 给软键盘做高亮。出现 min_hits 次以上才算"""
    vc = Counter(t for it in items for t in it.get('answer', []) if t in VOWELS)
    return [t for t, n in vc.most_common(top) if n >= min_hits]
