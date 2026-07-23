import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Volume2, Check, X as XIcon, RefreshCw } from 'lucide-react';
import { listSentences, type Sentence } from '../api/sentences';
import { reportStudyTime } from '../api/learningRecords';
import useIdleDetector from '../hooks/useIdleDetector';
import { useAudio } from '../hooks/useAudio';
import { toast } from '../components/Toast';
import { parseError } from '../utils/errorMessage';
import { normalizeAnswer } from '../utils/normalizeAnswer';
import { imeSafeInputProps } from '../utils/noSuggestInput';
import { usePreventCopy } from '../hooks/usePreventCopy';

type Mode = 'choice' | 'dictation';

/**
 * 句子背诵学习页：
 * - choice: 英翻中四选一（中文选项里只有一个是正确翻译，其它从同单元里随机抽干扰）
 * - dictation: 听句子写英文，错答需照抄正确句子 3 遍才放行（与 SpellingPractice 一致）
 */
export default function SentenceLearning() {
  usePreventCopy();  // 防划走答案:禁右键/复制/选中(输入框内放行)
  const navigate = useNavigate();
  const { bookId, unitId } = useParams<{ bookId: string; unitId: string }>();
  const uid = parseInt(unitId || '0', 10);
  const { playAudio } = useAudio();

  const [mode, setMode] = useState<Mode>('choice');
  const [sentences, setSentences] = useState<Sentence[]>([]);
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState(0);
  const [done, setDone] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [wrongCount, setWrongCount] = useState(0);

  // ── 学习时长上报:背诵没有逐题落库,单独按净活动时长计入学习日历 ──
  // 空闲检测:鼠标点击/移动、键盘、触摸都算活动信号;无操作60秒或切后台→暂停计时
  const isIdle = useIdleDetector();
  const startTimeRef = useRef(Date.now());
  const idleStartRef = useRef(0);
  useEffect(() => {
    if (isIdle) {
      idleStartRef.current = Date.now();
    } else if (idleStartRef.current > 0) {
      startTimeRef.current += Date.now() - idleStartRef.current; // 挂机时段不计入
      idleStartRef.current = 0;
    }
  }, [isIdle]);
  // 已上报的净活动秒数,每次只报增量(与单词学习页 takeSessionDelta 同一口径)
  const lastReportedSecRef = useRef(0);
  const reportDelta = useCallback(() => {
    let start = startTimeRef.current;
    if (idleStartRef.current > 0) start += Date.now() - idleStartRef.current; // 正在挂机的这段也扣掉
    const net = Math.round((Date.now() - start) / 1000);
    const delta = net - lastReportedSecRef.current;
    lastReportedSecRef.current = net;
    if (delta > 0) reportStudyTime(delta).catch(() => {});
  }, []);
  // 完成一组时结一次;退出页面(含中途返回)把尾巴补上
  useEffect(() => { if (done) reportDelta(); }, [done, reportDelta]);
  useEffect(() => () => reportDelta(), [reportDelta]);

  useEffect(() => {
    if (!uid) return;
    (async () => {
      try {
        const list = await listSentences(uid);
        setSentences(list);
      } catch (err: any) {
        toast.error(parseError(err, '加载失败').message);
      } finally { setLoading(false); }
    })();
  }, [uid]);

  const cur = sentences[idx];

  const restart = () => {
    setIdx(0); setDone(false); setCorrectCount(0); setWrongCount(0);
  };

  // 统一返回上一层（单元列表）：用 navigate(-1) 出栈。
  // 不要 navigate 到单元页 URL —— 那是 push，会和单元页自身的 navigate(-1)
  // 形成 学习页⇄单元页 无限来回（点返回一直循环）。
  const goBack = () => navigate(-1);

  const handleResult = (ok: boolean) => {
    if (ok) setCorrectCount(c => c + 1);
    else setWrongCount(w => w + 1);
  };

  const goNext = () => {
    if (idx + 1 >= sentences.length) setDone(true);
    else setIdx(i => i + 1);
  };

  if (loading) {
    return <CenterText text="加载中…" />;
  }
  if (sentences.length === 0) {
    return (
      <Shell title="句子背诵" onBack={goBack}>
        <div className="py-20 text-center text-sm text-ink-mute">该单元还没有句子</div>
      </Shell>
    );
  }
  if (done) {
    const total = correctCount + wrongCount;
    const acc = total > 0 ? Math.round((correctCount / total) * 100) : 0;
    return (
      <Shell title="本组完成" onBack={goBack}>
        <div className="py-12 text-center">
          <div className="text-5xl mb-3">🎉</div>
          <h2 className="font-display text-2xl font-semibold text-ink mb-2">练完啦</h2>
          <p className="text-sm text-ink-soft mb-6">
            答对 <span className="text-ink font-semibold">{correctCount}</span> · 答错 <span className="text-ink font-semibold">{wrongCount}</span> · 准确率 {acc}%
          </p>
          <div className="flex gap-3 justify-center">
            <button onClick={restart} className="px-5 py-2.5 rounded-xl border border-black/10 hover:bg-black/[0.02] inline-flex items-center gap-1.5 text-sm">
              <RefreshCw className="w-4 h-4" /> 再练一组
            </button>
            <button onClick={goBack} className="px-5 py-2.5 rounded-xl bg-accent-warm text-white hover:opacity-90 text-sm">
              换一个单元
            </button>
          </div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell title={`句子背诵 ${idx + 1} / ${sentences.length}`} onBack={goBack}>
      {/* 模式切换 */}
      <div className="inline-flex bg-black/[0.04] p-1 rounded-full mb-6">
        {(['choice', 'dictation'] as Mode[]).map(m => (
          <button
            key={m}
            onClick={() => { setMode(m); }}
            className={`px-4 py-1.5 text-xs font-medium rounded-full transition ${
              mode === m ? 'bg-white text-ink shadow-sm' : 'text-ink-soft hover:text-ink'
            }`}
          >
            {m === 'choice' ? '英翻中（选择）' : '听句子默写'}
          </button>
        ))}
      </div>

      {/* 进度条 */}
      <div className="h-1.5 bg-black/[0.06] rounded-full overflow-hidden mb-6">
        <div className="h-full bg-accent-warm transition-all" style={{ width: `${((idx + 1) / sentences.length) * 100}%` }} />
      </div>

      <AnimatePresence mode="wait">
        {mode === 'choice' && cur ? (
          <ChoiceCard
            key={`c-${cur.id}`}
            sentence={cur}
            pool={sentences}
            onAnswer={(ok) => { handleResult(ok); }}
            onNext={goNext}
            playAudio={playAudio}
          />
        ) : cur ? (
          <DictationCard
            key={`d-${cur.id}`}
            sentence={cur}
            onAnswer={(ok) => handleResult(ok)}
            onNext={goNext}
            playAudio={playAudio}
          />
        ) : null}
      </AnimatePresence>
    </Shell>
  );
}

/* ============= 英翻中：四选一 ============= */
function ChoiceCard({ sentence, pool, onAnswer, onNext, playAudio }: {
  sentence: Sentence; pool: Sentence[]; onAnswer: (ok: boolean) => void; onNext: () => void;
  playAudio: (text: string) => Promise<void>;
}) {
  const options = useMemo(() => {
    const correct = sentence.chinese;
    const distractors = pool
      .filter(s => s.id !== sentence.id)
      .sort(() => Math.random() - 0.5)
      .slice(0, 3)
      .map(s => s.chinese);
    return [correct, ...distractors].sort(() => Math.random() - 0.5);
  }, [sentence.id, pool]);

  const [picked, setPicked] = useState<string | null>(null);
  const isAnswered = picked !== null;

  const pick = (opt: string) => {
    if (isAnswered) return;
    setPicked(opt);
    onAnswer(opt === sentence.chinese);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      className="bg-white rounded-2xl border border-black/[0.05] p-6"
    >
      <div className="flex items-center gap-2 mb-4">
        <button onClick={() => playAudio(sentence.tts_text || sentence.english)} className="p-2 rounded-full bg-accent-warm/[0.08] text-accent-warm hover:bg-accent-warm/[0.15]" title="朗读">
          <Volume2 className="w-4 h-4" />
        </button>
        <span className="text-xs text-ink-mute">点击朗读</span>
      </div>
      <p className="font-display text-2xl text-ink leading-snug mb-1">{sentence.english}</p>
      {sentence.phonetic && <p className="text-sm text-ink-mute mb-5">{sentence.phonetic}</p>}

      <p className="text-xs text-ink-soft mb-3">下面哪个是它的意思？</p>
      <div className="space-y-2.5">
        {options.map((opt, i) => {
          const isCorrect = isAnswered && opt === sentence.chinese;
          const isWrong = isAnswered && picked === opt && opt !== sentence.chinese;
          return (
            <button
              key={i}
              onClick={() => pick(opt)}
              disabled={isAnswered}
              className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition ${
                isCorrect ? 'bg-green-50 border-green-300 text-green-800' :
                isWrong ? 'bg-red-50 border-red-300 text-red-800' :
                'border-black/10 hover:border-accent-warm/40 hover:bg-accent-warm/[0.04]'
              }`}
            >
              <span className="inline-block w-5 h-5 mr-2 text-xs font-numeric text-ink-mute">{String.fromCharCode(65 + i)}.</span>
              {opt}
              {isCorrect && <Check className="inline w-4 h-4 ml-2 text-green-600" />}
              {isWrong && <XIcon className="inline w-4 h-4 ml-2 text-red-500" />}
            </button>
          );
        })}
      </div>

      {isAnswered && (
        <button onClick={onNext} className="mt-5 w-full py-3 rounded-xl bg-accent-warm text-white font-medium hover:opacity-90">
          下一句 →
        </button>
      )}
    </motion.div>
  );
}

/* ============= 听句子默写：错答需抄 3 遍 ============= */
function DictationCard({ sentence, onAnswer, onNext, playAudio }: {
  sentence: Sentence; onAnswer: (ok: boolean) => void; onNext: () => void;
  playAudio: (text: string) => Promise<void>;
}) {
  const [input, setInput] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  // 错答抄写：必须连续 3 次正确才放行
  const [copyMode, setCopyMode] = useState(false);
  const [copyDoneCount, setCopyDoneCount] = useState(0);
  const COPY_REQUIRED = 3;
  const inputRef = useRef<HTMLInputElement>(null);
  const playedRef = useRef(false);

  useEffect(() => {
    if (!playedRef.current) {
      playedRef.current = true;
      setTimeout(() => playAudio(sentence.tts_text || sentence.english), 300);
    }
    setTimeout(() => inputRef.current?.focus(), 200);
  }, [sentence.id, playAudio, sentence.tts_text, sentence.english]);

  // 句子默写场景按整句严格匹配，大小写不敏感（学生不一定按规范敲首字母大写）
  const norm = (s: string) => normalizeAnswer(s).toLowerCase();
  const targetNorm = norm(sentence.english);

  const handleCheck = () => {
    if (!input.trim()) return;
    const ok = norm(input) === targetNorm;
    setIsCorrect(ok);
    setSubmitted(true);
    if (ok) {
      onAnswer(true);
    } else {
      onAnswer(false);
      setCopyMode(true);
      setCopyDoneCount(0);
      setTimeout(() => {
        setInput('');
        inputRef.current?.focus();
      }, 700);
    }
  };

  const handleCopySubmit = () => {
    if (!input.trim()) return;
    if (norm(input) === targetNorm) {
      const next = copyDoneCount + 1;
      setCopyDoneCount(next);
      if (next >= COPY_REQUIRED) {
        // 抄写完成，退出抄写模式（amber 提示框换成"参考答案"）
        setCopyMode(false);
      } else {
        setTimeout(() => {
          setInput('');
          inputRef.current?.focus();
        }, 200);
      }
    } else {
      toast.warning('请照着上方正确句子完整抄写');
    }
  };

  const handleNext = () => {
    setInput(''); setSubmitted(false); setIsCorrect(false);
    setCopyMode(false); setCopyDoneCount(0);
    onNext();
  };

  const passed = isCorrect || copyDoneCount >= COPY_REQUIRED;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
      className="bg-white rounded-2xl border border-black/[0.05] p-6"
    >
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => playAudio(sentence.tts_text || sentence.english)} className="p-3 rounded-full bg-accent-warm/[0.08] text-accent-warm hover:bg-accent-warm/[0.15]" title="重播">
          <Volume2 className="w-5 h-5" />
        </button>
        <div>
          <p className="text-sm text-ink">中文：{sentence.chinese}</p>
          <p className="text-xs text-ink-mute mt-0.5">听音频写出英文</p>
        </div>
      </div>

      {submitted && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
          <p className="text-xs text-amber-700 mb-1">{copyMode ? '正确句子（请照着抄写）' : '参考答案'}</p>
          <p className="text-base font-mono text-amber-900 leading-relaxed">{sentence.english}</p>
          {sentence.phonetic && <p className="text-xs text-amber-700 mt-1">{sentence.phonetic}</p>}
        </div>
      )}

      <input
        {...imeSafeInputProps()}
        ref={inputRef}
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') (passed ? handleNext() : copyMode ? handleCopySubmit() : handleCheck()); }}
        placeholder={copyMode ? '请抄写上面的句子' : '听到的英文…'}
        className="w-full px-4 py-3 rounded-xl border-2 border-black/10 focus:border-accent-warm outline-none text-base font-mono"
      />

      {!submitted ? (
        <button
          onClick={handleCheck}
          disabled={!input.trim()}
          className="mt-4 w-full py-3 rounded-xl bg-accent-warm text-white font-medium hover:opacity-90 disabled:opacity-50"
        >提交检查</button>
      ) : !passed ? (
        <>
          <p className="text-sm text-amber-700 mt-3">
            ✏️ 拼错了，请照着抄 {COPY_REQUIRED} 遍（已完成 {copyDoneCount} / {COPY_REQUIRED}）
          </p>
          <button
            onClick={handleCopySubmit}
            disabled={!input.trim()}
            className="mt-3 w-full py-3 rounded-xl bg-accent-warm text-white font-medium hover:opacity-90 disabled:opacity-50"
          >
            提交本遍（{Math.min(copyDoneCount + 1, COPY_REQUIRED)} / {COPY_REQUIRED}）
          </button>
        </>
      ) : (
        <>
          <p className="text-sm text-green-700 mt-3">
            {isCorrect ? '✅ 完全正确！' : `✅ 已抄写 ${COPY_REQUIRED} 遍`}
          </p>
          <button onClick={handleNext} className="mt-3 w-full py-3 rounded-xl bg-accent-warm text-white font-medium hover:opacity-90">
            下一句 →
          </button>
        </>
      )}
    </motion.div>
  );
}

/* ============= 通用壳 ============= */
function Shell({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper">
      <nav className="border-b border-slate-200/80 bg-white/95 backdrop-blur sticky top-0 z-20">
        <div className="max-w-2xl mx-auto px-5 py-3.5 flex items-center justify-between">
          <button onClick={onBack} className="flex items-center gap-2 text-ink-soft hover:text-ink text-sm">
            <ArrowLeft className="w-4 h-4" /> 返回
          </button>
          <h1 className="font-display text-base font-semibold text-ink">{title}</h1>
          <div className="w-12" />
        </div>
      </nav>
      <div className="max-w-2xl mx-auto px-5 py-8">{children}</div>
    </div>
  );
}

function CenterText({ text }: { text: string }) {
  return <div className="min-h-screen flex items-center justify-center text-sm text-ink-mute">{text}</div>;
}
