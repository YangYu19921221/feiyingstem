/**
 * 听写阶段（循环模式）
 * 拼错显示正确答案，一轮结束后错词再来
 * 只有首次拼对才算通过，用于错题集记录
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { WordData } from '../../api/progress';
import ColoredPhonetic from '../ColoredPhonetic';
import ColoredWord from '../ColoredWord';

export interface DictationResult {
  wordId: number;
  word: string;
  userInput: string;
  isCorrect: boolean;  // 首次是否拼对
}

interface DictationPhaseProps {
  words: WordData[];
  onComplete: (results: DictationResult[]) => void;
  playAudioSlow: (word: string) => void;
}

export default function DictationPhase({
  words,
  onComplete,
  playAudioSlow,
}: DictationPhaseProps) {
  const [roundWords, setRoundWords] = useState<WordData[]>(words);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [round, setRound] = useState(1);
  const [userInput, setUserInput] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  // 错误后需要重新输入正确答案
  const [retryMode, setRetryMode] = useState(false);
  const [retryInput, setRetryInput] = useState('');
  const [retryPassed, setRetryPassed] = useState(false);
  // 只记录首次尝试结果
  const [firstAttemptResults, setFirstAttemptResults] = useState<Map<number, boolean>>(new Map());
  const [roundErrorWords, setRoundErrorWords] = useState<WordData[]>([]);
  const [showRoundSummary, setShowRoundSummary] = useState(false);
  const [roundCorrectCount, setRoundCorrectCount] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  const currentWord = roundWords[currentIndex];
  const wordLength = currentWord?.word.replace(/\s+/g, '').length || 0;

  // 自动播放发音
  useEffect(() => {
    if (!currentWord || showRoundSummary) return;
    const t = setTimeout(() => {
      playAudioSlow(currentWord.word);
    }, 500);
    setTimeout(() => inputRef.current?.focus(), 600);
    return () => clearTimeout(t);
  }, [currentIndex, currentWord, playAudioSlow, round, showRoundSummary]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (retryMode) {
      setRetryInput(e.target.value.slice(0, wordLength));
      return;
    }
    if (submitted) return;
    setUserInput(e.target.value.slice(0, wordLength));
  };

  const handleSubmit = useCallback(() => {
    if (submitted || !currentWord || userInput.length === 0) return;

    // 校验时忽略空格：用户不需要输入空格
    const normalizedInput = userInput.trim().replace(/\s+/g, '');
    const normalizedTarget = currentWord.word.trim().replace(/\s+/g, '');
    const correct = normalizedInput === normalizedTarget;
    setIsCorrect(correct);
    setSubmitted(true);

    // 记录首次结果（只记一次）
    setFirstAttemptResults(prev => {
      if (prev.has(currentWord.id)) return prev;
      const next = new Map(prev);
      next.set(currentWord.id, correct);
      return next;
    });

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
      // 全部通过，构建结果（用首次记录）
      const results: DictationResult[] = words.map(w => ({
        wordId: w.id,
        word: w.word,
        userInput: w.word,
        isCorrect: firstAttemptResults.get(w.id) ?? true,
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
    }
  }, [currentIndex, roundWords.length, handleRoundEnd]);

  const handleRetrySubmit = useCallback(() => {
    if (!currentWord || retryInput.length === 0) return;
    if (retryInput.trim().replace(/\s+/g, '') === currentWord.word.trim().replace(/\s+/g, '')) {
      setRetryPassed(true);
    } else {
      setRetryInput('');
      inputRef.current?.focus();
    }
  }, [currentWord, retryInput]);

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

  const getSlotStyle = (index: number): string => {
    if (!submitted) {
      if (index < userInput.length) return 'border-primary text-gray-800';
      if (index === userInput.length) return 'border-primary/60';
      return 'border-gray-300';
    }
    const correctChar = currentWord.word[index];
    const userChar = userInput[index];
    if (!userChar) return 'border-red-300 text-red-300';
    if (userChar === correctChar) return 'border-green-400 text-green-600 bg-green-50';
    return 'border-red-400 text-red-600 bg-red-50';
  };

  const getSlotLetter = (index: number): string => {
    if (!submitted) return userInput[index] || '';
    return userInput[index] || currentWord.word[index] || '';
  };

  if (showRoundSummary) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-3xl shadow-lg p-8 w-full max-w-md text-center"
        >
          <div className="text-5xl mb-4">🔄</div>
          <h3 className="text-xl font-bold text-gray-800 mb-2">听写第 {round} 轮完成</h3>
          <div className="flex justify-center gap-6 mb-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-500">{roundCorrectCount}</div>
              <div className="text-xs text-gray-400">✅ 拼对</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-500">{roundErrorWords.length}</div>
              <div className="text-xs text-gray-400">❌ 拼错</div>
            </div>
          </div>
          <p className="text-gray-500 text-sm">
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
          <span className="text-xs text-orange-500 font-medium mr-2">第{round}轮</span>
        )}
        <span className="text-sm text-gray-500">
          听写 {currentIndex + 1} / {roundWords.length}
        </span>
        <div className="w-48 h-1.5 bg-gray-200 rounded-full mt-2 mx-auto overflow-hidden">
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
          className="bg-white rounded-3xl shadow-lg p-8 w-full max-w-md text-center"
        >
          <div className="mb-4">
            <span className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
              ✍️ 听写模式
            </span>
          </div>

          <p className="text-lg text-gray-600 mb-4">{currentWord.meaning}</p>

          <button
            onClick={() => playAudioSlow(currentWord.word)}
            className="mb-6 p-4 rounded-full bg-blue-50 hover:bg-blue-100 transition"
          >
            <span className="text-3xl">🔊</span>
          </button>
          <p className="text-xs text-gray-400 mb-6">点击重新播放</p>

          {/* 字母格子 */}
          <div
            className="flex flex-wrap gap-0.5 justify-center mb-4 cursor-text"
            onClick={() => inputRef.current?.focus()}
          >
            {Array.from({ length: wordLength }, (_, i) => {
              const ch = currentWord.word[i];

              if (ch === ' ') {
                return (
                  <div key={i} className="w-4 h-12 flex items-end justify-center pb-1 text-gray-300 text-sm">
                    ␣
                  </div>
                );
              }

              if (ch === '-' || ch === '.' || ch === '\'') {
                return (
                  <motion.div
                    key={i}
                    initial={submitted ? { scale: 0.8 } : false}
                    animate={submitted ? { scale: 1 } : {}}
                    transition={{ delay: i * 0.04 }}
                    className={`w-4 h-12 flex items-end justify-center pb-1 text-2xl font-mono font-bold border-b-[3px] transition-colors duration-200 ${getSlotStyle(i)}`}
                  >
                    {getSlotLetter(i)}
                  </motion.div>
                );
              }

              const letter = getSlotLetter(i);
              const isCursor = !submitted && i === userInput.length;

              return (
                <motion.div
                  key={i}
                  initial={submitted ? { scale: 0.8 } : false}
                  animate={submitted ? { scale: 1 } : {}}
                  transition={{ delay: i * 0.04 }}
                  className={`w-9 h-12 flex items-end justify-center pb-1 text-2xl font-mono font-bold border-b-[3px] transition-colors duration-200 ${getSlotStyle(i)}`}
                >
                  {letter}
                  {isCursor && (
                    <motion.span
                      animate={{ opacity: [1, 0] }}
                      transition={{ repeat: Infinity, duration: 0.8 }}
                      className="text-primary"
                    >
                      |
                    </motion.span>
                  )}
                </motion.div>
              );
            })}
          </div>

          <input
            ref={inputRef}
            type="text"
            value={retryMode ? retryInput : userInput}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            disabled={submitted && !retryMode}
            maxLength={wordLength}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="sr-only"
          />

          {!submitted && (
            <p className="text-xs text-gray-400 mb-2">
              {wordLength} 个字符{currentWord.word.includes(' ') ? '（含空格）' : ''} · {userInput.length}/{wordLength}
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
                      className="text-2xl font-bold"
                    />
                  </div>
                  {currentWord.phonetic && (
                    <div className="mt-1 flex justify-center">
                      <ColoredPhonetic phonetic={currentWord.phonetic} size="sm" />
                    </div>
                  )}

                  {/* 重新输入区域 */}
                  {!retryPassed ? (
                    <div className="mt-4">
                      <p className="text-sm text-orange-600 font-medium mb-2">请重新输入正确拼写：</p>
                      <input
                        ref={inputRef}
                        type="text"
                        value={retryInput}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        maxLength={wordLength}
                        autoComplete="off"
                        autoCorrect="off"
                        autoCapitalize="off"
                        spellCheck={false}
                        className="w-full px-4 py-3 text-center text-xl font-mono border-2 border-orange-300 rounded-xl focus:ring-2 focus:ring-orange-400/50 focus:border-orange-400 outline-none transition"
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
                        确认 (Enter)
                      </motion.button>
                    </div>
                  ) : (
                    <div className="mt-4">
                      <div className="text-green-600 font-medium">✅ 输入正确！</div>
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
                userInput.length === wordLength
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
              onClick={() => {
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
              }}
              className="mt-3 px-6 py-2 rounded-xl bg-gray-100 hover:bg-gray-200 text-gray-500 text-sm font-medium transition cursor-pointer"
            >
              跳过（标记为未掌握）
            </motion.button>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
