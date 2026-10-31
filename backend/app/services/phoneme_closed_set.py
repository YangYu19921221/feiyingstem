"""闭集发音判定:算这段录音更像本节哪个词

## 为什么闭集
上一版做贪心解码(模型在 392 个音素里自由猜),整节 20 词只有 80% ——
错的是 bade→bæd、cab→kɑːb、bee→pi 这类。根因是模型不知道孩子**该**读什么,
在开放集里猜音素本来就难。

但我们知道答案。所以改成:算「这段音读成 kæb 的可能性」vs「读成 kɑːb / beɪd / …
的可能性」,取最高的那个。这是闭集打分(forced alignment),信息量比开放解码大得多。

## 判定口径
- best == 目标词 → 读对了
- best 是本节另一个词 → 念成了那个词(可以明确告诉孩子念串了)
- 目标词得分与最高分差得很少 → 判不准,当读对(宁可漏纠,不可假拒绝)

阈值方向只有一个:**宁可漏放**。判错一次孩子就不敢开口,而漏纠一次下节课还能补。

## 乱读也能过的洞(2026-10-30 补上,见 judge() 的「两道门」)
上面三条只看**相对排序**。一段乱读、一句中文、一声「啊」,照样有个「最像」的词,
目标词又常常落在 0.6 以内 → 判过。生产 10-30 用户自己乱读,整页都绿。
现在先过两道门(GOP_FLOOR / GATE_MARGIN),过了才轮到上面的排序判定。
"""
import math
from typing import Dict, List, Optional, Tuple

# ⚠️ 刻意**不在模块顶层** import torch:
# 主应用的 venv 不该被迫装 torch(2GB)。判定跑在独立进程里(模型占 2.6GB,
# 与主应用同进程会拖慢登录/交卷,而且生产机只剩 4.6GB 可用内存)。
# judge() / 阈值这些纯逻辑必须在没有 torch 的环境里也能 import 和单测。


def _torch():
    import torch
    return torch


def trim_silence(audio, thresh_ratio: float = 0.08, pad_ms: int = 60):
    """削掉首尾静音,只留说话那一段。

    浏览器录音前后必然带静音:孩子点了按钮才开口(前面一段),而 VAD 要
    连续静 600ms 才判定说完(后面一段)。实测真人录音 1.5~4.6 秒,而里面
    真正在发音的往往不到 1 秒 —— 剩下全是静音,却每一帧都在往 CTC 分数上
    累加负值。

    做法:按 20ms 一帧算能量,取"最大帧能量 × thresh_ratio"当阈值,
    找第一个和最后一个超阈值的帧,两头各留 pad_ms 的余量(不留会切掉
    /p/ /t/ /k/ 这类爆破音的起音和词尾的摩擦音)。
    用**相对**阈值而不是固定值:孩子离麦克风远近差很多,固定阈值对小声的
    孩子会把整段都当静音削光。

    削不出东西(整段都是静音)就原样返回,让判定逻辑去判 not_speech。
    """
    import numpy as np
    a = np.asarray(audio, dtype="float32").reshape(-1)
    if a.size < 16000 // 10:              # 短于 0.1 秒不折腾
        return a
    win = 320                             # 20ms @ 16k
    n = a.size // win
    if n < 3:
        return a
    frames = a[:n * win].reshape(n, win)
    energy = np.sqrt((frames.astype("float64") ** 2).mean(axis=1))
    peak = float(energy.max())
    if peak <= 1e-6:                      # 全静音
        return a
    loud = np.nonzero(energy >= peak * thresh_ratio)[0]
    if loud.size == 0:
        return a
    pad = max(1, pad_ms // 20)
    lo = max(0, int(loud[0]) - pad) * win
    hi = min(n, int(loud[-1]) + 1 + pad) * win
    out = a[lo:hi]
    # 削得只剩一丁点就别削了,交给上层判 not_speech
    return out if out.size >= win * 5 else a


class ClosedSetScorer:
    """给定音频与若干候选音素序列,算每个候选的 CTC 对数似然

    只在装了 torch 的判定进程里实例化;主应用只用 judge() 那部分纯逻辑。
    """

    def __init__(self, model, feature_extractor, vocab: Dict[str, int]):
        self.model = model
        self.fe = feature_extractor
        self.vocab = vocab
        self.blank = vocab.get('<pad>', 0)

    def _ids(self, tokens: List[str]) -> Optional[List[int]]:
        """音素 token → 模型词表 id。词表里没有的音素返回 None(该候选无法评分)"""
        out = []
        for t in tokens:
            if t == 'ˈ':                      # 重音符不参与声学判定
                continue
            if t in self.vocab:
                out.append(self.vocab[t])
                continue
            # 长音符在模型词表里可能拆成两个单元;逐字符退化
            sub = [self.vocab[c] for c in t if c in self.vocab]
            if not sub:
                return None
            out.extend(sub)
        return out or None

    def logits(self, audio):
        """→ [T, vocab] 的 log_softmax。推理前削掉首尾静音"""
        audio = trim_silence(audio)
        x = self.fe(audio, sampling_rate=16000, return_tensors="pt").input_values
        torch = _torch()
        with torch.no_grad():
            return torch.log_softmax(self.model(x).logits[0], dim=-1)

    def greedy(self, logp) -> List[str]:
        """同一份 logits 上做贪心解码 → 听到的音素序列。

        用途是判**错误类型**(词尾多加元音之类,见 phoneme_error_pattern),
        不参与闭集打分。**复用传进来的 logp,不重新推理** —— 模型跑一次
        既出闭集分又出音素串,额外开销只是一次 argmax。

        标准 CTC 折叠:去重复、去 blank。
        """
        self._inv = getattr(self, "_inv", None) or {v: k for k, v in self.vocab.items()}
        out: List[str] = []
        prev = None
        for i in logp.argmax(-1).tolist():
            if i != prev and i != self.blank:
                t = self._inv.get(i)
                if t:
                    out.append(t)
            prev = i
        return out

    def rank_and_hear(self, audio, candidates: Dict[str, List[str]]):
        """一次推理同时拿到 (排序结果, 听到的音素)。

        分开调 rank() 和 greedy() 会推理两遍 —— CPU 上一次 0.65 秒,
        白搭一倍。判定服务走这个入口。
        """
        logp = self.logits(audio)
        return self._rank_on(logp, candidates), self.greedy(logp)

    def ctc_logprob(self, logp, target: List[int]) -> float:
        """CTC forward 算 log P(target | audio),长度归一化

        标准 CTC forward:在 target 中间插 blank,DP 累加所有对齐路径的概率。
        除以 target 长度是必须的 —— 否则长词天然得分低,cab 会永远输给 ca。
        """
        T = logp.shape[0]
        # 扩展序列:blank t1 blank t2 blank … (长度 2L+1)
        ext = [self.blank]
        for t in target:
            ext.extend([t, self.blank])
        L = len(ext)
        if T < len(target):
            return -math.inf                  # 音频太短装不下这个词

        NEG = -1e30
        prev = [NEG] * L
        prev[0] = float(logp[0, ext[0]])
        if L > 1:
            prev[1] = float(logp[0, ext[1]])

        for t in range(1, T):
            cur = [NEG] * L
            for s in range(L):
                # 停在原位
                best = prev[s]
                # 从前一个状态来
                if s > 0:
                    best = max(best, prev[s - 1])
                # 跳过 blank(仅当当前非 blank 且与前前个 token 不同)
                if s > 1 and ext[s] != self.blank and ext[s] != ext[s - 2]:
                    best = max(best, prev[s - 2])
                if best > NEG:
                    cur[s] = best + float(logp[t, ext[s]])
            prev = cur

        end = max(prev[L - 1], prev[L - 2] if L > 1 else NEG)
        if end <= NEG:
            return -math.inf
        # 除音素数:候选之间比较用。不除帧数是**故意**的 —— T 在同一次比较里
        # 恒定,除了不改排序;而不除能让「音素数」这个量纲留在分里,
        # MARGIN_UNCERTAIN=0.6 就是按这个量纲标定的,改了它得重标。
        return end / max(len(target), 1)

    def rank(self, audio, candidates: Dict[str, List[str]]
             ) -> List[Tuple[str, float, float, float]]:
        """candidates: {词: 音素token列表} → [(词, 排序分, 逐帧分, 贴合分)] 按排序分降序

        三个分,用途不同:
        - **排序分** = 维特比总分 ÷ 音素数。候选之间比大小用,MARGIN_UNCERTAIN / GATE_MARGIN 按它标定。
        - **逐帧分** = 再除帧数 T。只留着排查用(曾拿它做绝对门槛,标定失败,见 judge())。
        - **贴合分(GOP)** = (强制读成这个词的总分 − 模型自由听的最好总分) ÷ 音素数。
          0 = 和模型自己听到的一样好,越负越不像这个词。GOP_FLOOR 用它。

        为什么排序分不能当绝对门槛:它在**所有帧**上累加负对数概率却只除音素数,
        录音越长分越低 —— 同一个 bad,0.98 秒的 TTS 得 -0.78,4.58 秒的真人录音得 -15.19。
        贴合分减掉了「自由听的最好分」,静音帧两边一起扣,长短抵掉了,所以它能当门槛。
        """
        return self._rank_on(self.logits(audio), candidates)

    def _rank_on(self, logp, candidates: Dict[str, List[str]]
                 ) -> List[Tuple[str, float, float, float]]:
        """在**已算好的** logits 上打分。rank() 和 rank_and_hear() 共用,
        避免同一段音频推理两遍(CPU 上一次 0.65 秒)。

        logp 可以是 torch 张量也可以是 numpy 数组(测试用后者,主应用 venv 不装 torch)。
        """
        T = max(int(logp.shape[0]), 1)
        mx = logp.max(-1)
        best_path = float(getattr(mx, "values", mx).sum())   # 每帧都取最像的那个 token
        scored = []
        for word, toks in candidates.items():
            ids = self._ids(toks)
            if not ids:
                continue
            s = self.ctc_logprob(logp, ids)
            if s > -math.inf:
                per_frame = s * len(ids) / T
                gop = (s * len(ids) - best_path) / len(ids)
            else:
                per_frame = gop = -math.inf
            scored.append((word, s, per_frame, gop))
        scored.sort(key=lambda x: -x[1])
        return scored


# 目标词与最高分的差距小于这个值就当判不准 → 按读对处理(宁可漏放)。
#
# 0.6 是从实测数据定的,不是拍的:整节 20 词里判错的三个,目标词与最高分的差距是
#   bee  0.19(fee -2.82 vs bee -3.01)
#   bed  0.31(bad -1.64 vs bed -1.95)
#   bade 1.50(bad -0.40 vs bade -1.90)
# 前两个是声学上真的分不开(Edge TTS 标准音都分不开,孩子只会更糊),
# 必须吸收;bade 那种 1.5 的差距才是真念错。取 0.6 卡在中间。
# 真实童声会更糊,所以这个值将来只该调大不该调小。
MARGIN_UNCERTAIN = 0.6

# ── 两道门(2026-10-30,用户「乱读不要过 还是要有一定的正确率」)──────────────
# 免费方案里实测最好的一种:还是现在这个模型,只是多问一句「这段音和目标词贴得多近」。
# (试过的另外两种都更差: 和标准录音逐帧比 DTW、换 L2-ARCTIC 中国学生英语模型 ——
#  后者把真孩子的录音拦掉一半。收费的讯飞更准,用户嫌按次收费没用。)
#
# 标定(/tmp/pron_eval,生产机跑的): 本节 20 个词 × 7 个声音(含 2 个中国口音 TTS)+
# 15 段乱读 / 中文 / 噪音 + 生产 52 条真实录音。在「10-03 那批认真读的真孩子录音 9/9 都过、
# 10-30 那 5 条乱读 / 说中文 / 说一句话的真实录音都拦」的前提下挑放过乱读最少的:
#     读对的过 133/140(中国口音 35/40)   乱读放过 5.3%   念成本节别的词放过 23.6%
# 9 条真孩子录音里最低的贴合分 -3.59、最低的相对分 -3.12 —— 门槛离它们还有一截,
# 5 条乱读最高的贴合分 -11.91。
#
# ⚠️ 方向: 孩子认真读却过不了,比乱读偶尔过一次严重得多。这两个值**只该往宽调**
#    (更负)。要收紧先拿生产 private_media/phonetic_audio 里新攒的真孩子录音重跑标定。
GOP_FLOOR = -5.5       # 目标词贴合分低于它 = 读得不像这个词
GATE_MARGIN = -3.25    # 目标词排序分比本节最像的别的词低这么多 = 明显在读别的词


# ── 中国口音放宽(2026-10-31,用户「现在是不是有点严格很难绿」)───────────────────
# 线上那 40 条录音里,cab 读了 15 遍: 模型每次都听成 kha5 / khɑu5(æ 听成中文的 a、词尾 b 没听见),
# 贴合分 -7.0 ~ -7.7,和说「hello」「water」对 cab 的分数一样低 —— 光看贴合分分不开「带口音读对」和「乱说」。
# 第二个信号是**听到的音素骨架**: 开头辅音(清浊不分,b=p)+ 第一个元音的大类(æ=a=ɑ)对得上目标词。
# 「啊」没有开头辅音、「hello」开头是 h、「water」开头是 w,都对不上;kha 对 cab 对得上。
# 两道门没过、但贴合分 ≥ ACCENT_FLOOR 且骨架对上 → 算过(标黄: 过了,但口音还重)。
# 线上判定服务实测(10-31): 读对 100 次 92 → 93 过;240 段乱读 / 中文 / 别的英语词放过 9 → 11
# (多放的是「嗯嗯」对 dab / dad,听成 thai5ti5);那 40 条录音 5 → 22 过。
# 元音开头的词(ace / add / ebb)不放宽: 只有一个元音可比,「啊」对 add 就能对上。
ACCENT_FLOOR = -8.5

_CONS_CLASS = {
    "p": "P", "b": "P", "t": "T", "d": "T", "k": "K", "ɡ": "K", "g": "K",
    "f": "F", "v": "F", "θ": "TH", "ð": "TH", "s": "S", "z": "S", "ʃ": "SH", "ʒ": "SH", "ɕ": "SH", "ʂ": "SH",
    "tʃ": "CH", "dʒ": "CH", "tɕ": "CH", "ʈʂ": "CH", "ts": "TS", "dz": "TS", "tr": "TR", "dr": "TR",
    "m": "M", "n": "N", "ŋ": "NG", "h": "H", "x": "H", "l": "L", "r": "R", "ɹ": "R", "w": "W", "j": "J",
}
_HEARD_VOWEL = {
    "i": "I", "ɪ": "I", "y": "I", "e": "E", "ɛ": "E",
    "a": "A", "æ": "A", "ɑ": "A", "ɐ": "A", "ʌ": "A",
    "o": "O", "ɔ": "O", "ɒ": "O", "u": "U", "ʊ": "U", "ə": "@", "ɜ": "@", "ɚ": "@",
}
# 目标元音 → 听到哪些元音大类算对得上(中国口音 æ 常听成 a、eɪ 听成 ei / e、əʊ 听成 o / ə)
_TARGET_VOWEL = {
    "iː": {"I"}, "ɪ": {"I"}, "i": {"I"}, "e": {"E"}, "æ": {"A", "E"}, "ɑː": {"A"}, "ʌ": {"A", "@"},
    "ɒ": {"O", "A"}, "ɔː": {"O"}, "ʊ": {"U"}, "uː": {"U"}, "ɜː": {"@"}, "ə": {"@", "A"},
    "eɪ": {"E"}, "aɪ": {"A"}, "ɔɪ": {"O"}, "əʊ": {"O", "@"}, "aʊ": {"A"}, "ɪə": {"I"}, "eə": {"E"}, "ʊə": {"U"},
}


def _heard_skeleton(heard: str):
    """听到的音素串 → (开头辅音大类 / None, 第一个元音大类 / None, 元音段数)"""
    import re
    s = re.sub(r"[0-9ːʰʔˈˌ]", "", heard or "")
    # 中文送气音模型写成 kh / th / ph / tɕh: 送气不送气不区分
    s = s.replace("tɕh", "tɕ").replace("ʈʂh", "ʈʂ").replace("tsh", "ts").replace("kh", "k").replace("th", "t").replace("ph", "p")
    onset = None
    if s and s[0] not in _HEARD_VOWEL:
        for n in (2, 1):
            if s[:n] in _CONS_CLASS:
                onset = _CONS_CLASS[s[:n]]
                break
        else:
            onset = "?"
    vowel = next((_HEARD_VOWEL[c] for c in s if c in _HEARD_VOWEL), None)
    groups, prev = 0, False
    for c in s:
        v = c in _HEARD_VOWEL
        if v and not prev:
            groups += 1
        prev = v
    return onset, vowel, groups


def skeleton_match(heard: str, target_tokens: List[str]) -> bool:
    """开头辅音(清浊不分)+ 第一个元音大类对得上,且没多出一个以上音节"""
    toks = [t for t in (target_tokens or []) if t not in ("ˈ", "ˌ")]
    if not toks or toks[0] not in _CONS_CLASS:
        return False                      # 元音开头的词不放宽(见上)
    t_vowels = [t for t in toks if t in _TARGET_VOWEL]
    if not t_vowels:
        return False
    onset, vowel, groups = _heard_skeleton(heard)
    if onset != _CONS_CLASS[toks[0]] or vowel not in _TARGET_VOWEL[t_vowels[0]]:
        return False
    return groups <= len(t_vowels) + 1


def vowel_mismatch(heard: Optional[str], target_tokens: Optional[List[str]]) -> Optional[str]:
    """听到的**只有元音没有开头辅音**、且元音大类对不上目标词 → 返回目标元音(拦下用);否则 None

    2026-10-31 用户「我发现乱读会过 我读ooo 给我过了」: 对 fee 读「ooo」,模型听成 aː,
    两道门给过了(fee 只有 f + iː 两个音,一个拖长的元音和它的分差不大)。
    只在**没听到开头辅音**时否决: 有辅音开头的,模型常把元音听偏(标准音 fee 听成 fei5、
    babe 听成 paɪ),拿元音否决会冤枉读对的 —— 实测那样会拦掉 100 次读对里的 10 次;
    只看没辅音开头的,100 次读对 0 次被拦,「ooo」「啊」照样拦。
    """
    toks = [t for t in (target_tokens or []) if t not in ("ˈ", "ˌ")]
    tv = next((t for t in toks if t in _TARGET_VOWEL), None)
    if heard is None or tv is None:
        return None
    onset, vowel, _ = _heard_skeleton(heard)
    if onset is not None or vowel is None:
        return None
    # e 开头的 ebb / def: 中国口音常读成 a(美音 ebb 也听成 aːb),不拿 a 否决
    allowed = _TARGET_VOWEL[tv] | ({"A"} if tv == "e" else set())
    return None if vowel in allowed else tv


def judge(scores: List[Tuple], target: str, heard: Optional[str] = None,
          target_tokens: Optional[List[str]] = None) -> dict:
    """闭集得分 → 判定。见 _judge_core;外面再加一道「元音对不上」的否决(vowel_mismatch)"""
    r = _judge_core(scores, target, heard, target_tokens)
    if r["verdict"] in ("pass", "confused", "uncertain"):
        tv = vowel_mismatch(heard, target_tokens)
        if tv:
            return {**r, "verdict": "not_close", "best": r.get("best"), "accent": False,
                    "note": "元音对不上", "error_code": "wrong_vowel",
                    "error_hint": f"听着元音不对,这个词要读 /{tv}/,先点「听标准音」听清楚再读"}
    return r


def _judge_core(scores: List[Tuple], target: str, heard: Optional[str] = None,
                target_tokens: Optional[List[str]] = None) -> dict:
    """闭集得分 → 判定

    scores: rank() 的输出 [(词, 排序分, 逐帧分, 贴合分)]。也兼容只有 2 / 3 元的老格式
            (那时两道门自动跳过,只按相对排序判)。

    heard / target_tokens: 听到的音素串、目标词音素(判定服务传;不传就不做口音放宽)

    verdict:
      not_close  读得不像这个词(乱读 / 说中文 / 只「啊」一声)—— 拦
      wrong_word 明显读成了本节另一个词 —— 拦,best 是那个词
      pass       读对了
      confused   过了两道门,但另一个词更像(差 ≥ MARGIN_UNCERTAIN)—— 放过,只当提示
      uncertain  判不准 —— 放过
    返回里带 gop / gate_margin,存库供以后重新标定。
    """
    if not scores:
        return {"verdict": "uncertain", "best": None, "margin": 0.0}

    tgt_row = next((r for r in scores if r[0] == target), None)
    if tgt_row is None:
        return {"verdict": "uncertain", "best": scores[0][0], "margin": 0.0}

    # ── 两道门。必须在相对排序之前判: 排序只说「更像哪个」,不说「像不像」 ──
    if len(tgt_row) >= 4:
        gop = tgt_row[3]
        others = [r for r in scores if r[0] != target]
        top_other = max(others, key=lambda r: r[1]) if others else None
        gate_margin = (tgt_row[1] - top_other[1]) if top_other else math.inf
        info = {"gop": _r(gop), "gate_margin": _r(gate_margin)}
        if gate_margin < GATE_MARGIN and top_other[3] >= GOP_FLOOR:
            # 另一个词既明显更像、本身也读得像 —— 能明确说读成了哪个
            return {"verdict": "wrong_word", "best": top_other[0],
                    "margin": _r(-gate_margin), **info}
        if gop < GOP_FLOOR or gate_margin < GATE_MARGIN:
            if heard is not None and gop >= ACCENT_FLOOR and skeleton_match(heard, target_tokens):
                # 带中国口音读对了: 贴合分不够,但听到的骨架对得上(见 ACCENT_FLOOR)
                return {"verdict": "pass", "best": target, "margin": 0.0, "accent": True,
                        "note": "口音放宽", **info}
            return {"verdict": "not_close", "best": scores[0][0], "margin": 0.0,
                    "note": "读得不像这个词", **info}
    else:
        info = {}

    tgt = next((s for w, s, *_ in scores if w == target), None)
    if tgt is None:
        return {"verdict": "uncertain", "best": scores[0][0], "margin": 0.0}

    # 平分时目标词优先:实测 bee/beef 会算出完全相同的分(-1.67),
    # 那时排序只由字典序决定 —— 不能让孩子的对错取决于字典序
    best_word, best_score = scores[0][0], scores[0][1]
    if best_score == tgt:
        best_word = target

    if best_word == target:
        return {"verdict": "pass", "best": target, "margin": 0.0,
                "runner_up": next((w for w, *_ in scores if w != target), None), **info}

    margin = best_score - tgt
    if margin < MARGIN_UNCERTAIN:
        # 差距太小,声学上分不开 —— 判不准就当读对,不冤枉孩子
        return {"verdict": "pass", "best": best_word, "margin": round(margin, 3),
                "note": "差距小,按读对处理", **info}
    return {"verdict": "confused", "best": best_word, "margin": round(margin, 3), **info}


# ── 三种颜色(2026-10-31,用户「完全不对的差别大的标红 接近标黄 完全正确就绿」)──────
# 颜色只管「给孩子看读得怎么样」,**过不过关仍按 judge() 的 verdict**,这里不改门槛。
#   绿 = 判定通过且没挑出毛病
#   黄 = 接近: ①通过了但词尾多带了一个音(error_code,中国孩子最常见、能照着改)
#              ②靠口音放宽才过的(accent,见 ACCENT_FLOOR)
#              ③没通过但贴合分 ≥ NEAR_FLOOR(差一点)
#   红 = 差得多: 贴合分更低,或明显读成了本节另一个词
# confused(另一个词更像一点)仍算绿: 用 Edge TTS 英美标准音读对的 60 次里有 7 次被判 confused
# (beef→bee、bed→bad、bade→bad),是模型分不开,不是读错 —— 标黄就是冤枉读对的孩子。
#
# NEAR_FLOOR 标定(10-31 线上判定服务,第 1 册 1—1): 100 次读对的(5 个声音含 2 个中国口音)里
# 8 次没过两道门,贴合分 -5.5 ~ -6.6,全落在黄;48 段乱读 / 中文 / 别的英语词全部没过,
# 其中只有「啊」「嗯嗯」「你好」这类很短的声音落在 -5.5 ~ -6.9(7 段黄),其余 41 段红。
NEAR_FLOOR = -7.0


def grade(verdict: Optional[str], gop: Optional[float], error_code: Optional[str] = None,
          accent: bool = False) -> Optional[str]:
    """→ 'green' / 'yellow' / 'red';没声音(silent)/ 没判出来(off)不是对读音的判断,返回 None 不上色

    accent = 靠口音放宽才过的(见 ACCENT_FLOOR): 过了但标黄,跟标准音比还有差距"""
    if verdict in ("pass", "confused", "uncertain"):
        return "yellow" if (error_code or accent) else "green"
    if verdict == "not_close":
        if error_code == "wrong_vowel":
            return "red"                  # 元音都不对(读「ooo」),不算接近
        return "yellow" if gop is not None and gop >= NEAR_FLOOR else "red"
    if verdict in ("wrong_word", "not_speech"):
        return "red"
    return None


def _r(x: float) -> Optional[float]:
    """-inf(音频太短装不下这个词)给 None,JSON 里放不下无穷"""
    return round(x, 3) if x > -math.inf and x < math.inf else None
