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
             ) -> List[Tuple[str, float, float]]:
        """candidates: {词: 音素token列表} → [(词, 排序分, 逐帧分)] 按排序分降序

        返回两个分,用途不同:
        - **排序分** = 除音素数。候选之间比大小用,MARGIN_UNCERTAIN 按它标定。
        - **逐帧分** = 再除帧数 T。绝对门槛(SCORE_FLOOR)用它。

        为什么必须分开:排序分在**所有帧**上累加负对数概率却只除音素数,
        所以录音越长分越低 —— 同一个 bad,0.98 秒的 TTS 得 -0.78,
        4.58 秒的真人录音得 -15.19。量的是长度不是发音质量。
        浏览器录音天然比 TTS 长得多(VAD 要静 600ms 才停,前后都带静音),
        拿排序分做绝对门槛必然把真人全判成"没在读词"(2026-09-03 实测:
        11 条真实录音 100% 被 -5.0 的地板拦掉,而它们的音频质量没问题,
        RMS 0.033~0.100 对比 TTS 的 0.051,峰值还更高)。
        除以 T 之后量纲变成"每帧平均对数概率",与音频长短无关,才能当门槛。
        """
        return self._rank_on(self.logits(audio), candidates)

    def _rank_on(self, logp, candidates: Dict[str, List[str]]
                 ) -> List[Tuple[str, float, float]]:
        """在**已算好的** logits 上打分。rank() 和 rank_and_hear() 共用,
        避免同一段音频推理两遍(CPU 上一次 0.65 秒)。"""
        T = max(int(logp.shape[0]), 1)
        scored = []
        for word, toks in candidates.items():
            ids = self._ids(toks)
            if not ids:
                continue
            s = self.ctc_logprob(logp, ids)
            per_frame = s * len(ids) / T if s > -math.inf else -math.inf
            scored.append((word, s, per_frame))
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

# 绝对分数地板 —— 判「这段音压根不是在读本节任何词」(静音/噪音/说中文)。
# ⚠️ 比的是 rank() 的**逐帧分**(第 3 个值),不是排序分。原因见 rank() 的说明:
#    排序分随录音长度漂移,拿它当门槛会把真人全拦掉。
#
# 为什么必须有这道闸:judge() 的 pass/confused 只看**相对排序**,从不看绝对值。
# 一段静音照样有个"最像"的词,分差还可能落进 MARGIN_UNCERTAIN 被
# 「差距小,按读对处理」放过 —— 实测 1 秒真实静音 webm 判 pass(best=bee,
# margin=0.553)。前端 VAD 只看音量,空调声/手机摩擦声都能过。
#
# 数值由 scripts/calibrate_score_floor.py 标定(真人录音 + 标准音 + 各类非语音)。
# 标定口径:取真人真实读词的最低逐帧分,再往下留一截余量。
#
# ⚠️ 童声比 Edge TTS 糊,分数更低。这个值和 MARGIN_UNCERTAIN 方向相反 ——
#    只该**调小**(更宽松)。孩子反复读同一个词过不去,先查是不是撞了这条。
# 2026-09-03 标定结论:**这条门槛做不到,已停用**(设成极小值 = 永不触发)。
# scripts/calibrate_score_floor.py 在真人录音上跑出来:
#     真人读词最低逐帧分  -1.019
#     非语音最高逐帧分    -0.354   ← 比真人还高
# 两簇完全重叠,任何门槛要么漏噪音、要么拦真人。而误拦一个认真读的孩子
# 比漏过一次噪音严重得多(判错一次孩子就不敢开口),所以放弃绝对门槛。
# 静音由前端 VAD + 服务端 0.2 秒最短时长兜。
# 想重开先跑那个标定脚本,两簇分开了再谈。
SCORE_FLOOR = -99.0


def judge(scores: List[Tuple], target: str) -> dict:
    """闭集得分 → 判定

    scores: rank() 的输出 [(词, 排序分, 逐帧分)]。也兼容只有 2 元的老格式
            (那时地板检查自动跳过 —— 拿排序分当门槛会误拦真人,宁可不判)。

    verdict: pass / confused(念成了本节另一个词) / not_speech(压根没在读词) /
             uncertain
    """
    if not scores:
        return {"verdict": "uncertain", "best": None, "margin": 0.0}

    # 先过绝对分数地板:连最像的那个都低于地板 = 这段音不是在读本节的词
    # (静音/噪音/说中文/哼歌)。必须在相对排序之前判 —— 排序对噪音输入
    # 本来就不可靠(同一段静音换个候选集,verdict 会从 pass 抖成 confused)。
    #
    # ⚠️ 用**逐帧分**(下标 2)。用排序分会随录音长短漂移:实测 11 条真人录音
    #    100% 被排序分的地板拦掉,而音频质量完全正常。
    if len(scores[0]) >= 3:
        per_frame = scores[0][2]
        if per_frame < SCORE_FLOOR:
            return {"verdict": "not_speech", "best": scores[0][0],
                    "margin": 0.0, "score": round(per_frame, 3),
                    "note": "没听出在读这一节的词"}

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
                "runner_up": next((w for w, *_ in scores if w != target), None)}

    margin = best_score - tgt
    if margin < MARGIN_UNCERTAIN:
        # 差距太小,声学上分不开 —— 判不准就当读对,不冤枉孩子
        return {"verdict": "pass", "best": best_word, "margin": round(margin, 3),
                "note": "差距小,按读对处理"}
    return {"verdict": "confused", "best": best_word, "margin": round(margin, 3)}
