import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import useGoBack from '../hooks/useGoBack';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  FileCheck2,
  Headphones,
  PenLine,
  RefreshCw,
  Volume2,
} from 'lucide-react';
import {
  generateExam, submitExam,
  type ExamData, type ExamAnswerItem,
  EXAM_TYPE_LABELS,
} from '../api/unitExam';
import { API_BASE_URL } from '../config/env';
import { toast } from '../components/Toast';
import usePresence from '../hooks/usePresence';
import { usePreventCopy } from '../hooks/usePreventCopy';
import { imeSafeInputProps } from '../utils/noSuggestInput';
import { getErrorMessage } from '../utils/errorMessage';

type ExamPhase = 'start' | 'testing' | 'submitting';

const isInputQuestion = (type: string) => (
  type === 'listening' || type === 'spelling' || type === 'sentence_fill'
);

const UnitExam = () => {
  usePreventCopy();  // 防划走答案:禁右键/复制/选中(输入框内放行)
  const { unitId } = useParams<{ unitId: string }>();
  const navigate = useNavigate();
  const goBack = useGoBack('/student/dashboard');

  const [phase, setPhase] = useState<ExamPhase>('start');
  const [examData, setExamData] = useState<ExamData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Map<number, string>>(new Map());
  const [timeLeft, setTimeLeft] = useState(900);
  const [startTime, setStartTime] = useState(0);
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);

  // 实时课堂:考试中也上报在线状态(考试切屏更要盯)
  usePresence({
    unitId: unitId ? parseInt(unitId) : undefined,
    unitName: examData?.unit_name ? `${examData.unit_name}(考试)` : '考试中',
    idle: false,  // 考试页有倒计时,不做无操作判定
    enabled: phase === 'testing',
  });

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
    } catch (err: unknown) {
      setError(getErrorMessage(err, '加载试卷失败'));
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
    if (isInputQuestion(currentQuestion.type)) {
      setAnswers(prev => {
        const next = new Map(prev);
        const answer = inputValue.trim();
        if (answer) {
          next.set(currentQuestion.id, answer);
        } else {
          next.delete(currentQuestion.id);
        }
        return next;
      });
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
    setShowSubmitDialog(false);
    setPhase('submitting');

    const answerList: ExamAnswerItem[] = [];
    // 确保输入题的最新值也被保存
    const finalAnswers = new Map(answers);
    if (currentQuestion && isInputQuestion(currentQuestion.type)) {
      if (inputValue.trim()) {
        finalAnswers.set(currentQuestion.id, inputValue.trim());
      } else {
        finalAnswers.delete(currentQuestion.id);
      }
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
    } catch (err: unknown) {
      console.error('提交失败:', err);
      const msg = getErrorMessage(err, '提交失败，请重试');
      toast.error(msg);
      setPhase('testing');
    }
  };
  handleSubmitRef.current = () => { void handleSubmit(); };

  // 开始考试
  const handleStart = () => {
    setPhase('testing');
    setStartTime(Date.now());
    setCurrentIndex(0);
  };

  const handleExit = () => {
    if (phase === 'testing' && answers.size > 0) {
      const shouldExit = window.confirm('退出后，本次未交卷的答案不会保留。确定退出吗？');
      if (!shouldExit) return;
    }
    goBack();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-paper no-select px-4 py-12" aria-busy="true" aria-label="正在生成单元考试">
        <div className="mx-auto max-w-md overflow-hidden rounded-2xl bg-white p-6 sm:p-8">
          <div className="mx-auto mb-5 h-14 w-14 animate-pulse rounded-2xl bg-orange-50" />
          <div className="mx-auto mb-3 h-7 w-44 animate-pulse rounded bg-slate-100" />
          <div className="mx-auto mb-8 h-4 w-56 animate-pulse rounded bg-slate-100" />
          <div className="mb-7 grid grid-cols-3 divide-x divide-black/[0.06] py-4">
            {[0, 1, 2].map((item) => <div key={item} className="mx-auto h-10 w-16 animate-pulse rounded bg-slate-100" />)}
          </div>
          <div className="h-12 animate-pulse rounded-xl bg-slate-100" />
        </div>
      </div>
    );
  }

  if (error || !examData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper p-4 no-select">
        <div className="card-soft w-full max-w-md rounded-2xl p-7 text-center sm:p-9" role="alert">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 text-accent-warm">
            <RefreshCw className="h-8 w-8" aria-hidden="true" />
          </div>
          <h3 className="font-display text-xl font-semibold text-ink">试卷暂时没准备好</h3>
          <p className="mt-2 text-sm leading-6 text-ink-soft">{error || '请稍后重试'}</p>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => goBack()}
              className="min-h-11 rounded-xl border border-black/10 px-5 text-sm font-semibold text-ink transition hover:bg-black/[0.04]"
            >
              返回单元
            </button>
            <button
              type="button"
              onClick={() => unitId && void loadExam(parseInt(unitId))}
              className="min-h-11 rounded-xl bg-accent-warm px-5 text-sm font-semibold text-white transition hover:opacity-90"
            >
              重新出题
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 开始页
  if (phase === 'start') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper p-4 no-select">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-lg overflow-hidden rounded-2xl bg-white"
        >
          <div className="student-colorful-surface border-b border-orange-100 p-6 text-center sm:p-8">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 text-accent-warm">
              <FileCheck2 className="h-8 w-8" aria-hidden="true" />
            </div>
            <h1 className="font-display text-2xl font-semibold text-ink sm:text-3xl">{examData.unit_name}</h1>
            <p className="mt-2 text-sm text-ink-soft">完成一次单元检查，看看哪些词还需要巩固。</p>
          </div>

          <div className="p-5 sm:p-7">
            <div className="mb-7 grid grid-cols-3 divide-x divide-black/[0.06] rounded-xl bg-slate-50 py-4">
              {[
                { label: '题目', value: examData.question_count },
                { label: '总分', value: examData.total_score },
                { label: '分钟', value: Math.floor(examData.time_limit / 60) },
              ].map((item) => (
                <div key={item.label} className="text-center">
                  <p className="font-numeric text-2xl font-semibold text-ink">{item.value}</p>
                  <p className="mt-1 text-xs text-ink-mute">{item.label}</p>
                </div>
              ))}
            </div>

            <div className="mb-7 space-y-3 text-sm text-ink-soft">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-accent-warm" aria-hidden="true" />
                英译中与中译英选择题
              </div>
              <div className="flex items-center gap-3">
                <Headphones className="h-4 w-4 shrink-0 text-accent-warm" aria-hidden="true" />
                听写与拼写填空
              </div>
              <div className="flex items-center gap-3">
                <PenLine className="h-4 w-4 shrink-0 text-accent-warm" aria-hidden="true" />
                根据例句完成填空
              </div>
            </div>

            <div className="flex flex-col-reverse gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => goBack()}
                className="min-h-12 flex-1 rounded-xl border border-black/10 font-semibold text-ink transition hover:bg-black/[0.04]"
              >
                稍后再做
              </button>
              <motion.button
                whileTap={{ scale: 0.98 }}
                onClick={handleStart}
                className="btn-glow min-h-12 flex-1 rounded-xl text-base font-semibold text-white"
              >
                开始考试
              </motion.button>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  // 答题页
  const totalQuestions = examData.questions.length;
  const currentDraftQuestionId = currentQuestion
    && isInputQuestion(currentQuestion.type)
    && inputValue.trim()
    && !answers.has(currentQuestion.id)
      ? currentQuestion.id
      : null;
  const answeredCount = answers.size + (currentDraftQuestionId ? 1 : 0);
  const unansweredIndexes = examData.questions.reduce<number[]>((indexes, question, index) => {
    if (!answers.has(question.id) && question.id !== currentDraftQuestionId) indexes.push(index);
    return indexes;
  }, []);
  const unansweredCount = unansweredIndexes.length;
  const isUrgent = timeLeft <= 60;

  const goToQuestion = (index: number) => {
    saveInputAnswer();
    setCurrentIndex(index);
  };

  const requestSubmit = () => {
    saveInputAnswer();
    setShowSubmitDialog(true);
  };

  return (
    <div className="min-h-screen bg-paper no-select">
      {/* 顶部栏 */}
      <nav className="bg-white/95 backdrop-blur-md border-b border-slate-200/80 sticky top-0 z-20">
        <div className="mx-auto max-w-5xl px-3 py-3 sm:px-4">
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={handleExit}
              className="inline-flex min-h-11 items-center gap-1 rounded-lg px-2 text-ink-soft transition hover:bg-orange-50 hover:text-accent-warm"
            >
              <ArrowLeft className="h-4 w-4" />
              <span className="text-sm font-medium">退出</span>
            </button>

            <div className="flex items-center gap-2 sm:gap-3">
              <span className="hidden text-sm text-gray-500 sm:inline">
                第 {currentIndex + 1} / {totalQuestions} 题
              </span>
              <span className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 font-numeric text-sm font-bold ${
                isUrgent ? 'bg-red-100 text-red-600' : 'bg-orange-50 text-accent-warm'
              }`}>
                <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
                {formatTime(timeLeft)}
              </span>
            </div>

            <button
              type="button"
              onClick={requestSubmit}
              disabled={phase === 'submitting'}
              className="min-h-11 rounded-lg bg-accent-warm px-4 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {phase === 'submitting' ? '提交中...' : '交卷'}
            </button>
          </div>

          {/* 进度条 */}
          <div className="mt-2 flex items-center gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
            <motion.div
              className="h-full rounded-full bg-accent-warm"
              animate={{ width: `${totalQuestions > 0 ? (answeredCount / totalQuestions) * 100 : 0}%` }}
            />
            </div>
            <span className="min-w-fit font-numeric text-xs font-semibold text-ink-mute">
              已答 {answeredCount}/{totalQuestions}
            </span>
          </div>
        </div>
      </nav>

      {/* 题目内容 */}
      <div className="mx-auto max-w-5xl px-4 py-5 sm:py-6">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_17rem] lg:items-start">
          <main className="min-w-0">
            <AnimatePresence mode="wait">
              {currentQuestion && (
                <motion.div
                  key={currentQuestion.id}
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -24 }}
                  transition={{ duration: 0.2 }}
                  className="card-soft rounded-2xl p-5 sm:p-7"
                >
              {/* 题型标签 */}
              <div className="mb-5 flex items-center justify-between">
                <span className="rounded-full bg-orange-50 px-3 py-1 text-xs font-medium text-accent-warm">
                  {EXAM_TYPE_LABELS[currentQuestion.type] || currentQuestion.type}
                </span>
                <span className="font-numeric text-sm text-ink-mute">第 {currentIndex + 1} 题 · {currentQuestion.score} 分</span>
              </div>

              {/* 选择题（英译中 / 中译英） */}
              {(currentQuestion.type === 'en_to_cn' || currentQuestion.type === 'cn_to_en') && (
                <div>
                  <h1 className={`${currentQuestion.type === 'en_to_cn' ? 'text-3xl' : 'text-2xl'} mb-8 break-words text-center font-display font-semibold leading-tight text-ink`}>{currentQuestion.prompt}</h1>
                  <div className="grid grid-cols-1 gap-3">
                    {currentQuestion.options?.map((opt, i) => {
                      const isSelected = answers.get(currentQuestion.id) === opt;
                      return (
                        <motion.button
                          key={i}
                          whileHover={{ scale: 1.01 }}
                          whileTap={{ scale: 0.99 }}
                          onClick={() => handleSelectOption(opt)}
                          className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border-2 p-4 text-left font-medium transition ${
                            isSelected
                              ? 'border-orange-400 bg-orange-50 text-orange-800'
                              : 'border-gray-200 text-gray-700 hover:border-orange-300 hover:bg-orange-50/60'
                          }`}
                          aria-pressed={isSelected}
                        >
                          <span className="flex min-w-0 items-center">
                            <span className={`mr-3 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-sm ${isSelected ? 'bg-orange-500 text-white' : 'bg-slate-100 text-ink-mute'}`}>
                              {String.fromCharCode(65 + i)}
                            </span>
                            <span className="break-words">{opt}</span>
                          </span>
                          {isSelected && <CheckCircle2 className="h-5 w-5 shrink-0 text-orange-500" aria-hidden="true" />}
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
                    className={`mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-2xl transition ${
                      playCount >= 3
                        ? 'bg-gray-200 cursor-not-allowed'
                        : 'bg-accent-warm text-white hover:opacity-90'
                    }`}
                    aria-label="播放听写发音"
                  >
                    <Volume2 className="h-8 w-8" aria-hidden="true" />
                  </motion.button>
                  <p className="text-xs text-gray-400 mb-6">可播放 {3 - playCount} 次</p>
                  <input
                    ref={inputRef}
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleInputNext()}
                    placeholder="输入你听到的单词"
                    className="w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-center text-2xl font-bold outline-none transition focus:border-orange-400 focus:ring-4 focus:ring-orange-100"
                    aria-label="输入你听到的单词"
                    {...imeSafeInputProps()}
                  />
                </div>
              )}

              {/* 拼写填空 */}
              {currentQuestion.type === 'spelling' && (
                <div className="text-center">
                  <p className="text-gray-500 mb-2">根据释义写出单词</p>
                  <h3 className="text-xl font-bold text-gray-800 mb-2">{currentQuestion.prompt}</h3>
                  <p className="mb-6 text-sm text-accent-warm">
                    提示: <span className="font-mono font-bold tracking-widest">{currentQuestion.hint}</span>
                    <span className="text-gray-400 ml-2">({currentQuestion.word_length} 个字母)</span>
                  </p>
                  <input
                    ref={inputRef}
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleInputNext()}
                    placeholder="输入完整单词"
                    maxLength={(currentQuestion.word_length || 20) + 5}
                    className="w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-center text-2xl font-bold outline-none transition focus:border-orange-400 focus:ring-4 focus:ring-orange-100"
                    aria-label="输入完整单词"
                    {...imeSafeInputProps()}
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
                  <p className="mb-6 text-sm text-accent-warm">提示: {currentQuestion.hint}</p>
                  <input
                    ref={inputRef}
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleInputNext()}
                    placeholder="填入单词"
                    className="w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-center text-2xl font-bold outline-none transition focus:border-orange-400 focus:ring-4 focus:ring-orange-100"
                    aria-label="填入正确单词"
                    {...imeSafeInputProps()}
                  />
                </div>
              )}

              {/* 输入题的确认按钮 */}
              {isInputQuestion(currentQuestion.type) && (
                <div className="mt-6 flex justify-center">
                  <motion.button
                    whileHover={{ scale: 1.03 }}
                    whileTap={{ scale: 0.97 }}
                    onClick={handleInputNext}
                    className="min-h-12 rounded-xl bg-accent-warm px-8 font-semibold text-white transition hover:opacity-90"
                  >
                    {currentIndex < totalQuestions - 1 ? '保存并下一题' : '保存答案'}
                  </motion.button>
                </div>
              )}
                </motion.div>
              )}
            </AnimatePresence>
          </main>

          {/* 正式答题卡 */}
          <aside
            id="exam-answer-sheet"
            className="card-soft scroll-mt-24 rounded-2xl p-4 sm:p-5 lg:sticky lg:top-24"
            aria-labelledby="answer-sheet-title"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="answer-sheet-title" className="font-display text-lg font-semibold text-ink">答题卡</h2>
                <p className="mt-1 text-xs text-ink-mute">点击题号可快速检查</p>
              </div>
              <span className="rounded-lg bg-orange-50 px-2.5 py-1 font-numeric text-sm font-semibold text-accent-warm">
                {answeredCount}/{totalQuestions}
              </span>
            </div>

            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs text-ink-mute" aria-label="答题状态图例">
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-accent-warm" />当前</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />已答</span>
              <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm border border-slate-300 bg-white" />未答</span>
            </div>

            <div className="mt-4 grid grid-cols-5 gap-2 sm:grid-cols-8 lg:grid-cols-4">
              {examData.questions.map((question, index) => {
                const isAnswered = answers.has(question.id) || question.id === currentDraftQuestionId;
                const isCurrent = index === currentIndex;
                const statusText = isCurrent ? '当前题' : isAnswered ? '已作答' : '未作答';
                return (
                  <button
                    key={question.id}
                    type="button"
                    onClick={() => goToQuestion(index)}
                    className={`min-h-11 rounded-xl border text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-orange-100 ${
                      isCurrent
                        ? 'border-accent-warm bg-accent-warm text-white shadow-sm'
                        : isAnswered
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:border-emerald-300'
                        : 'border-slate-200 bg-white text-ink-soft hover:border-orange-300 hover:bg-orange-50/50'
                    }`}
                    aria-label={`第 ${index + 1} 题，${statusText}`}
                    aria-current={isCurrent ? 'step' : undefined}
                  >
                    {index + 1}
                  </button>
                );
              })}
            </div>

            <div className={`mt-4 rounded-xl px-3 py-2.5 text-sm ${
              unansweredCount > 0 ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-700'
            }`} aria-live="polite">
              {unansweredCount > 0
                ? `还有 ${unansweredCount} 题未作答，交卷前记得检查。`
                : '全部题目都已作答，可以交卷啦。'}
            </div>

            {unansweredCount > 0 && (
              <button
                type="button"
                onClick={() => goToQuestion(unansweredIndexes[0])}
                className="mt-3 min-h-11 w-full rounded-xl border border-orange-200 bg-orange-50 text-sm font-semibold text-accent-warm transition hover:bg-orange-100"
              >
                去第一道未答题
              </button>
            )}

            <button
              type="button"
              onClick={requestSubmit}
              disabled={phase === 'submitting'}
              className="btn-glow mt-3 min-h-12 w-full rounded-xl text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {phase === 'submitting' ? '正在交卷…' : '检查完毕，交卷'}
            </button>
          </aside>
        </div>
      </div>

      <AnimatePresence>
        {showSubmitDialog && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/35 p-0 sm:items-center sm:p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            role="presentation"
            onClick={() => setShowSubmitDialog(false)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setShowSubmitDialog(false);
            }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby="submit-dialog-title"
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 16, scale: 0.98 }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-6"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-orange-50 text-accent-warm">
                <FileCheck2 className="h-6 w-6" aria-hidden="true" />
              </div>
              <h2 id="submit-dialog-title" className="text-center font-display text-xl font-semibold text-ink">确认交卷</h2>
              <p className="mt-2 text-center text-sm leading-6 text-ink-soft">
                {unansweredCount > 0
                  ? `目前已答 ${answeredCount} 题，还有 ${unansweredCount} 题未作答。交卷后不能修改答案。`
                  : `共 ${totalQuestions} 题已全部作答。交卷后不能修改答案。`}
              </p>

              <div className="mt-5 grid grid-cols-2 gap-3 rounded-xl bg-slate-50 p-3 text-center">
                <div>
                  <p className="font-numeric text-xl font-semibold text-emerald-600">{answeredCount}</p>
                  <p className="mt-0.5 text-xs text-ink-mute">已作答</p>
                </div>
                <div>
                  <p className={`font-numeric text-xl font-semibold ${unansweredCount > 0 ? 'text-amber-600' : 'text-ink-mute'}`}>{unansweredCount}</p>
                  <p className="mt-0.5 text-xs text-ink-mute">未作答</p>
                </div>
              </div>

              <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setShowSubmitDialog(false)}
                  className="min-h-12 flex-1 rounded-xl border border-slate-200 font-semibold text-ink transition hover:bg-slate-50"
                  autoFocus
                >
                  继续检查
                </button>
                <button
                  type="button"
                  onClick={() => void handleSubmit()}
                  className="min-h-12 flex-1 rounded-xl bg-accent-warm font-semibold text-white transition hover:opacity-90"
                >
                  确认交卷
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default UnitExam;
