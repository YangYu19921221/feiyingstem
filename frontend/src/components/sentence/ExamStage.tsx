/**
 * 第 5 步 过关检测: 每句一题,题型轮着出(连词成句 / 关键词填空 / 听音选中文 / 看中文默写),80 分过关。
 * 每题只答一次、不重练;首答进掌握度(stage='exam',**只有这一步推进记忆曲线**)。
 * 不计时: 句子长短差很多,倒计时只会逼孩子乱填。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Volume2 } from 'lucide-react';
import type { LearnSentence } from '../../api/sentences';
import { useAudio } from '../../hooks/useAudio';
import useAccidentalTapGuard from '../../hooks/useAccidentalTapGuard';
import { imeSafeInputProps } from '../../utils/noSuggestInput';
import { clozeIsCorrect, makeCloze, shuffleChunks, stripDialogueDash } from '../../utils/sentenceCheck';
import { ArrangeCard } from './ArrangeStage';
import { DictationCard } from './DictationStage';
import type { FirstResult } from './useRoundQueue';
import { StageHeader, PrimaryButton } from './ui';
import { PASS_SCORE } from './constants';
import { buildQuestions } from './buildQuestions';

export default function ExamStage({ items, onDone }: {
  items: LearnSentence[];
  onDone: (score: number, first: FirstResult[]) => void;
}) {
  const questions = useMemo(() => buildQuestions(items), [items]);
  const [idx, setIdx] = useState(0);
  const results = useRef<FirstResult[]>([]);
  const [pending, setPending] = useState<null | boolean>(null);   // 已答、等「下一题」
  const { isAccidentalTap, markShown } = useAccidentalTapGuard();
  const q = questions[idx];

  const answered = (isCorrect: boolean, answer: string) => {
    if (pending !== null) return;
    results.current.push({ sentence: q.sentence, isCorrect, answer });
    setPending(isCorrect);
    markShown();
  };
  const next = () => {
    if (isAccidentalTap()) return;
    setPending(null);
    if (idx + 1 >= questions.length) {
      const correct = results.current.filter(r => r.isCorrect).length;
      onDone(Math.round((correct / questions.length) * 100), results.current);
    } else {
      setIdx(idx + 1);
    }
  };

  if (!q) return null;
  const typeName = { arrange: '连词成句', cloze: '填关键词', choice: '听音选意思', dictation: '看中文默写' }[q.type];

  return (
    <motion.div key={idx} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} data-sentence-id={q.sentence.id}>
      <StageHeader step={5} title="过关检测" hint={`${typeName} · ${PASS_SCORE} 分过关,每题只答一次`} pos={idx} total={questions.length} />
      {q.type === 'arrange' && <ArrangeCard sentence={q.sentence} single onFinish={answered} />}
      {q.type === 'dictation' && <DictationCard sentence={q.sentence} single autoPlay={false} onFinish={answered} />}
      {q.type === 'cloze' && <ClozeCard sentence={q.sentence} onFinish={answered} />}
      {q.type === 'choice' && <ChoiceCard sentence={q.sentence} pool={items} onFinish={answered} />}
      {pending !== null && (
        <div className="mt-4">
          <p className={`mb-3 text-sm ${pending ? 'text-green-700' : 'text-red-600'}`}>
            {pending ? '答对了' : <>答错了。正确的是:<span className="font-medium">{stripDialogueDash(q.sentence.english)}</span></>}
          </p>
          <PrimaryButton onClick={next}>{idx + 1 >= questions.length ? '看成绩' : '下一题'}</PrimaryButton>
        </div>
      )}
    </motion.div>
  );
}

function ClozeCard({ sentence, onFinish }: { sentence: LearnSentence; onFinish: (ok: boolean, ans: string) => void }) {
  const cloze = makeCloze(sentence.english, sentence.key_word)!;
  const [input, setInput] = useState('');
  const [done, setDone] = useState(false);
  const submit = () => {
    if (!input.trim() || done) return;
    setDone(true);
    onFinish(clozeIsCorrect(input, cloze.answer), input);
  };
  return (
    <div className="rounded-2xl border border-black/[0.05] bg-white p-5">
      <p className="text-base text-ink-soft">{sentence.chinese}</p>
      <p className="mt-3 font-display text-xl leading-relaxed text-ink">
        {cloze.before}
        <span className="mx-1 inline-block min-w-[5rem] border-b-2 border-accent-warm text-center text-accent-warm">{done ? cloze.answer : ' '}</span>
        {cloze.after}
      </p>
      <input {...imeSafeInputProps()} value={input} disabled={done} autoFocus aria-label="填空"
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && !e.repeat) submit(); }}
        placeholder={`填一个词(${cloze.answer.length} 个字母,首字母 ${cloze.answer[0]})`}
        className="mt-4 w-full rounded-xl border-2 border-black/10 px-4 py-3 font-mono text-base outline-none focus:border-accent-warm" />
      {!done && <div className="mt-4"><PrimaryButton onClick={submit} disabled={!input.trim()}>确定</PrimaryButton></div>}
    </div>
  );
}

function ChoiceCard({ sentence, pool, onFinish }: { sentence: LearnSentence; pool: LearnSentence[]; onFinish: (ok: boolean, ans: string) => void }) {
  const { playAudio } = useAudio();
  const options = useMemo(() => shuffleChunks([
    sentence.chinese,
    ...shuffleChunks(pool.filter(s => s.id !== sentence.id && s.chinese !== sentence.chinese)).slice(0, 3).map(s => s.chinese),
  ]), [sentence, pool]);
  const [picked, setPicked] = useState<string | null>(null);
  const text = sentence.tts_text || stripDialogueDash(sentence.english);
  // 只听不看: 这题考的是听懂,英文不显示
  useEffect(() => { const t = setTimeout(() => playAudio(text), 300); return () => clearTimeout(t); }, [text, playAudio]);
  return (
    <div className="rounded-2xl border border-black/[0.05] bg-white p-5">
      <button type="button" onClick={() => playAudio(text)}
        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-accent-warm/[0.08] px-4 text-sm text-accent-warm">
        <Volume2 className="h-5 w-5" /> 再听一遍
      </button>
      <p className="mt-3 text-sm text-ink-soft">听到的这句是什么意思?</p>
      <div className="mt-3 grid gap-2.5">
        {options.map(opt => {
          const isRight = picked !== null && opt === sentence.chinese;
          const isWrong = picked === opt && opt !== sentence.chinese;
          return (
            <button key={opt} type="button" disabled={picked !== null}
              onClick={() => { setPicked(opt); onFinish(opt === sentence.chinese, opt); }}
              className={`min-h-12 rounded-xl border px-4 py-3 text-left text-base transition ${
                isRight ? 'border-green-300 bg-green-50 text-green-800' : isWrong ? 'border-red-300 bg-red-50 text-red-800' : 'border-black/10 hover:border-accent-warm/40'}`}>
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
