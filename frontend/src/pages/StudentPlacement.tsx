/**
 * 学生入学摸底测评页
 *
 * 流程：引导 → 认知题（4选1）/ 拼写题（写英文）→ 结果页
 * 题目一道道呈现，答完自动下一道，全部完成后统一提交。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ChevronRight, LoaderCircle, Sparkles } from 'lucide-react';
import { placementApi } from '../api/placement';
import type { PlacementQuestion, SubmitAnswer, SubmitResponse } from '../api/placement';
import { toast } from '../components/Toast';
import { getErrorMessage } from '../utils/errorMessage';

const BAND_LABEL: Record<number, string> = {
  1: '小学低段', 2: '小学高段', 3: '初中入门', 4: '初中进阶', 5: '高中',
};

const BAND_COLOR: Record<number, string> = {
  1: 'bg-green-100 text-green-700',
  2: 'bg-teal-100 text-teal-700',
  3: 'bg-blue-100 text-blue-700',
  4: 'bg-violet-100 text-violet-700',
  5: 'bg-rose-100 text-rose-700',
};

export default function StudentPlacement() {
  const navigate = useNavigate();

  // ── 状态机：intro → quiz → submitting → result
  const [phase, setPhase] = useState<'intro' | 'quiz' | 'submitting' | 'result'>('intro');
  const [questions, setQuestions] = useState<PlacementQuestion[]>([]);
  const [testId, setTestId] = useState<number>(0);
  const [cursor, setCursor] = useState(0);           // 当前题序
  const [answers, setAnswers] = useState<SubmitAnswer[]>([]);
  const [chosen, setChosen] = useState<number | null>(null);     // 认知题已选项
  const [typed, setTyped] = useState('');                        // 拼写题输入
  const [feedback, setFeedback] = useState<'correct' | 'wrong' | null>(null);
  const [result, setResult] = useState<SubmitResponse | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const q = questions[cursor] ?? null;
  const progress = questions.length ? Math.round((cursor / questions.length) * 100) : 0;

  // ── 开始 ──────────────────────────────────────────────────────────────────
  const startQuiz = useCallback(async () => {
    setLoadErr('');
    setPhase('quiz');
    try {
      const res = await placementApi.start();
      setTestId(res.test_id);
      setQuestions(res.questions);
      setCursor(0);
      setAnswers([]);
    } catch (e) {
      setLoadErr(getErrorMessage(e, '无法加载题目，请稍后重试'));
      setPhase('intro');
    }
  }, []);

  // 拼写题时自动聚焦输入框
  useEffect(() => {
    if (q?.question_type === 'spelling') {
      setTyped('');
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [cursor, q?.question_type]);

  // ── 提交单题答案（本地收集，全部完成后统一发送） ──────────────────────────
  const submitAnswer = useCallback((answer: SubmitAnswer) => {
    setAnswers(prev => [...prev, answer]);
    setFeedback(null);
    setChosen(null);
    setTyped('');
    if (cursor + 1 < questions.length) {
      setCursor(c => c + 1);
    } else {
      // 全部答完 → 提交
      setPhase('submitting');
    }
  }, [cursor, questions.length]);

  // ── 认知题点击选项 ─────────────────────────────────────────────────────────
  const handleChoice = (idx: number) => {
    if (feedback || chosen !== null) return;
    setChosen(idx);
    setTimeout(() => submitAnswer({
      word_id: q!.word_id,
      question_type: 'recognition',
      chosen_index: idx,
    }), 300);
  };

  // ── 拼写题提交 ─────────────────────────────────────────────────────────────
  const handleSpelling = () => {
    if (!typed.trim()) return;
    submitAnswer({
      word_id: q!.word_id,
      question_type: 'spelling',
      typed_answer: typed.trim(),
    });
  };

  // ── 统一提交到服务器 ───────────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'submitting' || !testId || answers.length === 0) return;
    // answers 此时是上一个 render 的值；用 ref snapshot 防止重复触发
    let cancelled = false;
    (async () => {
      try {
        const res = await placementApi.submit(testId, answers);
        if (!cancelled) { setResult(res); setPhase('result'); }
      } catch (e) {
        if (!cancelled) {
          toast.error(getErrorMessage(e, '提交失败，请重试'));
          setPhase('quiz');  // 回到最后一题
        }
      }
    })();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // ── 跳过 ──────────────────────────────────────────────────────────────────
  const handleSkip = async () => {
    const level = window.prompt('你现在大概在几年级？（如：三年级、初一）');
    if (!level?.trim()) return;
    try {
      await placementApi.skip(level.trim());
      navigate('/student/dashboard');
    } catch (e) {
      toast.error(getErrorMessage(e, '跳过失败，请重试'));
    }
  };

  // ── 键盘快捷键（认知题：1-4选，拼写题：回车提交） ─────────────────────────
  useEffect(() => {
    if (phase !== 'quiz' || !q) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
      if (q.question_type === 'recognition') {
        const n = Number(e.key);
        if (n >= 1 && n <= (q.options?.length ?? 0)) handleChoice(n - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ── 渲染 ──────────────────────────────────────────────────────────────────

  if (phase === 'intro') return <IntroScreen onStart={startQuiz} onSkip={handleSkip} error={loadErr} />;
  if (phase === 'submitting') return <Loading label="分析中…" />;
  if (phase === 'result' && result) return <ResultScreen result={result} onDone={() => navigate('/student/dashboard')} />;
  if (!q) return <Loading label="加载题目…" />;

  return (
    <div className="min-h-screen bg-paper">
      {/* 顶栏 */}
      <nav className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <button onClick={() => navigate('/student/dashboard')} aria-label="返回"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-orange-50 hover:text-orange-600">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-base font-bold text-ink">入学摸底测评</h1>
          <span className="ml-auto text-sm text-ink-soft">{cursor + 1} / {questions.length}</span>
        </div>
        {/* 进度条 */}
        <div className="h-1 bg-slate-100">
          <div className="h-1 bg-orange-400 transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
      </nav>

      <main className="mx-auto max-w-2xl px-4 py-6">
        {/* 难度标签 */}
        <div className="mb-4 flex items-center gap-2">
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${BAND_COLOR[q.difficulty] ?? 'bg-slate-100 text-slate-600'}`}>
            {BAND_LABEL[q.difficulty] ?? `难度 ${q.difficulty}`}
          </span>
          <span className="text-xs text-ink-mute">{q.question_type === 'spelling' ? '写出英文单词' : '选出正确意思'}</span>
        </div>

        {/* 题目卡片 */}
        <div className="rounded-2xl bg-white p-6 shadow-sm">
          {q.question_type === 'recognition' ? (
            <RecognitionQuestion q={q} chosen={chosen} onChoice={handleChoice} />
          ) : (
            <SpellingQuestion q={q} value={typed} onChange={setTyped} onSubmit={handleSpelling} inputRef={inputRef} />
          )}
        </div>
      </main>
    </div>
  );
}

// ── 子组件 ────────────────────────────────────────────────────────────────────

function IntroScreen({ onStart, onSkip, error }: { onStart: () => void; onSkip: () => void; error: string }) {
  return (
    <div className="min-h-screen bg-paper flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-100">
          <Sparkles className="h-8 w-8 text-orange-500" />
        </div>
        <h1 className="mb-2 text-xl font-bold text-ink">先摸摸底</h1>
        <p className="mb-6 text-sm leading-relaxed text-ink-soft">
          12 道题，约 3 分钟。<br />
          测出你已经会哪些词，以后就不用再背，<br />
          只学你还不会的，省时间、提成绩更快。
        </p>
        <div className="mb-4 rounded-xl bg-orange-50 px-4 py-3 text-sm text-ink-soft text-left space-y-1">
          <p>✦ 认知题：看英文选中文意思（4选1）</p>
          <p>✦ 拼写题：看中文意思写英文单词</p>
          <p>✦ 不会的直接跳过，别猜——猜对反而测不准</p>
        </div>
        {error && <p className="mb-3 text-sm text-rose-600">{error}</p>}
        <button onClick={onStart}
          className="w-full rounded-xl bg-orange-500 py-3 font-semibold text-white hover:bg-orange-600 active:scale-[.98] transition-transform">
          开始测评
        </button>
        <button onClick={onSkip} className="mt-3 w-full rounded-xl py-2.5 text-sm text-ink-soft hover:bg-slate-50">
          跳过，直接告诉老师我的年级
        </button>
      </div>
    </div>
  );
}

function RecognitionQuestion({ q, chosen, onChoice }: {
  q: PlacementQuestion; chosen: number | null; onChoice: (i: number) => void;
}) {
  return (
    <>
      <div className="mb-6 text-center">
        <p className="text-3xl font-bold tracking-wide text-ink">{q.word}</p>
        {q.phonetic && <p className="mt-1 text-sm text-ink-mute">{q.phonetic}</p>}
      </div>
      <div className="grid grid-cols-2 gap-3">
        {(q.options ?? []).map((opt, i) => (
          <button key={i} onClick={() => onChoice(i)} disabled={chosen !== null}
            className={[
              'rounded-xl border-2 px-3 py-3 text-sm font-medium transition-all text-left',
              chosen === i
                ? 'border-orange-400 bg-orange-50 text-orange-700 scale-[.98]'
                : 'border-slate-200 bg-white text-ink hover:border-orange-300 hover:bg-orange-50',
              chosen !== null && chosen !== i ? 'opacity-50' : '',
            ].join(' ')}>
            <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-xs text-slate-500">
              {i + 1}
            </span>
            {opt}
          </button>
        ))}
      </div>
      <p className="mt-4 text-center text-xs text-ink-mute">键盘 1–4 快速选择</p>
    </>
  );
}

function SpellingQuestion({ q, value, onChange, onSubmit, inputRef }: {
  q: PlacementQuestion; value: string;
  onChange: (v: string) => void; onSubmit: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  return (
    <>
      <div className="mb-6 text-center">
        <p className="text-sm text-ink-soft mb-1">看中文写出英文单词</p>
        <p className="text-2xl font-bold text-ink">{q.prompt}</p>
      </div>
      <div className="flex gap-2">
        <input ref={inputRef} type="text" value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onSubmit()}
          placeholder="在这里写英文…"
          autoCapitalize="none" autoCorrect="off" spellCheck={false}
          className="flex-1 rounded-xl border-2 border-slate-200 px-4 py-3 text-base text-ink outline-none focus:border-orange-400"
        />
        <button onClick={onSubmit} disabled={!value.trim()}
          className="flex items-center gap-1 rounded-xl bg-orange-500 px-4 py-3 font-semibold text-white hover:bg-orange-600 disabled:opacity-40">
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>
      <p className="mt-3 text-center text-xs text-ink-mute">不确定可以写不出来，直接空着提交也行</p>
      <button onClick={onSubmit} className="mt-2 w-full text-center text-sm text-ink-soft hover:text-ink">
        跳过这题
      </button>
    </>
  );
}

function ResultScreen({ result, onDone }: { result: SubmitResponse; onDone: () => void }) {
  const { placement_label, recognition_accuracy, spelling_accuracy,
    band_scores, solid_through_band, first_gap_band, recommendation,
    correct_count, total_questions, weak_words } = result;

  const recPct = Math.round(recognition_accuracy * 100);
  const spPct = spelling_accuracy !== null ? Math.round(spelling_accuracy * 100) : null;

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto max-w-2xl px-4 py-8">
        {/* 推荐起点 */}
        <div className="mb-5 rounded-2xl bg-white p-6 shadow-sm text-center">
          <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-orange-400" />
          <p className="text-sm text-ink-soft mb-1">测评完成，推荐起点</p>
          <p className="text-2xl font-bold text-ink">{placement_label}</p>
          <p className="mt-1 text-sm text-ink-mute">{correct_count} / {total_questions} 题正确</p>
        </div>

        {/* 双技能 */}
        <div className="mb-5 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-white p-4 shadow-sm text-center">
            <p className="text-xs text-ink-soft mb-1">识别准确率</p>
            <p className="text-2xl font-bold text-ink">{recPct}%</p>
          </div>
          <div className="rounded-2xl bg-white p-4 shadow-sm text-center">
            <p className="text-xs text-ink-soft mb-1">拼写准确率</p>
            <p className="text-2xl font-bold text-ink">{spPct !== null ? `${spPct}%` : '—'}</p>
          </div>
        </div>

        {/* 各档得分 */}
        <div className="mb-5 rounded-2xl bg-white p-5 shadow-sm">
          <p className="mb-3 text-sm font-semibold text-ink">各难度表现</p>
          {Object.entries(band_scores).map(([band, score]) => {
            const d = Number(band);
            const pct = Math.round(score * 100);
            return (
              <div key={band} className="mb-2 flex items-center gap-3">
                <span className={`w-16 text-xs rounded-full px-2 py-0.5 text-center font-medium ${BAND_COLOR[d] ?? 'bg-slate-100 text-slate-600'}`}>
                  {BAND_LABEL[d]}
                </span>
                <div className="flex-1 rounded-full bg-slate-100 h-2 overflow-hidden">
                  <div className="h-2 rounded-full bg-orange-400 transition-all"
                    style={{ width: `${pct}%` }} />
                </div>
                <span className="w-8 text-right text-xs text-ink-soft">{pct}%</span>
              </div>
            );
          })}
        </div>

        {/* 诊断建议 */}
        <div className="mb-5 rounded-2xl bg-orange-50 p-5">
          <p className="mb-2 text-sm font-semibold text-orange-700">老师的建议</p>
          <p className="text-sm leading-relaxed text-ink-soft">{recommendation}</p>
        </div>

        {/* 薄弱词 */}
        {weak_words.length > 0 && (
          <div className="mb-5 rounded-2xl bg-white p-5 shadow-sm">
            <p className="mb-3 text-sm font-semibold text-ink">需要加强的词（{weak_words.length} 个）</p>
            <div className="flex flex-wrap gap-2">
              {weak_words.map(w => (
                <span key={w.word_id}
                  className={`rounded-lg px-2.5 py-1 text-xs font-medium ${BAND_COLOR[w.difficulty] ?? 'bg-slate-100 text-slate-600'}`}>
                  {w.word}
                </span>
              ))}
            </div>
          </div>
        )}

        <button onClick={onDone}
          className="w-full rounded-xl bg-orange-500 py-3 font-semibold text-white hover:bg-orange-600 active:scale-[.98] transition-transform">
          回首页，等老师分配学习内容
        </button>
      </div>
    </div>
  );
}

function Loading({ label }: { label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper">
      <div className="flex flex-col items-center gap-3 text-ink-soft">
        <LoaderCircle className="h-8 w-8 animate-spin text-orange-400" />
        <p className="text-sm">{label}</p>
      </div>
    </div>
  );
}
