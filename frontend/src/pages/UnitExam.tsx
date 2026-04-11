import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import {
  generateExam, submitExam,
  type ExamData, type ExamQuestion, type ExamAnswerItem,
  EXAM_TYPE_LABELS,
} from '../api/unitExam';
import { API_BASE_URL } from '../config/env';
import { toast } from '../components/Toast';

type ExamPhase = 'start' | 'testing' | 'submitting';

const UnitExam = () => {
  const { unitId } = useParams<{ unitId: string }>();
  const navigate = useNavigate();

  const [phase, setPhase] = useState<ExamPhase>('start');
  const [examData, setExamData] = useState<ExamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Map<number, string>>(new Map());
  const [timeLeft, setTimeLeft] = useState(900);
  const [startTime, setStartTime] = useState(0);

  // 听写播放次数
  const [playCount, setPlayCount] = useState(0);

  // 输入框
  const [inputValue, setInputValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const handleSubmitRef = useRef<() => void>(() => {});
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // 加载试卷
  useEffect(() => {
    if (unitId) loadExam(parseInt(unitId));
  }, [unitId]);

  const loadExam = async (id: number) => {
    try {
      setLoading(true);
      const data = await generateExam(id);
      setExamData(data);
      setTimeLeft(data.time_limit);
    } catch (err: any) {
      setError(err?.response?.data?.detail || '加载试卷失败');
    } finally {
      setLoading(false);
    }
  };

  // 倒计时
  useEffect(() => {
    if (phase !== 'testing') return;
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          handleSubmitRef.current();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, '0')}:${sec.toString().padStart(2, '0')}`;
  };

  const currentQuestion = examData?.questions[currentIndex];

  // 切换题目时重置状态
  useEffect(() => {
    setPlayCount(0);
    const existing = currentQuestion ? answers.get(currentQuestion.id) : '';
    setInputValue(existing || '');
    if (currentQuestion && ['listening', 'spelling', 'sentence_fill'].includes(currentQuestion.type)) {
      setTimeout(() => inputRef.current?.focus(), 350);
    }
  }, [currentIndex]);

  // 保存当前输入题的答案
  const saveInputAnswer = useCallback(() => {
    if (!currentQuestion) return;
    if (['listening', 'spelling', 'sentence_fill'].includes(currentQuestion.type) && inputValue.trim()) {
      setAnswers(prev => new Map(prev).set(currentQuestion.id, inputValue.trim()));
    }
  }, [currentQuestion, inputValue]);

  // 选择题选择
  const handleSelectOption = (option: string) => {
    if (!currentQuestion) return;
    setAnswers(prev => new Map(prev).set(currentQuestion.id, option));
    // 自动跳下一题
    setTimeout(() => {
      if (currentIndex < (examData?.questions.length || 0) - 1) {
        setCurrentIndex(currentIndex + 1);
      }
    }, 400);
  };

  // 输入题下一题
  const handleInputNext = () => {
    saveInputAnswer();
    if (currentIndex < (examData?.questions.length || 0) - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  // 听写题播放（通过 word_id，不泄露答案）
  const playListeningAudio = useCallback(() => {
    if (!currentQuestion || playCount >= 3) return;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    const url = `${API_BASE_URL}/pronunciation/edge-tts?word_id=${currentQuestion.word_id}`;
    const audio = new Audio(url);
    audioRef.current = audio;
    audio.play()
      .then(() => setPlayCount(prev => prev + 1))
      .catch(console.error);
  }, [currentQuestion, playCount]);

  // 提交考试
  const handleSubmit = async () => {
    if (!examData || phase === 'submitting') return;
    saveInputAnswer();
    setPhase('submitting');

    const answerList: ExamAnswerItem[] = [];
    // 确保输入题的最新值也被保存
    const finalAnswers = new Map(answers);
    if (currentQuestion && ['listening', 'spelling', 'sentence_fill'].includes(currentQuestion.type) && inputValue.trim()) {
      finalAnswers.set(currentQuestion.id, inputValue.trim());
    }

    for (const q of examData.questions) {
      answerList.push({
        question_id: q.id,
        answer: finalAnswers.get(q.id) || '',
      });
    }

    try {
      const timeSpent = Math.floor((Date.now() - startTime) / 1000);
      const result = await submitExam(examData.exam_id, answerList, timeSpent);
      // 跳转到成绩页
      navigate(`/student/exam/result/${result.paper_id}`, {
        state: { result, unitId },
      });
    } catch (err: any) {
      console.error('提交失败:', err);
      const msg = err?.response?.data?.detail || '提交失败，请重试';
      toast.error(msg);
      setPhase('testing');
    }
  };
  handleSubmitRef.current = handleSubmit;

  // 开始考试
  const handleStart = () => {
    setPhase('testing');
    setStartTime(Date.now());
    setCurrentIndex(0);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-yellow-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          <p className="text-gray-500 mt-4">正在出题...</p>
        </div>
      </div>
    );
  }

  if (error || !examData) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-yellow-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-md text-center">
          <span className="text-5xl">😅</span>
          <h3 className="text-xl font-bold text-gray-800 mt-4 mb-2">出题失败</h3>
          <p className="text-gray-500 mb-4">{error || '请稍后重试'}</p>
          <button onClick={() => navigate(-1)} className="px-6 py-2 bg-primary text-white rounded-xl">返回</button>
        </div>
      </div>
    );
  }

  // 开始页
  if (phase === 'start') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-3xl shadow-xl p-8 max-w-md w-full text-center"
        >
          <div className="text-6xl mb-4">📝</div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">{examData.unit_name}</h2>
          <p className="text-gray-500 mb-6">单元测验</p>

          <div className="grid grid-cols-3 gap-4 mb-8">
            <div className="bg-blue-50 rounded-xl p-3">
              <div className="text-2xl font-bold text-blue-600">{examData.question_count}</div>
              <div className="text-xs text-gray-500">题目</div>
            </div>
            <div className="bg-green-50 rounded-xl p-3">
              <div className="text-2xl font-bold text-green-600">{examData.total_score}</div>
              <div className="text-xs text-gray-500">总分</div>
            </div>
            <div className="bg-orange-50 rounded-xl p-3">
              <div className="text-2xl font-bold text-orange-600">{Math.floor(examData.time_limit / 60)}</div>
              <div className="text-xs text-gray-500">分钟</div>
            </div>
          </div>

          <div className="text-left mb-6 space-y-2 text-sm text-gray-600">
            <p>📌 英译中选择 × 5 + 中译英选择 × 5</p>
            <p>📌 听写 × 4 + 拼写填空 × 4</p>
            <p>📌 例句填空 × 2</p>
          </div>

          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={handleStart}
            className="w-full py-4 bg-gradient-to-r from-blue-500 to-indigo-600 text-white text-lg font-bold rounded-2xl shadow-lg hover:shadow-xl transition"
          >
            开始考试
          </motion.button>
        </motion.div>
      </div>
    );
  }

  // 答题页
  const answeredCount = answers.size;
  const totalQuestions = examData.questions.length;
  const isUrgent = timeLeft <= 60;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50">
      {/* 顶部栏 */}
      <nav className="bg-white/90 backdrop-blur-md shadow-sm sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <button onClick={() => navigate(-1)} className="flex items-center gap-1 text-gray-500 hover:text-gray-700">
              <ArrowLeft className="w-4 h-4" />
              <span className="text-sm">退出</span>
            </button>

            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">
                {currentIndex + 1} / {totalQuestions}
              </span>
              <span className={`text-sm font-mono font-bold px-3 py-1 rounded-full ${
                isUrgent ? 'bg-red-100 text-red-600 animate-pulse' : 'bg-blue-100 text-blue-600'
              }`}>
                {formatTime(timeLeft)}
              </span>
            </div>

            <button
              onClick={handleSubmit}
              disabled={phase === 'submitting'}
              className="px-4 py-1.5 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition disabled:opacity-50"
            >
              {phase === 'submitting' ? '提交中...' : '交卷'}
            </button>
          </div>

          {/* 进度条 */}
          <div className="h-1 bg-gray-100 rounded-full mt-2">
            <motion.div
              className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full"
              animate={{ width: `${(answeredCount / totalQuestions) * 100}%` }}
            />
          </div>
        </div>
      </nav>

      {/* 题目内容 */}
      <div className="max-w-2xl mx-auto px-4 py-6">
        <AnimatePresence mode="wait">
          {currentQuestion && (
            <motion.div
              key={currentQuestion.id}
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -30 }}
              transition={{ duration: 0.2 }}
              className="bg-white rounded-2xl shadow-lg p-6"
            >
              {/* 题型标签 */}
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs px-3 py-1 rounded-full bg-blue-100 text-blue-600 font-medium">
                  {EXAM_TYPE_LABELS[currentQuestion.type] || currentQuestion.type}
                </span>
                <span className="text-sm text-gray-400">{currentQuestion.score} 分</span>
              </div>

              {/* 选择题（英译中 / 中译英） */}
              {(currentQuestion.type === 'en_to_cn' || currentQuestion.type === 'cn_to_en') && (
                <div>
                  <h3 className={`${currentQuestion.type === 'en_to_cn' ? 'text-3xl' : 'text-2xl'} font-bold text-gray-800 text-center mb-8`}>{currentQuestion.prompt}</h3>
                  <div className="grid grid-cols-1 gap-3">
                    {currentQuestion.options?.map((opt, i) => {
                      const isSelected = answers.get(currentQuestion.id) === opt;
                      return (
                        <motion.button
                          key={i}
                          whileHover={{ scale: 1.01 }}
                          whileTap={{ scale: 0.99 }}
                          onClick={() => handleSelectOption(opt)}
                          className={`w-full text-left p-4 rounded-xl border-2 transition font-medium ${
                            isSelected
                              ? 'border-blue-500 bg-blue-50 text-blue-700'
                              : 'border-gray-200 hover:border-gray-300 text-gray-700'
                          }`}
                        >
                          <span className="text-gray-400 mr-3">{String.fromCharCode(65 + i)}.</span>
                          {opt}
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 听写 */}
              {currentQuestion.type === 'listening' && (
                <div className="text-center">
                  <p className="text-gray-500 mb-6">听发音，写出单词</p>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={playListeningAudio}
                    disabled={playCount >= 3}
                    className={`w-20 h-20 rounded-full flex items-center justify-center text-4xl mx-auto mb-4 shadow-lg transition ${
                      playCount >= 3
                        ? 'bg-gray-200 cursor-not-allowed'
                        : 'bg-gradient-to-br from-blue-500 to-indigo-600 hover:shadow-xl'
                    }`}
                  >
                    🔊
                  </motion.button>
                  <p className="text-xs text-gray-400 mb-6">可播放 {3 - playCount} 次</p>
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleInputNext()}
                    placeholder="输入你听到的单词"
                    className="w-full text-center text-2xl font-bold border-b-2 border-gray-300 focus:border-blue-500 outline-none py-3 bg-transparent"
                    autoComplete="off"
                  />
                </div>
              )}

              {/* 拼写填空 */}
              {currentQuestion.type === 'spelling' && (
                <div className="text-center">
                  <p className="text-gray-500 mb-2">根据释义写出单词</p>
                  <h3 className="text-xl font-bold text-gray-800 mb-2">{currentQuestion.prompt}</h3>
                  <p className="text-sm text-blue-500 mb-6">
                    提示: <span className="font-mono font-bold tracking-widest">{currentQuestion.hint}</span>
                    <span className="text-gray-400 ml-2">({currentQuestion.word_length} 个字母)</span>
                  </p>
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleInputNext()}
                    placeholder="输入完整单词"
                    maxLength={(currentQuestion.word_length || 20) + 5}
                    className="w-full text-center text-2xl font-bold border-b-2 border-gray-300 focus:border-blue-500 outline-none py-3 bg-transparent"
                    autoComplete="off"
                  />
                </div>
              )}

              {/* 例句填空 */}
              {currentQuestion.type === 'sentence_fill' && (
                <div className="text-center">
                  <p className="text-gray-500 mb-2">根据提示填入正确单词</p>
                  <p className="text-lg text-gray-800 mb-2 leading-relaxed italic">
                    "{currentQuestion.prompt}"
                  </p>
                  <p className="text-sm text-blue-500 mb-6">提示: {currentQuestion.hint}</p>
                  <input
                    ref={inputRef}
                    type="text"
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleInputNext()}
                    placeholder="填入单词"
                    className="w-full text-center text-2xl font-bold border-b-2 border-gray-300 focus:border-blue-500 outline-none py-3 bg-transparent"
                    autoComplete="off"
                  />
                </div>
              )}

              {/* 输入题的确认按钮 */}
              {['listening', 'spelling', 'sentence_fill'].includes(currentQuestion.type) && (
                <div className="mt-6 flex justify-center">
                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={handleInputNext}
                    className="px-8 py-3 bg-gradient-to-r from-blue-500 to-indigo-600 text-white font-medium rounded-xl shadow-md"
                  >
                    {currentIndex < totalQuestions - 1 ? '下一题 →' : '完成'}
                  </motion.button>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* 底部题号导航 */}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {examData.questions.map((q, i) => {
            const isAnswered = answers.has(q.id);
            const isCurrent = i === currentIndex;
            return (
              <button
                key={q.id}
                onClick={() => { saveInputAnswer(); setCurrentIndex(i); }}
                className={`w-9 h-9 rounded-lg text-sm font-medium transition ${
                  isCurrent
                    ? 'bg-blue-500 text-white shadow-md'
                    : isAnswered
                    ? 'bg-green-100 text-green-700 border border-green-300'
                    : 'bg-white text-gray-500 border border-gray-200 hover:border-gray-300'
                }`}
              >
                {i + 1}
              </button>
            );
          })}
        </div>

        {/* 未答题提醒 */}
        {answeredCount < totalQuestions && (
          <p className="text-center text-sm text-gray-400 mt-3">
            已答 {answeredCount}/{totalQuestions}，还有 {totalQuestions - answeredCount} 题未答
          </p>
        )}
      </div>
    </div>
  );
};

export default UnitExam;
