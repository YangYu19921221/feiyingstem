/**
 * 句子填空阶段(循环模式)—— 2026-10-23 重做,用户「填错没有提示,正确答案也没有」
 *
 * 显示例句(目标词挖空)+ 中文翻译,学生填入该词。没有例句/挖不出空的词自动跳过。
 *
 * 判分按**句子里那个空该填的形式**(utils/sentenceFill,挖空和判分同一个区间):
 * 句子是 "She sings a song" 就判 sings,大小写不算错;写成原形 sing 单独提示「放进句子要变个样子」。
 *
 * 一个词的流程:
 *   第一次写 → 对: ✅ 下一个
 *            → 错: 不给答案,提示首字母 + 字母个数(写成原形则提示要变形),再写一次
 *   第二次写 → 对: ✅ 改对了
 *            → 错 / 任何时候点「不会,看答案」: 正确的词绿色填回句子 + 逐字母对比 + 自动朗读句子,
 *              **照着写对一遍才能下一个**(订正)
 *   第一次没写对的词收进下一轮,全对才结束。
 *
 * 防误跳(以前判完再按一下回车就跳走,答案一闪而过):
 *   出答案后 1 秒、判对后 0.4 秒、换题后 0.35 秒内的回车和点击都不算;按住回车不连跳;中文输入法组字时的回车不算提交。
 *
 * 只把**第一轮每个词的第一次作答**交给 onFirstAnswer(放弃看答案也算一次做错),
 * 页面拿去记学习记录;后面的重试和轮次不记 —— 看过答案再写对不该算会了。
 */
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { WordData } from '../../api/progress';
import ColoredWord from '../ColoredWord';
import ColoredPhonetic from '../ColoredPhonetic';
import { blankAnswer, checkFill, letterCount, letterDiff, type BlankAnswer } from '../../utils/sentenceFill';
import { imeSafeInputProps } from '../../utils/noSuggestInput';

export interface FillBlankResult {
  wordId: number;
  word: string;
  userInput: string;
  isCorrect: boolean;
  /** 例句与空里该填的形式(结束页回顾用) */
  sentence?: string;
  expected?: string;
}

export interface FirstAnswer {
  wordId: number;
  isCorrect: boolean;
  /** 孩子写的;直接点「看答案」时为空串 */
  userAnswer: string;
}

interface SentenceFillPhaseProps {
  words: WordData[];
  onComplete: (results: FillBlankResult[]) => void;
  playAudio: (text: string, rate?: number, wordId?: number) => void;
  /** 每个词第一轮的第一次作答(放弃也算一次做错) */
  onFirstAnswer?: (answer: FirstAnswer) => void;
}

type Stage = 'answer' | 'retry' | 'correct' | 'revealed';

interface Item {
  word: WordData;
  blank: BlankAnswer;
}

const REVEAL_GUARD_MS = 1000;
const CORRECT_GUARD_MS = 400;
const NEW_WORD_GUARD_MS = 350;

export default function SentenceFillPhase({
  words,
  onComplete,
  playAudio,
  onFirstAnswer,
}: SentenceFillPhaseProps) {
  // 只取能正确挖空的词,避免出现没有横线的坏句
  const items = useMemo<Item[]>(() => words.flatMap((w) => {
    const blank = blankAnswer(w.example_sentence, w.word);
    return blank ? [{ word: w, blank }] : [];
  }), [words]);

  const [roundItems, setRoundItems] = useState<Item[]>(items);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [round, setRound] = useState(1);
  const [stage, setStage] = useState<Stage>('answer');
  const [hint, setHint] = useState<'wrong' | 'base' | null>(null);
  const [userInput, setUserInput] = useState('');
  const [firstWrong, setFirstWrong] = useState('');
  const [lastWrong, setLastWrong] = useState('');
  const [copyInput, setCopyInput] = useState('');
  const [copyMiss, setCopyMiss] = useState(false);
  const [showRoundSummary, setShowRoundSummary] = useState(false);
  const [summary, setSummary] = useState({ correct: 0, missed: 0 });

  // 跨渲染累积的数据放 ref: 轮次结束时要读到最新值,state 会读到旧闭包
  const resultsRef = useRef<FillBlankResult[]>([]);
  const missRef = useRef<Item[]>([]);
  const guardUntil = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const copyRef = useRef<HTMLInputElement>(null);

  const current = roundItems[currentIndex];
  const expected = current?.blank.expected ?? '';
  const expectedLetters = letterCount(expected);
  const capLength = Math.max(expected.length + 4, Math.ceil(expected.length * 1.5));

  const guarded = () => Date.now() < guardUntil.current;
  const guardFor = (ms: number) => { guardUntil.current = Date.now() + ms; };

  // 没有能挖空的词,直接完成
  useEffect(() => {
    if (items.length === 0) onComplete([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 聚焦: 作答/重写时聚焦答题框,出答案后聚焦订正框(延迟到动画结束再弹键盘)
  useEffect(() => {
    if (!current || showRoundSummary || stage === 'correct') return;
    const target = stage === 'revealed' ? copyRef : inputRef;
    const t = setTimeout(() => {
      target.current?.focus({ preventScroll: true });
      target.current?.click();   // 移动端要再触发一次才弹键盘
    }, 300);
    return () => clearTimeout(t);
  }, [currentIndex, current, round, stage, showRoundSummary]);

  const recordFirst = useCallback((item: Item, isCorrect: boolean, input: string) => {
    if (round !== 1 || resultsRef.current.some((r) => r.wordId === item.word.id)) return;
    resultsRef.current = [...resultsRef.current, {
      wordId: item.word.id,
      word: item.word.word,
      userInput: input,
      isCorrect,
      sentence: item.word.example_sentence ?? undefined,
      expected: item.blank.expected,
    }];
    onFirstAnswer?.({ wordId: item.word.id, isCorrect, userAnswer: input });
  }, [round, onFirstAnswer]);

  const markMissed = (item: Item) => {
    if (!missRef.current.some((m) => m.word.id === item.word.id)) missRef.current = [...missRef.current, item];
  };

  const reveal = useCallback((wrongInput: string) => {
    if (!current) return;
    if (stage === 'answer') {
      recordFirst(current, false, wrongInput);   // 第一次就点了看答案 = 一次做错
      markMissed(current);
    }
    setLastWrong(wrongInput);
    setCopyInput('');
    setCopyMiss(false);
    setStage('revealed');
    guardFor(REVEAL_GUARD_MS);
    if (current.word.example_sentence) playAudio(current.word.example_sentence);
  }, [current, stage, recordFirst, playAudio]);

  const handleSubmit = useCallback(() => {
    if (!current || guarded() || !userInput.trim()) return;
    if (stage !== 'answer' && stage !== 'retry') return;
    const result = checkFill(userInput, current.blank.expected, current.word.word);
    if (stage === 'answer') {
      recordFirst(current, result.correct, userInput);
      if (result.correct) {
        setStage('correct');
        guardFor(CORRECT_GUARD_MS);
        playAudio(current.word.word, 1, current.word.id);
        return;
      }
      markMissed(current);
      setFirstWrong(userInput);
      setHint(result.baseForm ? 'base' : 'wrong');
      setUserInput('');
      setStage('retry');
      return;
    }
    // 第二次
    if (result.correct) {
      setStage('correct');
      guardFor(CORRECT_GUARD_MS);
      playAudio(current.word.word, 1, current.word.id);
      return;
    }
    reveal(userInput);
  }, [current, stage, userInput, recordFirst, reveal, playAudio]);

  const handleRoundEnd = useCallback(() => {
    const missed = missRef.current;
    if (missed.length === 0) {
      onComplete(resultsRef.current);
      return;
    }
    setSummary({ correct: roundItems.length - missed.length, missed: missed.length });
    setShowRoundSummary(true);
    setTimeout(() => {
      setRound((r) => r + 1);
      setRoundItems([...missed]);
      missRef.current = [];
      setCurrentIndex(0);
      resetWord();
      setShowRoundSummary(false);
      guardFor(NEW_WORD_GUARD_MS);
    }, 2500);
  }, [roundItems.length, onComplete]);

  function resetWord() {
    setStage('answer');
    setHint(null);
    setUserInput('');
    setFirstWrong('');
    setLastWrong('');
    setCopyInput('');
    setCopyMiss(false);
  }

  const handleNext = useCallback(() => {
    if (guarded()) return;
    if (stage !== 'correct' && stage !== 'revealed') return;
    if (currentIndex + 1 >= roundItems.length) {
      handleRoundEnd();
      return;
    }
    setCurrentIndex((i) => i + 1);
    resetWord();
    guardFor(NEW_WORD_GUARD_MS);
  }, [stage, currentIndex, roundItems.length, handleRoundEnd]);

  const copyOk = !!current && checkFill(copyInput, current.blank.expected, current.word.word).correct;
  const handleCopySubmit = useCallback(() => {
    if (guarded() || !current) return;
    if (copyOk) handleNext();
    else setCopyMiss(true);
  }, [current, copyOk, handleNext]);

  const cleanInput = (v: string) => v.replace(/[^a-zA-Z '\-!?.,！？，。…]/g, '').slice(0, capLength);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || e.repeat || e.nativeEvent.isComposing) return;
    e.preventDefault();
    if (stage === 'revealed') handleCopySubmit();
    else handleSubmit();
  };

  // 判对后没有输入框,用全局回车进下一题(按住不连跳、组字时不算)
  useEffect(() => {
    if (stage !== 'correct') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.repeat && !e.isComposing) handleNext();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage, handleNext]);

  if (showRoundSummary) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center px-4 py-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-xl rounded-[28px] border border-[#f0e2d6] bg-white p-7 text-center shadow-[0_8px_30px_rgba(189,82,39,0.08)] sm:p-10"
        >
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 text-3xl" aria-hidden="true">🔄</div>
          <h3 className="font-display text-2xl font-semibold text-ink sm:text-3xl">填空第 {round} 轮完成</h3>
          <div className="mx-auto mt-6 grid max-w-sm grid-cols-2 gap-3">
            <div className="rounded-2xl bg-green-50 px-4 py-4">
              <div className="font-numeric text-3xl font-bold text-green-600">{summary.correct}</div>
              <div className="mt-1 text-sm text-green-700/80">一次写对</div>
            </div>
            <div className="rounded-2xl bg-orange-50 px-4 py-4">
              <div className="font-numeric text-3xl font-bold text-accent-warm">{summary.missed}</div>
              <div className="mt-1 text-sm text-accent-warm/80">要再练</div>
            </div>
          </div>
          <p className="mt-6 text-base text-ink-soft">
            还有 <span className="font-bold text-accent-warm">{summary.missed}</span> 个词再练一遍...
          </p>
        </motion.div>
      </div>
    );
  }

  if (!current) return null;

  const sentence = current.word.example_sentence || '';
  const before = sentence.slice(0, current.blank.start);
  const after = sentence.slice(current.blank.end);
  const filled = stage === 'correct' || stage === 'revealed';
  const sameAsBase = expected.toLowerCase() === current.word.word.trim().toLowerCase();
  const wrongShown = lastWrong || firstWrong;
  const diff = stage === 'revealed' && wrongShown ? letterDiff(wrongShown, expected) : null;
  const progressPct = ((currentIndex + (filled ? 1 : 0)) / roundItems.length) * 100;

  // 句子里的空按字母画成一个个格子,边打边填进去(孩子不用在句子和输入框之间来回看)。
  // 一个词一组不断行,词与词之间的空格可以断行 —— 长短语在手机上也不会撑破
  const typed = filled ? '' : userInput.replace(/[^A-Za-z]/g, '');
  let letterIdx = 0;
  const blankSlots = expected.split(' ').map((part, wi) => (
    <span key={wi}>
      {wi > 0 && ' '}
      <span className="inline-flex whitespace-nowrap align-baseline">
        {[...part].map((ch, ci) => {
          if (!/[A-Za-z]/.test(ch)) {
            return <span key={ci} className={filled ? 'text-green-700' : 'text-ink-mute'}>{ch}</span>;
          }
          const i = letterIdx++;
          let shown = '';
          let tone = 'border-[#e6cdb9] text-transparent';
          if (filled) {
            shown = ch;
            tone = 'border-green-500 text-green-700';
          } else if (i < typed.length) {
            shown = typed[i];
            tone = 'border-accent-warm text-ink';
          } else if (i === 0 && hint === 'wrong') {
            shown = ch;
            tone = 'border-amber-300 text-amber-500/80';
          }
          return (
            <span
              key={ci}
              className={`mx-[0.035em] inline-block w-[0.7em] border-b-[3px] text-center font-mono font-bold transition-colors duration-150 ${tone}`}
            >
              {shown || '\u00a0'}
            </span>
          );
        })}
      </span>
    </span>
  ));

  return (
    <div className="flex min-h-[72vh] flex-col items-center justify-center px-3 py-6 sm:px-6 sm:py-10">
      {/* 进度 */}
      <div className="mb-5 w-full max-w-2xl sm:mb-7">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium text-ink-soft">
            句子填空 {currentIndex + 1} / {roundItems.length}
          </span>
          {round > 1 && (
            <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-accent-warm">第{round}轮 · 错题再练</span>
          )}
        </div>
        <div className="h-2.5 w-full overflow-hidden rounded-full bg-[#efe6dd]">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-[#ff8a4c] to-[#bd5227]"
            animate={{ width: `${progressPct}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 20 }}
          />
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={`${round}-${current.word.id}`}
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -24 }}
          transition={{ duration: 0.28 }}
          className="w-full max-w-2xl rounded-[28px] border border-[#f0e2d6] bg-white p-5 shadow-[0_10px_40px_rgba(189,82,39,0.08)] sm:p-10"
        >
          {/* 顶栏: 题型 + 朗读 */}
          <div className="mb-5 flex items-center justify-between gap-3 sm:mb-7">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-3.5 py-1.5 text-sm font-semibold text-accent-warm">
              <span aria-hidden="true">📝</span> 把句子补完整
            </span>
            <button
              type="button"
              onClick={() => playAudio(sentence)}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-orange-200 bg-white px-4 text-sm font-semibold text-accent-warm transition hover:bg-orange-50 active:scale-95"
            >
              <span aria-hidden="true">🔊</span> 朗读句子
            </button>
          </div>

          {/* 例句: 空里按字母画格子,边打边填;判对/出答案后变绿 */}
          <p className="font-display text-[22px] leading-[1.75] text-ink sm:text-[30px] sm:leading-[1.7]">
            {before}
            <span
              className={`mx-1 rounded-xl px-1.5 py-0.5 transition-colors duration-200 ${filled ? 'bg-green-50' : 'bg-[#fff4ea]'}`}
              aria-label={filled ? expected : `${expectedLetters} 个字母的空`}
            >
              {blankSlots}
            </span>
            {after}
          </p>

          {current.word.example_translation && (
            <div className="mt-5 flex items-start gap-2.5 rounded-2xl bg-[#faf6f1] px-4 py-3 sm:mt-6 sm:px-5 sm:py-4">
              <span className="mt-0.5 shrink-0 rounded-md bg-white px-1.5 py-0.5 text-[11px] font-semibold text-ink-mute ring-1 ring-black/5">中文</span>
              <p className="text-base leading-7 text-ink-soft sm:text-lg">{current.word.example_translation}</p>
            </div>
          )}

          {/* 作答 / 再写一次 */}
          {(stage === 'answer' || stage === 'retry') && (
            <div className="mt-6 sm:mt-8">
              {stage === 'retry' && (
                <motion.div
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mb-4 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-left text-[15px] leading-7 text-amber-900"
                  role="status"
                >
                  <span className="text-xl leading-7" aria-hidden="true">{hint === 'base' ? '🧩' : '💡'}</span>
                  <div>
                    {hint === 'base' ? (
                      <>单词没错！放进这句话里要<strong>变个样子</strong>（看看前面是谁、是什么时候），再改一下。</>
                    ) : (
                      <>还差一点。首字母是 <strong className="font-mono text-lg">{expected[0]}</strong>，一共 <strong>{expectedLetters}</strong> 个字母，再写一次。</>
                    )}
                    <span className="mt-0.5 block text-sm text-amber-800/70">
                      你刚才写的：<span className="font-mono line-through">{firstWrong}</span>
                    </span>
                  </div>
                </motion.div>
              )}
              <input
                {...imeSafeInputProps()}
                ref={inputRef}
                value={userInput}
                onChange={(e) => setUserInput(cleanInput(e.target.value))}
                onKeyDown={handleKeyDown}
                maxLength={capLength}
                placeholder={stage === 'retry' ? '再写一次…' : '在这里写单词…'}
                aria-label="填入单词"
                className="h-16 w-full rounded-2xl border-2 border-[#ecd9ca] bg-[#fffcf9] px-5 text-center font-mono text-[26px] font-bold tracking-wide text-ink outline-none transition placeholder:font-sans placeholder:text-lg placeholder:font-normal placeholder:tracking-normal placeholder:text-ink-mute/70 focus:border-accent-warm focus:bg-white focus:ring-4 focus:ring-orange-100 sm:h-[72px] sm:text-3xl"
                autoFocus
              />
              <p className="mt-2 text-center text-sm text-ink-mute">
                一共 {expectedLetters} 个字母 · 已写 <span className="font-numeric font-semibold text-ink-soft">{letterCount(userInput)}</span>
              </p>
              <div className="mt-5 flex flex-col items-center gap-2 sm:flex-row sm:justify-center sm:gap-4">
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={userInput.trim().length === 0}
                  className="btn-glow h-14 w-full rounded-2xl px-10 text-lg font-bold text-white sm:w-auto sm:min-w-[220px]"
                >
                  提交 (Enter)
                </button>
                <button
                  type="button"
                  onClick={() => { if (!guarded()) reveal(stage === 'retry' ? '' : userInput); }}
                  className="min-h-11 px-4 text-[15px] font-medium text-ink-mute underline-offset-4 transition hover:text-ink-soft hover:underline"
                >
                  不会，看答案
                </button>
              </div>
            </div>
          )}

          {/* 写对了 */}
          {stage === 'correct' && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mt-6 flex flex-col items-center rounded-2xl border border-green-200 bg-green-50 px-5 py-6 text-center sm:mt-8"
            >
              <motion.div
                initial={{ scale: 0.4, rotate: -20 }}
                animate={{ scale: 1, rotate: 0 }}
                transition={{ type: 'spring', stiffness: 320, damping: 14 }}
                className="flex h-14 w-14 items-center justify-center rounded-full bg-green-500 text-2xl text-white"
                aria-hidden="true"
              >
                ✓
              </motion.div>
              <div className="mt-3 font-display text-2xl font-semibold text-green-700">{firstWrong ? '改对了！' : '正确！'}</div>
              {current.word.phonetic && (
                <div className="mt-2 flex justify-center">
                  <ColoredPhonetic phonetic={current.word.phonetic} size="sm" />
                </div>
              )}
              <button
                type="button"
                onClick={handleNext}
                className="btn-glow mt-5 h-14 w-full rounded-2xl px-10 text-lg font-bold text-white sm:w-auto sm:min-w-[220px]"
              >
                下一个 (Enter)
              </button>
            </motion.div>
          )}

          {/* 出答案 + 订正 */}
          {stage === 'revealed' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-6 sm:mt-8">
              <div className="rounded-2xl border border-green-200 bg-green-50/70 px-5 py-5 text-center">
                <p className="text-sm font-medium text-green-700/80">正确答案</p>
                <div className="mt-1 flex justify-center">
                  {sameAsBase
                    ? <ColoredWord word={expected} syllables={current.word.syllables} className="font-display text-4xl font-bold sm:text-5xl" />
                    : <span className="font-display text-4xl font-bold text-green-700 sm:text-5xl">{expected}</span>}
                </div>
                {current.word.phonetic && (
                  <div className="mt-2 flex justify-center">
                    <ColoredPhonetic phonetic={current.word.phonetic} size="sm" />
                  </div>
                )}
                {!sameAsBase && (
                  <p className="mt-2 text-sm text-ink-soft">
                    原形 <span className="font-semibold text-ink">{current.word.word}</span>，放进这句话里要写成 <span className="font-semibold text-green-700">{expected}</span>
                  </p>
                )}

                {diff && (
                  <div className="mx-auto mt-4 max-w-sm rounded-xl bg-white px-4 py-3 text-left text-[15px] ring-1 ring-black/5">
                    <p className="flex items-baseline gap-2 text-ink-mute">
                      <span className="w-14 shrink-0 text-sm">你写的</span>
                      <span className="font-mono text-lg">
                        {diff.got.map((d, i) => (
                          <span key={i} className={d.ok ? 'text-ink-soft' : 'font-bold text-red-500 line-through'}>{d.ch}</span>
                        ))}
                      </span>
                    </p>
                    <p className="mt-1 flex items-baseline gap-2 text-ink-mute">
                      <span className="w-14 shrink-0 text-sm">应该是</span>
                      <span className="font-mono text-lg">
                        {diff.want.map((d, i) => (
                          <span key={i} className={d.ok ? 'text-ink-soft' : 'font-bold text-green-600 underline decoration-2 underline-offset-4'}>{d.ch}</span>
                        ))}
                      </span>
                    </p>
                  </div>
                )}
              </div>

              <p className="mt-6 text-center text-base font-semibold text-ink">照着写一遍再继续</p>
              <input
                {...imeSafeInputProps()}
                ref={copyRef}
                value={copyInput}
                onChange={(e) => { setCopyInput(cleanInput(e.target.value)); setCopyMiss(false); }}
                onKeyDown={handleKeyDown}
                maxLength={capLength}
                placeholder={expected}
                aria-label="照着写一遍"
                className={`mt-3 h-16 w-full rounded-2xl border-2 bg-[#fffcf9] px-5 text-center font-mono text-[26px] font-bold tracking-wide text-ink outline-none transition placeholder:text-ink-mute/40 focus:bg-white focus:ring-4 sm:h-[72px] sm:text-3xl ${
                  copyOk ? 'border-green-400 focus:ring-green-100' : copyMiss ? 'border-red-300 focus:ring-red-100' : 'border-[#ecd9ca] focus:border-accent-warm focus:ring-orange-100'
                }`}
              />
              {copyMiss && !copyOk && <p className="mt-2 text-center text-sm text-red-500">再对照上面的答案看一看</p>}
              <div className="mt-5 flex justify-center">
                <button
                  type="button"
                  onClick={handleCopySubmit}
                  disabled={!copyOk}
                  className="btn-glow h-14 w-full rounded-2xl px-10 text-lg font-bold text-white sm:w-auto sm:min-w-[220px]"
                >
                  下一个 (Enter)
                </button>
              </div>
            </motion.div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
