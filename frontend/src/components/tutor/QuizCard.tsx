/**
 * 小鹰老师出的语法 / 句子小题(2026-10-27,后端 services/tutor_quiz):
 * 选择题 / 句子填空 / 连词成句。发下来的没有答案,交了服务器判分,判完显示正确答案和一句为什么,
 * 再请小鹰老师点评(onSubmitted → 页面接着问一句,不扣次数)。不计分、不进学习记录。
 *
 * 连词成句: 点下面的词按顺序放上去,点上面的词放回去(不用拖,小学生在平板上拖不准)。
 */
import { memo, useState } from 'react';
import { Check, Loader2, Volume2, X } from 'lucide-react';
import { useAudio } from '../../hooks/useAudio';
import { noSuggestInputProps } from '../../utils/noSuggestInput';
import { submitQuiz, type QuizItem, type QuizItemResult, type QuizResult } from '../../api/tutor';
import { getErrorMessage } from '../../utils/errorMessage';
import { toast } from '../Toast';
import type { QuizSubmitted } from './PracticeCard';

type Ans = string | number | null;

function initAnswer(it: QuizItem, prev: Ans | undefined): Ans {
  if (prev !== undefined && prev !== null && prev !== '') return prev;
  return it.type === 'choice' ? null : '';
}

/** 连词成句: 已选的词在 tokens 里的下标(同一个词出现两次也分得清) */
function OrderInput({ tokens, value, disabled, onChange }: {
  tokens: string[]; value: number[]; disabled: boolean; onChange: (v: number[]) => void;
}) {
  return (
    <div>
      <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-dashed border-orange-200 bg-white px-2 py-1.5"
        aria-label="排好的句子">
        {value.length === 0 && <span className="px-1 text-sm text-ink-mute">点下面的词,按顺序排成一句话</span>}
        {value.map((ti, k) => (
          <button key={`${ti}-${k}`} type="button" disabled={disabled}
            onClick={() => onChange(value.filter((_, j) => j !== k))}
            className="min-h-9 rounded-lg bg-orange-100 px-2.5 text-[15px] text-orange-900 disabled:opacity-80">
            {tokens[ti]}
          </button>
        ))}
      </div>
      {!disabled && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tokens.map((t, ti) => (value.includes(ti) ? null : (
            <button key={ti} type="button" onClick={() => onChange([...value, ti])}
              className="min-h-9 rounded-lg bg-white px-2.5 text-[15px] text-ink shadow-sm ring-1 ring-black/10 hover:bg-orange-50">
              {t}
            </button>
          )))}
        </div>
      )}
    </div>
  );
}

function QuizCard({ quizId, topic, items, result, onSubmitted }: {
  quizId: number;
  topic: string | null;
  items: QuizItem[];
  result?: QuizResult;
  onSubmitted?: (r: QuizSubmitted) => void;
}) {
  const { playAudio } = useAudio();
  const [answers, setAnswers] = useState<Ans[]>(() => items.map((it, i) => initAnswer(it, result?.answers?.[i])));
  // 连词成句的选择单独存下标;交卷时拼成句子
  const [orders, setOrders] = useState<number[][]>(() => items.map(() => []));
  const [graded, setGraded] = useState<QuizItemResult[] | null>(() => result?.results ?? null);
  const [busy, setBusy] = useState(false);
  const checked = graded !== null;

  const finalAnswers = (): Ans[] => items.map((it, i) => (
    it.type === 'order' ? (orders[i].length ? orders[i].map((ti) => it.tokens[ti]).join(' ') : String(answers[i] ?? '')) : answers[i]
  ));
  const filled = finalAnswers().some((a) => a !== null && String(a).trim() !== '');

  const check = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const ans = finalAnswers();
      const r = await submitQuiz(quizId, ans);
      setAnswers(ans);
      setGraded(r.results);
      if (r.first) onSubmitted?.({ quizId, score: r.score, total: r.total, feedback: r.feedback, free: r.free });
    } catch (e) {
      toast.error(getErrorMessage(e, '没交上去,再点一次'));
    } finally {
      setBusy(false);
    }
  };

  const retry = () => {
    setAnswers(items.map((it) => initAnswer(it, undefined)));
    setOrders(items.map(() => []));
    setGraded(null);
  };

  const right = graded ? graded.filter((g) => g.ok).length : 0;

  return (
    <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50/50 p-3 sm:p-4">
      <p className="mb-2 text-sm font-semibold text-sky-800">
        小练习{topic ? `: ${topic}` : ''}
        <span className="ml-2 font-normal text-sky-700/80">共 {items.length} 题</span>
      </p>
      <ol className="space-y-3">
        {items.map((it, i) => {
          const g = graded?.[i];
          return (
            <li key={i} className="rounded-xl bg-white/80 p-2.5 ring-1 ring-black/[0.04]">
              <p className="mb-2 flex gap-1.5 text-[15px] leading-relaxed text-ink">
                <span className="shrink-0 text-ink-mute">{i + 1}.</span>
                <span className="break-words">{it.question}</span>
                {g && (g.ok
                  ? <Check className="ml-auto h-5 w-5 shrink-0 text-green-600" aria-label="对了" />
                  : <X className="ml-auto h-5 w-5 shrink-0 text-rose-500" aria-label="不对" />)}
              </p>
              {it.type === 'choice' && (
                <div className="grid gap-1.5 sm:grid-cols-2" role="radiogroup" aria-label={`第 ${i + 1} 题的选项`}>
                  {it.options.map((o, oi) => {
                    const picked = answers[i] === oi;
                    const isRight = g && o === g.answer;
                    const isWrongPick = g && picked && !g.ok;
                    return (
                      <button key={oi} type="button" role="radio" aria-checked={picked} disabled={checked || busy}
                        onClick={() => setAnswers((a) => a.map((v, j) => (j === i ? oi : v)))}
                        className={`flex min-h-10 items-center gap-2 rounded-xl px-3 text-left text-[15px] ring-1 transition ${
                          isRight ? 'bg-green-50 text-green-800 ring-green-300'
                            : isWrongPick ? 'bg-rose-50 text-rose-700 ring-rose-300'
                              : picked ? 'bg-sky-100 text-sky-900 ring-sky-300' : 'bg-white text-ink ring-black/10 hover:bg-sky-50'
                        }`}>
                        <span className="text-xs font-semibold text-ink-mute">{'ABCD'[oi]}</span>{o}
                      </button>
                    );
                  })}
                </div>
              )}
              {it.type === 'fill' && (
                <input
                  {...noSuggestInputProps()}
                  value={String(answers[i] ?? '')}
                  disabled={checked || busy}
                  onChange={(e) => setAnswers((a) => a.map((v, j) => (j === i ? e.target.value : v)))}
                  aria-label={`第 ${i + 1} 题的空里填什么`}
                  placeholder="空里填什么"
                  className={`min-h-10 w-full rounded-xl border bg-white px-3 text-base text-ink focus:outline-none focus:ring-2 ${
                    g ? (g.ok ? 'border-green-400' : 'border-rose-300') : 'border-black/10 focus:ring-sky-200'}`}
                />
              )}
              {it.type === 'order' && (checked ? (
                <p className={`rounded-xl px-3 py-2 text-[15px] ${g?.ok ? 'bg-green-50 text-green-800' : 'bg-rose-50 text-rose-700'}`}>
                  {g?.your || '没排'}
                </p>
              ) : (
                <OrderInput tokens={it.tokens} value={orders[i]} disabled={busy}
                  onChange={(v) => setOrders((o) => o.map((x, j) => (j === i ? v : x)))} />
              ))}
              {g && (!g.ok || g.explain) && (
                <div className="mt-2 space-y-0.5 text-sm">
                  {!g.ok && (
                    <p className="flex flex-wrap items-center gap-1 text-rose-600">
                      正确: <span className="font-semibold">{g.answer}</span>
                      {/[A-Za-z]/.test(g.answer) && (
                        <button type="button" onClick={() => void playAudio(g.answer)}
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-sky-700 hover:bg-sky-50"
                          aria-label={`听 ${g.answer}`}>
                          <Volume2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </p>
                  )}
                  {g.explain && <p className="text-ink-soft">{g.explain}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex items-center gap-3">
        {!checked ? (
          <button type="button" onClick={() => { void check(); }} disabled={busy || !filled}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-sky-600 px-4 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-40">
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            交给小鹰老师
          </button>
        ) : (
          <>
            <span className="text-sm font-semibold text-ink">对了 {right} / {items.length}</span>
            <button type="button" onClick={retry}
              className="min-h-10 rounded-xl bg-white px-4 text-sm text-sky-700 ring-1 ring-sky-200 hover:bg-sky-50">
              再做一遍
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default memo(QuizCard);
