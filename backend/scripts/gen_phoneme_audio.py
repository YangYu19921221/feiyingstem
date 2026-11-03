"""生成音标键盘上 48 个音的发音 → frontend/public/phonemes/*.mp3

为什么要切: 发音引擎(Edge TTS)只会读单词,不认 IPA 标签(11-03 实测 <phoneme> 发过去没有声音)。
全站只许一个声音(en-GB-SoniaNeural),所以让她读一批单词,再把要的那个音切出来。

三步(第 2 步要判定服务那台机器上的模型,所以拆开):
  1. 本机: python -I gen_phoneme_audio.py tts <工作目录>
       读 MANIFEST 里的单词,出 {词}.16k.wav(给模型)和 {词}.24k.wav(切音用)
  2. 生产机(有 /root/wav2vec2-phoneme 和 venv_judge): 把 16k wav、manifest.json、本文件传上去,
       venv_judge/bin/python -I gen_phoneme_audio.py align <wav目录> <manifest.json> <spans.json>
       CTC 强制对齐,出每个音的尖峰位置。用 nice -n 19 跑,49 个词一两分钟
  3. 本机: python -I gen_phoneme_audio.py cut <工作目录> <spans.json> <输出目录>
       按尖峰圈范围、按声学变化(响度 / 过零率 / 频谱重心)找边界切,淡入淡出,峰值拉到 -2dB,
       再 ffmpeg 转 mp3(48k)放进 frontend/public/phonemes。

切完一定要听一遍。别拿模型当裁判: 它是按整词训练的,单独一个 /s/ 它常听成 l n m(11-03 试过,
48 个里一半排不到第一),但频谱上看切得是对的。

切法(和 MANIFEST 的第 6 项对应):
  vow  元音: 取 s / h / 词首后面那段(see→/iː/、hat→/æ/),后面接塞音或词尾,边界最好找
  end  能拖长的辅音: 取词尾(bus→/s/、hum→/m/、beige→/ʒ/),词尾读得最长最清楚
  tail 爆破音和 r l w j h tr dr: 单独切只有「嗒」一下,带一小段后面的 /ʌ/ 再淡出(/bʌ/,老师也这么教)
"""
import json
import sys

# 键 → (文件名, 源单词, 模型音素序列, 目标起, 目标止, 切法)。文件名和前端 utils/ipaPhonemes.ts 的 PHONEME_AUDIO 一致
MANIFEST = {
 'p':  ('p',  'pup',    ['p','ʌ','p'], 0,1,'tail'),
 'b':  ('b',  'bus',    ['b','ʌ','s'], 0,1,'tail'),
 't':  ('t',  'tub',    ['t','ʌ','b'], 0,1,'tail'),
 'd':  ('d',  'duck',   ['d','ʌ','k'], 0,1,'tail'),
 'k':  ('k',  'cup',    ['k','ʌ','p'], 0,1,'tail'),
 'ɡ':  ('g',  'gun',    ['ɡ','ʌ','n'], 0,1,'tail'),
 'h':  ('h',  'hut',    ['h','ʌ','t'], 0,1,'tail'),
 'r':  ('r',  'run',    ['r','ʌ','n'], 0,1,'tail'),
 'w':  ('w',  'one',    ['w','ʌ','n'], 0,1,'tail'),
 'j':  ('y',  'young',  ['j','ʌ','ŋ'], 0,1,'tail'),
 'l':  ('l',  'love',   ['l','ʌ','v'], 0,1,'tail'),
 'tr': ('tr', 'trunk',  ['t','r','ʌ','ŋ','k'], 0,2,'tail'),
 'dr': ('dr', 'drum',   ['d','r','ʌ','m'], 0,2,'tail'),
 'f':  ('f',  'puff',   ['p','ʌ','f'], 2,3,'end'),
 'v':  ('v',  'dove',   ['d','ʌ','v'], 2,3,'end'),
 's':  ('s',  'bus',    ['b','ʌ','s'], 2,3,'end'),
 'z':  ('z',  'buzz',   ['b','ʌ','z'], 2,3,'end'),
 'θ':  ('th', 'bath',   ['b','ɑː','θ'], 2,3,'end'),
 'ð':  ('dh', 'breathe',['b','r','iː','ð'], 3,4,'end'),
 'ʃ':  ('sh', 'push',   ['p','ʊ','ʃ'], 2,3,'end'),
 'ʒ':  ('zh', 'beige',  ['b','eɪ','ʒ'], 2,3,'end'),
 'ts': ('ts', 'cats',   ['k','æ','t','s'], 2,4,'end'),
 'dz': ('dz', 'beds',   ['b','e','d','z'], 2,4,'end'),
 'tʃ': ('ch', 'much',   ['m','ʌ','tʃ'], 2,3,'end'),
 'dʒ': ('dj', 'judge',  ['dʒ','ʌ','dʒ'], 2,3,'end'),
 'm':  ('m',  'hum',    ['h','ʌ','m'], 2,3,'end'),
 'n':  ('n',  'bun',    ['b','ʌ','n'], 2,3,'end'),
 'ŋ':  ('ng', 'sung',   ['s','ʌ','ŋ'], 2,3,'end'),
 'iː': ('ee', 'see',    ['s','iː'], 1,2,'vow'),
 'ɪ':  ('ih', 'hit',    ['h','ɪ','t'], 1,2,'vow'),
 'i':  ('i',  'happy',  ['h','æ','p','i'], 3,4,'vow'),
 'e':  ('e',  'get',    ['ɡ','e','t'], 1,2,'vow'),
 'æ':  ('ae', 'hat',    ['h','æ','t'], 1,2,'vow'),
 'ɑː': ('ar', 'car',    ['k','ɑː'], 1,2,'vow'),
 'ʌ':  ('uh', 'hut',    ['h','ʌ','t'], 1,2,'vow'),
 'ɒ':  ('o',  'hot',    ['h','ɒ','t'], 1,2,'vow'),
 'ɔː': ('or', 'saw',    ['s','ɔː'], 1,2,'vow'),
 'ʊ':  ('u',  'hook',   ['h','ʊ','k'], 1,2,'vow'),
 'uː': ('oo', 'shoe',   ['ʃ','uː'], 1,2,'vow'),
 'ɜː': ('er', 'sir',    ['s','ɜː'], 1,2,'vow'),
 'ə':  ('schwa','sofa', ['s','əʊ','f','ə'], 3,4,'vow'),
 'eɪ': ('ei', 'say',    ['s','eɪ'], 1,2,'vow'),
 'aɪ': ('ai', 'sigh',   ['s','aɪ'], 1,2,'vow'),
 'ɔɪ': ('oi', 'boy',    ['b','ɔɪ'], 1,2,'vow'),
 'əʊ': ('ou', 'so',     ['s','əʊ'], 1,2,'vow'),
 'aʊ': ('au', 'how',    ['h','aʊ'], 1,2,'vow'),
 'ɪə': ('ia', 'here',   ['h','ɪə'], 1,2,'vow'),
 'eə': ('ea', 'hair',   ['h','eə'], 1,2,'vow'),
 'ʊə': ('ua', 'tour',   ['t','ʊə'], 1,2,'vow'),
}
VOWELS = {'iː', 'ɪ', 'i', 'e', 'æ', 'ɑː', 'ʌ', 'ɒ', 'ɔː', 'ʊ', 'uː', 'ɜː', 'ə',
          'eɪ', 'aɪ', 'ɔɪ', 'əʊ', 'aʊ', 'ɪə', 'eə', 'ʊə'}


# ---------------------------------------------------------------- 1. 读单词
def cmd_tts(work):
    import asyncio
    import os
    import subprocess
    import edge_tts

    os.makedirs(work, exist_ok=True)

    async def one(word):
        # 慢一点读(-15%),切出来的音长一些
        c = edge_tts.Communicate(word, "en-GB-SoniaNeural", rate="-15%")
        data = b""
        async for ch in c.stream():
            if ch["type"] == "audio":
                data += ch["data"]
        open(f"{work}/{word}.mp3", "wb").write(data)

    async def main():
        words = sorted({v[1] for v in MANIFEST.values()})
        for w in words:
            await one(w)
            for sr in (16000, 24000):
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", f"{work}/{w}.mp3", "-ac", "1",
                                "-ar", str(sr), f"{work}/{w}.{sr // 1000}k.wav"], check=True)
        json.dump(MANIFEST, open(f"{work}/manifest.json", "w"), ensure_ascii=False)
        print(len(words), "个词")

    asyncio.run(main())


# ---------------------------------------------------------------- 2. 对齐(生产机)
def cmd_align(src, man, out):
    import wave
    import numpy as np
    import torch
    from transformers import Wav2Vec2FeatureExtractor, Wav2Vec2ForCTC

    torch.set_num_threads(1)
    md = "/root/wav2vec2-phoneme"
    vocab = json.load(open(f"{md}/vocab.json", encoding="utf-8"))
    blank = vocab.get("<pad>", 0)
    fe = Wav2Vec2FeatureExtractor.from_pretrained(md)
    model = Wav2Vec2ForCTC.from_pretrained(md).eval()

    def ids(tok):
        return [vocab[tok]] if tok in vocab else [vocab[c] for c in tok if c in vocab]

    def viterbi(logp, target):
        T = logp.shape[0]
        ext, owner = [blank], [-1]
        for j, t in enumerate(target):
            ext += [t, blank]
            owner += [j, -1]
        L = len(ext)
        neg = -1e30
        dp = np.full((T, L), neg)
        bp = np.zeros((T, L), dtype=int)
        dp[0, 0], dp[0, 1] = logp[0, ext[0]], logp[0, ext[1]]
        for t in range(1, T):
            for s in range(L):
                cands = [(dp[t - 1, s], s)]
                if s > 0:
                    cands.append((dp[t - 1, s - 1], s - 1))
                if s > 1 and ext[s] != blank and ext[s] != ext[s - 2]:
                    cands.append((dp[t - 1, s - 2], s - 2))
                v, p = max(cands)
                if v > neg:
                    dp[t, s], bp[t, s] = v + logp[t, ext[s]], p
        s = L - 1 if dp[T - 1, L - 1] >= dp[T - 1, L - 2] else L - 2
        path = [0] * T
        for t in range(T - 1, -1, -1):
            path[t] = s
            s = bp[t, s]
        return [owner[s] for s in path]

    m = json.load(open(man, encoding="utf-8"))
    res, cache = {}, {}
    for key, (_, word, toks, *_rest) in m.items():
        if word not in cache:
            with wave.open(f"{src}/{word}.16k.wav") as w:
                a = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype("float32") / 32768
            x = fe(a, sampling_rate=16000, return_tensors="pt").input_values
            with torch.no_grad():
                cache[word] = torch.log_softmax(model(x).logits[0], -1).numpy(), len(a) / 16000
        logp, dur = cache[word]
        fr = dur / logp.shape[0]
        target, tok_of = [], []
        for j, t in enumerate(toks):
            for i in ids(t):
                target.append(i)
                tok_of.append(j)
        spans = {}
        for f, o in enumerate(viterbi(logp, target)):
            if o >= 0:
                j = tok_of[o]
                lo, hi = spans.get(j, (f, f))
                spans[j] = (min(lo, f), max(hi, f))
        res[key] = {"word": word, "spans": {str(j): [lo * fr, (hi + 1) * fr] for j, (lo, hi) in spans.items()}}
    json.dump(res, open(out, "w"), ensure_ascii=False, indent=1)
    print("对齐了", len(res), "个")


# ---------------------------------------------------------------- 3. 切音
def cmd_cut(src, spans_p, out):
    import subprocess
    import wave
    import numpy as np
    S = json.load(open(spans_p))
    M = MANIFEST
    SR = 24000
    HOP = int(SR * 0.005)
    WIN = int(SR * 0.025)
    
    def read(p):
        with wave.open(p) as w:
            return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype("float64") / 32768
    
    def write(p, a):
        with wave.open(p, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
            w.writeframes((np.clip(a, -1, 1) * 32767).astype(np.int16).tobytes())
    
    def features(a):
        n = max(1, (len(a) - WIN) // HOP)
        win = np.hanning(WIN)
        freqs = np.fft.rfftfreq(WIN, 1 / SR)
        db, zc, cen = np.zeros(n), np.zeros(n), np.zeros(n)
        for i in range(n):
            f = a[i*HOP:i*HOP+WIN]
            db[i] = 20 * np.log10(np.sqrt((f ** 2).mean()) + 1e-9)
            zc[i] = (np.abs(np.diff(np.sign(f))) > 0).mean()
            sp = np.abs(np.fft.rfft(f * win)) + 1e-9
            cen[i] = (freqs * sp).sum() / sp.sum()
        sm = lambda x: np.convolve(x, np.ones(3) / 3, 'same')
        return sm(db), sm(zc), sm(cen)
    
    t2i = lambda t: max(0, int(round((t - WIN / SR / 2) * SR / HOP)))
    i2t = lambda i: i * HOP / SR + WIN / SR / 2
    
    def change_point(db, zc, cen, t0, t1):
        i0, i1 = t2i(t0), t2i(t1)
        if i1 - i0 < 3:
            return (t0 + t1) / 2
        lag = 3                      # 隔 15ms 比,抹掉逐帧抖动
        d = np.zeros(len(db))
        for i in range(lag, len(db) - lag):
            d[i] = (abs(db[i+lag] - db[i-lag]) / 10
                    + abs(zc[i+lag] - zc[i-lag]) * 6
                    + abs(cen[i+lag] - cen[i-lag]) / 1500)
        return i2t(i0 + int(np.argmax(d[i0:i1])))
    
    def fade(a, fin, fout):
        a = a.copy()
        ni, no = min(int(fin * SR), len(a) // 3), min(int(fout * SR), len(a) // 2)
        if ni: a[:ni] *= np.linspace(0, 1, ni)
        if no: a[-no:] *= np.linspace(1, 0, no) ** 1.5
        return a
    
    report = {}
    for key, (fname, word, toks, A, B, how) in M.items():
        a = read(f"{src}/{word}.24k.wav")
        db, zc, cen = features(a)
        loud = np.nonzero(db > db.max() - 40)[0]
        on, off = i2t(loud[0]) - 0.012, i2t(loud[-1]) + 0.015
        sp = S[key]["spans"]
        pk = [sp[str(j)][0] for j in range(len(toks))]          # 每个音的尖峰起点
        nxt = lambda j: pk[j + 1] if j + 1 < len(toks) else off
        fin, fout = 0.006, 0.035
        if how == 'tail':
            # 爆破音 / 流音: 带上后面一小段元音再淡出,不然只有「嗒」一声
            v = next(j for j in range(B, len(toks)) if toks[j] in VOWELS)
            vstart = change_point(db, zc, cen, pk[v - 1] + 0.01, pk[v] + 0.06)
            start, end, fout = on, vstart + 0.085, 0.07
        elif how == 'end':
            # 词尾的辅音: 从元音结束切到声音结束(词尾的辅音读得最长最清楚)
            start = change_point(db, zc, cen, pk[A - 1] + 0.05, pk[A] + 0.06) + 0.005
            end, fin = off, 0.012
        else:
            # 元音: 前面的辅音结束 → 后面的辅音开始(或声音结束)
            start = on if A == 0 else change_point(db, zc, cen, pk[A - 1] + 0.005, pk[A] + 0.05) + 0.015
            end = off if B == len(toks) else change_point(db, zc, cen, pk[A] + 0.08, nxt(A) + 0.06) - 0.005
            fin, fout = 0.02, 0.07
        seg = a[int(start * SR):int(end * SR)]
        seg = fade(seg, fin, fout)
        peak = np.abs(seg).max() + 1e-9
        gain = min(10 ** (15 / 20), 10 ** (-2 / 20) / peak)     # 峰值拉到 -2dB,最多放大 15dB
        write(f"{out}/{fname}.wav", np.concatenate([np.zeros(int(0.03 * SR)), seg * gain, np.zeros(int(0.06 * SR))]))
        report[key] = [word, round(float(start), 3), round(float(end), 3), round(float(end - start), 3)]
    json.dump(report, open(f"{out}/cuts.json", "w"), ensure_ascii=False)
    for k, v in report.items():
        print(k, v, "<-- 太短" if v[3] < 0.06 else "")
    for key, (fname, *_rest) in MANIFEST.items():
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", f"{out}/{fname}.wav", "-ac", "1", "-ar", "24000",
                        "-codec:a", "libmp3lame", "-b:a", "48k", f"{out}/{fname}.mp3"], check=True)
    print("mp3 在", out, "—— 听一遍,再拷到 frontend/public/phonemes/")


if __name__ == "__main__":
    cmd, *args = sys.argv[1:]
    {"tts": cmd_tts, "align": cmd_align, "cut": cmd_cut}[cmd](*args)
