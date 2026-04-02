/**
 * 过关检测组件 - 嵌入分类学习流程
 * 每个单词一道题，题型随机分配，全部覆盖
 * ≥60% 通过，否则可选重考或重学
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { WordData } from '../../api/progress';
import { API_BASE_URL } from '../../config/env';
import ColoredWord from '../ColoredWord';

interface ExamQuestion {
  id: number;
  type: 'en_to_cn' | 'cn_to_en' | 'listening' | 'spelling';
  word: WordData;
  prompt: string;
  options?: string[];
  hint?: string;
  correctAnswer: string;
}

interface GroupExamPhaseProps {
  words: WordData[];
  onPass: (score: number, total: number) => void;
  onRetry: () => void;
  onRelearn: () => void;
}

function generateQuestions(words: WordData[]): ExamQuestion[] {
  const questions: ExamQuestion[] = [];
  const shuffled = [...words].sort(() => Math.random() - 0.5);
  const allMeanings = words.map(w => w.meaning).filter(Boolean);
  const allWords = words.map(w => w.word);

  // 按比例分配题型：英译中 30% + 中译英 30% + 听写 20% + 拼写 20%
  const types: ExamQuestion['type'][] = [];
  const n = shuffled.length;
  const enToCn = Math.round(n * 0.3);
  const cnToEn = Math.round(n * 0.3);
  const listening = Math.round(n * 0.2);
  const spelling = n - enToCn - cnToEn - listening;

  for (let i = 0; i < enToCn; i++) types.push('en_to_cn');
  for (let i = 0; i < cnToEn; i++) types.push('cn_to_en');
  for (let i = 0; i < listening; i++) types.push('listening');
  for (let i = 0; i < spelling; i++) types.push('spelling');

  // 打乱题型顺序
  types.sort(() => Math.random() - 0.5);

  shuffled.forEach((word, i) => {
    const type = types[i] || 'en_to_cn';
    const q: ExamQuestion = {
      id: i,
      type,
      word,
      prompt: '',
      correctAnswer: '',
    };

    switch (type) {
      case 'en_to_cn': {
        q.prompt = word.word;
        q.correctAnswer = word.meaning || '';
        const distractors = allMeanings.filter(m => m !== word.meaning).sort(() => Math.random() - 0.5).slice(0, 3);
        q.options = [...distractors, q.correctAnswer].sort(() => Math.random() - 0.5);
        break;
      }
      case 'cn_to_en': {
        q.prompt = word.meaning || '';
        q.correctAnswer = word.word;
        const distractors = allWords.filter(w => w !== word.word).sort(() => Math.random() - 0.5).slice(0, 3);
        q.options = [...distractors, q.correctAnswer].sort(() => Math.random() - 0.5);
        break;
      }
      case 'listening': {
        q.correctAnswer = word.word;
        break;
      }
      case 'spelling': {
        q.prompt = word.meaning || '';
        q.hint = word.word[0] + '_'.repeat(word.word.length - 1);
        q.correctAnswer = word.word;
        break;
      }
    }
    questions.push(q);
  });

  return questions;
}

const TYPE_LABELS: Record<string, string> = {
  en_to_cn: '英译中', cn_to_en: '中译英', listening: '听写', spelling: '拼写',
};

export default function GroupExamPhase({ words, onPass, onRetry, onRelearn }: GroupExamPhaseProps) {
  const [questions] = useState(() => generateQuestions(words));
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Map<number, string>>(new Map());
  const [inputValue, setInputValue] = useState('');
  const [phase, setPhase] = useState<'testing' | 'result'>('testing');
  const [timeLeft, setTimeLeft] = useState(words.length * 15); // 每题15秒
  const [playCount, setPlayCount] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const handleSubmitRef = useRef<() => void>(() => {});

  const currentQ = questions[currentIndex];
  const totalQuestions = questions.length;

  // 倒计时
  useEffect(() => {
    if (phase !== 'testing') return;
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) { clearInterval(timer); handleSubmitRef.current(); return 0; }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  // 切题时重置
  useEffect(() => {
    setPlayCount(0);
    const existing = currentQ ? answers.get(currentQ.id) : '';
    setInputValue(existing || '');
    if (currentQ && (currentQ.type === 'listening' || currentQ.type === 'spelling')) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [currentIndex]);

  const saveInput = useCallback(() => {
    if (!currentQ) return;
    if ((currentQ.type === 'listening' || currentQ.type === 'spelling') && inputValue.trim()) {
      setAnswers(prev => new Map(prev).set(currentQ.id, inputValue.trim()));
    }
  }, [currentQ, inputValue]);

  const handleSelect = (option: string) => {
    if (!currentQ) return;
    setAnswers(prev => new Map(prev).set(currentQ.id, option));
    setTimeout(() => {
      if (currentIndex < totalQuestions - 1) setCurrentIndex(currentIndex + 1);
    }, 300);
  };

  const handleInputNext = () => {
    saveInput();
    if (currentIndex < totalQuestions - 1) setCurrentIndex(currentIndex + 1);
  };

  const playAudio = () => {
    if (!currentQ || playCount >= 3) return;
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    const audio = new Audio(`${API_BASE_URL}/pronunciation/edge-tts?word=${encodeURIComponent(currentQ.word.word)}&v=4`);
    audioRef.current = audio;
    audio.play().then(() => setPlayCount(p => p + 1)).catch(() => {});
  };

  // 自动播放听写题
  useEffect(() => {
    const q = questions[currentIndex];
    if (q?.type === 'listening' && phase === 'testing') {
      const t = setTimeout(() => {
        const audio = new Audio(`${API_BASE_URL}/pronunciation/edge-tts?word=${encodeURIComponent(q.word.word)}&v=4`);
        audioRef.current = audio;
        audio.play().then(() => setPlayCount(1)).catch(() => {});
      }, 400);
      return () => clearTimeout(t);
    }
  }, [currentIndex, phase, questions]);

  handleSubmitRef.current = handleSubmit;

  function handleSubmit() {
    saveInput();
    setPhase('result');
  }

  // 计算成绩
  const results = questions.map(q => {
    const userAnswer = answers.get(q.id) || '';
    const isCorrect = userAnswer.trim().toLowerCase() === q.correctAnswer.trim().toLowerCase();
    return { ...q, userAnswer, isCorrect };
  });
  const correctCount = results.filter(r => r.isCorrect).length;
  const score = Math.round((correctCount / totalQuestions) * 100);
  const passed = score >= 60;

  const formatTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;

  if (phase === 'result') {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="flex flex-col min-h-[calc(100vh-64px)] items-center justify-center px-4"
      >
        <div className="bg-white rounded-3xl shadow-lg p-8 w-full max-w-md text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: [0, 1.3, 1] }}
            transition={{ duration: 0.5 }}
            className="text-6xl mb-4"
          >
            {passed ? '🎉' : '💪'}
          </motion.div>

          <h3 className="text-2xl font-bold text-gray-800 mb-2">
            {passed ? '过关成功！' : '未通过'}
          </h3>

          <div className={`text-5xl font-bold mb-2 ${passed ? 'text-green-500' : 'text-orange-500'}`}>
            {score}分
          </div>
          <p className="text-gray-500 mb-6">
            答对 {correctCount}/{totalQuestions} 题
            {!passed && <span className="text-orange-500 ml-2">（需要60分通过）</span>}
          </p>

          {/* 错题列表 */}
          {results.some(r => !r.isCorrect) && (
            <div className="text-left mb-6 max-h-48 overflow-y-auto">
              <p className="text-sm font-medium text-gray-600 mb-2">错题回顾：</p>
              {results.filter(r => !r.isCorrect).map(r => (
                <div key={r.id} className="flex items-center gap-2 py-1.5 border-b border-gray-100 text-sm">
                  <span className="text-red-400">✗</span>
                  <ColoredWord word={r.word.word} syllables={r.word.syllables} className="font-medium text-sm" />
                  <span className="text-gray-400">→</span>
                  <span className="text-green-600">{r.correctAnswer}</span>
                  {r.userAnswer && (
                    <span className="text-red-400 text-xs">（你答: {r.userAnswer}）</span>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-3">
            {passed ? (
              <motion.button
                whileTap={{ scale: 0.97 }}
                onClick={() => onPass(correctCount, totalQuestions)}
                className="w-full py-3 bg-gradient-to-r from-green-500 to-emerald-500 text-white font-bold rounded-xl shadow-md"
              >
                继续下一组 →
              </motion.button>
            ) : (
              <>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={onRetry}
                  className="w-full py-3 bg-gradient-to-r from-blue-500 to-indigo-500 text-white font-bold rounded-xl shadow-md"
                >
                  重新检测
                </motion.button>
                <motion.button
                  whileTap={{ scale: 0.97 }}
                  onClick={onRelearn}
                  className="w-full py-3 bg-gray-100 text-gray-600 font-medium rounded-xl"
                >
                  重学本组
                </motion.button>
              </>
            )}
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <div className="flex flex-col min-h-[calc(100vh-64px)]">
      {/* 顶部信息栏 */}
      <div className="px-4 pt-4 pb-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-500">
            过关检测 · {currentIndex + 1}/{totalQuestions}
          </span>
          <span className={`text-sm font-mono font-bold px-3 py-1 rounded-full ${
            timeLeft <= 30 ? 'bg-red-100 text-red-600 animate-pulse' : 'bg-blue-100 text-blue-600'
          }`}>
            {formatTime(timeLeft)}
          </span>
        </div>
        <div className="h-1.5 bg-gray-100 rounded-full">
          <motion.div
            className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full"
            animate={{ width: `${(answers.size / totalQuestions) * 100}%` }}
          />
        </div>
      </div>

      {/* 题目区 */}
      <div className="flex-1 flex items-center justify-center px-4 pb-4">
        <AnimatePresence mode="wait">
          {currentQ && (
            <motion.div
              key={currentQ.id}
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-2xl shadow-lg p-6 w-full max-w-md"
            >
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs px-3 py-1 rounded-full bg-blue-100 text-blue-600 font-medium">
                  {TYPE_LABELS[currentQ.type]}
                </span>
              </div>

              {/* 选择题 */}
              {(currentQ.type === 'en_to_cn' || currentQ.type === 'cn_to_en') && (
                <div>
                  <h3 className={`${currentQ.type === 'en_to_cn' ? 'text-3xl' : 'text-xl'} font-bold text-gray-800 text-center mb-6`}>
                    {currentQ.prompt}
                  </h3>
                  <div className="space-y-2.5">
                    {currentQ.options?.map((opt, i) => {
                      const isSelected = answers.get(currentQ.id) === opt;
                      return (
                        <motion.button
                          key={i}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => handleSelect(opt)}
                          className={`w-full text-left p-3.5 rounded-xl border-2 transition font-medium ${
                            isSelected ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 hover:border-gray-300'
                          }`}
                        >
                          <span className="text-gray-400 mr-2">{String.fromCharCode(65 + i)}.</span>
                          {opt}
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 听写 */}
              {currentQ.type === 'listening' && (
                <div className="text-center">
                  <p className="text-gray-500 mb-4">听发音，写出单词</p>
                  <motion.button
                    whileTap={{ scale: 0.95 }}
                    onClick={playAudio}
                    disabled={playCount >= 3}
                    className={`w-16 h-16 rounded-full flex items-center justify-center text-3xl mx-auto mb-2 shadow-lg ${
                      playCount >= 3 ? 'bg-gray-200' : 'bg-gradient-to-br from-blue-500 to-indigo-600'
                    }`}
                  >
                    🔊
                  </motion.button>
                  <p className="text-xs text-gray-400 mb-4">可播放 {3 - playCount} 次</p>
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleInputNext()}
                    placeholder="输入单词"
                    className="w-full text-center text-2xl font-bold border-b-2 border-gray-300 focus:border-blue-500 outline-none py-3 bg-transparent"
                    autoComplete="off"
                  />
                </div>
              )}

              {/* 拼写 */}
              {currentQ.type === 'spelling' && (
                <div className="text-center">
                  <h3 className="text-xl font-bold text-gray-800 mb-2">{currentQ.prompt}</h3>
                  <p className="text-sm text-blue-500 mb-4">
                    提示: <span className="font-mono font-bold tracking-widest">{currentQ.hint}</span>
                  </p>
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleInputNext()}
                    placeholder="输入完整单词"
                    className="w-full text-center text-2xl font-bold border-b-2 border-gray-300 focus:border-blue-500 outline-none py-3 bg-transparent"
                    autoComplete="off"
                  />
                </div>
              )}

              {/* 输入题确认按钮 */}
              {(currentQ.type === 'listening' || currentQ.type === 'spelling') && (
                <div className="mt-5 flex justify-center">
                  <motion.button
                    whileTap={{ scale: 0.97 }}
                    onClick={handleInputNext}
                    className="px-8 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-medium rounded-xl shadow-md"
                  >
                    {currentIndex < totalQuestions - 1 ? '下一题 →' : '提交'}
                  </motion.button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* 底部题号 + 交卷按钮 */}
      <div className="px-4 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex flex-wrap gap-1.5">
            {questions.map((q, i) => (
              <button
                key={q.id}
                onClick={() => { saveInput(); setCurrentIndex(i); }}
                className={`w-7 h-7 rounded-md text-xs font-medium transition ${
                  i === currentIndex ? 'bg-blue-500 text-white' :
                  answers.has(q.id) ? 'bg-green-100 text-green-700 border border-green-300' :
                  'bg-gray-100 text-gray-400'
                }`}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <motion.button
            whileTap={{ scale: 0.97 }}
            onClick={handleSubmit}
            className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg"
          >
            交卷
          </motion.button>
        </div>
      </div>
    </div>
  );
}
