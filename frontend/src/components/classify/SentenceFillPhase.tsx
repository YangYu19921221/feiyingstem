/**
 * 句子填空阶段（循环模式）
 * 显示例句（目标词挖空）+ 中文翻译，学生填入正确单词
 * 填错的收集再来一轮，全对才结束
 * 没有例句的单词自动跳过
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { WordData } from '../../api/progress';
import ColoredWord from '../ColoredWord';
import ColoredPhonetic from '../ColoredPhonetic';

export interface FillBlankResult {
  wordId: number;
  word: string;
  userInput: string;
  isCorrect: boolean;
}

interface SentenceFillPhaseProps {
  words: WordData[];
  onComplete: (results: FillBlankResult[]) => void;
  playAudio: (text: string) => void;
}

export default function SentenceFillPhase({
  words,
  onComplete,
  playAudio,
}: SentenceFillPhaseProps) {
  // 只取有例句的单词
  const wordsWithSentence = words.filter(w => w.example_sentence);

  const [roundWords, setRoundWords] = useState<WordData[]>(wordsWithSentence);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [round, setRound] = useState(1);
  const [userInput, setUserInput] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  const [allResults, setAllResults] = useState<FillBlankResult[]>([]);
  const [roundErrorWords, setRoundErrorWords] = useState<WordData[]>([]);
  const [showRoundSummary, setShowRoundSummary] = useState(false);
  const [roundCorrectCount, setRoundCorrectCount] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  const currentWord = roundWords[currentIndex];
  const wordLength = currentWord?.word.length || 0;

  // 没有带例句的单词，直接完成
  useEffect(() => {
    if (wordsWithSentence.length === 0) {
      onComplete([]);
    }
  }, []);

  // 聚焦输入框
  useEffect(() => {
    if (!currentWord || showRoundSummary) return;
    // 延迟聚焦，确保动画完成后再弹出键盘
    const t = setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true });
      // 移动端需要额外触发一次 click 才能弹出键盘
      inputRef.current?.click();
    }, 300);
    return () => clearTimeout(t);
  }, [currentIndex, currentWord, round, showRoundSummary]);

  // 把例句中的目标词替换成空格
  const renderSentence = (sentence: string, targetWord: string) => {
    // 用整词边界匹配，避免 "run" 命中 "runs" 导致例句被切错、残留 "s"
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`\\b${escape(targetWord)}\\b`, 'i');
    const match = pattern.exec(sentence);

    if (!match) {
      return (
        <p className="text-gray-700 text-lg leading-relaxed break-words whitespace-normal">
          {sentence}
        </p>
      );
    }

    const idx = match.index;
    const matchedLen = match[0].length;
    const before = sentence.slice(0, idx);
    const after = sentence.slice(idx + matchedLen);

    return (
      <p className="text-gray-700 text-lg leading-relaxed break-words whitespace-normal">
        {before}
        <span className="inline-block border-b-2 border-dashed border-primary mx-1 min-w-[60px] text-center font-bold text-primary">
          {submitted ? (
            <span className={isCorrect ? 'text-green-600' : 'text-red-500'}>
              {userInput || '___'}
            </span>
          ) : (
            <span className="text-gray-300">{'_'.repeat(targetWord.length)}</span>
          )}
        </span>
        {after}
      </p>
    );
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (submitted) return;
    // 允许 ASCII 字母 + 空格 + 连字符 + 撇号 + 常见标点 (!?.,) + 全角标点 (！？，。…)
    const val = e.target.value.replace(/[^a-zA-Z '\-!?.,！？，。…]/g, '');
    // 放开字数上限：允许稍长的答案，但不超过目标词的 1.5 倍以防粘贴过长
    const cap = Math.max(wordLength + 4, Math.ceil(wordLength * 1.5));
    setUserInput(val.slice(0, cap));
  };

  const handleSubmit = useCallback(() => {
    if (submitted || !currentWord || userInput.length === 0) return;

    const correct = userInput.trim() === currentWord.word.trim();
    setIsCorrect(correct);
    setSubmitted(true);

    if (correct) {
      playAudio(currentWord.word);
    }

    setAllResults(prev => [...prev, {
      wordId: currentWord.id,
      word: currentWord.word,
      userInput,
      isCorrect: correct,
    }]);

    if (!correct) {
      setRoundErrorWords(prev => [...prev, currentWord]);
    }
  }, [submitted, currentWord, userInput, playAudio]);

  const handleRoundEnd = useCallback(() => {
    if (roundErrorWords.length === 0) {
      onComplete(allResults);
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
        setShowRoundSummary(false);
      }, 2500);
    }
  }, [roundErrorWords, roundWords.length, allResults, onComplete]);

  const handleNext = useCallback(() => {
    if (currentIndex + 1 >= roundWords.length) {
      setTimeout(() => handleRoundEnd(), 50);
    } else {
      setCurrentIndex(currentIndex + 1);
      setUserInput('');
      setSubmitted(false);
      setIsCorrect(false);
    }
  }, [currentIndex, roundWords.length, handleRoundEnd]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      if (!submitted && userInput.length > 0) {
        handleSubmit();
      } else if (submitted) {
        handleNext();
      }
    }
  };

  // submitted 后 input 被 disabled，用全局键盘事件监听回车
  useEffect(() => {
    if (!submitted) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter') handleNext();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [submitted, handleNext]);

  // 轮次过渡
  if (showRoundSummary) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-3xl shadow-lg p-8 w-full max-w-lg text-center"
        >
          <div className="text-5xl mb-4">🔄</div>
          <h3 className="text-xl font-bold text-gray-800 mb-2">填空第 {round} 轮完成</h3>
          <div className="flex justify-center gap-6 mb-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-500">{roundCorrectCount}</div>
              <div className="text-xs text-gray-400">✅ 正确</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-500">{roundErrorWords.length}</div>
              <div className="text-xs text-gray-400">❌ 错误</div>
            </div>
          </div>
          <p className="text-gray-500 text-sm">
            还有 <span className="font-bold text-red-500">{roundErrorWords.length}</span> 个词需要重新填空...
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
          句子填空 {currentIndex + 1} / {roundWords.length}
        </span>
        <div className="w-48 h-1.5 bg-gray-200 rounded-full mt-2 mx-auto overflow-hidden">
          <motion.div
            className="h-full bg-violet-500 rounded-full"
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
          className="bg-white rounded-3xl shadow-lg p-8 w-full max-w-lg text-center"
        >
          {/* 标签 */}
          <div className="mb-4">
            <span className="inline-flex items-center gap-1 px-3 py-1 bg-violet-100 text-violet-700 rounded-full text-sm font-medium">
              📝 句子填空
            </span>
          </div>

          {/* 例句（目标词挖空）+ 朗读按钮 */}
          <div className="mb-4 px-2 text-left">
            {currentWord.example_sentence && renderSentence(currentWord.example_sentence, currentWord.word)}
            {currentWord.example_sentence && (
              <button
                onClick={() => playAudio(currentWord.example_sentence!)}
                className="mt-2 inline-flex items-center gap-1 px-3 py-1.5 bg-violet-100 text-violet-700 rounded-full text-sm hover:bg-violet-200 transition"
              >
                🔊 朗读句子
              </button>
            )}
          </div>

          {/* 中文翻译 */}
          {currentWord.example_translation && (
            <p className="text-sm text-gray-400 mb-5 px-2 text-left">
              💡 {currentWord.example_translation}
            </p>
          )}

          {/* 输入区：扁平长条输入框 */}
          <div className="mb-4 px-2">
            {!submitted ? (
              <input
                ref={inputRef}
                type="text"
                value={userInput}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                maxLength={Math.max(wordLength + 4, Math.ceil(wordLength * 1.5))}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="输入单词..."
                className="w-full text-center text-2xl font-mono font-bold bg-transparent border-0 border-b-4 border-violet-300 focus:border-violet-500 outline-none transition-colors duration-200 py-3 text-gray-800 placeholder:text-gray-300"
                autoFocus
              />
            ) : (
              <div className="text-center py-3 border-b-4 border-transparent">
                <span className={`text-2xl font-mono font-bold ${isCorrect ? 'text-green-600' : 'text-red-500'}`}>
                  {userInput || '(未作答)'}
                </span>
              </div>
            )}
          </div>

          {/* 字数提示 */}
          {!submitted && (
            <p className="text-xs text-gray-400 mb-2">
              {wordLength} 个字母 · {userInput.length}/{wordLength}
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
                <div className="text-green-600 font-medium text-lg">✅ 正确！</div>
              ) : (
                <div>
                  <div className="text-red-600 font-medium text-lg mb-2">❌ 不对哦</div>
                  <p className="text-gray-500 text-sm mb-1">正确答案：</p>
                  <div className="flex justify-center mb-1">
                    <ColoredWord word={currentWord.word} syllables={currentWord.syllables} className="text-xl font-bold" />
                  </div>
                  {currentWord.phonetic && (
                    <div className="flex justify-center">
                      <ColoredPhonetic phonetic={currentWord.phonetic} size="sm" />
                    </div>
                  )}
                </div>
              )}

              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={handleNext}
                className="mt-4 px-8 py-3 rounded-2xl text-lg font-medium bg-primary text-white shadow-lg hover:opacity-90 cursor-pointer"
              >
                下一个
              </motion.button>
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
                  ? 'bg-violet-500 text-white hover:bg-violet-600'
                  : 'bg-gray-200 text-gray-500'
              }`}
            >
              提交 (Enter)
            </motion.button>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
