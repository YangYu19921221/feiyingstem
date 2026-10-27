/**
 * 学习助手出的单词练习卡(听发音拼写 / 看中文拼写)。
 *
 * 10-27 起答案只在服务器(services/tutor_quiz): 卡上只有 word_id(放发音)、中文和字母数,
 * 交了服务器判分,判完给出正确拼写,再请小鹰老师点评(onSubmitted → 页面接着问一句,不扣次数)。
 * 不计分、不进学习记录(聊天里随手练,算进掌握度会变成刷分入口)。
 * 10-27 之前出的旧卡没有 quiz_id、带着 word: 照旧网页当场判。
 */
import { memo, useState } from 'react';
import { Check, Loader2, Volume2, X } from 'lucide-react';
import { useAudio } from '../../hooks/useAudio';
import { noSuggestInputProps } from '../../utils/noSuggestInput';
import { submitQuiz, type PracticeItem, type QuizItemResult, type QuizResult } from '../../api/tutor';
import { getErrorMessage } from '../../utils/errorMessage';
import { toast } from '../Toast';

const norm = (s: string) => s.trim().toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');

export type QuizSubmitted = { quizId: number; score: number; total: number; feedback: boolean; free: boolean };

function PracticeCard({ mode, items, quizId, result, onSubmitted }: {
  mode: 'listen' | 'meaning';
  items: PracticeItem[];
  quizId?: number;
  result?: QuizResult;
  onSubmitted?: (r: QuizSubmitted) => void;
}) {
  const { playAudio } = useAudio();
  const [answers, setAnswers] = useState<string[]>(() => items.map((_, i) => String(result?.answers?.[i] ?? '')));
  const [graded, setGraded] = useState<QuizItemResult[] | null>(() => result?.results ?? null);
  const [busy, setBusy] = useState(false);
  const checked = graded !== null;

  const say = (it: PracticeItem) => {
    if (it.word) void playAudio(it.word);
    else if (it.word_id != null) void playAudio('', 1, it.word_id);
  };

  const check = async () => {
    if (busy) return;
    if (!quizId) {
      // 旧卡: 网页当场判
      setGraded(items.map((it, i) => ({ ok: norm(answers[i]) === norm(it.word || ''), your: answers[i], answer: it.word || '' })));
      return;
    }
    setBusy(true);
    try {
      const r = await submitQuiz(quizId, answers);
      setGraded(r.results);
      if (r.first) onSubmitted?.({ quizId, score: r.score, total: r.total, feedback: r.feedback, free: r.free });
    } catch (e) {
      toast.error(getErrorMessage(e, '没交上去,再点一次'));
    } finally {
      setBusy(false);
    }
  };

  const right = graded ? graded.filter((g) => g.ok).length : 0;

  return (
    <div className="mt-3 rounded-2xl border border-orange-200 bg-orange-50/60 p-3 sm:p-4">
      <p className="mb-2 text-sm font-semibold text-orange-800">
        {mode === 'listen' ? '听发音,写单词' : '看中文,写单词'}
        <span className="ml-2 font-normal text-orange-700/80">共 {items.length} 个</span>
      </p>
      <ol className="space-y-2">
        {items.map((it, i) => {
          const g = graded?.[i];
          return (
            <li key={`${it.word_id ?? it.word}-${i}`} className="flex items-start gap-2">
              <span className="w-5 shrink-0 pt-2.5 text-right text-sm text-ink-mute">{i + 1}.</span>
              {mode === 'listen' ? (
                <button
                  type="button"
                  onClick={() => say(it)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-orange-600 shadow-sm ring-1 ring-orange-200 hover:bg-orange-100"
                  aria-label={`听第 ${i + 1} 个单词`}
                >
                  <Volume2 className="h-5 w-5" aria-hidden="true" />
                </button>
              ) : (
                <span className="w-28 shrink-0 break-words pt-2 text-sm leading-snug text-ink sm:w-44">
                  {it.meaning}
                  {it.letters ? <span className="ml-1 text-xs text-ink-mute">({it.letters} 个字母)</span> : null}
                </span>
              )}
              {/* 输入框占满剩下的宽度;判完的正确拼写放在下一行,不挤输入框 */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <input
                    {...noSuggestInputProps()}
                    value={answers[i]}
                    disabled={checked || busy}
                    onChange={(e) => setAnswers((a) => a.map((v, j) => (j === i ? e.target.value : v)))}
                    aria-label={`第 ${i + 1} 个单词的拼写`}
                    className={`min-h-10 w-full min-w-0 rounded-xl border bg-white px-3 text-base text-ink focus:outline-none focus:ring-2 ${
                      g ? (g.ok ? 'border-green-400 ring-green-200' : 'border-rose-300') : 'border-black/10 focus:ring-orange-200'
                    }`}
                  />
                  {g && (g.ok
                    ? <Check className="h-5 w-5 shrink-0 text-green-600" aria-label="对了" />
                    : <X className="h-5 w-5 shrink-0 text-rose-500" aria-label="不对" />)}
                </div>
                {g && (
                  <p className={`mt-1 flex flex-wrap items-center gap-x-2 break-words text-sm ${g.ok ? 'text-green-700' : 'text-rose-600'}`}>
                    {!g.ok && <span>正确: <span className="font-semibold">{g.answer}</span></span>}
                    {it.word_id != null && (
                      <button type="button" onClick={() => void playAudio(g.answer, 1, it.word_id)}
                        className="inline-flex min-h-8 items-center gap-1 rounded-lg px-1.5 text-sky-700 hover:bg-sky-50"
                        aria-label={`听 ${g.answer} 的发音`}>
                        <Volume2 className="h-4 w-4" aria-hidden="true" /> {g.ok ? g.answer : ''}
                      </button>
                    )}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="mt-3 flex items-center gap-3">
        {!checked ? (
          <button
            type="button"
            onClick={() => { void check(); }}
            disabled={busy || answers.every((a) => !a.trim())}
            className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-orange-500 px-4 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-40"
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            看看对不对
          </button>
        ) : (
          <>
            <span className="text-sm font-semibold text-ink">对了 {right} / {items.length}</span>
            <button
              type="button"
              onClick={() => { setAnswers(items.map(() => '')); setGraded(null); }}
              className="min-h-10 rounded-xl bg-white px-4 text-sm text-orange-700 ring-1 ring-orange-200 hover:bg-orange-100"
            >
              再写一遍
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default memo(PracticeCard);
