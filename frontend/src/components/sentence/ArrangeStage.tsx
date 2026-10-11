/**
 * 第 2 步 连词成句: 看中文、听录音,把打乱的词块按顺序点出来。
 * 点错不立刻判(孩子会边点边改),点满了才判;错了标出第一个放错的位置,重排。
 * 首答(第一次点满时对不对)进掌握度,stage='arrange'。
 */
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Volume2, Undo2 } from 'lucide-react';
import type { LearnSentence } from '../../api/sentences';
import { useAudio } from '../../hooks/useAudio';
import useAccidentalTapGuard from '../../hooks/useAccidentalTapGuard';
import { arrangeChunks, arrangeIsCorrect, compareTokens, shuffleChunks, stripDialogueDash } from '../../utils/sentenceCheck';
import { useRoundQueue, type FirstResult } from './useRoundQueue';
import { StageHeader, PrimaryButton, SecondaryButton } from './ui';

export default function ArrangeStage({ items, onDone }: {
  items: LearnSentence[]; onDone: (first: FirstResult[]) => void;
}) {
  const q = useRoundQueue(items);
  const cur = q.current;
  useEffect(() => { if (q.done) onDone(q.firstResults()); }, [q.done, onDone, q]);
  if (!cur) return null;
  return (
    <motion.div key={`${cur.id}-${q.round}-${q.pos}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <StageHeader step={2} title="连词成句" hint="听一听,按顺序点出词块" pos={q.pos} total={q.total} round={q.round} />
      <ArrangeCard sentence={cur} onFinish={(ok, ans) => q.answer(ok, ans)} />
    </motion.div>
  );
}

/** 一张连词卡。过关检测里也复用(那里只答一次,不重排) */
export function ArrangeCard({ sentence, onFinish, single = false }: {
  sentence: LearnSentence;
  /** isCorrect = 第一次点满时对不对;single 模式下点满即结束 */
  onFinish: (isCorrect: boolean, answer: string) => void;
  single?: boolean;
}) {
  const { playAudio } = useAudio();
  const { markShown, isAccidentalTap } = useAccidentalTapGuard();
  const chunks = useMemo(() => arrangeChunks(sentence.english), [sentence.english]);
  // 词块带下标,相同的词(两个 I)也能区分
  const shuffled = useMemo(() => shuffleChunks(chunks.map((t, i) => ({ t, i }))), [chunks]);
  const [picked, setPicked] = useState<number[]>([]);
  const [verdict, setVerdict] = useState<null | 'ok' | 'wrong'>(null);
  const [firstVerdict, setFirstVerdict] = useState<null | boolean>(null);
  const [firstAnswer, setFirstAnswer] = useState('');

  useEffect(() => {
    markShown();
    const t = setTimeout(() => playAudio(sentence.tts_text || stripDialogueDash(sentence.english)), 300);
    return () => clearTimeout(t);
  }, [sentence, playAudio, markShown]);

  const pickedWords = picked.map(i => chunks[i]);
  const full = picked.length === chunks.length;

  // 点满自动判
  useEffect(() => {
    if (!full || verdict) return;
    const ok = arrangeIsCorrect(pickedWords, sentence.english);
    setVerdict(ok ? 'ok' : 'wrong');
    if (firstVerdict === null) { setFirstVerdict(ok); setFirstAnswer(pickedWords.join(' ')); }
    if (single) onFinish(ok, pickedWords.join(' '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full]);

  // 第一个放错的位置(比对口径一致: 标点、大小写不算)
  const wrongAt = useMemo(() => {
    if (verdict !== 'wrong') return -1;
    for (let k = 0; k < pickedWords.length; k++) {
      if (compareTokens(pickedWords[k]).join(' ') !== compareTokens(chunks[k]).join(' ')) return k;
    }
    return -1;
  }, [verdict, pickedWords, chunks]);

  const pick = (i: number) => {
    if (verdict || isAccidentalTap()) return;
    setPicked(p => [...p, i]);
  };
  const undo = () => { if (!verdict) setPicked(p => p.slice(0, -1)); };
  const retry = () => { if (isAccidentalTap()) return; setPicked([]); setVerdict(null); markShown(); };

  return (
    <div>
      <div className="rounded-2xl border border-black/[0.05] bg-white p-5">
        <div className="flex items-center gap-3">
          <button type="button" aria-label="播放" onClick={() => playAudio(sentence.tts_text || stripDialogueDash(sentence.english))}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-accent-warm/[0.08] text-accent-warm">
            <Volume2 className="h-5 w-5" />
          </button>
          <p className="text-base text-ink">{sentence.chinese}</p>
        </div>
        {/* 已排的 */}
        <div className={`mt-4 flex min-h-[3.5rem] flex-wrap gap-2 rounded-xl border-2 border-dashed p-2 ${
          verdict === 'ok' ? 'border-green-300 bg-green-50' : verdict === 'wrong' ? 'border-red-300 bg-red-50' : 'border-black/10'}`}>
          {pickedWords.map((w, k) => (
            <span key={k} className={`rounded-lg px-3 py-1.5 text-base ${k === wrongAt ? 'bg-red-500 text-white' : 'bg-white text-ink shadow-sm'}`}>{w}</span>
          ))}
          {picked.length === 0 && <span className="self-center px-2 text-sm text-ink-mute">点下面的词块</span>}
        </div>
        {verdict === 'wrong' && (
          <p className="mt-3 text-sm text-red-600">
            从第 {wrongAt + 1} 个词开始顺序不对。正确的是:<span className="font-medium">{stripDialogueDash(sentence.english)}</span>
          </p>
        )}
        {verdict === 'ok' && <p className="mt-3 text-sm text-green-700">排对了!</p>}
        {/* 待选的 */}
        {!verdict && (
          <div className="mt-4 flex flex-wrap gap-2">
            {shuffled.map(({ t, i }) => (
              <button key={i} type="button" disabled={picked.includes(i)} onClick={() => pick(i)}
                className="min-h-11 rounded-lg border border-black/10 bg-white px-3 py-1.5 text-base text-ink shadow-sm hover:border-accent-warm/50 disabled:invisible">
                {t}
              </button>
            ))}
          </div>
        )}
      </div>
      {!single && (
        <div className="mt-5">
          {!verdict && (
            <SecondaryButton onClick={undo} disabled={picked.length === 0}>
              <span className="inline-flex items-center gap-1.5"><Undo2 className="h-4 w-4" /> 退一步</span>
            </SecondaryButton>
          )}
          {verdict === 'wrong' && <PrimaryButton onClick={retry}>照着正确的再排一次</PrimaryButton>}
          {verdict === 'ok' && (
            <PrimaryButton onClick={() => { if (!isAccidentalTap()) onFinish(firstVerdict ?? true, firstAnswer); }}>下一句</PrimaryButton>
          )}
        </div>
      )}
    </div>
  );
}
