/**
 * 听写阶段（循环模式）
 * 拼错显示正确答案，一轮结束后错词再来
 * 只有首次拼对才算通过，用于错题集记录
 *
 * 「卡住了吗」(2026-10-31): 第一次听写这个词,STUCK_MS 还没交、且 QUIET_MS 没打过字
 * → 卡片上问一句,给「再听一遍 / 不会,看答案」。发呆提醒只看有没有操作,
 * 孩子隔一会儿动下鼠标就一直算「在学」;这里看的是「有没有进展」。
 * 每个词第一次作答的真实用时(切出页面的时间不算)随结果带出去,卡住过的词经 onStuck 上报。
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { WordData } from '../../api/progress';
import ColoredPhonetic from '../ColoredPhonetic';
import ColoredWord from '../ColoredWord';
import { normalizeAnswer } from '../../utils/normalizeAnswer';
import { imeSafeInputProps } from '../../utils/noSuggestInput';


export interface DictationResult {
  wordId: number;
  word: string;
  userInput: string;
  isCorrect: boolean;  // 首次是否拼对
  /** 首次作答用时(毫秒,不含切出页面的时间);没作答过(断点恢复前的旧结果)为空 */
  ms?: number;
  /** 首次作答前问过「卡住了吗」 */
  stuck?: boolean;
}

export type StuckOutcome = 'correct' | 'wrong' | 'gave_up';

/** 多久没交算卡住 / 最近多久没打字(还在打字说明在想,不打断) */
export const STUCK_MS = 40_000;
export const QUIET_MS = 15_000;

interface DictationPhaseProps {
  words: WordData[];
  onComplete: (results: DictationResult[]) => void;
  playAudioSlow: (word: string, wordId?: number) => void;
  /** 拼错后订正需连续正确几遍才放行。默认 3(正常学习强化记忆);
   *  复习模式传 1,拼错订正 1 遍即过,不再重复抄。 */
  copyRequired?: number;
  /** 卡住过的词第一次作答后调一次(单元复习里的二次听写不传,不记) */
  onStuck?: (info: { wordId: number; ms: number; outcome: StuckOutcome }) => void;
}

export default function DictationPhase({
  words,
  onComplete,
  playAudioSlow,
  copyRequired = 3,
  onStuck,
}: DictationPhaseProps) {
  const [roundWords, setRoundWords] = useState<WordData[]>(words);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [round, setRound] = useState(1);
  const [userInput, setUserInput] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  // 错误后需要重新输入正确答案 - 连续 copyRequired 遍正确才放行(默认3强化记忆,复习模式传1)
  const [retryMode, setRetryMode] = useState(false);
  const [retryInput, setRetryInput] = useState('');
  const [retryPassed, setRetryPassed] = useState(false);
  const [copyDoneCount, setCopyDoneCount] = useState(0);
  const COPY_REQUIRED = copyRequired;
  // 只记录首次尝试结果
  const [firstAttemptResults, setFirstAttemptResults] = useState<Map<number, boolean>>(new Map());
  // 首次答错时的真实输入(拼写错误模式诊断的数据源——之前结果里 userInput 写死成
  // 正确拼写,整条诊断链对真实用户是死的)
  const firstWrongInputsRef = useRef<Map<number, string>>(new Map());
  const [roundErrorWords, setRoundErrorWords] = useState<WordData[]>([]);
  const [showRoundSummary, setShowRoundSummary] = useState(false);
  const [roundCorrectCount, setRoundCorrectCount] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  // 这个词第一次作答的计时: 出现时刻、切出页面累计的时间、最近一次打字
  const shownAtRef = useRef(Date.now());
  const hiddenMsRef = useRef(0);
  const hiddenSinceRef = useRef<number | null>(null);
  const lastTypeAtRef = useRef(Date.now());
  const firstMsRef = useRef<Map<number, number>>(new Map());
  const stuckIdsRef = useRef<Set<number>>(new Set());
  const [stuckAsk, setStuckAsk] = useState(false);
  const onStuckRef = useRef(onStuck);
  onStuckRef.current = onStuck;
  const elapsedMs = () => {
    const now = Date.now();
    const hiddenNow = hiddenSinceRef.current !== null ? now - hiddenSinceRef.current : 0;
    return Math.max(0, now - shownAtRef.current - hiddenMsRef.current - hiddenNow);
  };

  const currentWord = roundWords[currentIndex];
  const wordLength = currentWord?.word.replace(/\s+/g, '').length || 0;
  const wordLengthWithSpaces = currentWord?.word.length || 0;

  // 自动播放发音 (含 retry 抄写阶段每次状态变化都重新播一次, 让学生听不止 1 遍)
  useEffect(() => {
    if (!currentWord || showRoundSummary) return;
    // 已经抄完 3 遍, 准备进入下一题, 不再播
    if (retryMode && retryPassed) return;
    const t = setTimeout(() => {
      playAudioSlow(currentWord.word, currentWord.id);
    }, 500);
    setTimeout(() => inputRef.current?.focus(), 600);
    return () => clearTimeout(t);
  }, [currentIndex, currentWord, playAudioSlow, round, showRoundSummary, retryMode, copyDoneCount, retryPassed]);

  // 换词重新计时
  useEffect(() => {
    const now = Date.now();
    shownAtRef.current = now;
    lastTypeAtRef.current = now;
    hiddenMsRef.current = 0;
    hiddenSinceRef.current = document.hidden ? now : null;
    setStuckAsk(false);
  }, [currentIndex, round]);

  // 切出页面的时间不算进用时(那段由切屏提醒管)
  useEffect(() => {
    const onVis = () => {
      const now = Date.now();
      if (document.hidden) {
        if (hiddenSinceRef.current === null) hiddenSinceRef.current = now;
      } else if (hiddenSinceRef.current !== null) {
        hiddenMsRef.current += now - hiddenSinceRef.current;
        hiddenSinceRef.current = null;
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // 第一次听写这个词: 想了很久还没交、最近也没在打字 → 问一句「卡住了吗」(每个词只问一次)
  const firstTry = !!currentWord && !firstAttemptResults.has(currentWord.id);
  useEffect(() => {
    if (!currentWord || submitted || showRoundSummary || !firstTry || stuckAsk) return;
    if (stuckIdsRef.current.has(currentWord.id)) return;
    const id = currentWord.id;
    const timer = setInterval(() => {
      if (document.hidden) return;
      if (elapsedMs() >= STUCK_MS && Date.now() - lastTypeAtRef.current >= QUIET_MS) {
        stuckIdsRef.current.add(id);
        setStuckAsk(true);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [currentWord, submitted, showRoundSummary, firstTry, stuckAsk]);

  /** 第一次作答落定: 记用时;问过「卡住了吗」的词上报一次 */
  const settleFirstAttempt = (wordId: number, outcome: StuckOutcome) => {
    if (firstMsRef.current.has(wordId)) return;
    const ms = elapsedMs();
    firstMsRef.current.set(wordId, ms);
    if (stuckIdsRef.current.has(wordId)) onStuckRef.current?.({ wordId, ms, outcome });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (retryMode) {
      setRetryInput(e.target.value.slice(0, wordLengthWithSpaces));
      return;
    }
    if (submitted) return;
    lastTypeAtRef.current = Date.now();
    setStuckAsk(false);  // 开始写了就不挡着
    setUserInput(e.target.value.slice(0, wordLengthWithSpaces));
  };

  const handleSubmit = useCallback(() => {
    if (submitted || !currentWord || userInput.length === 0) return;

    // 校验：完全一致（包括空格位置和数量）。短语 "many kinds of" 必须原样输入，
    // 不能去除中间空格；也不容忍首尾空格误输入。
    const correct = normalizeAnswer(userInput) === normalizeAnswer(currentWord.word);
    setIsCorrect(correct);
    setSubmitted(true);

    // 记录首次结果（只记一次）
    setFirstAttemptResults(prev => {
      if (prev.has(currentWord.id)) return prev;
      const next = new Map(prev);
      next.set(currentWord.id, correct);
      return next;
    });
    // 首次答错的实际输入(只记一次,与首次结果同口径)
    if (!correct && !firstWrongInputsRef.current.has(currentWord.id)) {
      firstWrongInputsRef.current.set(currentWord.id, userInput.trim());
    }
    settleFirstAttempt(currentWord.id, correct ? 'correct' : 'wrong');
    setStuckAsk(false);

    if (!correct) {
      setRoundErrorWords(prev => {
        if (prev.some(w => w.id === currentWord.id)) return prev;
        return [...prev, currentWord];
      });
      setRetryMode(true);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [submitted, currentWord, userInput]);

  const handleRoundEnd = useCallback(() => {
    if (roundErrorWords.length === 0) {
      // 全部通过，构建结果（用首次记录;答错过的词带首次真实输入,供拼写诊断)
      const results: DictationResult[] = words.map(w => ({
        wordId: w.id,
        word: w.word,
        userInput: firstWrongInputsRef.current.get(w.id) ?? w.word,
        isCorrect: firstAttemptResults.get(w.id) ?? true,
        ms: firstMsRef.current.get(w.id),
        stuck: stuckIdsRef.current.has(w.id) || undefined,
      }));
      onComplete(results);
    } else {
      setRoundCorrectCount(roundWords.length - roundErrorWords.length);
      setShowRoundSummary(true);
      setTimeout(() => {
        setRound(prev => prev + 1);
        setRoundWords([...roundErrorWords]);
        setRoundErrorWords([]);
        setCurrentIndex(0);
        setUserInput('');
        setSubmitted(false);
        setIsCorrect(false);
        setRetryMode(false);
        setRetryInput('');
        setRetryPassed(false);
        setCopyDoneCount(0);
        setShowRoundSummary(false);
      }, 2500);
    }
  }, [roundErrorWords, roundWords.length, words, firstAttemptResults, onComplete]);

  const handleNext = useCallback(() => {
    if (currentIndex + 1 >= roundWords.length) {
      setTimeout(() => handleRoundEnd(), 50);
    } else {
      setCurrentIndex(currentIndex + 1);
      setUserInput('');
      setSubmitted(false);
      setIsCorrect(false);
      setRetryMode(false);
      setRetryInput('');
      setRetryPassed(false);
      setCopyDoneCount(0);
    }
  }, [currentIndex, roundWords.length, handleRoundEnd]);

  const handleRetrySubmit = useCallback(() => {
    if (!currentWord || retryInput.length === 0) return;
    if (normalizeAnswer(retryInput) === normalizeAnswer(currentWord.word)) {
      const next = copyDoneCount + 1;
      if (next >= COPY_REQUIRED) {
        setCopyDoneCount(next);
        setRetryPassed(true);
      } else {
        setCopyDoneCount(next);
        setRetryInput('');
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    } else {
      setRetryInput('');
      inputRef.current?.focus();
      // 抄错: copyDoneCount 不变, useEffect 不会重跑, 显式再播一次
      setTimeout(() => playAudioSlow(currentWord.word, currentWord.id), 200);
    }
  }, [currentWord, retryInput, copyDoneCount, playAudioSlow]);

  // 跳过 / 卡住时点「不会,看答案」= 交空答案、算没拼对、进抄写
  const giveUp = () => {
    if (!currentWord || submitted) return;
    settleFirstAttempt(currentWord.id, 'gave_up');
    setStuckAsk(false);
    setUserInput('');
    setIsCorrect(false);
    setSubmitted(true);
    setRetryMode(true);
    setFirstAttemptResults(prev => {
      if (prev.has(currentWord.id)) return prev;
      const next = new Map(prev);
      next.set(currentWord.id, false);
      return next;
    });
    setRoundErrorWords(prev => {
      if (prev.some(w => w.id === currentWord.id)) return prev;
      return [...prev, currentWord];
    });
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (retryMode && !retryPassed) {
        handleRetrySubmit();
      } else if (retryPassed || (submitted && isCorrect)) {
        handleNext();
      } else if (!submitted && userInput.length > 0) {
        handleSubmit();
      }
    }
  };

  useEffect(() => {
    if (!submitted) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (retryMode && !retryPassed) {
          handleRetrySubmit();
        } else if (retryPassed || isCorrect) {
          handleNext();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [submitted, isCorrect, retryMode, retryPassed, handleNext, handleRetrySubmit]);

  // 提交后逐字符直接对比
  const getCharInfo = (charIndex: number): { result: 'correct' | 'wrong' | 'missing'; displayChar: string } => {
    const correctChar = currentWord.word[charIndex];
    const userChar = userInput[charIndex];
    if (!userChar) return { result: 'missing', displayChar: correctChar };
    if (userChar === correctChar) return { result: 'correct', displayChar: userChar };
    return { result: 'wrong', displayChar: userChar };
  };

  if (showRoundSummary) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-3xl shadow-lg p-8 md:p-10 w-full max-w-md md:max-w-lg text-center"
        >
          <div className="text-5xl md:text-6xl mb-4">🔄</div>
          <h3 className="text-xl md:text-2xl font-bold text-gray-800 mb-2">听写第 {round} 轮完成</h3>
          <div className="flex justify-center gap-6 md:gap-10 mb-4">
            <div className="text-center">
              <div className="text-2xl md:text-3xl font-bold text-green-500">{roundCorrectCount}</div>
              <div className="text-xs md:text-sm text-gray-400">✅ 拼对</div>
            </div>
            <div className="text-center">
              <div className="text-2xl md:text-3xl font-bold text-red-500">{roundErrorWords.length}</div>
              <div className="text-xs md:text-sm text-gray-400">❌ 拼错</div>
            </div>
          </div>
          <p className="text-gray-500 text-sm md:text-base">
            还有 <span className="font-bold text-red-500">{roundErrorWords.length}</span> 个词需要重新听写...
          </p>
        </motion.div>
      </div>
    );
  }

  if (!currentWord) return null;

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4">
      {/* 进度 */}
      <div className="mb-6 text-center">
        {round > 1 && (
          <span className="text-xs md:text-sm text-orange-500 font-medium mr-2">第{round}轮</span>
        )}
        <span className="text-sm md:text-base text-gray-500">
          听写 {currentIndex + 1} / {roundWords.length}
        </span>
        <div className="w-48 md:w-72 h-1.5 bg-gray-200 rounded-full mt-2 mx-auto overflow-hidden">
          <motion.div
            className="h-full bg-accent rounded-full"
            animate={{ width: `${((currentIndex + 1) / roundWords.length) * 100}%` }}
          />
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={`${round}-${currentWord.id}`}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="bg-white rounded-3xl shadow-lg p-8 md:p-10 w-full max-w-md md:max-w-xl text-center"
        >
          <div className="mb-4">
            <span className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
              ✍️ 听写模式
            </span>
          </div>

          <p className="text-lg md:text-2xl text-gray-600 mb-4 md:mb-6">{currentWord.meaning}</p>

          <button
            onClick={() => playAudioSlow(currentWord.word, currentWord.id)}
            className="mb-6 p-4 md:p-5 rounded-full bg-blue-50 hover:bg-blue-100 transition"
          >
            <span className="text-3xl md:text-4xl">🔊</span>
          </button>
          <p className="text-xs md:text-sm text-gray-400 mb-6">点击重新播放</p>

          {/* 卡住了吗: 想了很久、最近也没打字。开始打字就收起 */}
          <AnimatePresence>
            {stuckAsk && !submitted && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                role="status"
                className="mb-5 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-left"
              >
                <p className="text-sm md:text-base font-semibold text-amber-800">这个词想了好一会儿了,卡住了吗?</p>
                <p className="mt-0.5 text-xs md:text-sm text-amber-700">再听一遍,或者看答案照着写,都比一直空着强。</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      lastTypeAtRef.current = Date.now();
                      setStuckAsk(false);
                      playAudioSlow(currentWord.word, currentWord.id);
                      setTimeout(() => inputRef.current?.focus(), 50);
                    }}
                    className="min-h-11 rounded-xl bg-white px-4 text-sm font-medium text-amber-800 border border-amber-300 hover:bg-amber-100 transition"
                  >
                    🔊 再听一遍
                  </button>
                  <button
                    type="button"
                    onClick={giveUp}
                    className="min-h-11 rounded-xl bg-amber-500 px-4 text-sm font-medium text-white hover:bg-amber-600 transition"
                  >
                    不会,看答案
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {!submitted ? (
            <div className="mb-4 px-2 md:px-6">
              <input
                {...imeSafeInputProps()}
                ref={inputRef}
                value={userInput}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                maxLength={wordLengthWithSpaces}
                placeholder="输入单词..."
                className="w-full text-center text-3xl md:text-4xl font-mono font-bold bg-transparent border-0 border-b-4 border-primary/40 focus:border-primary outline-none transition-colors duration-200 py-2 text-gray-800 placeholder:text-gray-300"
              />
            </div>
          ) : (
            <div className="mb-4 flex justify-center items-baseline gap-0.5 flex-wrap">
              {Array.from(currentWord.word).map((ch, i) => {
                if (ch === ' ') {
                  return <span key={i} className="w-3 inline-block" />;
                }
                const { result, displayChar } = getCharInfo(i);
                const colorClass =
                  result === 'correct' ? 'text-green-600' :
                  result === 'wrong'   ? 'text-red-500 line-through decoration-2' :
                                         'text-red-300';
                return (
                  <span key={i} className={`text-3xl md:text-4xl font-mono font-bold ${colorClass}`}>
                    {displayChar}
                  </span>
                );
              })}
            </div>
          )}

          {!submitted && (
            <p className="text-xs text-gray-400 mb-2">
              {wordLength} 个字母{currentWord.word.includes(' ') ? `（短语，共 ${wordLengthWithSpaces} 个字符含空格）` : ''} · {userInput.length}/{wordLengthWithSpaces}
            </p>
          )}

          {/* 反馈 */}
          {submitted && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-4"
            >
              {isCorrect ? (
                <>
                  <div className="text-green-600 font-medium text-lg">✅ 正确！</div>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleNext}
                    className="mt-4 px-8 py-3 rounded-2xl text-lg font-medium bg-primary text-white shadow-lg hover:opacity-90 cursor-pointer"
                  >
                    下一个
                  </motion.button>
                </>
              ) : (
                <div>
                  <div className="text-red-600 font-medium text-lg mb-2">❌ 不对哦</div>
                  <p className="text-gray-500 text-sm mb-1">正确拼写：</p>
                  <div className="flex justify-center mb-1">
                    <ColoredWord
                      word={currentWord.word}
                      syllables={currentWord.syllables}
                      className="text-2xl md:text-3xl font-bold"
                    />
                  </div>
                  {currentWord.phonetic && (
                    <div className="mt-1 flex justify-center">
                      <ColoredPhonetic phonetic={currentWord.phonetic} size="sm" />
                    </div>
                  )}

                  {/* 重新输入区域：需连续 3 次正确 */}
                  {!retryPassed ? (
                    <div className="mt-4">
                      <p className="text-sm text-orange-600 font-medium mb-2">
                        请重新输入正确拼写 <span className="font-numeric">({copyDoneCount} / {COPY_REQUIRED})</span>
                      </p>
                      <input
                        {...imeSafeInputProps()}
                        value={retryInput}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        maxLength={wordLengthWithSpaces}
                        className="w-full md:max-w-md md:mx-auto block px-4 py-3 text-center text-xl md:text-2xl font-mono border-2 border-orange-300 rounded-xl focus:ring-2 focus:ring-orange-400/50 focus:border-orange-400 outline-none transition"
                        placeholder="输入正确的单词"
                        autoFocus
                      />
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={handleRetrySubmit}
                        disabled={retryInput.length === 0}
                        className={`mt-3 px-8 py-3 rounded-2xl text-lg font-medium shadow-lg cursor-pointer transition ${
                          retryInput.length > 0
                            ? 'bg-accent text-white hover:opacity-90'
                            : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        }`}
                      >
                        提交本遍（{copyDoneCount + 1} / {COPY_REQUIRED}）
                      </motion.button>
                    </div>
                  ) : (
                    <div className="mt-4">
                      <div className="text-green-600 font-medium">✅ 已抄写 {COPY_REQUIRED} 遍</div>
                      <motion.button
                        whileHover={{ scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={handleNext}
                        className="mt-3 px-8 py-3 rounded-2xl text-lg font-medium bg-primary text-white shadow-lg hover:opacity-90 cursor-pointer"
                      >
                        下一个
                      </motion.button>
                    </div>
                  )}
                </div>
              )}
            </motion.div>
          )}

          {/* 提交按钮 */}
          {!submitted && userInput.length > 0 && (
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={handleSubmit}
              className={`mt-4 px-8 py-3 rounded-2xl text-lg font-medium shadow-lg cursor-pointer transition ${
                userInput.length === wordLengthWithSpaces
                  ? 'bg-accent text-white hover:opacity-90'
                  : 'bg-gray-200 text-gray-500'
              }`}
            >
              提交 (Enter)
            </motion.button>
          )}

          {/* 跳过 = 提交空答案，显示正确答案 */}
          {!submitted && (
            <motion.button
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.5 }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={giveUp}
              className="mt-3 min-h-11 rounded-xl bg-gray-100 px-6 text-sm font-medium text-gray-500 transition hover:bg-gray-200"
            >
              跳过（标记为未掌握）
            </motion.button>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
