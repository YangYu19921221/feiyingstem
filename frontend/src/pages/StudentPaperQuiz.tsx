/**
 * 学生端「今日小卷」(2026-11-22,/student/paper-quiz)。规则见后端 services/paper_bank.py。
 *
 * 一天一份,从老师传的真题卷里挑他不会的点和没记牢的单词。一次一题: 选择题点选项(键盘 1–4 / A–D),填空在格子里写;
 * 交了才告诉他对没对、正确答案、错在哪(那个错选项代表的错法)。每题只认第一次交的。
 * 做完看「今天练了这些」—— 只和自己比,不出现「弱」字。
 * 签到才能做(和作业同一个规矩);没签到给一个签到按钮。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, LoaderCircle, Sparkles, X } from 'lucide-react';
import {
  answerQuiz, getQuizSummary, quizItemImageUrl, startTodayQuiz,
  type Quiz, type QuizItem, type QuizResult, type QuizSummaryPoint,
} from '../api/paperBank';
import useAccidentalTapGuard from '../hooks/useAccidentalTapGuard';
import { checkInToday, isNeedCheckin } from '../utils/checkin';
import { getErrorCode, getErrorMessage } from '../utils/errorMessage';
import { toast } from '../components/Toast';

const LETTERS = 'ABCDEF';

function Stem({ item, values }: { item: QuizItem; values?: string[] }) {
  const parts = item.stem.split('___');
  return (
    <p className="whitespace-pre-wrap text-[19px] leading-9 text-ink sm:text-[21px]">
      {parts.map((p, i) => (
        <span key={i}>
          {p}
          {i < parts.length - 1 && (
            <span className="mx-1 inline-block min-w-16 border-b-2 border-orange-400 px-1 text-center font-semibold text-orange-700">
              {values?.[i] || ' '}
            </span>
          )}
        </span>
      ))}
    </p>
  );
}

function ItemImage({ itemId }: { itemId: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let made: string | null = null;
    let alive = true;
    quizItemImageUrl(itemId).then((u) => { made = u; if (alive) setUrl(u); else URL.revokeObjectURL(u); }).catch(() => undefined);
    return () => { alive = false; if (made) URL.revokeObjectURL(made); };
  }, [itemId]);
  if (!url) return null;
  return <img src={url} alt="题目里的图" className="mt-2 w-full max-w-md rounded-lg ring-1 ring-slate-200" />;
}

export default function StudentPaperQuiz() {
  const navigate = useNavigate();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [error, setError] = useState<{ code: string | null; message: string } | null>(null);
  const [idx, setIdx] = useState(0);
  const [values, setValues] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [summary, setSummary] = useState<QuizSummaryPoint[] | null>(null);
  const startedAt = useRef(Date.now());
  const { markShown, isAccidentalTap } = useAccidentalTapGuard();
  const firstInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const q = await startTodayQuiz();
      setQuiz(q);
      const first = q.items.findIndex((i) => !i.result);
      setIdx(first < 0 ? q.items.length : first);
    } catch (e) {
      setError({ code: isNeedCheckin(e) ? 'need_checkin' : getErrorCode(e), message: getErrorMessage(e, '小卷没打开') });
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const item = quiz && idx < quiz.items.length ? quiz.items[idx] : null;
  const finished = !!quiz && idx >= quiz.items.length;

  // 换到新的一题: 清空、计时、防误触、填空题自动聚焦
  useEffect(() => {
    if (!item) return;
    setValues(item.kind === 'fill' ? Array(item.blanks || 1).fill('') : []);
    startedAt.current = Date.now();
    markShown();
    if (item.kind === 'fill' && !item.result) window.setTimeout(() => firstInput.current?.focus(), 60);
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (finished && quiz && !summary) {
      getQuizSummary(quiz.id).then((r) => setSummary(r.points)).catch(() => setSummary([]));
    }
  }, [finished, quiz, summary]);

  const submit = useCallback(async (answer: string | string[]) => {
    if (!quiz || !item || item.result || sending) return;
    setSending(true);
    try {
      const r = await answerQuiz(quiz.id, item.id, answer, Date.now() - startedAt.current);
      setQuiz((q) => q && {
        ...q, answered: r.answered, right: r.right, status: r.done ? 'done' : q.status,
        items: q.items.map((x) => (x.id === item.id ? { ...x, result: r.result } : x)),
      });
      markShown();
    } catch (e) {
      toast.error(getErrorMessage(e, '没交上,再点一次'));
    } finally {
      setSending(false);
    }
  }, [quiz, item, sending, markShown]);

  const next = useCallback(() => {
    if (isAccidentalTap()) return;
    setIdx((i) => i + 1);
  }, [isAccidentalTap]);

  // 键盘: 选择题 1–4 / A–D 直接选;交完了回车下一题(按住回车不连跳)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!item || e.repeat || e.isComposing) return;
      const inInput = (e.target as HTMLElement)?.tagName === 'INPUT';
      if (item.result) {
        if (e.key === 'Enter') { e.preventDefault(); next(); }
        return;
      }
      if (item.kind === 'mc' && !inInput) {
        const k = e.key.toUpperCase();
        const n = /^[1-6]$/.test(k) ? Number(k) - 1 : LETTERS.indexOf(k);
        if (n >= 0 && n < (item.options?.length ?? 0) && !isAccidentalTap()) void submit(LETTERS[n]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, next, submit, isAccidentalTap]);

  const progressPct = quiz ? Math.round((quiz.answered / Math.max(1, quiz.total)) * 100) : 0;
  const fillReady = values.length > 0 && values.every((v) => v.trim());

  const doCheckin = async () => {
    try {
      await checkInToday();
      await load();
    } catch (e) {
      toast.error(getErrorMessage(e, '没签上'));
    }
  };

  const litCount = useMemo(() => (summary || []).filter((p) => p.lit).length, [summary]);

  return (
    <div className="min-h-screen bg-paper page-warm-glow">
      <nav className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <button type="button" onClick={() => navigate('/student/dashboard')} aria-label="回首页"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-orange-50 hover:text-orange-600">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-base font-bold text-ink">今日小卷</h1>
          {quiz && !finished && <span className="ml-auto text-sm text-ink-soft">{Math.min(idx + 1, quiz.total)} / {quiz.total}</span>}
        </div>
        {quiz && (
          <div className="h-1.5 bg-orange-100" aria-hidden>
            <div className="h-full bg-[#FF6B35] transition-all" style={{ width: `${progressPct}%` }} />
          </div>
        )}
      </nav>

      <main className="mx-auto max-w-2xl px-4 py-5">
        {error && (
          <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
            <p className="text-ink">{error.code === 'need_checkin' ? '今天还没签到,签到后才能做小卷' : error.message}</p>
            {error.code === 'need_checkin' ? (
              <button type="button" onClick={doCheckin} className="mt-4 min-h-11 rounded-xl bg-[#FF6B35] px-6 font-semibold text-white">签到,开始做</button>
            ) : (
              <button type="button" onClick={() => navigate('/student/dashboard')} className="mt-4 text-sm font-semibold text-accent-warm">回首页</button>
            )}
          </div>
        )}
        {!quiz && !error && <div className="flex justify-center py-16"><LoaderCircle className="h-6 w-6 animate-spin text-orange-400" /></div>}

        {quiz && item && (
          <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/[0.04] sm:p-6">
            {quiz.mode === 'diagnose' && idx === 0 && !item.result && (
              <p className="mb-3 rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">先做几道摸摸底,看看哪些你已经会了。不会的猜一个就行。</p>
            )}
            <Stem item={item} values={item.kind === 'fill' ? (item.result ? item.result.yours.split(' / ') : values) : undefined} />
            {item.base_word && <p className="mt-1 text-sm text-ink-soft">用这个词: <b className="text-ink">{item.base_word}</b></p>}
            {item.has_image && <ItemImage itemId={item.id} />}

            {item.kind === 'mc' && (
              <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
                {(item.options || []).map((o, i) => {
                  const L = LETTERS[i];
                  const r: QuizResult | null = item.result;
                  const isRight = r && L === r.answer;
                  const isMine = r && L === r.yours;
                  return (
                    <button key={L} type="button" disabled={!!r || sending}
                      onClick={() => { if (!isAccidentalTap()) void submit(L); }}
                      className={`flex min-h-14 items-center gap-3 rounded-xl px-4 text-left text-[17px] transition ${
                        isRight ? 'bg-emerald-50 text-emerald-900 ring-2 ring-emerald-400'
                          : isMine ? 'bg-rose-50 text-rose-900 ring-2 ring-rose-300'
                            : r ? 'bg-slate-50 text-slate-400 ring-1 ring-slate-200'
                              : 'bg-orange-50/60 text-ink ring-1 ring-orange-200 hover:bg-orange-100 active:scale-[0.99]'}`}>
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold ring-1 ring-slate-200">{L}</span>
                      <span>{o}</span>
                      {isRight && <Check className="ml-auto h-5 w-5" />}
                      {isMine && !isRight && <X className="ml-auto h-5 w-5" />}
                    </button>
                  );
                })}
              </div>
            )}

            {item.kind === 'fill' && !item.result && (
              <form className="mt-5 space-y-3" onSubmit={(e) => { e.preventDefault(); if (fillReady && !isAccidentalTap()) void submit(values); }}>
                {values.map((v, i) => (
                  <input key={i} ref={i === 0 ? firstInput : undefined} value={v} autoCapitalize="off" autoCorrect="off" spellCheck={false}
                    onChange={(e) => setValues((vs) => vs.map((x, j) => (j === i ? e.target.value : x)))}
                    placeholder={values.length > 1 ? `第 ${i + 1} 个空` : '写在这里'} aria-label={`第 ${i + 1} 个空`}
                    className="w-full rounded-xl border-2 border-orange-200 bg-white px-4 py-3 text-[18px] outline-none focus:border-orange-400" />
                ))}
                <button type="submit" disabled={!fillReady || sending}
                  className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#FF6B35] font-semibold text-white disabled:bg-slate-300">
                  {sending && <LoaderCircle className="h-4 w-4 animate-spin" />} 交这一题
                </button>
              </form>
            )}

            {item.result && (
              <div className={`mt-5 rounded-xl px-4 py-3 ${item.result.correct ? 'bg-emerald-50' : 'bg-rose-50'}`} role="status">
                <p className={`text-lg font-bold ${item.result.correct ? 'text-emerald-800' : 'text-rose-800'}`}>
                  {item.result.correct ? '对啦!' : '这题没对'}
                </p>
                {!item.result.correct && (
                  <p className="mt-1 text-ink">正确答案: <b>{item.result.answer_text}</b>{item.kind === 'fill' && item.result.yours ? `(你写的是 ${item.result.yours})` : ''}</p>
                )}
                {!item.result.correct && item.result.why && <p className="mt-1 text-sm text-rose-900">{item.result.why}</p>}
                {item.result.explain && <p className="mt-1 text-sm text-ink-soft">{item.result.explain}</p>}
                <button type="button" onClick={next}
                  className="mt-3 min-h-12 w-full rounded-xl bg-ink font-semibold text-white sm:w-auto sm:px-8">
                  {idx + 1 >= quiz.total ? '看今天练了什么' : '下一题'}
                </button>
              </div>
            )}
          </section>
        )}

        {finished && quiz && (
          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/[0.04]">
            <p className="flex items-center gap-2 text-lg font-bold text-ink"><Sparkles className="h-5 w-5 text-accent-warm" /> 今天的小卷做完了</p>
            <p className="mt-1 text-ink-soft">对了 {quiz.right} 道,共 {quiz.total} 道。{litCount ? `有 ${litCount} 个点已经点亮了。` : ''}明天还有一份新的。</p>
            {summary === null ? (
              <div className="py-6 text-center"><LoaderCircle className="mx-auto h-5 w-5 animate-spin text-orange-400" /></div>
            ) : summary.length > 0 && (
              <>
                <p className="mt-4 text-sm font-semibold text-ink">今天练了这些</p>
                <ul className="mt-2 space-y-1.5">
                  {summary.map((p) => (
                    <li key={p.kp} className="flex items-center gap-2 rounded-lg bg-orange-50/70 px-3 py-2 text-sm">
                      <span className="flex-1 text-ink">{p.kid}</span>
                      <span className={p.right === p.n ? 'font-semibold text-emerald-700' : 'text-ink-soft'}>{p.right}/{p.n}</span>
                      {p.lit && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">点亮</span>}
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-ink-soft">没做对的不用担心,过几天会换一道题再考你;连着做对就点亮了。</p>
              </>
            )}
            <button type="button" onClick={() => navigate('/student/dashboard')} className="mt-5 min-h-11 rounded-xl bg-[#FF6B35] px-6 font-semibold text-white">回首页</button>
          </section>
        )}
      </main>
    </div>
  );
}
