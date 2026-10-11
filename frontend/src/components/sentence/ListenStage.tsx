/**
 * 第 1 步 听读: 句子循环播放,中英文都显示。
 * 「会读了」进下一句;「再听听」放到本轮最后再来一遍。不打分、不上报。
 * 对话行(同组相邻的一问一答)连着显示上一句,孩子知道这句是在回答什么。
 */
import { useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Volume2 } from 'lucide-react';
import type { LearnSentence } from '../../api/sentences';
import { useAudio } from '../../hooks/useAudio';
import useAccidentalTapGuard from '../../hooks/useAccidentalTapGuard';
import { stripDialogueDash } from '../../utils/sentenceCheck';
import { useRoundQueue } from './useRoundQueue';
import { StageHeader, PrimaryButton, SecondaryButton } from './ui';
import MarkedText from './MarkedText';

export default function ListenStage({ items, onDone }: { items: LearnSentence[]; onDone: () => void }) {
  const q = useRoundQueue(items);
  const { playAudioLoop, stopAudio } = useAudio();
  const { markShown, isAccidentalTap } = useAccidentalTapGuard();
  const cur = q.current;

  // 对话: 上一句(同组里紧挨着、也是对话行)给个上下文
  const prev = useMemo(() => {
    if (!cur?.is_dialogue) return null;
    const i = items.findIndex(s => s.id === cur.id);
    return i > 0 && items[i - 1].is_dialogue ? items[i - 1] : null;
  }, [cur, items]);

  useEffect(() => {
    if (!cur) return;
    markShown();
    // 循环放 3 遍,每遍之间 1.2 秒留给孩子跟着念
    playAudioLoop(cur.tts_text || stripDialogueDash(cur.english), 3, 1200);
    return () => stopAudio();
  }, [cur, playAudioLoop, stopAudio, markShown]);

  useEffect(() => { if (q.done) onDone(); }, [q.done, onDone]);
  if (!cur) return null;

  const go = (ok: boolean) => { if (isAccidentalTap()) return; stopAudio(); q.answer(ok); };

  return (
    <motion.div key={`${cur.id}-${q.round}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <StageHeader step={1} title="听读" hint="跟着读几遍,会读了再往下" pos={q.pos} total={q.total} round={q.round} />
      <div className="rounded-2xl border border-black/[0.05] bg-white p-6">
        {prev && (
          <p className="mb-3 rounded-lg bg-black/[0.03] px-3 py-2 text-sm text-ink-soft">
            <MarkedText text={prev.english} marked={prev.marked} />
            <span className="ml-2 text-ink-mute">{prev.chinese}</span>
          </p>
        )}
        <p className="font-display text-2xl leading-snug text-ink"><MarkedText text={cur.english} marked={cur.marked} /></p>
        <p className="mt-2 text-base text-ink-soft">{cur.chinese}</p>
        <button
          type="button"
          onClick={() => playAudioLoop(cur.tts_text || stripDialogueDash(cur.english), 1, 0)}
          className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-accent-warm/[0.08] px-4 text-sm text-accent-warm hover:bg-accent-warm/[0.15]"
        >
          <Volume2 className="h-4 w-4" /> 再放一遍
        </button>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <SecondaryButton onClick={() => go(false)}>再听听</SecondaryButton>
        <PrimaryButton onClick={() => go(true)}>会读了</PrimaryButton>
      </div>
    </motion.div>
  );
}
