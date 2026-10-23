"""选词填空挖空：在例句中定位目标词并返回挖空区间，容忍常见词形变化。

与前端 frontend/src/utils/blankSentence.ts 对齐：第三人称单数、复数、过去式、
现在分词、以及高频不规则词都能匹配。挖不出空返回 None —— 调用方应跳过该词，
绝不展示「答案词原样留在题面」的坏句。

2026-10-23 补(与前端同步): 连字符词算一个词、be 动词各形式、更多不规则动词、-ing/-ed 双写辅音还原。
⚠️ 规则必须与前端一模一样,tests/test_blank_sentence.py 解析前端文件核对 _IRREGULAR 一致。
"""
import re

# 高频不规则词 → 归一到同一词干，保证目标词与句中变形两边一致
_IRREGULAR = {
    "make": "make", "makes": "make", "made": "make", "making": "make", "do": "do", "does": "do",
    "did": "do", "done": "do", "doing": "do", "say": "say", "says": "say", "said": "say",
    "go": "go", "goes": "go", "went": "go", "gone": "go", "going": "go", "have": "have",
    "has": "have", "had": "have", "having": "have", "get": "get", "gets": "get", "got": "get",
    "gotten": "get", "take": "take", "takes": "take", "took": "take", "taken": "take", "taking": "take",
    "give": "give", "gives": "give", "gave": "give", "given": "give", "come": "come", "comes": "come",
    "came": "come", "coming": "come", "run": "run", "runs": "run", "ran": "run", "running": "run",
    "see": "see", "sees": "see", "saw": "see", "seen": "see", "eat": "eat", "eats": "eat",
    "ate": "eat", "eaten": "eat", "write": "write", "writes": "write", "wrote": "write", "written": "write",
    "sing": "sing", "sings": "sing", "sang": "sing", "sung": "sing", "buy": "buy", "buys": "buy",
    "bought": "buy", "find": "find", "finds": "find", "found": "find", "put": "put", "puts": "put",
    "putting": "put", "be": "be", "is": "be", "am": "be", "are": "be", "was": "be",
    "were": "be", "been": "be", "being": "be", "tell": "tell", "tells": "tell", "told": "tell",
    "think": "think", "thinks": "think", "thought": "think", "bring": "bring", "brings": "bring", "brought": "bring",
    "teach": "teach", "teaches": "teach", "taught": "teach", "catch": "catch", "catches": "catch", "caught": "catch",
    "sit": "sit", "sits": "sit", "sat": "sit", "sitting": "sit", "stand": "stand", "stands": "stand",
    "stood": "stand", "speak": "speak", "speaks": "speak", "spoke": "speak", "spoken": "speak", "wear": "wear",
    "wears": "wear", "wore": "wear", "worn": "wear", "swim": "swim", "swims": "swim", "swam": "swim",
    "swum": "swim", "swimming": "swim", "begin": "begin", "begins": "begin", "began": "begin", "begun": "begin",
    "beginning": "begin", "drink": "drink", "drinks": "drink", "drank": "drink", "drunk": "drink", "drive": "drive",
    "drives": "drive", "drove": "drive", "driven": "drive", "fly": "fly", "flies": "fly", "flew": "fly",
    "flown": "fly", "grow": "grow", "grows": "grow", "grew": "grow", "grown": "grow", "know": "know",
    "knows": "know", "knew": "know", "known": "know", "leave": "leave", "leaves": "leave", "left": "leave",
    "leaving": "leave", "lose": "lose", "loses": "lose", "lost": "lose", "losing": "lose", "meet": "meet",
    "meets": "meet", "met": "meet", "pay": "pay", "pays": "pay", "paid": "pay", "ride": "ride",
    "rides": "ride", "rode": "ride", "ridden": "ride", "sell": "sell", "sells": "sell", "sold": "sell",
    "send": "send", "sends": "send", "sent": "send", "sleep": "sleep", "sleeps": "sleep", "slept": "sleep",
    "spend": "spend", "spends": "spend", "spent": "spend", "win": "win", "wins": "win", "won": "win",
    "winning": "win", "keep": "keep", "keeps": "keep", "kept": "keep", "feel": "feel", "feels": "feel",
    "felt": "feel", "hear": "hear", "hears": "hear", "heard": "hear", "hold": "hold", "holds": "hold",
    "held": "hold", "become": "become", "becomes": "become", "became": "become", "build": "build", "builds": "build",
    "built": "build", "fall": "fall", "falls": "fall", "fell": "fall", "fallen": "fall", "forget": "forget",
    "forgets": "forget", "forgot": "forget", "forgotten": "forget", "understand": "understand", "understands": "understand", "understood": "understand",
    "choose": "choose", "chooses": "choose", "chose": "choose", "chosen": "choose", "break": "break", "breaks": "break",
    "broke": "break", "broken": "break", "wake": "wake", "wakes": "wake", "woke": "wake", "woken": "wake",
    "child": "child", "children": "child", "man": "man", "men": "man", "woman": "woman", "women": "woman",
    "foot": "foot", "feet": "foot", "tooth": "tooth", "teeth": "tooth", "mouse": "mouse", "mice": "mouse",
}

# 连字符词算一个词(T-shirt / hard-working),与前端 tokenize 同一个正则
_TOKEN_RE = re.compile(r"[A-Za-z']+(?:-[A-Za-z']+)*")


def _clean(s: str) -> str:
    """小写并去掉首尾非字母字符（保留内部空格）"""
    return re.sub(r"^[^a-z]+|[^a-z]+$", "", s.lower())


def _stem(raw: str) -> str:
    """把一个词归一成词干，吃掉常见屈折后缀"""
    w = _clean(raw)
    if not w:
        return ""
    if w in _IRREGULAR:
        return _IRREGULAR[w]
    s = w
    ing_ed = False
    if len(s) >= 5 and s.endswith("ing"):
        s = s[:-3]
        ing_ed = True
    elif len(s) >= 4 and s.endswith("ies"):
        s = s[:-3] + "y"
    elif len(s) >= 4 and s.endswith("ied"):
        s = s[:-3] + "y"
    elif len(s) >= 4 and s.endswith("es"):
        s = s[:-2]
    elif len(s) >= 4 and s.endswith("ed"):
        s = s[:-2]
        ing_ed = True
    elif len(s) >= 3 and s.endswith("s") and not s.endswith("ss"):
        s = s[:-1]
    # 加 -ing/-ed 时双写的辅音还原: getting→get, stopped→stop(只对 -ing/-ed,ll/ss/ff/zz 不动)
    if ing_ed and len(s) >= 4 and s[-1] == s[-2] and s[-1] in "bcdgkmnprtv":
        s = s[:-1]
    if s.endswith("e"):  # introduce/introduces 都归到 introduc
        s = s[:-1]
    return s


def _common_prefix_len(a: str, b: str) -> int:
    i = 0
    while i < len(a) and i < len(b) and a[i] == b[i]:
        i += 1
    return i


def find_blank_span(sentence: str, target: str):
    """返回句子中应挖空的字符区间 (start, end)，找不到返回 None。"""
    if not sentence or not target:
        return None
    tw = [t for t in _clean(target).split() if t]
    toks = [(m.group(0), m.start(), m.end()) for m in _TOKEN_RE.finditer(sentence)]
    if not tw or not toks:
        return None

    t_stems = [_stem(t) for t in tw]

    # 滑窗匹配整个短语/单词：每个位置 stem 相等或原词相等即算命中
    for i in range(0, len(toks) - len(tw) + 1):
        ok = True
        for k in range(len(tw)):
            text = toks[i + k][0]
            if _stem(text) != t_stems[k] and _clean(text) != tw[k]:
                ok = False
                break
        if ok:
            return (toks[i][1], toks[i + len(tw) - 1][2])

    # 单词兜底：罕见变形用「公共前缀 ≥3 且接近词长」选最接近的 token
    if len(tw) == 1:
        base = tw[0]
        best = None
        for text, start, end in toks:
            c = _clean(text)
            lcp = _common_prefix_len(c, base)
            if lcp >= 3 and lcp >= len(base) - 2:
                if best is None or abs(len(c) - len(base)) < abs(len(_clean(best[0])) - len(base)):
                    best = (text, start, end)
        if best:
            return (best[1], best[2])

    return None


def blank_out(sentence: str, word: str, placeholder: str = "______"):
    """把句子里的目标词换成占位符，挖不出空返回 None（调用方应跳过该词）。"""
    span = find_blank_span(sentence, word)
    if span is None:
        return None
    start, end = span
    return sentence[:start] + placeholder + sentence[end:]


def can_blank(sentence, word: str) -> bool:
    """该例句能否给目标词挖空（用于筛掉展示不了横线的词）"""
    return bool(sentence) and find_blank_span(sentence, word) is not None
