/**
 * 第 4 步 默写: 看中文 + 听录音,打出整句。
 * 逐词比对(大小写/标点/撇号/对话破折号/常见缩写不算错),只标写错和漏写的词。
 * 写错 → 照着正确的抄一遍(1 遍,分类学习是 3 遍;句子长,抄 3 遍是体力活不是记忆),这句放到本轮最后再默。
 * 首答进掌握度,stage='dictation',写错的原文一并上报给老师看。
 */
import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Volume2 } from 'lucide-react';
import type { LearnSentence } from '../../api/sentences';
import { useAudio } from '../../hooks/useAudio';
import useAccidentalTapGuard from '../../hooks/useAccidentalTapGuard';
import { imeSafeInputProps } from '../../utils/noSuggestInput';
import { checkSentence, stripDialogueDash, type WordDiff } from '../../utils/sentenceCheck';
import { useRoundQueue, type FirstResult } from './useRoundQueue';
import { StageHeader, PrimaryButton, WordMarks } from './ui';

export default function DictationStage({ items, onDone }: {
  items: LearnSentence[]; onDone: (first: FirstResult[]) => void;
}) {
  const q = useRoundQueue(items);
  const cur = q.current;
  useEffect(() => { if (q.done) onDone(q.firstResults()); }, [q.done, onDone, q]);
  if (!cur) return null;
  return (
    <motion.div key={`${cur.id}-${q.round}-${q.pos}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
      <StageHeader step={4} title="默写" hint="看中文,把英文整句写出来" pos={q.pos} total={q.total} round={q.round} />
      <DictationCard sentence={cur} onFinish={(ok, ans) => q.answer(ok, ans)} />
    </motion.div>
  );
}

/** 一张默写卡。过关检测里复用(single: 交一次就结束,不抄写) */
export function DictationCard({ sentence, onFinish, single = false, autoPlay = true }: {
  sentence: LearnSentence;
  onFinish: (isCorrect: boolean, answer: string) => void;
  single?: boolean;
  autoPlay?: boolean;
}) {
  const { playAudio } = useAudio();
  const { markShown, isAccidentalTap } = useAccidentalTapGuard();
  const inputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState('');
  const [result, setResult] = useState<null | { ok: boolean; words: WordDiff[]; answer: string }>(null);
  const [copying, setCopying] = useState(false);
  const target = stripDialogueDash(sentence.english);

  useEffect(() => {
    markShown();
    const t1 = autoPlay ? setTimeout(() => playAudio(sentence.tts_text || target), 300) : undefined;
    const t2 = setTimeout(() => inputRef.current?.focus(), 200);
    return () => { if (t1) clearTimeout(t1); clearTimeout(t2); };
  }, [sentence, target, autoPlay, playAudio, markShown]);

  const submit = () => {
    if (!input.trim() || isAccidentalTap()) return;
    if (copying) {
      if (checkSentence(input, sentence.english).isCorrect) onFinish(false, result?.answer ?? input);
      return;
    }
    const r = checkSentence(input, sentence.english);
    setResult({ ok: r.isCorrect, words: r.words, answer: input });
    markShown();
    if (single) { onFinish(r.isCorrect, input); return; }
    if (!r.isCorrect) { setCopying(true); setInput(''); setTimeout(() => inputRef.current?.focus(), 50); }
  };

  const copyOk = copying && checkSentence(input, sentence.english).isCorrect;

  return (
    <div>
      <div className="rounded-2xl border border-black/[0.05] bg-white p-5">
        <div className="flex items-center gap-3">
          <button type="button" aria-label="播放" onClick={() => playAudio(sentence.tts_text || target)}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-accent-warm/[0.08] text-accent-warm">
            <Volume2 className="h-5 w-5" />
          </button>
          <p className="text-base text-ink">{sentence.chinese}</p>
        </div>
        {result && !result.ok && !single && (
          <div className="mt-4 rounded-xl bg-red-50/60 px-4 py-3">
            <p className="text-xs text-red-700">标红的词写错或漏了,照着正确的抄一遍</p>
            <div className="mt-1"><WordMarks words={result.words} /></div>
          </div>
        )}
        {result?.ok && !single && <p className="mt-4 text-sm text-green-700">全对!</p>}
        <input
          {...imeSafeInputProps()}
          ref={inputRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && !e.repeat) { if (result?.ok) onFinish(true, result.answer); else submit(); } }}
          disabled={!!result?.ok}
          placeholder={copying ? '照着上面抄一遍' : '在这里写英文'}
          aria-label="写出英文句子"
          className="mt-4 w-full rounded-xl border-2 border-black/10 px-4 py-3 font-mono text-base outline-none focus:border-accent-warm disabled:bg-black/[0.02]"
        />
        {copying && <p className={`mt-2 text-xs ${copyOk ? 'text-green-700' : 'text-ink-mute'}`}>{copyOk ? '抄对了' : '大小写和标点不用管'}</p>}
      </div>
      <div className="mt-5">
        {result?.ok && !single
          ? <PrimaryButton onClick={() => { if (!isAccidentalTap()) onFinish(true, result.answer); }}>下一句</PrimaryButton>
          : <PrimaryButton onClick={submit} disabled={!input.trim()}>{copying ? '抄好了' : '写好了'}</PrimaryButton>}
      </div>
    </div>
  );
}
