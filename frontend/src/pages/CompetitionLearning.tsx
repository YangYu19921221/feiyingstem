/**
 * 竞赛模式学习页面 - 对齐教师端数据结构
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  CheckCircle2,
  CircleAlert,
  FileText,
  Flame,
  Languages,
  LoaderCircle,
  PenLine,
  RefreshCw,
  Sparkles,
  Trophy,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import axios from 'axios';
import api from '../api/client';
import LiveLeaderboard from '../components/LiveLeaderboard';
import RankNotification from '../components/RankNotification';
import RankBadge, { type RankInfo } from '../components/RankBadge';
import { competitionWS } from '../services/websocket';
import { toast } from '../components/Toast';
import { getErrorMessage } from '../utils/errorMessage';
import { noSuggestInputProps, imeSafeInputProps } from '../utils/noSuggestInput';
import { usePreventCopy } from '../hooks/usePreventCopy';
import useGoBack from '../hooks/useGoBack';

// 题目选项接口
interface QuestionOption {
  id: number;
  option_key: string;
  option_text: string;
  display_order: number;
}

// 竞赛题目接口 - 对齐后端CompetitionQuestion
interface CompetitionQuestion {
  id: number;
  question_type: 'choice' | 'fill_blank' | 'spelling' | 'reading';
  title?: string;
  content: string;
  passage?: string;
  difficulty: 'easy' | 'medium' | 'hard';
  word_id?: number;
  options: QuestionOption[];
  source: string;
  tags?: string;
}

// 答题状态接口
interface QuestionState extends CompetitionQuestion {
  startTime: number;
  userAnswer?: string;
}

interface CompetitionTodayStats {
  score: number;
  questions_answered: number;
  accuracy_rate: number;
  rank: number | null;
  max_combo: number;
}

interface CompetitionStats {
  today?: CompetitionTodayStats;
}

interface CompetitionFeedback {
  result: {
    is_correct: boolean;
    total_score: number;
    base_score: number;
    difficulty_bonus: number;
    speed_bonus: number;
    combo_bonus: number;
    multiplier: number;
    rank_change: number;
  };
  correct_answer?: string | { key: string; text: string };
  answer_explanation?: string;
  rank_tier?: {
    tier_emoji: string;
    tier_label: string;
    points_delta: number;
    promoted: boolean;
  };
}

const QUESTION_TYPE_META: Record<CompetitionQuestion['question_type'], { label: string; icon: LucideIcon }> = {
  choice: { label: '选择题', icon: Languages },
  fill_blank: { label: '填空题', icon: PenLine },
  spelling: { label: '拼写题', icon: FileText },
  reading: { label: '阅读理解', icon: BookOpenText },
};

const DIFFICULTY_META: Record<CompetitionQuestion['difficulty'], { label: string; className: string }> = {
  easy: { label: '简单', className: 'bg-emerald-50 text-emerald-700' },
  medium: { label: '中等', className: 'bg-amber-50 text-amber-800' },
  hard: { label: '挑战', className: 'bg-orange-50 text-accent-warm' },
};

const CompetitionLearning: React.FC = () => {
  usePreventCopy();  // 防划走答案:禁右键/复制/选中(输入框内放行)
  const navigate = useNavigate();
  const goBack = useGoBack('/student/dashboard');
  const reduceMotion = useReducedMotion();
  const [token] = useState(localStorage.getItem('access_token') || '');
  const [currentQuestion, setCurrentQuestion] = useState<QuestionState | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackData, setFeedbackData] = useState<CompetitionFeedback | null>(null);
  const [myStats, setMyStats] = useState<CompetitionStats | null>(null);
  const [, setWsConnected] = useState(false);
  const [userAnswer, setUserAnswer] = useState('');
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false); // 是否答完所有题目
  const [rankInfo, setRankInfo] = useState<RankInfo | null>(null);

  // 连接WebSocket
  useEffect(() => {
    if (token) {
      competitionWS.connect(token, 1);

      // 监听连接状态
      const handleConnected = () => setWsConnected(true);
      competitionWS.on('connected', handleConnected);

      return () => {
        competitionWS.off('connected', handleConnected);
        competitionWS.disconnect();
      };
    }
  }, [token]);

  const fetchMyStats = useCallback(async () => {
    try {
      const data = await api.get('/competition/my-stats', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMyStats(data);
    } catch (error) {
      console.error('获取统计失败:', error);
    }
  }, [token]);

  const fetchRankInfo = useCallback(async () => {
    try {
      const data = await api.get('/competition/my-rank?season_id=1', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRankInfo(data);
    } catch (error) {
      console.error('获取段位失败:', error);
    }
  }, [token]);

  // 获取个人统计
  useEffect(() => {
    void fetchMyStats();
    void fetchRankInfo();
  }, [fetchMyStats, fetchRankInfo]);

  // 加载题目 - 从真实API获取
  const loadQuestion = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    setUserAnswer('');

    try {
      const response = await api.get('/competition/random-question', {
        headers: { Authorization: `Bearer ${token}` }
      });

      const question: CompetitionQuestion = response;

      // 添加答题开始时间
      const questionWithTime: QuestionState = {
        ...question,
        startTime: Date.now()
      };

      setCurrentQuestion(questionWithTime);
    } catch (error: unknown) {
      console.error('❌ 加载题目失败:', error);

      // 如果是404错误,说明没有更多题目了
      if (axios.isAxiosError(error) && error.response?.status === 404) {
        setIsCompleted(true);
        setLoading(false);
        return;
      }

      const errorMsg = getErrorMessage(error, '加载题目失败,请稍后重试');
      toast.error(errorMsg);
      setLoadError(errorMsg);
    } finally {
      setLoading(false);
    }
  }, [token]);

  // 提交答案
  const handleSubmitAnswer = async (answer: string) => {
    if (!currentQuestion || isSubmitting) return;

    // 设置选中状态
    setSelectedOption(answer);
    setIsSubmitting(true);

    const timeSpent = Date.now() - currentQuestion.startTime;

    // 延迟500ms,让用户看到选中效果
    await new Promise(resolve => setTimeout(resolve, 500));

    try {
      const response = await api.post(
        '/competition/submit-answer',
        {
          question_id: currentQuestion.id,
          user_answer: answer,
          time_spent_ms: timeSpent,
          season_id: 1
        },
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );

      // 显示答题反馈
      setFeedbackData(response);
      setShowFeedback(true);

      // 更新统计
      void fetchMyStats();
      void fetchRankInfo();
    } catch (error: unknown) {
      console.error('提交答案失败:', error);
      toast.error(getErrorMessage(error, '提交失败'));
      setIsSubmitting(false);
      setSelectedOption(null);
    }
  };

  // 关闭反馈,加载下一题
  const handleCloseFeedback = useCallback(() => {
    setShowFeedback(false);
    setFeedbackData(null);
    setSelectedOption(null);
    setIsSubmitting(false);
    void loadQuestion();
  }, [loadQuestion]);

  // 初始加载
  useEffect(() => {
    void loadQuestion();
  }, [loadQuestion]);

  useEffect(() => {
    if (!showFeedback) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') handleCloseFeedback();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleCloseFeedback, showFeedback]);

  // 渲染不同题型
  const renderQuestionContent = () => {
    if (!currentQuestion) return null;

    switch (currentQuestion.question_type) {
      case 'choice':
        return renderChoiceQuestion();
      case 'fill_blank':
        return renderFillBlankQuestion();
      case 'spelling':
        return renderSpellingQuestion();
      case 'reading':
        return renderReadingQuestion();
      default:
        return null;
    }
  };

  // 选择题
  const renderChoiceQuestion = () => {
    if (!currentQuestion) return null;

    return (
      <div className="space-y-6">
        {/* 题目内容 */}
        <div className="mb-6 text-center">
          {currentQuestion.title && (
            <h2 className="mb-4 break-words font-display text-2xl font-semibold text-ink sm:text-3xl">
              {currentQuestion.title}
            </h2>
          )}
          <p className="break-words text-xl leading-relaxed text-ink">{currentQuestion.content}</p>
        </div>

        {/* 选项 */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
          {currentQuestion.options.map((option) => {
            const isSelected = selectedOption === option.option_key;
            const correctAnswerKey = typeof feedbackData?.correct_answer === 'object'
              ? feedbackData.correct_answer.key
              : null;
            const isCorrect = correctAnswerKey === option.option_key;
            const isWrong = isSelected && feedbackData && !feedbackData.result.is_correct;

            // 动态设置样式
            let buttonStyle = "min-h-16 rounded-xl border p-4 text-base font-semibold transition-colors sm:min-h-20 sm:p-5 sm:text-lg ";
            let iconStyle = "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg font-numeric text-sm font-bold ";

            if (isSubmitting || feedbackData) {
              // 提交后或显示反馈时
              if (isCorrect) {
                // 正确答案 - 绿色
                buttonStyle += "border-emerald-300 bg-emerald-50 text-ink";
                iconStyle += "bg-emerald-600 text-white";
              } else if (isWrong) {
                // 选错的答案 - 红色
                buttonStyle += "border-red-300 bg-red-50 text-ink";
                iconStyle += "bg-red-500 text-white";
              } else if (isSelected) {
                // 选中但还未判断 - 蓝色
                buttonStyle += "border-orange-300 bg-orange-50 text-ink";
                iconStyle += "bg-accent-warm text-white";
              } else {
                // 未选中的选项 - 灰色禁用
                buttonStyle += "border-slate-200 bg-slate-50 text-ink-mute opacity-70";
                iconStyle += "bg-slate-200 text-ink-mute";
              }
              buttonStyle += " cursor-not-allowed";
            } else {
              // 未提交时 - 可选择状态
              buttonStyle += "border-slate-200 bg-white text-ink hover:border-orange-300 hover:bg-orange-50/50";
              iconStyle += "bg-slate-100 text-ink-soft";
            }

            return (
              <motion.button
                key={option.id}
                whileHover={!isSubmitting && !feedbackData ? { scale: 1.02 } : {}}
                whileTap={!isSubmitting && !feedbackData ? { scale: 0.98 } : {}}
                onClick={() => !isSubmitting && !feedbackData && handleSubmitAnswer(option.option_key)}
                className={buttonStyle}
                disabled={isSubmitting || !!feedbackData}
                aria-pressed={isSelected}
              >
                <div className="flex items-center gap-3">
                  <div className={iconStyle}>
                    {isCorrect && feedbackData
                      ? <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
                      : isWrong
                        ? <XCircle className="h-5 w-5" aria-hidden="true" />
                        : option.option_key}
                  </div>
                  <span className="min-w-0 flex-1 break-words text-left">{option.option_text}</span>
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>
    );
  };

  // 填空题
  const renderFillBlankQuestion = () => {
    if (!currentQuestion) return null;

    return (
      <div className="space-y-6">
        <div className="mb-6 text-center">
          <p className="whitespace-pre-wrap break-words text-xl leading-relaxed text-ink">{currentQuestion.content}</p>
        </div>

        <div className="max-w-md mx-auto">
          <input
            {...imeSafeInputProps()}
            value={userAnswer}
            onChange={(e) => setUserAnswer(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && userAnswer.trim() && void handleSubmitAnswer(userAnswer)}
            disabled={isSubmitting}
            aria-label="输入填空答案"
            className="allow-select h-14 w-full rounded-xl border border-slate-200 bg-white px-4 text-center text-lg font-semibold text-ink outline-none transition focus:border-accent-warm focus:ring-4 focus:ring-orange-100 disabled:bg-slate-50"
            placeholder="输入答案"
          />
          <button
            onClick={() => userAnswer.trim() && void handleSubmitAnswer(userAnswer)}
            disabled={!userAnswer.trim() || isSubmitting}
            className="btn-glow mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? <><LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />提交中…</> : <>提交答案<ArrowRight className="h-4 w-4" aria-hidden="true" /></>}
          </button>
        </div>
      </div>
    );
  };

  // 拼写题
  const renderSpellingQuestion = () => {
    if (!currentQuestion) return null;

    return (
      <div className="space-y-6">
        <div className="mb-6 text-center">
          <p className="mb-4 break-words text-xl leading-relaxed text-ink">{currentQuestion.content}</p>
          {currentQuestion.passage && (
            <div className="break-words text-lg italic leading-relaxed text-ink-soft">
              “{currentQuestion.passage}”
            </div>
          )}
        </div>

        <div className="max-w-md mx-auto">
          <input
            {...imeSafeInputProps()}
            value={userAnswer}
            onChange={(e) => setUserAnswer(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && userAnswer.trim() && void handleSubmitAnswer(userAnswer)}
            disabled={isSubmitting}
            aria-label="输入拼写答案"
            className="allow-select h-14 w-full rounded-xl border border-slate-200 bg-white px-4 text-center font-display text-xl font-semibold tracking-[0.06em] text-ink outline-none transition focus:border-accent-warm focus:ring-4 focus:ring-orange-100 disabled:bg-slate-50"
            placeholder="输入英文单词"
          />
          <button
            onClick={() => userAnswer.trim() && void handleSubmitAnswer(userAnswer)}
            disabled={!userAnswer.trim() || isSubmitting}
            className="btn-glow mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? <><LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />提交中…</> : <>提交拼写<ArrowRight className="h-4 w-4" aria-hidden="true" /></>}
          </button>
        </div>
      </div>
    );
  };

  // 阅读理解
  const renderReadingQuestion = () => {
    if (!currentQuestion) return null;

    return (
      <div className="space-y-6">
        {/* 阅读文章 */}
        {currentQuestion.passage && (
          <div className="mb-6 rounded-xl border border-orange-100 bg-orange-50/70 p-5 sm:p-6">
            <div className="flex items-center gap-2 mb-3">
              <BookOpenText className="h-5 w-5 text-accent-warm" aria-hidden="true" />
              <h3 className="text-lg font-bold text-ink">阅读文章</h3>
            </div>
            <div className="whitespace-pre-wrap break-words leading-7 text-ink">
              {currentQuestion.passage}
            </div>
          </div>
        )}

        {/* 问题 */}
        <div className="mb-6 text-center">
          <p className="break-words text-xl font-semibold leading-relaxed text-ink">{currentQuestion.content}</p>
        </div>

        {/* 选项(阅读理解通常是选择题形式) */}
        {currentQuestion.options.length > 0 ? (
          <div className="grid grid-cols-1 gap-3">
            {currentQuestion.options.map((option) => (
              <motion.button
                key={option.id}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={() => void handleSubmitAnswer(option.option_key)}
                disabled={isSubmitting}
                className="min-h-14 rounded-xl border border-slate-200 bg-white p-4 text-left font-semibold text-ink transition-colors hover:border-orange-300 hover:bg-orange-50/50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <div className="flex items-start gap-3">
                  <div className="font-numeric flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-sm font-bold text-ink-soft">
                    {option.option_key}
                  </div>
                  <span className="flex-1 pt-1">{option.option_text}</span>
                </div>
              </motion.button>
            ))}
          </div>
        ) : (
          <div className="max-w-md mx-auto">
            <textarea
              {...noSuggestInputProps()}
              value={userAnswer}
              onChange={(e) => setUserAnswer(e.target.value)}
              disabled={isSubmitting}
              aria-label="输入阅读题答案"
              className="allow-select w-full rounded-xl border border-slate-200 px-4 py-3 text-base text-ink outline-none transition focus:border-accent-warm focus:ring-4 focus:ring-orange-100 disabled:bg-slate-50"
              rows={3}
              placeholder="输入答案"
            />
            <button
              onClick={() => userAnswer.trim() && void handleSubmitAnswer(userAnswer)}
              disabled={!userAnswer.trim() || isSubmitting}
              className="btn-glow mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? <><LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />提交中…</> : <>提交答案<ArrowRight className="h-4 w-4" aria-hidden="true" /></>}
            </button>
          </div>
        )}
      </div>
    );
  };

  // 完成界面
  const renderCompletionScreen = () => {
    return (
      <div className="card-soft rounded-2xl p-5 text-center sm:p-8">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
          <Trophy className="h-8 w-8" aria-hidden="true" />
        </div>
        <h2 className="font-display text-2xl font-semibold leading-tight text-ink sm:text-3xl">这一轮完成了</h2>
        <p className="mt-2 text-sm leading-6 text-ink-soft">今天的可用题目已经全部答完，休息一下再继续挑战。</p>

        {myStats?.today && (
          <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-black/[0.06] text-center sm:grid-cols-5">
            {[
              { label: '今日积分', value: myStats.today.score || 0, accent: true },
              { label: '答题数', value: myStats.today.questions_answered || 0 },
              { label: '正确率', value: `${(myStats.today.accuracy_rate || 0).toFixed(0)}%` },
              { label: '今日排名', value: myStats.today.rank ? `#${myStats.today.rank}` : '—' },
              { label: '最高连击', value: myStats.today.max_combo || 0 },
            ].map((item) => (
              <div key={item.label} className="bg-slate-50 px-3 py-4 last:col-span-2 sm:last:col-span-1">
                <p className={`font-numeric text-xl font-semibold ${item.accent ? 'text-accent-warm' : 'text-ink'}`}>{item.value}</p>
                <p className="mt-1 text-xs text-ink-mute">{item.label}</p>
              </div>
            ))}
          </div>
        )}

        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            onClick={() => navigate('/student/dashboard')}
            className="min-h-12 rounded-xl border border-black/10 text-base font-semibold text-ink transition hover:bg-black/[0.04]"
          >
            返回首页
          </button>
          <button
            onClick={() => {
              setIsCompleted(false);
              loadQuestion();
            }}
            className="btn-glow min-h-12 rounded-xl text-base font-semibold text-white"
          >
            再来一轮
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-paper">
      <nav className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur" aria-label="竞赛学习导航">
        <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3.5">
          <button
            type="button"
            onClick={() => goBack()}
            className="-ml-2 flex h-11 w-11 items-center justify-center rounded-xl text-ink-soft transition hover:bg-orange-50 hover:text-accent-warm"
            aria-label="返回"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="font-display text-lg font-semibold text-ink sm:text-xl">竞赛练习</h1>
            <p className="hidden text-xs text-ink-mute sm:block">答题得分，和同学一起进步</p>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:py-8">
        <motion.section
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.42, ease: [0.16, 1, 0.3, 1] }}
          className="student-colorful-surface mb-6 grid gap-5 rounded-2xl border border-orange-100 p-5 sm:p-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
        >
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-orange-50 text-accent-warm">
              <Trophy className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <h2 className="font-display text-2xl font-semibold text-ink">专心答好当前这一题</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-ink-soft">答对、速度和连击都会加分。先保证正确，再慢慢提速。</p>
            </div>
          </div>
          {myStats?.today && (
            <div className="grid grid-cols-3 divide-x divide-black/[0.06] rounded-xl bg-white/80 py-3">
              {[
                { label: '今日积分', value: myStats.today.score || 0 },
                { label: '正确率', value: `${(myStats.today.accuracy_rate || 0).toFixed(0)}%` },
                { label: '最高连击', value: myStats.today.max_combo || 0 },
              ].map((item) => (
                <div key={item.label} className="min-w-20 px-3 text-center sm:px-5">
                  <p className="font-numeric text-xl font-semibold text-ink">{item.value}</p>
                  <p className="mt-0.5 text-[11px] text-ink-mute">{item.label}</p>
                </div>
              ))}
            </div>
          )}
        </motion.section>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <section className="space-y-4" aria-label="竞赛题目">

            {/* 题目卡片 */}
            {loading ? (
              <div className="rounded-2xl bg-white p-5 sm:p-8" aria-busy="true">
                <div className="mb-6 flex items-center gap-3 border-b border-black/[0.06] pb-5">
                  <div className="h-10 w-10 animate-pulse rounded-xl bg-slate-100" />
                  <div className="h-5 w-28 animate-pulse rounded bg-slate-100" />
                </div>
                <div className="mx-auto mb-8 h-8 max-w-lg animate-pulse rounded bg-slate-100" />
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {[0, 1, 2, 3].map((item) => <div key={item} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}
                </div>
              </div>
            ) : isCompleted ? (
              renderCompletionScreen()
            ) : loadError ? (
              <div className="rounded-2xl bg-white px-5 py-12 text-center" role="alert">
                <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-50 text-accent-warm">
                  <RefreshCw className="h-7 w-7" aria-hidden="true" />
                </div>
                <h2 className="font-display text-xl font-semibold text-ink">题目暂时没加载出来</h2>
                <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-soft">{loadError}</p>
                <button
                  type="button"
                  onClick={() => void loadQuestion()}
                  className="mt-5 min-h-11 rounded-xl bg-accent-warm px-5 text-sm font-semibold text-white transition hover:opacity-90"
                >
                  重新加载
                </button>
              </div>
            ) : currentQuestion ? (
              <motion.div
                initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.36, ease: [0.16, 1, 0.3, 1] }}
                className="card-soft rounded-2xl p-5 sm:p-8"
              >
                {/* 题目头部信息 */}
                <div className="mb-6 flex items-center justify-between gap-3 border-b border-black/[0.06] pb-4">
                  <div className="flex min-w-0 items-center gap-3">
                    {(() => {
                      const QuestionTypeIcon = QUESTION_TYPE_META[currentQuestion.question_type].icon;
                      return (
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-accent-warm">
                          <QuestionTypeIcon className="h-5 w-5" aria-hidden="true" />
                        </span>
                      );
                    })()}
                    <div>
                      <div className="font-semibold text-ink">{QUESTION_TYPE_META[currentQuestion.question_type].label}</div>
                      {currentQuestion.source && (
                        <div className="text-xs text-ink-mute">
                          {currentQuestion.source === 'ai' ? '智能题库' : '教师出题'}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className={`shrink-0 rounded-lg px-3 py-2 text-sm font-semibold ${DIFFICULTY_META[currentQuestion.difficulty].className}`}>
                    {DIFFICULTY_META[currentQuestion.difficulty].label}
                  </div>
                </div>

                {/* 题目内容 */}
                {renderQuestionContent()}

                {/* 提示 */}
                <div className="mt-6 flex items-center justify-center gap-2 text-center text-sm text-ink-mute">
                  <Flame className="h-4 w-4 text-accent-warm" aria-hidden="true" />
                  连续答对会获得连击加成
                </div>
              </motion.div>
            ) : null}

            {/* 操作按钮 */}
            {!loading && !isCompleted && currentQuestion && (
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
              <button
                type="button"
                onClick={() => goBack()}
                disabled={isSubmitting}
                className="min-h-11 rounded-xl border border-black/10 bg-white px-6 font-semibold text-ink transition hover:bg-black/[0.04]"
              >
                结束竞赛
              </button>
              <button
                type="button"
                onClick={() => void loadQuestion()}
                disabled={isSubmitting}
                className="btn-glow inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-6 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                换一道题
              </button>
            </div>
            )}
          </section>

          <aside className="space-y-4 lg:sticky lg:top-24" aria-label="竞赛排名">
            {rankInfo && (
              <div className="card-soft rounded-2xl p-5">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <RankBadge rank={rankInfo} size="lg" />
                    <div>
                      <p className="text-xs text-ink-mute">段位积分</p>
                      <p className="font-numeric text-2xl font-semibold text-ink">{rankInfo.rank_points}</p>
                    </div>
                  </div>
                  {myStats?.today && (
                    <div className="text-right">
                      <p className="text-xs text-ink-mute">今日排名</p>
                      <p className="font-numeric text-xl font-semibold text-accent-warm">#{myStats.today.rank || '—'}</p>
                    </div>
                  )}
                </div>
                {rankInfo.next_tier && (
                  <div className="mt-4">
                    <div className="mb-1.5 flex justify-between text-xs text-ink-mute">
                      <span>距离 {rankInfo.next_tier.label}</span>
                      <span>还需 {Math.max(rankInfo.next_tier.min_points - rankInfo.rank_points, 0)} 分</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-black/[0.06]">
                      <motion.div
                        className="h-full rounded-full bg-accent-warm"
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(rankInfo.progress_to_next * 100, 100)}%` }}
                        transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
            <LiveLeaderboard
              token={token}
              seasonId={1}
            />
          </aside>
        </div>
      </main>

      {/* 答题反馈弹窗 */}
      <AnimatePresence>
        {showFeedback && feedbackData && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
            onClick={handleCloseFeedback}
            role="presentation"
          >
            <motion.div
              initial={reduceMotion ? false : { scale: 0.98, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0 }}
              exit={reduceMotion ? undefined : { scale: 0.98, y: 16, opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
              onClick={(e) => e.stopPropagation()}
              className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:rounded-2xl sm:p-7"
              role="dialog"
              aria-modal="true"
              aria-labelledby="competition-feedback-title"
            >
              <div className="mb-5 text-center">
                <div className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl ${feedbackData.result.is_correct ? 'bg-emerald-50 text-emerald-600' : 'bg-orange-50 text-accent-warm'}`}>
                  {feedbackData.result.is_correct
                    ? <CheckCircle2 className="h-7 w-7" aria-hidden="true" />
                    : <CircleAlert className="h-7 w-7" aria-hidden="true" />}
                </div>
                <h2 id="competition-feedback-title" className="font-display text-2xl font-semibold text-ink">
                  {feedbackData.result.is_correct ? '回答正确' : '这题再记一下'}
                </h2>
                <p className="mt-1 text-sm text-ink-mute">查看本题得分后继续下一题</p>
              </div>

              <div className="mb-5 rounded-xl bg-slate-50 p-4">
                <div className="mb-4 text-center">
                  <div className="font-numeric text-4xl font-semibold text-accent-warm">
                    {feedbackData.result.is_correct ? '+' : ''}{feedbackData.result.total_score}
                  </div>
                  <div className="mt-1 text-xs text-ink-mute">本题得分</div>
                </div>

                <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="text-ink-mute">基础分</span>
                    <span className="font-numeric font-semibold text-ink">+{feedbackData.result.base_score}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-ink-mute">难度加成</span>
                    <span className="font-numeric font-semibold text-ink">+{feedbackData.result.difficulty_bonus}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-ink-mute">速度奖励</span>
                    <span className="font-numeric font-semibold text-ink">+{feedbackData.result.speed_bonus}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-ink-mute">连击奖励</span>
                    <span className="font-numeric font-semibold text-ink">+{feedbackData.result.combo_bonus}</span>
                  </div>
                </div>

                {feedbackData.result.multiplier > 1 && (
                  <div className="mt-4 flex items-center justify-center gap-1.5 rounded-lg bg-orange-50 py-2 text-sm font-semibold text-accent-warm">
                    <Flame className="h-4 w-4" aria-hidden="true" />
                    连击倍数 ×{feedbackData.result.multiplier}
                  </div>
                )}
              </div>

              {/* 正确答案 */}
              {!feedbackData.result.is_correct && feedbackData.correct_answer && (
                <div className="mb-5 rounded-xl bg-emerald-50 p-4 text-left">
                  <div className="mb-2 flex items-center gap-2 font-semibold text-emerald-800">
                    <CheckCircle2 className="h-4 w-4" aria-hidden="true" />正确答案
                  </div>
                  <div className="break-words text-lg text-emerald-900">
                    {typeof feedbackData.correct_answer === 'object'
                      ? `${feedbackData.correct_answer.key}. ${feedbackData.correct_answer.text}`
                      : feedbackData.correct_answer}
                  </div>
                </div>
              )}

              {/* 答案解析 */}
              {feedbackData.answer_explanation && (
                <div className="mb-6 rounded-xl border border-orange-100 bg-orange-50 p-4">
                  <div className="mb-2 font-semibold text-ink">答案解析</div>
                  <div className="break-words text-sm leading-6 text-ink-soft">{feedbackData.answer_explanation}</div>
                </div>
              )}

              {/* 排名变化 */}
              {feedbackData.result.rank_change !== 0 && (
                <div className="mb-5 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                  <span className="text-sm text-ink-mute">排名变化</span>
                  <div className={`font-numeric text-lg font-semibold ${feedbackData.result.rank_change > 0 ? 'text-emerald-600' : 'text-ink-soft'}`}>
                    {feedbackData.result.rank_change > 0 ? '上升' : '变化'} {Math.abs(feedbackData.result.rank_change)} 名
                  </div>
                </div>
              )}

              {/* 段位积分变化 */}
              {feedbackData.rank_tier && (
                <div className="mb-5 rounded-xl bg-slate-50 p-3 text-center">
                  <div className="mb-1 text-sm text-ink-mute">段位积分</div>
                  <div className="flex items-center justify-center gap-2">
                    <Sparkles className="h-4 w-4 text-accent-warm" aria-hidden="true" />
                    <span className="font-semibold text-ink">{feedbackData.rank_tier.tier_label}</span>
                    <span className={`font-numeric text-sm font-semibold ${feedbackData.rank_tier.points_delta >= 0 ? 'text-emerald-600' : 'text-ink-soft'}`}>
                      {feedbackData.rank_tier.points_delta >= 0 ? '+' : ''}{feedbackData.rank_tier.points_delta}
                    </span>
                  </div>
                  {feedbackData.rank_tier.promoted && (
                    <motion.div
                      initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                      animate={{ scale: 1 }}
                      className="mt-2 font-semibold text-accent-warm"
                    >
                      段位晋升
                    </motion.div>
                  )}
                </div>
              )}

              {/* 下一题按钮 */}
              <button
                onClick={handleCloseFeedback}
                className="btn-glow inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl text-base font-semibold text-white"
                autoFocus
              >
                下一题
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 实时通知 */}
      <RankNotification />
    </div>
  );
};

export default CompetitionLearning;
