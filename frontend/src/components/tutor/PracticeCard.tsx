/**
 * 学习助手出的小练习卡(听发音拼写 / 看中文拼写)。当场判对错,不计分、不进学习记录 ——
 * 这是聊天里随手练一下,算进掌握度会让「问助手」变成刷分入口。
 */
import { memo, useState } from 'react';
import { Check, Volume2, X } from 'lucide-react';
import { useAudio } from '../../hooks/useAudio';
import { noSuggestInputProps } from '../../utils/noSuggestInput';
import type { PracticeItem } from '../../api/tutor';

const norm = (s: string) => s.trim().toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ');

function PracticeCard({ mode, items }: { mode: 'listen' | 'meaning'; items: PracticeItem[] }) {
  const { playAudio } = useAudio();
  const [answers, setAnswers] = useState<string[]>(() => items.map(() => ''));
  const [checked, setChecked] = useState(false);

  const right = items.filter((it, i) => norm(answers[i]) === norm(it.word)).length;

  return (
    <div className="mt-3 rounded-2xl border border-orange-200 bg-orange-50/60 p-3 sm:p-4">
      <p className="mb-2 text-sm font-semibold text-orange-800">
        {mode === 'listen' ? '听发音,写单词' : '看中文,写单词'}
        <span className="ml-2 font-normal text-orange-700/80">共 {items.length} 个</span>
      </p>
      <ol className="space-y-2">
        {items.map((it, i) => {
          const ok = norm(answers[i]) === norm(it.word);
          return (
            <li key={`${it.word}-${i}`} className="flex items-start gap-2">
              <span className="w-5 shrink-0 pt-2.5 text-right text-sm text-ink-mute">{i + 1}.</span>
              {mode === 'listen' ? (
                <button
                  type="button"
                  onClick={() => playAudio(it.word)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-orange-600 shadow-sm ring-1 ring-orange-200 hover:bg-orange-100"
                  aria-label={`听第 ${i + 1} 个单词`}
                >
                  <Volume2 className="h-5 w-5" aria-hidden="true" />
                </button>
              ) : (
                <span className="w-28 shrink-0 break-words pt-2 text-sm leading-snug text-ink sm:w-44">
                  {it.meaning}
                </span>
              )}
              {/* 输入框占满剩下的宽度;判完的正确拼写放在下一行,不挤输入框 */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <input
                    {...noSuggestInputProps()}
                    value={answers[i]}
                    disabled={checked}
                    onChange={(e) => setAnswers((a) => a.map((v, j) => (j === i ? e.target.value : v)))}
                    aria-label={`第 ${i + 1} 个单词的拼写`}
                    className={`min-h-10 w-full min-w-0 rounded-xl border bg-white px-3 text-base text-ink focus:outline-none focus:ring-2 ${
                      checked ? (ok ? 'border-green-400 ring-green-200' : 'border-rose-300') : 'border-black/10 focus:ring-orange-200'
                    }`}
                  />
                  {checked && (ok
                    ? <Check className="h-5 w-5 shrink-0 text-green-600" aria-label="对了" />
                    : <X className="h-5 w-5 shrink-0 text-rose-500" aria-label="不对" />)}
                </div>
                {checked && !ok && (
                  <p className="mt-1 break-words text-sm text-rose-600">
                    正确: <span className="font-semibold">{it.word}</span>
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
            onClick={() => setChecked(true)}
            disabled={answers.every((a) => !a.trim())}
            className="min-h-10 rounded-xl bg-orange-500 px-4 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-40"
          >
            看看对不对
          </button>
        ) : (
          <>
            <span className="text-sm font-semibold text-ink">对了 {right} / {items.length}</span>
            <button
              type="button"
              onClick={() => { setAnswers(items.map(() => '')); setChecked(false); }}
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
