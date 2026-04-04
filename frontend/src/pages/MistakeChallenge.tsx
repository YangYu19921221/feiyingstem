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
    setPhase('playing');
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const handleSubmitWord = () => {
    if (!currentLevel || !inputValue.trim()) return;
    const word = currentLevel.words[currentWordIndex];
    const newAnswers = { ...userAnswers, [word.word_id]: inputValue.trim() };
    setUserAnswers(newAnswers);
    setInputValue('');

    if (currentWordIndex < currentLevel.words.length - 1) {
      setCurrentWordIndex(currentWordIndex + 1);
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      submitLevel(newAnswers);
    }
  };

  const submitLevel = async (answers: Record<number, string>) => {
    if (!currentLevel) return;
    setSubmitting(true);
    try {
      const answerList = currentLevel.words.map(w => ({
        word_id: w.word_id,
        user_answer: answers[w.word_id] || '',
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
      {/* 顶部导航 */}
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
              onSubmitWord={handleSubmitWord}
              submitting={submitting}
              inputRef={inputRef}
            />
          )}
          {phase === 'result' && resultData && (
            <ResultPhase
              key="result"
              result={resultData}
              userAnswers={userAnswers}
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

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="text-center mb-8">
        <p className="text-gray-600">共 {levels.length} 关，已通关 <span className="font-bold text-green-600">{cleared}</span> 关</p>
      </div>

      <div className="space-y-4">
        {levels.map((level) => {
          const isCleared = level.status === 'cleared';
          const isUnlocked = level.status === 'unlocked';
          const isLocked = level.status === 'locked';

          return (
            <motion.button
              key={level.level}
              onClick={() => onStart(level)}
              disabled={isLocked}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: level.level * 0.05 }}
              className={`w-full p-5 rounded-2xl text-left transition-all ${
                isCleared
                  ? 'bg-green-50 border-2 border-green-300'
                  : isUnlocked
                    ? 'bg-white border-2 border-orange-400 shadow-lg shadow-orange-100 animate-pulse'
                    : 'bg-gray-100 border-2 border-gray-200 opacity-60 cursor-not-allowed'
              }`}
            >
              <div className="flex items-center gap-4">
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold ${
                  isCleared ? 'bg-green-500 text-white' : isUnlocked ? 'bg-orange-500 text-white' : 'bg-gray-300 text-gray-500'
                }`}>
                  {isCleared ? '✓' : isLocked ? '🔒' : level.level}
                </div>
                <div className="flex-1">
                  <div className="font-bold text-gray-800">第 {level.level} 关</div>
                  <div className="text-sm text-gray-500">{level.word_count} 个单词</div>
                </div>
                {isCleared && <span className="text-green-600 font-bold">已通关 ✨</span>}
                {isUnlocked && <span className="text-orange-600 font-bold">挑战 →</span>}
              </div>
              {/* 单词预览 */}
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

// ===== 答题阶段 =====
function PlayingPhase({
  level, currentIndex, inputValue, setInputValue, onSubmitWord, submitting, inputRef
}: {
  level: ChallengeLevel;
  currentIndex: number;
  inputValue: string;
  setInputValue: (v: string) => void;
  onSubmitWord: () => void;
  submitting: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const word = level.words[currentIndex];
  const total = level.words.length;

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}>
      {/* 进度指示器 */}
      <div className="flex items-center justify-center gap-3 mb-8">
        {level.words.map((_, i) => (
          <div
            key={i}
            className={`w-4 h-4 rounded-full transition-all ${
              i < currentIndex ? 'bg-green-500 scale-100' : i === currentIndex ? 'bg-orange-500 scale-125 animate-pulse' : 'bg-gray-300'
            }`}
          />
        ))}
      </div>

      <div className="text-center mb-4 text-sm text-gray-500">
        第 {level.level} 关 · {currentIndex + 1} / {total}
      </div>

      {/* 单词卡片 */}
      <motion.div
        key={word.word_id}
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white rounded-3xl shadow-xl p-8 mb-8 text-center"
      >
        <div className="text-4xl mb-4">📝</div>
        <div className="text-2xl font-bold text-gray-800 mb-2">{word.meaning}</div>
        {word.part_of_speech && (
          <div className="text-sm text-gray-400 mb-1">{word.part_of_speech}</div>
        )}
        {word.phonetic && (
          <ColoredPhonetic phonetic={word.phonetic} className="text-sm" />
        )}
      </motion.div>

      {/* 输入框 */}
      <div className="flex gap-3">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSubmitWord()}
          placeholder="输入英文单词..."
          disabled={submitting}
          className="flex-1 px-6 py-4 text-lg rounded-2xl border-2 border-gray-200 focus:border-orange-400 focus:outline-none transition"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        <button
          onClick={onSubmitWord}
          disabled={!inputValue.trim() || submitting}
          className="px-8 py-4 bg-orange-500 text-white font-bold rounded-2xl hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed transition"
        >
          {currentIndex < total - 1 ? '下一个' : '提交'}
        </button>
      </div>
    </motion.div>
  );
}

// ===== 结果阶段 =====
function ResultPhase({
  result, userAnswers, onRetry, onBack
}: {
  result: ResultData;
  userAnswers: Record<number, string>;
  onRetry: () => void;
  onBack: () => void;
}) {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="text-center">
      {result.passed ? (
        <>
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 10 }}
            className="text-8xl mb-6"
          >
            🎉
          </motion.div>
          <h2 className="text-3xl font-bold text-green-600 mb-2">通关成功！</h2>
          <p className="text-gray-600 mb-8">{result.message}</p>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="inline-flex items-center gap-2 px-6 py-3 bg-green-100 text-green-700 rounded-full font-bold mb-8"
          >
            ✅ {result.correct_count}/{result.total_count} 全部正确
          </motion.div>
        </>
      ) : (
        <>
          <div className="text-6xl mb-6">💪</div>
          <h2 className="text-2xl font-bold text-orange-600 mb-2">再接再厉！</h2>
          <p className="text-gray-600 mb-4">{result.message}</p>
          <div className="inline-flex items-center gap-2 px-6 py-3 bg-orange-100 text-orange-700 rounded-full font-bold mb-8">
            {result.correct_count}/{result.total_count} 正确
          </div>

          {result.wrong_words.length > 0 && (
            <div className="bg-white rounded-2xl p-6 shadow-lg text-left mb-8">
              <h3 className="font-bold text-gray-800 mb-4">需要复习的单词：</h3>
              <div className="space-y-3">
                {result.wrong_words.map(w => (
                  <div key={w.word_id} className="p-3 bg-red-50 rounded-xl">
                    <div className="flex items-center gap-3 mb-1">
                      <span className="text-red-500">✗</span>
                      <span className="font-bold text-green-700 text-lg">{w.word}</span>
                      <span className="text-gray-500">—</span>
                      <span className="text-gray-600">{w.meaning}</span>
                    </div>
                    <div className="ml-7 flex items-center gap-2 text-sm">
                      <span className="text-gray-400">你的答案：</span>
                      <span className="text-red-500 line-through font-medium">{userAnswers[w.word_id] || '(未作答)'}</span>
                      <span className="text-gray-400">→</span>
                      <span className="text-green-600 font-bold">{w.word}</span>
                    </div>
                    {w.phonetic && (
                      <div className="ml-7 mt-1">
                        <ColoredPhonetic phonetic={w.phonetic} size="sm" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <div className="flex gap-4 justify-center">
        {!result.passed && (
          <button
            onClick={onRetry}
            className="px-8 py-3 bg-orange-500 text-white font-bold rounded-2xl hover:bg-orange-600 transition"
          >
            🔄 重新挑战
          </button>
        )}
        <button
          onClick={onBack}
          className="px-8 py-3 bg-gray-200 text-gray-700 font-bold rounded-2xl hover:bg-gray-300 transition"
        >
          返回关卡
        </button>
      </div>
    </motion.div>
  );
}
