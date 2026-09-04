"""wav2vec2 音素输出 → 教材音素集的归一与逐格比对

## 为什么需要归一
模型(facebook/wav2vec2-lv-60-espeak-cv-ft)输出的是 espeak 风格 IPA,
与教材/词典用的英式 IPA 有**写法差异**,但音是同一个:
    bed  教材 bed    模型 bɛd    ɛ 和 e 是同一个音
    dab  教材 dæb    模型 dab    espeak 用裸 a 表示 TRAP 元音
    fee  教材 fiː    模型 fi5    5 是多语言模型带的声调符号
不归一的话这些全会被判成错 —— 那是假拒绝,比漏纠更伤孩子。

## 但归一必须保守
`ɑː` 与 `æ` 是**真的不同**元音(PALM/START vs TRAP),不能归一到一起,
否则 cab /kæb/ 被念成 /kɑːb/ 就查不出来 —— 而这正是拼读要教的元音区分。
凡是「可能掩盖真实发音错误」的映射,一律不做。

## 逐格比对
答案已经是 token 数组(['b','æ','d']),这里把模型输出也切成 token 后做对齐,
就能指出**第几格**念偏了 —— 直接对应前端那三个音标格。
这是 ASR 做不到的(它只能说整个词像不像)。
"""
from typing import List, Optional, Tuple

# 与前端 utils/ipaPhonemes.ts 的 PHONEME_GROUPS 一致(48 音)
PHONEMES = [
    'p', 'b', 't', 'd', 'k', 'ɡ',
    'f', 'v', 's', 'z', 'θ', 'ð', 'ʃ', 'ʒ',
    'ts', 'dz', 'tr', 'dr', 'tʃ', 'dʒ',
    'm', 'n', 'ŋ',
    'h', 'r', 'l',
    'iː', 'ɪ', 'i', 'e', 'æ', 'ɑː', 'ʌ', 'ɒ', 'ɔː', 'ʊ', 'uː', 'ɜː', 'ə',
    'eɪ', 'aɪ', 'ɔɪ', 'əʊ', 'aʊ', 'ɪə', 'eə', 'ʊə',
    'w', 'j',
    'ˈ',
]
_BY_LEN = sorted(PHONEMES, key=len, reverse=True)   # 先长后短,否则 tʃ 被切成 t+ʃ

VOWELS = {
    'iː', 'ɪ', 'i', 'e', 'æ', 'ɑː', 'ʌ', 'ɒ', 'ɔː', 'ʊ', 'uː', 'ɜː', 'ə',
    'eɪ', 'aɪ', 'ɔɪ', 'əʊ', 'aʊ', 'ɪə', 'eə', 'ʊə',
}

# 纯写法差异 —— 折叠它们不会掩盖任何发音错误(实测依据见文件头)
_NOTATION = [
    ('ɛ', 'e'),      # bed: bɛd → bed
    ('ɐ', 'ʌ'),      # espeak 的 ʌ
    ('ɚ', 'ə'), ('ɝ', 'ɜː'),
    ('ɹ', 'r'), ('ɫ', 'l'),
    ('ʧ', 'tʃ'), ('ʤ', 'dʒ'),
    ('g', 'ɡ'),
    ('ː', 'ː'),
]
# 长音符缺失的容错:模型有时把 iː 输出成 i。这两个在英语里**是**不同音位
# (sit/seat),所以不直接折叠,而是在比对时作为「长度差异」单独判(见 _same_phoneme)
_LENGTH_PAIRS = {('i', 'iː'), ('u', 'uː'), ('ɔ', 'ɔː'), ('ɑ', 'ɑː'), ('ɜ', 'ɜː')}

# espeak 的裸元音 → 英式对应。**只映射不会与其它音位冲突的**
_BARE_VOWEL = {
    'a': 'æ',        # dab: dab → dæb。注意 ɑː 不在此列 —— 它是另一个元音
}


def normalize_model_ipa(raw: str) -> str:
    """模型原始输出 → 只含教材音素集字符的串"""
    s = raw or ''
    # 声调数字(多语言模型带的,如 fee → fi5)、重音符、分隔符一律去掉
    s = ''.join(c for c in s if not c.isdigit())
    for a, b in _NOTATION:
        s = s.replace(a, b)
    s = s.replace('ˈ', '').replace('ˌ', '').replace('.', '').replace(' ', '')
    s = s.replace('(', '').replace(')', '')
    return s


def tokenize(ipa: str) -> Tuple[List[str], List[str]]:
    """切 token。返回 (tokens, 表外字符)"""
    s = normalize_model_ipa(ipa)
    toks: List[str] = []
    unknown: List[str] = []
    i = 0
    while i < len(s):
        hit = next((p for p in _BY_LEN if s.startswith(p, i)), None)
        if hit:
            toks.append(hit)
            i += len(hit)
            continue
        # 裸元音单独处理:a→æ 这类
        if s[i] in _BARE_VOWEL:
            toks.append(_BARE_VOWEL[s[i]])
            i += 1
            continue
        unknown.append(s[i])
        i += 1
    return toks, unknown


def _same_phoneme(expected: str, heard: str) -> bool:
    """两个 token 是不是同一个音"""
    if expected == heard:
        return True
    # 长音符缺失/多余:算同一个音的**宽松**判定。
    # 严格说 i/iː 是不同音位,但模型对孤立单词的时长判断不稳,
    # 拿它判错会大量假拒绝 —— 长短音的区分交给对比回放和老师
    if (expected, heard) in _LENGTH_PAIRS or (heard, expected) in _LENGTH_PAIRS:
        return True
    if expected.rstrip('ː') == heard.rstrip('ː'):
        return True
    return False


def align(expected: List[str], heard: List[str]) -> List[Optional[int]]:
    """把 heard 对齐到 expected,返回每个 expected 位置对应的 heard 下标(没对上是 None)

    标准编辑距离回溯。用来指出「第几格念偏了」。
    """
    n, m = len(expected), len(heard)
    # dp[i][j] = expected[:i] 与 heard[:j] 的最小编辑代价
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        dp[i][0] = i
    for j in range(m + 1):
        dp[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost = 0 if _same_phoneme(expected[i - 1], heard[j - 1]) else 1
            dp[i][j] = min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)

    out: List[Optional[int]] = [None] * n
    i, j = n, m
    while i > 0 and j > 0:
        cost = 0 if _same_phoneme(expected[i - 1], heard[j - 1]) else 1
        if dp[i][j] == dp[i - 1][j - 1] + cost:
            out[i - 1] = j - 1 if cost == 0 else None
            i -= 1
            j -= 1
        elif dp[i][j] == dp[i - 1][j] + 1:
            i -= 1                       # expected 这一位没读出来
        else:
            j -= 1                       # 多读了一个音
    return out


def compare(answer_tokens: List[str], model_raw: str) -> dict:
    """比对答案与模型输出

    返回:
      per_slot   每格是否读对(与 answer_tokens 同长)
      wrong      读错/漏读的格下标
      heard      模型输出切成的 token
      vowel_bad  错的格里属于元音的 —— 元音才是拼读教学点
    """
    heard, unknown = tokenize(model_raw)
    # 重音符不参与判定(小学阶段漏点不该判错)
    idx_map = [i for i, t in enumerate(answer_tokens) if t != 'ˈ']
    exp = [answer_tokens[i] for i in idx_map]

    mapping = align(exp, heard)
    per_slot: List[Optional[bool]] = [None] * len(answer_tokens)
    wrong: List[int] = []
    for k, slot in enumerate(idx_map):
        ok = mapping[k] is not None
        per_slot[slot] = ok
        if not ok:
            wrong.append(slot)

    return {
        'per_slot': per_slot,
        'wrong': wrong,
        'heard': heard,
        'heard_display': ''.join(heard),
        'unknown': unknown,
        'vowel_bad': [i for i in wrong if answer_tokens[i] in VOWELS],
        'all_correct': not wrong,
    }
