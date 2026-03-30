/**
 * 阶段1：分类（循环模式）
 * 每轮过完所有词后，夹生+陌生的词再来一轮
 * 直到全部标为熟悉才结束
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { WordData } from '../../api/progress';
import ColoredWord from '../ColoredWord';
import ColoredPhonetic from '../ColoredPhonetic';

export type WordCategory = 'familiar' | 'semi' | 'unknown';

interface ClassificationPhaseProps {
  words: WordData[];
  onComplete: (results: Map<number, WordCategory>) => void;
  playAudio: (word: string) => void;
}

const CLASSIFY_TIME = 10;
const PLAY_INTERVAL = 1800;

export default function ClassificationPhase({
  words,
  onComplete,
  playAudio,
}: ClassificationPhaseProps) {
  // 当前轮要过的单词列表
  const [roundWords, setRoundWords] = useState<WordData[]>(words);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [round, setRound] = useState(1);
  const [timeLeft, setTimeLeft] = useState(CLASSIFY_TIME);
  const [results, setResults] = useState<Map<number, WordCategory>>(new Map());
  const [isTransitioning, setIsTransitioning] = useState(false);
  // 轮次间过渡
  const [showRoundSummary, setShowRoundSummary] = useState(false);
  const [roundErrors, setRoundErrors] = useState(0);
  // 使用教程
  const [showTutorial, setShowTutorial] = useState(() => {
    return !localStorage.getItem('classify_tutorial_done');
  });

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const classifyRef = useRef<(category: WordCategory) => void>(() => {});

  const currentWord = roundWords[currentIndex];

  // 循环播放发音
  useEffect(() => {
    if (!currentWord || showRoundSummary || showTutorial) return;

    const t = setTimeout(() => {
      playAudio(currentWord.word);
    }, 300);

    const t2 = setTimeout(() => {
      audioTimerRef.current = setInterval(() => {
        playAudio(currentWord.word);
      }, PLAY_INTERVAL);
    }, 300 + PLAY_INTERVAL);

    return () => {
      clearTimeout(t);
      clearTimeout(t2);
      if (audioTimerRef.current) {
        clearInterval(audioTimerRef.current);
        audioTimerRef.current = null;
      }
    };
  }, [currentIndex, currentWord, playAudio, showRoundSummary]);

  // 一轮结束时的处理
  const handleRoundEnd = useCallback((newResults: Map<number, WordCategory>) => {
    // 收集本轮中不是熟悉的词
    const errorWords = roundWords.filter(w => newResults.get(w.id) !== 'familiar');

    if (errorWords.length === 0) {
      // 全部熟悉，分类结束
      onComplete(newResults);
    } else {
      // 还有错误词，显示轮次总结后进入下一轮
      setRoundErrors(errorWords.length);
      setShowRoundSummary(true);

      // 2秒后自动进入下一轮
      setTimeout(() => {
        setRound(prev => prev + 1);
        setRoundWords(errorWords);
        setCurrentIndex(0);
        setTimeLeft(CLASSIFY_TIME);
        setShowRoundSummary(false);
      }, 2000);
    }
  }, [roundWords, onComplete]);

  const handleClassify = useCallback((category: WordCategory) => {
    if (isTransitioning || !currentWord) return;
    setIsTransitioning(true);

    if (timerRef.current) clearInterval(timerRef.current);
    if (audioTimerRef.current) clearInterval(audioTimerRef.current);

    const newResults = new Map(results);
    newResults.set(currentWord.id, category);
    setResults(newResults);

    setTimeout(() => {
      if (currentIndex + 1 >= roundWords.length) {
        // 本轮结束
        handleRoundEnd(newResults);
      } else {
        setCurrentIndex(currentIndex + 1);
        setTimeLeft(CLASSIFY_TIME);
      }
      setIsTransitioning(false);
    }, 200);
  }, [currentWord, currentIndex, roundWords.length, results, handleRoundEnd, isTransitioning]);

  useEffect(() => {
    classifyRef.current = handleClassify;
  }, [handleClassify]);

  // 键盘快捷键: 1=熟悉, 2=夹生, 3=陌生, 空格=播放发音
  useEffect(() => {
    if (showTutorial || showRoundSummary) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      switch (e.key) {
        case '1': classifyRef.current('familiar'); break;
        case '2': classifyRef.current('semi'); break;
        case '3': classifyRef.current('unknown'); break;
        case ' ':
          e.preventDefault();
          if (currentWord) playAudio(currentWord.word);
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showTutorial, showRoundSummary, currentWord, playAudio]);

  // 倒计时
  useEffect(() => {
    if (isTransitioning || showRoundSummary || showTutorial) return;

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 0.1) {
          classifyRef.current('unknown');
          return CLASSIFY_TIME;
        }
        return prev - 0.1;
      });
    }, 100);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [currentIndex, isTransitioning, showRoundSummary]);

  // 关闭教程
  const dismissTutorial = () => {
    setShowTutorial(false);
    localStorage.setItem('classify_tutorial_done', '1');
  };

  // 使用教程
  if (showTutorial) {
    return (
      <div className="flex flex-col min-h-[calc(100vh-64px)] items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-3xl shadow-lg p-8 w-full max-w-md"
        >
          <h3 className="text-2xl font-bold text-gray-800 text-center mb-6">
            🧠 分类记忆法
          </h3>

          <div className="space-y-4 mb-6">
            <div className="flex items-start gap-3 p-3 bg-green-50 rounded-xl">
              <span className="text-2xl">😊</span>
              <div>
                <div className="font-bold text-green-700">熟悉
                  <kbd className="ml-2 px-2 py-0.5 bg-green-100 text-green-600 rounded text-xs font-mono">1</kbd>
                </div>
                <p className="text-sm text-gray-500">看到就知道意思，直接过</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-orange-50 rounded-xl">
              <span className="text-2xl">🤔</span>
              <div>
                <div className="font-bold text-orange-700">夹生
                  <kbd className="ml-2 px-2 py-0.5 bg-orange-100 text-orange-600 rounded text-xs font-mono">2</kbd>
                </div>
                <p className="text-sm text-gray-500">有点印象但不确定，需要再记一记</p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-3 bg-red-50 rounded-xl">
              <span className="text-2xl">😰</span>
              <div>
                <div className="font-bold text-red-700">陌生
                  <kbd className="ml-2 px-2 py-0.5 bg-red-100 text-red-600 rounded text-xs font-mono">3</kbd>
                </div>
                <p className="text-sm text-gray-500">完全不认识，需要重点学习</p>
              </div>
            </div>
          </div>

          <div className="bg-blue-50 rounded-xl p-4 mb-6">
            <h4 className="font-bold text-blue-700 text-sm mb-2">学习流程</h4>
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <span className="px-2 py-1 bg-white rounded-lg">分类</span>
              <span>→</span>
              <span className="px-2 py-1 bg-white rounded-lg">语音</span>
              <span>→</span>
              <span className="px-2 py-1 bg-white rounded-lg">听写</span>
              <span>→</span>
              <span className="px-2 py-1 bg-white rounded-lg">填空</span>
              <span>→</span>
              <span className="px-2 py-1 bg-white rounded-lg">总结</span>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              未标熟悉的词会反复出现，直到全部掌握
            </p>
          </div>

          <div className="text-center text-xs text-gray-400 mb-4">
            <span className="inline-flex items-center gap-1">
              <kbd className="px-1.5 py-0.5 bg-gray-100 rounded font-mono">空格</kbd> 播放发音
            </span>
            <span className="mx-2">·</span>
            <span>每词 {CLASSIFY_TIME} 秒倒计时</span>
          </div>

          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={dismissTutorial}
            className="w-full py-3 bg-primary text-white rounded-2xl font-bold text-lg shadow-lg"
          >
            开始学习
          </motion.button>
        </motion.div>
      </div>
    );
  }

  // 轮次间过渡画面
  if (showRoundSummary) {
    const familiarCount = roundWords.length - roundErrors;
    return (
      <div className="flex flex-col min-h-[calc(100vh-64px)] items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-3xl shadow-lg p-8 w-full max-w-md text-center"
        >
          <div className="text-5xl mb-4">🔄</div>
          <h3 className="text-xl font-bold text-gray-800 mb-2">第 {round} 轮完成</h3>
          <div className="flex justify-center gap-6 mb-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-500">{familiarCount}</div>
              <div className="text-xs text-gray-400">😊 已掌握</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-500">{roundErrors}</div>
              <div className="text-xs text-gray-400">需复习</div>
            </div>
          </div>
          <p className="text-gray-500 text-sm">
            还有 <span className="font-bold text-red-500">{roundErrors}</span> 个词需要再过一遍...
          </p>
        </motion.div>
      </div>
    );
  }

  if (!currentWord) return null;

  const progress = timeLeft / CLASSIFY_TIME;
  const timerColor = timeLeft > 7 ? '#5FD35F' : timeLeft > 3 ? '#FFD23F' : '#FF5757';

  return (
    <div className="flex flex-col min-h-[calc(100vh-64px)]">
      {/* 卡片区域 */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 pb-4">
        {/* 轮次 + 进度 */}
        <div className="mb-4 text-center">
          {round > 1 && (
            <span className="text-xs text-orange-500 font-medium mr-2">
              第{round}轮
            </span>
          )}
          <span className="text-sm text-gray-400 font-medium">
            {currentIndex + 1} / {roundWords.length}
          </span>
        </div>

        {/* 单词卡片 */}
        <AnimatePresence mode="wait">
          <motion.div
            key={`${round}-${currentWord.id}`}
            initial={{ opacity: 0, x: 60 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -60 }}
            transition={{ duration: 0.25 }}
            className="bg-white rounded-3xl shadow-lg w-full max-w-md overflow-hidden"
          >
            {/* 顶部倒计时条 */}
            <div className="h-1.5 bg-gray-100 w-full">
              <motion.div
                className="h-full rounded-r-full"
                style={{ backgroundColor: timerColor }}
                animate={{ width: `${progress * 100}%` }}
                transition={{ duration: 0.1 }}
              />
            </div>

            {/* 倒计时秒数 */}
            <div className="flex justify-end px-5 pt-2">
              <span
                className="text-sm font-bold tabular-nums"
                style={{ color: timerColor }}
              >
                {Math.ceil(timeLeft)}s
              </span>
            </div>

            {/* 卡片内容 */}
            <div className="px-8 pb-8 pt-2 text-center">
              <div className="mb-3">
                <ColoredWord
                  word={currentWord.word}
                  syllables={currentWord.syllables}
                  className="text-5xl font-bold"
                />
              </div>

              {currentWord.phonetic && (
                <div className="mb-3 flex justify-center">
                  <ColoredPhonetic phonetic={currentWord.phonetic} size="sm" />
                </div>
              )}

              {currentWord.meaning && (
                <p className="text-lg text-gray-600 mb-3">
                  {currentWord.part_of_speech && (
                    <span className="text-sm text-gray-400 mr-1">
                      {currentWord.part_of_speech}
                    </span>
                  )}
                  {currentWord.meaning}
                </p>
              )}

              {currentWord.example_sentence && (
                <div className="mt-2 px-4 py-3 bg-amber-50 rounded-xl text-left">
                  <p className="text-sm text-gray-700 italic leading-relaxed">
                    📖 {currentWord.example_sentence}
                  </p>
                  {currentWord.example_translation && (
                    <p className="text-xs text-gray-400 mt-1">
                      {currentWord.example_translation}
                    </p>
                  )}
                </div>
              )}

              <button
                onClick={() => playAudio(currentWord.word)}
                className="mt-4 p-3 rounded-full bg-blue-50 hover:bg-blue-100 transition active:scale-95"
              >
                <span className="text-2xl">🔊</span>
              </button>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* 底部分类按钮 */}
      <div className="sticky bottom-0 bg-gradient-to-t from-orange-50 via-orange-50/90 to-transparent pt-6 pb-6 px-4">
        <div className="flex gap-3 justify-center max-w-md mx-auto">
          {[
            { category: 'familiar' as WordCategory, emoji: '😊', label: '熟悉', key: '1', color: 'bg-green-500 hover:bg-green-600 shadow-green-200' },
            { category: 'semi' as WordCategory, emoji: '🤔', label: '夹生', key: '2', color: 'bg-orange-500 hover:bg-orange-600 shadow-orange-200' },
            { category: 'unknown' as WordCategory, emoji: '😰', label: '陌生', key: '3', color: 'bg-red-500 hover:bg-red-600 shadow-red-200' },
          ].map(btn => (
            <motion.button
              key={btn.category}
              whileHover={{ scale: 1.06 }}
              whileTap={{ scale: 0.92 }}
              onClick={() => handleClassify(btn.category)}
              className={`${btn.color} text-white rounded-2xl flex-1 py-4 flex flex-col items-center gap-1 shadow-lg transition`}
            >
              <span className="text-3xl">{btn.emoji}</span>
              <span className="text-sm font-medium">{btn.label}</span>
              <kbd className="text-[10px] opacity-70 bg-white/20 px-1.5 py-0.5 rounded">{btn.key}</kbd>
            </motion.button>
          ))}
        </div>
      </div>
    </div>
  );
}
