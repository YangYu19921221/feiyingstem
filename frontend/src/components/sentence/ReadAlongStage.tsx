/**
 * 单元收尾: 跟读整篇。整个单元的句子连着播,当前句高亮,孩子跟着说一遍。不打分、不录音,只练流利度。
 * 可以随时「跳过」(这一步是锦上添花,不该挡住拿到「背完了」)。
 */
import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import type { LearnSentence } from '../../api/sentences';
import { useAudio } from '../../hooks/useAudio';
import { stripDialogueDash } from '../../utils/sentenceCheck';
import { PrimaryButton, SecondaryButton } from './ui';
import MarkedText from './MarkedText';

export default function ReadAlongStage({ sentences, onDone }: { sentences: LearnSentence[]; onDone: () => void }) {
  const { playAudioLoop, stopAudio } = useAudio();
  const [idx, setIdx] = useState(-1);          // -1 = 还没开始
  const [playing, setPlaying] = useState(false);
  const token = useRef(0);
  const itemRefs = useRef<(HTMLLIElement | null)[]>([]);

  const run = async (from: number) => {
    const my = ++token.current;
    setPlaying(true);
    for (let i = from; i < sentences.length; i++) {
      if (token.current !== my) return;
      setIdx(i);
      itemRefs.current[i]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      const s = sentences[i];
      await playAudioLoop(s.tts_text || stripDialogueDash(s.english), 1, 0);
      // 每句后留出跟读时间: 按词数估,至少 1.5 秒
      const words = stripDialogueDash(s.english).split(/\s+/).length;
      await new Promise(r => setTimeout(r, Math.max(1500, words * 450)));
    }
    if (token.current === my) { setPlaying(false); setIdx(sentences.length); }
  };

  const pause = () => { token.current++; stopAudio(); setPlaying(false); };
  useEffect(() => () => { token.current++; stopAudio(); }, [stopAudio]);
  const finished = idx >= sentences.length;

  return (
    <div>
      <p className="mb-4 text-sm text-ink-soft">整个单元连起来播一遍,每句放完跟着说。不打分。</p>
      <ol className="space-y-2">
        {sentences.map((s, i) => (
          <li key={s.id} ref={el => { itemRefs.current[i] = el; }}
            className={`rounded-xl px-4 py-3 transition ${i === idx ? 'bg-accent-warm/10 ring-2 ring-accent-warm/40' : 'bg-white'}`}>
            <p className={`font-display text-lg ${i === idx ? 'text-ink' : 'text-ink-soft'}`}><MarkedText text={s.english} marked={s.marked} /></p>
            <p className="text-xs text-ink-mute">{s.chinese}</p>
          </li>
        ))}
      </ol>
      <div className="sticky bottom-0 mt-5 grid gap-3 bg-paper/95 py-3 backdrop-blur">
        {finished ? (
          <PrimaryButton onClick={onDone}>完成</PrimaryButton>
        ) : playing ? (
          <SecondaryButton onClick={pause}><span className="inline-flex items-center gap-1.5"><Pause className="h-4 w-4" />暂停</span></SecondaryButton>
        ) : (
          <>
            <PrimaryButton onClick={() => run(Math.max(0, idx))}>
              <span className="inline-flex items-center gap-1.5"><Play className="h-4 w-4" />{idx < 0 ? '开始跟读' : '接着读'}</span>
            </PrimaryButton>
            <SecondaryButton onClick={onDone}>跳过</SecondaryButton>
          </>
        )}
      </div>
    </div>
  );
}
