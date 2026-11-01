/**
 * 学生「小鹰老师摸摸底」(2026-11-01,查缺补漏试点)。规则真源 backend/app/services/catchup.py 文件头。
 *
 * 一题一个词: 看英文选中文(有「不认识」,不会就别猜 —— 猜对了反而补不上),对 2 个的单元再写 2 个确认。
 * 答案只在服务器判,下发的题没有答案。孩子可以随时「先测到这」,测过的照样算。
 * 测完: 哪几个单元要补;小鹰老师之后每天的任务里会带上这几个单元。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, LoaderCircle, Sparkles, X } from 'lucide-react';
import { autopilotApi, type CatchupState } from '../api/autopilot';
import { toast } from '../components/Toast';
import { getErrorMessage } from '../utils/errorMessage';
import useAccidentalTapGuard from '../hooks/useAccidentalTapGuard';

const FEEDBACK_MS = 900;

export default function StudentCatchup() {
  const navigate = useNavigate();
  const [state, setState] = useState<CatchupState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; right: string } | null>(null);
  const { markShown, isAccidentalTap } = useAccidentalTapGuard();
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const s = await autopilotApi.catchup();
      setState(s);
      markShown();
    } catch (e) {
      setLoadError(getErrorMessage(e, '摸底没打开,稍后再试'));
    }
  }, [markShown]);
  useEffect(() => { void load(); }, [load]);

  const q = state?.question ?? null;
  useEffect(() => {
    setText('');
    if (q?.type === 'spell') setTimeout(() => inputRef.current?.focus(), 50);
  }, [q?.word_id, q?.type]);

  const submit = async (body: { choice?: number; text?: string; dont_know?: boolean }) => {
    if (!q || busy || feedback) return;
    if (isAccidentalTap()) return;   // 换题后 350ms 内的余点不算
    setBusy(true);
    try {
      const r = await autopilotApi.catchupAnswer({ word_id: q.word_id, ...body });
      if (r.stale) { setState(r); markShown(); return; }
      // 错了停一下给他看正确的;对了很快过去(浮躁的孩子等不了)
      setFeedback({ ok: !!r.correct, right: r.right || '' });
      setTimeout(() => {
        setFeedback(null);
        setState(r);
        markShown();
      }, r.correct ? 350 : FEEDBACK_MS + (body.dont_know ? 300 : 600));
    } catch (e) {
      toast.error(getErrorMessage(e, '没交上,再点一次'));
    } finally {
      setBusy(false);
    }
  };

  const finishEarly = async () => {
    if (busy) return;
    if (!window.confirm('先测到这里?测过的单元照样算,剩下的以后再说。')) return;
    setBusy(true);
    try {
      setState(await autopilotApi.catchupFinish());
    } catch (e) {
      toast.error(getErrorMessage(e, '没结束成功,再点一次'));
    } finally {
      setBusy(false);
    }
  };

  // 物理键盘: 1-4 选、0 / ? 不认识(打字的时候不劫持)
  useEffect(() => {
    if (q?.type !== 'choice') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || (e.target as HTMLElement)?.tagName === 'INPUT') return;
      const n = Number(e.key);
      if (n >= 1 && n <= (q.options?.length || 0)) void submit({ choice: n - 1 });
      else if (e.key === '0' || e.key === '?') void submit({ dont_know: true });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const done = state?.status === 'done' || state?.status === 'skipped';
  const total = (state?.answered ?? 0) + (state?.left ?? 0);
  const pct = total ? Math.round(((state?.answered ?? 0) / total) * 100) : 0;

  return (
    <div className="min-h-screen bg-paper page-warm-glow">
      <nav className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <button type="button" onClick={() => navigate('/student/dashboard')} aria-label="回首页"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-orange-50 hover:text-orange-600">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <img src="/tutor-avatar.jpg" alt="" className="h-8 w-8 rounded-full object-cover" />
          <h1 className="text-base font-bold text-ink">小鹰老师摸摸底</h1>
          {!done && state && state.status !== 'none' && (
            <button type="button" onClick={finishEarly} disabled={busy}
              className="ml-auto min-h-9 rounded-lg px-3 text-sm text-ink-soft hover:bg-slate-100 disabled:opacity-50">
              先测到这
            </button>
          )}
        </div>
      </nav>

      <main className="mx-auto max-w-2xl px-4 py-5">
        {loadError ? (
          <div className="rounded-2xl bg-white p-6 text-center">
            <p className="text-sm text-rose-600">{loadError}</p>
            <button type="button" onClick={() => void load()} className="mt-3 text-sm font-semibold text-accent-warm">再试一次</button>
          </div>
        ) : !state ? (
          <div className="flex justify-center py-20"><LoaderCircle className="h-6 w-6 animate-spin text-orange-500" aria-label="加载中" /></div>
        ) : state.status === 'none' ? (
          <div className="rounded-2xl bg-white p-6 text-center">
            <p className="text-ink">现在没有要做的摸底。</p>
            <button type="button" onClick={() => navigate('/student/dashboard')} className="mt-3 text-sm font-semibold text-accent-warm">回首页</button>
          </div>
        ) : done ? (
          <Result s={state} onHome={() => navigate('/student/dashboard')} />
        ) : q ? (
          <>
            {state.answered === 0 && (
              <p className="mb-4 rounded-xl bg-orange-50 px-4 py-3 text-sm text-ink-soft">
                小鹰老师先看看你哪些词已经会了,会的以后就不用再背,只补不会的。
                <b className="text-ink"> 不认识就点「不认识」,别猜</b> —— 猜对了反而补不上。大约 {state.minutes} 分钟,随时可以「先测到这」。
              </p>
            )}
            <div className="mb-3 flex items-center gap-3 text-xs text-ink-mute">
              <span className="truncate">{q.unit}</span>
              <span className="ml-auto shrink-0 tabular-nums">已答 {state.answered} 题</span>
            </div>
            <div className="mb-5 h-1.5 overflow-hidden rounded-full bg-orange-100" aria-hidden="true">
              <div className="h-full rounded-full bg-accent-warm transition-all" style={{ width: `${pct}%` }} />
            </div>

            <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/[0.04] sm:p-7" aria-live="polite">
              {q.type === 'choice' ? (
                <>
                  <p className="text-xs text-ink-mute">这个词是什么意思?</p>
                  <p className="mt-2 break-all text-center font-display text-4xl font-bold text-ink sm:text-5xl">{q.word}</p>
                  <div className="mt-6 grid gap-2.5 sm:grid-cols-2">
                    {(q.options || []).map((o, i) => (
                      <button key={i} type="button" disabled={busy || !!feedback} onClick={() => void submit({ choice: i })}
                        className={`min-h-14 rounded-xl border-2 px-4 text-left text-base font-medium transition active:scale-[0.98] disabled:cursor-default ${
                          feedback && o === feedback.right ? 'border-green-400 bg-green-50 text-green-800'
                            : 'border-slate-200 bg-white text-ink hover:border-orange-300 hover:bg-orange-50'}`}>
                        <span className="mr-2 hidden text-xs text-ink-mute sm:inline">{i + 1}</span>{o}
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) void submit({ text }); }}>
                  <p className="text-xs text-ink-mute">写出这个词的英文</p>
                  <p className="mt-2 text-center text-3xl font-bold text-ink">{q.meaning}</p>
                  <p className="mt-1 text-center text-sm text-ink-mute">{q.letters} 个字母,{q.first} 开头</p>
                  <input ref={inputRef} value={text} onChange={(e) => setText(e.target.value)} disabled={busy || !!feedback}
                    autoCapitalize="off" autoCorrect="off" spellCheck={false} aria-label="写英文"
                    className="mt-5 h-14 w-full rounded-xl border-2 border-slate-200 px-4 text-center text-2xl tracking-wider text-ink focus:border-orange-300 focus:outline-none" />
                  <button type="submit" disabled={busy || !!feedback || !text.trim()}
                    className="btn-glow mt-3 min-h-12 w-full rounded-xl text-base font-semibold text-white disabled:opacity-50">
                    写好了
                  </button>
                </form>
              )}
              <button type="button" disabled={busy || !!feedback} onClick={() => void submit({ dont_know: true })}
                className="mt-3 min-h-12 w-full rounded-xl border-2 border-dashed border-slate-300 text-base text-ink-soft hover:bg-slate-50 disabled:opacity-50">
                不认识
              </button>
              {feedback && (
                <p className={`mt-4 flex items-center justify-center gap-1.5 text-base font-semibold ${feedback.ok ? 'text-green-700' : 'text-rose-600'}`}>
                  {feedback.ok ? <Check className="h-5 w-5" aria-hidden /> : <X className="h-5 w-5" aria-hidden />}
                  {feedback.ok ? '对了' : `是「${feedback.right}」,记下来,小鹰老师会给你补`}
                </p>
              )}
            </section>
          </>
        ) : (
          <div className="flex justify-center py-20"><LoaderCircle className="h-6 w-6 animate-spin text-orange-500" aria-label="加载中" /></div>
        )}
      </main>
    </div>
  );
}

function Result({ s, onHome }: { s: CatchupState; onHome: () => void }) {
  const r = s.result;
  if (!r) return null;
  if (s.status === 'skipped') {
    return (
      <div className="rounded-2xl bg-white p-6 text-center">
        <p className="text-ink">{r.note || '现在没什么要摸底的'}</p>
        <button type="button" onClick={onHome} className="mt-3 text-sm font-semibold text-accent-warm">回首页</button>
      </div>
    );
  }
  return (
    <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-black/[0.04]">
      <p className="flex items-center gap-2 text-lg font-bold text-ink">
        <Sparkles className="h-5 w-5 text-accent-warm" aria-hidden /> 摸完底了
      </p>
      <p className="mt-2 text-sm text-ink-soft">
        答了 {r.questions} 题:{r.known_units} 个单元已经会了,以后不用再背;
        {r.gap_units ? ` ${r.gap_units} 个单元要补。` : ' 没有要补的,很棒!'}
      </p>
      {r.gaps.some((g) => !g.blocked) && (
        <>
          <ul className="mt-4 space-y-1.5">
            {r.gaps.filter((g) => !g.blocked).map((g) => (
              <li key={g.unit_id} className="rounded-lg bg-orange-50 px-3 py-2 text-sm text-ink">
                {g.book.replace('人教版', '')} · {g.unit}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-ink-soft">小鹰老师会把这几个单元一点点放进每天的任务里,每天只多几个词,不会一下子很多。</p>
        </>
      )}
      {r.gaps.some((g) => g.blocked) && (
        <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-sm text-ink-soft">
          <p>这几个单元的书你还没开,<b className="text-ink">等老师开了</b>小鹰老师再帮你补(老师那边看得到):</p>
          <p className="mt-1 text-ink">
            {r.gaps.filter((g) => g.blocked).map((g) => `${g.book.replace('人教版', '')} · ${g.unit}`).join('、')}
          </p>
        </div>
      )}
      <button type="button" onClick={onHome} className="btn-glow mt-5 min-h-12 w-full rounded-xl text-base font-semibold text-white">回首页</button>
    </section>
  );
}
