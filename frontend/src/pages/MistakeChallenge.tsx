import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import ColoredPhonetic from '../components/ColoredPhonetic';
import {
  getChallengeLevels,
  submitChallengeLevel,
  type ChallengeLevel,
  type ChallengeLevelWord,
} from '../api/mistakeBook';

type Phase = 'map' | 'playing' | 'result';

interface ResultData {
  passed: boolean;
  correct_count: number;
  total_count: number;
  wrong_words: ChallengeLevelWord[];
  message: string;
}

interface WordFeedback {
  word: ChallengeLevelWord;
  userAnswer: string;
  isCorrect: boolean;
}

const MistakeChallenge = () => {
  const navigate = useNavigate();
  const [levels, setLevels] = useState<ChallengeLevel[]>([]);
  const [loading, setLoading] = useState(true);
  const [phase, setPhase] = useState<Phase>('map');
  const [currentLevel, setCurrentLevel] = useState<ChallengeLevel | null>(null);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<number, string>>({});
  const [inputValue, setInputValue] = useState('');
  const [resultData, setResultData] = useState<ResultData | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 即时反馈
  const [showFeedback, setShowFeedback] = useState(false);
  const [currentFeedback, setCurrentFeedback] = useState<WordFeedback | null>(null);
  const [feedbackHistory, setFeedbackHistory] = useState<WordFeedback[]>([]);

  useEffect(() => {
    loadLevels();
  }, []);

  const loadLevels = async () => {
    try {
      setLoading(true);
      const data = await getChallengeLevels();
      setLevels(data.levels);
    } catch (error) {
      console.error('加载关卡失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const startLevel = (level: ChallengeLevel) => {
    if (level.status === 'locked') return;
    setCurrentLevel(level);
    setCurrentWordIndex(0);
    setUserAnswers({});
    setInputValue('');
    setShowFeedback(false);
    setCurrentFeedback(null);
    setFeedbackHistory([]);
    setPhase('playing');
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleCheckWord = () => {
    if (!currentLevel || !inputValue.trim() || showFeedback) return;
    const word = currentLevel.words[currentWordIndex];
    const answer = inputValue.trim();
    const isCorrect = answer === word.word;

    const newAnswers = { ...userAnswers, [word.word_id]: answer };
    setUserAnswers(newAnswers);

    const feedback: WordFeedback = { word, userAnswer: answer, isCorrect };
    setCurrentFeedback(feedback);
    setFeedbackHistory(prev => [...prev, feedback]);
    setShowFeedback(true);
  };

  const handleNextWord = () => {
    if (!currentLevel) return;
    setShowFeedback(false);
    setCurrentFeedback(null);
    setInputValue('');

    if (currentWordIndex < currentLevel.words.length - 1) {
      setCurrentWordIndex(currentWordIndex + 1);
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      submitLevel();
    }
  };

  const submitLevel = async () => {
    if (!currentLevel) return;
    setSubmitting(true);
    try {
      const answerList = currentLevel.words.map(w => ({
        word_id: w.word_id,
        user_answer: userAnswers[w.word_id] || '',
      }));
      const result = await submitChallengeLevel(currentLevel.level, answerList);
      setResultData(result);
      setPhase('result');
      if (result.passed) loadLevels();
    } catch (error) {
      console.error('提交失败:', error);
    } finally {
      setSubmitting(false);
    }
  };

  const retryLevel = () => {
    if (currentLevel) startLevel(currentLevel);
  };

  const backToMap = () => {
    setPhase('map');
    setCurrentLevel(null);
    setResultData(null);
    loadLevels();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-red-50 to-pink-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl animate-bounce mb-4">🏰</div>
          <p className="text-gray-500">加载关卡中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-red-50 to-pink-50">
      <nav className="bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center gap-4">
          <button onClick={() => phase === 'map' ? navigate(-1) : backToMap()} className="p-2 hover:bg-gray-100 rounded-lg transition">
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className="flex items-center gap-2">
            <span className="text-2xl">🏰</span>
            <h1 className="text-xl font-bold text-gray-800">错题闯关</h1>
          </div>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-4 py-8">
        <AnimatePresence mode="wait">
          {phase === 'map' && (
            <MapPhase key="map" levels={levels} onStart={startLevel} />
          )}
          {phase === 'playing' && currentLevel && (
            <PlayingPhase
              key="playing"
              level={currentLevel}
              currentIndex={currentWordIndex}
              inputValue={inputValue}
              setInputValue={setInputValue}
              onCheck={handleCheckWord}
              onNext={handleNextWord}
              showFeedback={showFeedback}
              feedback={currentFeedback}
              feedbackHistory={feedbackHistory}
              submitting={submitting}
              inputRef={inputRef}
            />
          )}
          {phase === 'result' && resultData && (
            <ResultPhase
              key="result"
              result={resultData}
              userAnswers={userAnswers}
              feedbackHistory={feedbackHistory}
              onRetry={retryLevel}
              onBack={backToMap}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};

export default MistakeChallenge;

// ===== 关卡地图 =====
function MapPhase({ levels, onStart }: { levels: ChallengeLevel[]; onStart: (l: ChallengeLevel) => void }) {
  if (levels.length === 0) {
    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center py-20">
        <div className="text-6xl mb-4">🎉</div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">没有未解决的错题</h2>
        <p className="text-gray-500">太棒了，继续保持！</p>
      </motion.div>
    );
  }

  const cleared = levels.filter(l => l.status === 'cleared').length;
  const reviewCount = levels.filter(l => l.status === 'review').length;
  const hasReview = reviewCount > 0;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      {hasReview && (
        <div className="mb-6 p-4 bg-red-50 border-2 border-red-300 rounded-2xl text-center">
          <p className="text-red-600 font-bold text-lg">⏰ 有 {reviewCount} 关需要复习！</p>
          <p className="text-red-500 text-sm mt-1">请先完成复习关卡，巩固已学内容</p>
        </div>
      )}
      <div className="text-center mb-8">
        <p className="text-gray-600">共 {levels.length} 关，已通关 <span className="font-bold text-green-600">{cleared}</span> 关</p>
      </div>
      <div className="space-y-4">
        {levels.map((level) => {
          const isCleared = level.status === 'cleared';
          const isUnlocked = level.status === 'unlocked';
          const isLocked = level.status === 'locked';
          const isReview = level.status === 'review';
          return (
            <motion.button
              key={level.level}
              onClick={() => onStart(level)}
              disabled={isLocked}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: level.level * 0.05 }}
              className={`w-full p-5 rounded-2xl text-left transition-all ${
                isReview ? 'bg-red-50 border-2 border-red-400 shadow-lg shadow-red-100 animate-pulse'
                : isCleared ? 'bg-green-50 border-2 border-green-300'
                : isUnlocked ? 'bg-white border-2 border-orange-400 shadow-lg shadow-orange-100'
                : 'bg-gray-100 border-2 border-gray-200 opacity-60 cursor-not-allowed'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold ${
                  isReview ? 'bg-red-500 text-white' : isCleared ? 'bg-green-500 text-white' : isUnlocked ? 'bg-orange-500 text-white' : 'bg-gray-300 text-gray-500'
                }`}>
                  {isReview ? '🔄' : isCleared ? '✓' : isLocked ? '🔒' : level.level}
                </div>
                <div className="flex-1">
                  <div className="font-bold text-gray-800">{isReview ? `复习第 ${level.level} 关` : `第 ${level.level} 关`}</div>
                  <div className="text-sm text-gray-500">{level.word_count} 个单词</div>
                </div>
                {isReview && <span className="text-red-600 font-bold">需复习 ⏰</span>}
                {isCleared && <span className="text-green-600 font-bold">已通关 ✨</span>}
                {isUnlocked && <span className="text-orange-600 font-bold">挑战 →</span>}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {level.words.map(w => (
                  <span key={w.word_id} className={`px-2 py-1 rounded text-xs ${
                    isCleared ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                  }`}>
                    {w.meaning}
                  </span>
                ))}
              </div>
            </motion.button>
          );
        })}
      </div>
    </motion.div>
  );
}

// ===== 答题阶段（即时反馈）=====
function PlayingPhase({
  level, currentIndex, inputValue, setInputValue, onCheck, onNext,
  showFeedback, feedback, feedbackHistory, submitting, inputRef
}: {
  level: ChallengeLevel;
  currentIndex: number;
  inputValue: string;
  setInputValue: (v: string) => void;
  onCheck: () => void;
  onNext: () => void;
  showFeedback: boolean;
  feedback: WordFeedback | null;
  feedbackHistory: WordFeedback[];
  submitting: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const word = level.words[currentIndex];
  const total = level.words.length;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      {/* 进度指示器 */}
      <div className="flex items-center justify-center gap-3 mb-8">
        {level.words.map((_, i) => {
          const fb = feedbackHistory[i];
          return (
            <div
              key={i}
              className={`w-4 h-4 rounded-full transition-all ${
                fb ? (fb.isCorrect ? 'bg-green-500' : 'bg-red-500') :
                i === currentIndex ? 'bg-orange-500 scale-125 animate-pulse' : 'bg-gray-300'
              }`}
            />
          );
        })}
      </div>

      <div className="text-center mb-4 text-sm text-gray-500">
        第 {level.level} 关 · {currentIndex + 1} / {total}
      </div>

      {/* 单词卡片 */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`${word.word_id}-${showFeedback}`}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-3xl shadow-xl p-8 mb-8 text-center"
        >
          {!showFeedback ? (
            <>
              <div className="text-4xl mb-4">📝</div>
              <div className="text-2xl font-bold text-gray-800 mb-2">{word.meaning}</div>
              {word.part_of_speech && <div className="text-sm text-gray-400 mb-1">{word.part_of_speech}</div>}
              {word.phonetic && <div className="flex justify-center"><ColoredPhonetic phonetic={word.phonetic} size="sm" /></div>}
            </>
          ) : feedback ? (
            feedback.isCorrect ? (
              <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }}>
                <div className="text-5xl mb-3">✅</div>
                <div className="text-2xl font-bold text-green-600 mb-1">正确！</div>
                <div className="text-xl text-gray-800 font-bold">{word.word}</div>
                <div className="text-sm text-gray-500 mt-1">{word.meaning}</div>
              </motion.div>
            ) : (
              <motion.div initial={{ scale: 0.5 }} animate={{ scale: 1 }}>
                <div className="text-5xl mb-3">❌</div>
                <div className="text-lg text-red-500 mb-3">
                  你的答案：<span className="line-through font-medium">{feedback.userAnswer}</span>
                </div>
                <div className="text-sm text-gray-400 mb-1">正确答案：</div>
                <div className="text-3xl font-bold text-green-600 mb-2">{word.word}</div>
                <div className="text-sm text-gray-500">{word.meaning}</div>
                {word.phonetic && <div className="flex justify-center mt-2"><ColoredPhonetic phonetic={word.phonetic} size="sm" /></div>}
              </motion.div>
            )
          ) : null}
        </motion.div>
      </AnimatePresence>

      {/* 输入框 / 下一题按钮 */}
      {!showFeedback ? (
        <div className="flex gap-3">
          <input
            ref={inputRef}
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onCheck()}
            placeholder="输入英文单词..."
            disabled={submitting}
            className="flex-1 px-6 py-4 text-lg rounded-2xl border-2 border-gray-200 focus:border-orange-400 focus:outline-none transition"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
          <button
            onClick={onCheck}
            disabled={!inputValue.trim() || submitting}
            className="px-8 py-4 bg-orange-500 text-white font-bold rounded-2xl hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            确认
          </button>
        </div>
      ) : (
        <motion.button
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          onClick={onNext}
          className="w-full py-4 bg-gradient-to-r from-orange-500 to-pink-500 text-white font-bold text-lg rounded-2xl hover:shadow-lg transition"
        >
          {currentIndex < total - 1 ? '下一题 →' : '查看成绩'}
        </motion.button>
      )}
    </motion.div>
  );
}

// ===== 结果阶段（评分+彩蛋）=====
function ResultPhase({
  result, userAnswers, feedbackHistory, onRetry, onBack
}: {
  result: ResultData;
  userAnswers: Record<number, string>;
  feedbackHistory: WordFeedback[];
  onRetry: () => void;
  onBack: () => void;
}) {
  const score = result.total_count > 0 ? Math.round(result.correct_count / result.total_count * 100) : 0;
  const isPerfect = score === 100;

  return (
    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="text-center">
      {/* 满分彩蛋 */}
      {isPerfect && (
        <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
          {Array.from({ length: 40 }).map((_, i) => (
            <motion.div
              key={i}
              initial={{
                x: Math.random() * window.innerWidth,
                y: -20,
                rotate: 0,
                scale: Math.random() * 0.5 + 0.5,
              }}
              animate={{
                y: window.innerHeight + 50,
                rotate: Math.random() * 720 - 360,
              }}
              transition={{
                duration: Math.random() * 2 + 2,
                delay: Math.random() * 1.5,
                ease: 'easeIn',
              }}
              className="absolute text-2xl"
            >
              {['🎉', '⭐', '🏆', '💯', '🎊', '✨', '🌟', '👑'][i % 8]}
            </motion.div>
          ))}
        </div>
      )}

      {/* 分数环 */}
      <div className="relative w-36 h-36 mx-auto mb-6">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="42" fill="none" stroke="#E5E7EB" strokeWidth="6" />
          <motion.circle
            cx="50" cy="50" r="42"
            fill="none"
            stroke={isPerfect ? '#22C55E' : score >= 80 ? '#3B82F6' : score >= 60 ? '#F59E0B' : '#EF4444'}
            strokeWidth="6" strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 42}
            initial={{ strokeDashoffset: 2 * Math.PI * 42 }}
            animate={{ strokeDashoffset: 2 * Math.PI * 42 * (1 - score / 100) }}
            transition={{ duration: 1.2, ease: 'easeOut' }}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.5, type: 'spring' }}
            className={`text-4xl font-bold ${
              isPerfect ? 'text-green-600' : score >= 80 ? 'text-blue-600' : score >= 60 ? 'text-yellow-600' : 'text-red-500'
            }`}
          >
            {score}
          </motion.span>
          <span className="text-xs text-gray-400">分</span>
        </div>
      </div>

      {/* 标题 */}
      {isPerfect ? (
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', delay: 0.3 }}>
          <div className="text-5xl mb-3">👑</div>
          <h2 className="text-3xl font-bold text-green-600 mb-2">满分通关！</h2>
          <p className="text-gray-500 mb-6">太棒了，全部答对！</p>
        </motion.div>
      ) : score >= 80 ? (
        <>
          <h2 className="text-2xl font-bold text-blue-600 mb-2">表现优秀！</h2>
          <p className="text-gray-500 mb-6">{result.correct_count}/{result.total_count} 正确</p>
        </>
      ) : score >= 60 ? (
        <>
          <h2 className="text-2xl font-bold text-yellow-600 mb-2">继续加油！</h2>
          <p className="text-gray-500 mb-6">{result.correct_count}/{result.total_count} 正确</p>
        </>
      ) : (
        <>
          <h2 className="text-2xl font-bold text-red-500 mb-2">需要多练习</h2>
          <p className="text-gray-500 mb-6">{result.correct_count}/{result.total_count} 正确</p>
        </>
      )}

      {/* 每题回顾 */}
      {feedbackHistory.length > 0 && (
        <div className="bg-white rounded-2xl p-6 shadow-lg text-left mb-8">
          <h3 className="font-bold text-gray-800 mb-4">答题回顾</h3>
          <div className="space-y-3">
            {feedbackHistory.map((fb, i) => (
              <div key={i} className={`p-3 rounded-xl ${fb.isCorrect ? 'bg-green-50' : 'bg-red-50'}`}>
                <div className="flex items-center gap-3">
                  <span className={fb.isCorrect ? 'text-green-500' : 'text-red-500'}>
                    {fb.isCorrect ? '✓' : '✗'}
                  </span>
                  <span className="font-bold text-gray-800">{fb.word.word}</span>
                  <span className="text-gray-400">—</span>
                  <span className="text-gray-600 text-sm">{fb.word.meaning}</span>
                </div>
                {!fb.isCorrect && (
                  <div className="ml-8 mt-1 text-sm">
                    <span className="text-red-400 line-through">{fb.userAnswer}</span>
                    <span className="text-gray-400 mx-2">→</span>
                    <span className="text-green-600 font-bold">{fb.word.word}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-4 justify-center">
        {!isPerfect && (
          <button onClick={onRetry} className="px-8 py-3 bg-orange-500 text-white font-bold rounded-2xl hover:bg-orange-600 transition">
            🔄 重新挑战
          </button>
        )}
        <button onClick={onBack} className="px-8 py-3 bg-gray-200 text-gray-700 font-bold rounded-2xl hover:bg-gray-300 transition">
          返回关卡
        </button>
      </div>
    </motion.div>
  );
}
