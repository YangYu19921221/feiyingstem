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

/** 把要填的词换成下划线(保留空格),retry 时可以露出首字母 */
const maskOf = (expected: string, showFirst: boolean) =>
  [...expected].map((ch, i) => (/[A-Za-z]/.test(ch) ? (showFirst && i === 0 ? ch : '_') : ch)).join('');

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
      <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-lg rounded-2xl bg-white p-6 text-center sm:p-8"
        >
          <div className="mb-4 text-5xl">🔄</div>
          <h3 className="mb-2 text-xl font-bold text-gray-800">填空第 {round} 轮完成</h3>
          <div className="mb-4 flex justify-center gap-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-500">{summary.correct}</div>
              <div className="text-xs text-gray-400">一次写对</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-orange-500">{summary.missed}</div>
              <div className="text-xs text-gray-400">要再练</div>
            </div>
          </div>
          <p className="text-sm text-gray-500">
            还有 <span className="font-bold text-orange-500">{summary.missed}</span> 个词再练一遍...
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

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
      {/* 进度 */}
      <div className="mb-6 text-center">
        {round > 1 && <span className="mr-2 text-xs font-medium text-orange-500">第{round}轮</span>}
        <span className="text-sm text-gray-500">句子填空 {currentIndex + 1} / {roundItems.length}</span>
        <div className="mx-auto mt-2 h-1.5 w-48 overflow-hidden rounded-full bg-gray-200">
          <motion.div
            className="h-full rounded-full bg-accent-warm"
            animate={{ width: `${((currentIndex + 1) / roundItems.length) * 100}%` }}
          />
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={`${round}-${current.word.id}`}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="w-full max-w-lg rounded-2xl bg-white p-6 text-center sm:p-8"
        >
          <div className="mb-4">
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 px-3 py-1 text-sm font-medium text-accent-warm">
              📝 句子填空
            </span>
          </div>

          {/* 例句(挖空)。判对/出答案后把正确的词填回去 */}
          <div className="mb-4 px-2 text-left">
            <p className="whitespace-normal break-words text-lg leading-relaxed text-gray-700">
              {before}
              <span
                className={`mx-1 inline-block min-w-[60px] border-b-2 text-center font-bold ${
                  filled ? 'border-green-500 text-green-600' : 'border-dashed border-primary text-gray-300'
                }`}
              >
                {filled ? expected : maskOf(expected, hint === 'wrong')}
              </span>
              {after}
            </p>
            <button
              type="button"
              onClick={() => playAudio(sentence)}
              className="mt-2 inline-flex min-h-11 items-center gap-1 rounded-full bg-orange-50 px-4 text-sm font-medium text-accent-warm transition hover:bg-orange-100"
            >
              🔊 朗读句子
            </button>
          </div>

          {current.word.example_translation && (
            <p className="mb-5 px-2 text-left text-sm text-gray-400">💡 {current.word.example_translation}</p>
          )}

          {/* 作答 / 再写一次 */}
          {(stage === 'answer' || stage === 'retry') && (
            <>
              {stage === 'retry' && (
                <div className="mb-3 rounded-xl bg-amber-50 px-4 py-3 text-left text-sm leading-6 text-amber-800" role="status">
                  {hint === 'base' ? (
                    <>单词没错！放进这句话里要<strong>变个样子</strong>（看看前面是谁、是什么时候），再改一下。</>
                  ) : (
                    <>还差一点。首字母是 <strong className="font-mono text-base">{expected[0]}</strong>，一共 <strong>{expectedLetters}</strong> 个字母，再写一次。</>
                  )}
                  <span className="mt-1 block text-xs text-amber-700/80">
                    你刚才写的：<span className="font-mono line-through">{firstWrong}</span>
                  </span>
                </div>
              )}
              <div className="mb-2 px-2">
                <input
                  {...imeSafeInputProps()}
                  ref={inputRef}
                  value={userInput}
                  onChange={(e) => setUserInput(cleanInput(e.target.value))}
                  onKeyDown={handleKeyDown}
                  maxLength={capLength}
                  placeholder={stage === 'retry' ? '再写一次...' : '输入单词...'}
                  aria-label="填入单词"
                  className="w-full border-0 border-b-4 border-orange-200 bg-transparent py-3 text-center font-mono text-2xl font-bold text-gray-800 outline-none transition-colors duration-200 placeholder:text-gray-400 focus:border-accent-warm"
                  autoFocus
                />
              </div>
              <p className="mb-2 text-xs text-gray-400">
                {expectedLetters} 个字母 · 已写 {letterCount(userInput)}
              </p>
              <div className="mt-4 flex flex-col items-center gap-2">
                {userInput.trim().length > 0 && (
                  <button
                    type="button"
                    onClick={handleSubmit}
                    className="min-h-12 rounded-xl bg-accent-warm px-8 text-lg font-medium text-white hover:opacity-90"
                  >
                    提交 (Enter)
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { if (!guarded()) reveal(stage === 'retry' ? '' : userInput); }}
                  className="min-h-10 px-3 text-sm font-medium text-gray-400 underline-offset-4 hover:text-gray-600 hover:underline"
                >
                  不会，看答案
                </button>
              </div>
            </>
          )}

          {/* 写对了 */}
          {stage === 'correct' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-2">
              <div className="text-lg font-medium text-green-600">{firstWrong ? '✅ 改对了！' : '✅ 正确！'}</div>
              <button
                type="button"
                onClick={handleNext}
                className="mt-4 min-h-12 rounded-xl bg-accent-warm px-8 text-lg font-medium text-white hover:opacity-90"
              >
                下一个 (Enter)
              </button>
            </motion.div>
          )}

          {/* 出答案 + 订正 */}
          {stage === 'revealed' && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="mt-1">
              <p className="mb-1 text-sm text-gray-500">正确答案</p>
              <div className="mb-1 flex justify-center">
                {sameAsBase
                  ? <ColoredWord word={expected} syllables={current.word.syllables} className="text-2xl font-bold" />
                  : <span className="font-mono text-2xl font-bold text-green-700">{expected}</span>}
              </div>
              {!sameAsBase && (
                <p className="mb-1 text-xs text-gray-500">
                  原形 <span className="font-semibold text-gray-700">{current.word.word}</span>，放进这句话里要写成 {expected}
                </p>
              )}
              {current.word.phonetic && (
                <div className="mb-2 flex justify-center">
                  <ColoredPhonetic phonetic={current.word.phonetic} size="sm" />
                </div>
              )}

              {diff && (
                <div className="mx-auto mb-3 max-w-xs rounded-xl bg-slate-50 px-4 py-2 text-left text-sm">
                  <p className="text-gray-500">
                    你写的：
                    <span className="font-mono text-base">
                      {diff.got.map((d, i) => (
                        <span key={i} className={d.ok ? 'text-gray-700' : 'font-bold text-red-500 line-through'}>{d.ch}</span>
                      ))}
                    </span>
                  </p>
                  <p className="mt-0.5 text-gray-500">
                    应该是：
                    <span className="font-mono text-base">
                      {diff.want.map((d, i) => (
                        <span key={i} className={d.ok ? 'text-gray-700' : 'font-bold text-green-600 underline'}>{d.ch}</span>
                      ))}
                    </span>
                  </p>
                </div>
              )}

              <p className="mb-1 text-sm font-medium text-gray-700">照着写一遍再继续</p>
              <input
                {...imeSafeInputProps()}
                ref={copyRef}
                value={copyInput}
                onChange={(e) => { setCopyInput(cleanInput(e.target.value)); setCopyMiss(false); }}
                onKeyDown={handleKeyDown}
                maxLength={capLength}
                placeholder={expected}
                aria-label="照着写一遍"
                className={`w-full border-0 border-b-4 bg-transparent py-2 text-center font-mono text-xl font-bold text-gray-800 outline-none placeholder:text-gray-300 ${
                  copyOk ? 'border-green-400' : copyMiss ? 'border-red-300' : 'border-orange-200 focus:border-accent-warm'
                }`}
              />
              {copyMiss && !copyOk && <p className="mt-1 text-xs text-red-500">再对照上面的答案看一看</p>}
              <button
                type="button"
                onClick={handleCopySubmit}
                disabled={!copyOk}
                className="mt-4 min-h-12 rounded-xl bg-accent-warm px-8 text-lg font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-500"
              >
                下一个 (Enter)
              </button>
            </motion.div>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
