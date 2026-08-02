/**
 * 竞赛模式学习页面 - 对齐教师端数据结构
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, BarChart3, BookOpenText, Flame, RefreshCw, Trophy } from 'lucide-react';
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

const CompetitionLearning: React.FC = () => {
  usePreventCopy();  // 防划走答案:禁右键/复制/选中(输入框内放行)
  const navigate = useNavigate();
  const goBack = useGoBack('/student/dashboard');
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

  // 获取个人统计
  useEffect(() => {
    fetchMyStats();
    fetchRankInfo();
  }, []);

  const fetchMyStats = async () => {
    try {
      const data = await api.get('/competition/my-stats', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setMyStats(data);
    } catch (error) {
      console.error('获取统计失败:', error);
    }
  };

  const fetchRankInfo = async () => {
    try {
      const data = await api.get('/competition/my-rank?season_id=1', {
        headers: { Authorization: `Bearer ${token}` }
      });
      setRankInfo(data);
    } catch (error) {
      console.error('获取段位失败:', error);
    }
  };

  // 加载题目 - 从真实API获取
  const loadQuestion = async () => {
    console.log('📖 开始加载题目...');
    setLoading(true);
    setLoadError('');
    setUserAnswer('');

    try {
      const response = await api.get('/competition/random-question', {
        headers: { Authorization: `Bearer ${token}` }
      });

      console.log('✅ API返回数据:', response);
      const question: CompetitionQuestion = response;

      // 添加答题开始时间
      const questionWithTime: QuestionState = {
        ...question,
        startTime: Date.now()
      };

      console.log('💾 设置题目到state:', questionWithTime);
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
      console.log('✔️ 加载完成');
    }
  };

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
      fetchMyStats();
      fetchRankInfo();
    } catch (error: unknown) {
      console.error('提交答案失败:', error);
      toast.error(getErrorMessage(error, '提交失败'));
      setIsSubmitting(false);
      setSelectedOption(null);
    }
  };

  // 关闭反馈,加载下一题
  const handleCloseFeedback = () => {
    setShowFeedback(false);
    setFeedbackData(null);
    setSelectedOption(null);
    setIsSubmitting(false);
    loadQuestion();
  };

  // 初始加载
  useEffect(() => {
    loadQuestion();
  }, []);

  // 工具函数
  const getDifficultyColor = (difficulty: string) => {
    const colors = {
      'easy': 'bg-green-100 text-green-700 border-green-300',
      'medium': 'bg-yellow-100 text-yellow-700 border-yellow-300',
      'hard': 'bg-red-100 text-red-700 border-red-300'
    };
    return colors[difficulty as keyof typeof colors] || colors['medium'];
  };

  const getDifficultyText = (difficulty: string) => {
    const texts = {
      'easy': '简单',
      'medium': '中等',
      'hard': '困难'
    };
    return texts[difficulty as keyof typeof texts] || difficulty;
  };

  const getTypeIcon = (type: string) => {
    const icons = {
      'choice': '📝',
      'fill_blank': '✏️',
      'spelling': '🔤',
      'reading': '📖'
    };
    return icons[type as keyof typeof icons] || '❓';
  };

  const getTypeText = (type: string) => {
    const texts = {
      'choice': '选择题',
      'fill_blank': '填空题',
      'spelling': '拼写题',
      'reading': '阅读理解'
    };
    return texts[type as keyof typeof texts] || type;
  };

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
        <div className="text-center mb-6">
          {currentQuestion.title && (
            <h3 className="text-2xl font-bold text-gray-800 mb-4">
              {currentQuestion.title}
            </h3>
          )}
          <p className="text-xl text-gray-700">{currentQuestion.content}</p>
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
            let buttonStyle = "min-h-20 p-4 sm:p-5 text-base sm:text-lg font-medium rounded-xl transition-all border ";
            let iconStyle = "w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg ";

            if (isSubmitting || feedbackData) {
              // 提交后或显示反馈时
              if (isCorrect) {
                // 正确答案 - 绿色
                buttonStyle += "bg-green-50 border-green-400 text-gray-800";
                iconStyle += "bg-green-500 text-white";
              } else if (isWrong) {
                // 选错的答案 - 红色
                buttonStyle += "bg-red-50 border-red-400 text-gray-800";
                iconStyle += "bg-red-500 text-white";
              } else if (isSelected) {
                // 选中但还未判断 - 蓝色
                buttonStyle += "bg-orange-50 border-orange-400 text-gray-800";
                iconStyle += "bg-accent-warm text-white";
              } else {
                // 未选中的选项 - 灰色禁用
                buttonStyle += "bg-gray-50 border-gray-200 text-gray-400 opacity-60";
                iconStyle += "bg-gray-200 text-gray-500";
              }
              buttonStyle += " cursor-not-allowed";
            } else {
              // 未提交时 - 可选择状态
              buttonStyle += "text-gray-700 bg-white hover:bg-orange-50 border-gray-200 hover:border-orange-300 cursor-pointer";
              iconStyle += "bg-white text-orange-600";
            }

            return (
              <motion.button
                key={option.id}
                whileHover={!isSubmitting && !feedbackData ? { scale: 1.02 } : {}}
                whileTap={!isSubmitting && !feedbackData ? { scale: 0.98 } : {}}
                onClick={() => !isSubmitting && !feedbackData && handleSubmitAnswer(option.option_key)}
                className={buttonStyle}
                disabled={isSubmitting || !!feedbackData}
              >
                <div className="flex items-center gap-3">
                  <div className={iconStyle}>
                    {isCorrect && feedbackData ? '✓' :
                     isWrong ? '✗' :
                     option.option_key}
                  </div>
                  <span className="flex-1 text-left">{option.option_text}</span>
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
        <div className="text-center mb-6">
          <p className="text-xl text-gray-700 whitespace-pre-wrap">{currentQuestion.content}</p>
        </div>

        <div className="max-w-md mx-auto">
          <input
            {...imeSafeInputProps()}
            value={userAnswer}
            onChange={(e) => setUserAnswer(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && userAnswer.trim() && handleSubmitAnswer(userAnswer)}
            className="w-full px-6 py-4 text-lg border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
            placeholder="请输入答案..."
          />
          <button
            onClick={() => userAnswer.trim() && handleSubmitAnswer(userAnswer)}
            disabled={!userAnswer.trim()}
            className="w-full mt-4 py-4 bg-orange-500 hover:bg-orange-600 text-white font-bold text-lg rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            提交答案
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
        <div className="text-center mb-6">
          <p className="text-xl text-gray-700 mb-4">{currentQuestion.content}</p>
          {currentQuestion.passage && (
            <div className="text-lg text-gray-600 italic">
              "{currentQuestion.passage}"
            </div>
          )}
        </div>

        <div className="max-w-md mx-auto">
          <input
            {...imeSafeInputProps()}
            value={userAnswer}
            onChange={(e) => setUserAnswer(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && userAnswer.trim() && handleSubmitAnswer(userAnswer)}
            className="w-full px-6 py-4 text-xl text-center font-mono tracking-wider border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
            placeholder="请拼写单词..."
          />
          <button
            onClick={() => userAnswer.trim() && handleSubmitAnswer(userAnswer)}
            disabled={!userAnswer.trim()}
            className="mt-4 w-full rounded-xl bg-accent-warm py-4 text-lg font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            🔤 提交拼写
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
            <div className="text-gray-800 leading-relaxed whitespace-pre-wrap">
              {currentQuestion.passage}
            </div>
          </div>
        )}

        {/* 问题 */}
        <div className="text-center mb-6">
          <p className="text-xl font-semibold text-gray-800">{currentQuestion.content}</p>
        </div>

        {/* 选项(阅读理解通常是选择题形式) */}
        {currentQuestion.options.length > 0 ? (
          <div className="grid grid-cols-1 gap-3">
            {currentQuestion.options.map((option) => (
              <motion.button
                key={option.id}
                whileHover={{ scale: 1.01 }}
                whileTap={{ scale: 0.99 }}
                onClick={() => handleSubmitAnswer(option.option_key)}
                className="rounded-xl border border-gray-200 bg-white p-4 text-left text-gray-700 transition-all hover:border-orange-300 hover:bg-orange-50"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-orange-50 font-bold text-accent-warm">
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
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-base focus:border-orange-400 focus:outline-none focus:ring-2 focus:ring-orange-200"
              rows={3}
              placeholder="请输入答案..."
            />
            <button
              onClick={() => userAnswer.trim() && handleSubmitAnswer(userAnswer)}
              disabled={!userAnswer.trim()}
              className="mt-4 w-full rounded-xl bg-accent-warm py-3 font-bold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              提交答案
            </button>
          </div>
        )}
      </div>
    );
  };

  // 完成界面
  const renderCompletionScreen = () => {
    return (
      <div className="bg-white rounded-2xl border border-black/[0.05] p-8 text-center">
        <img
          src="/result-champion.jpeg"
          alt=""
          className="w-36 h-36 md:w-44 md:h-44 mx-auto mb-6 rounded-2xl object-cover"
          loading="lazy"
        />
        <p className="text-ink-mute text-sm mb-2">竞赛轮次完成</p>
        <h2 className="font-display text-3xl md:text-4xl font-semibold text-ink leading-tight tracking-tight mb-3">
          恭喜过关
        </h2>
        <p className="text-ink-soft text-base mb-8">已完成所有可用题目</p>

        {myStats?.today && (
          <div className="bg-paper rounded-2xl border border-black/[0.05] divide-y divide-black/[0.05] mb-8 text-left">
            <div className="px-5 py-4 flex items-baseline justify-between">
              <span className="text-ink-soft text-sm">今日总积分</span>
              <span className="font-display font-semibold text-3xl text-accent-warm font-numeric">
                {myStats.today.score || 0}
              </span>
            </div>
            <div className="px-5 py-4 flex items-baseline justify-between">
              <span className="text-ink-soft text-sm">答题总数</span>
              <span className="font-display font-semibold text-2xl text-ink font-numeric">
                {myStats.today.questions_answered || 0}
              </span>
            </div>
            <div className="px-5 py-4 flex items-baseline justify-between">
              <span className="text-ink-soft text-sm">正确率</span>
              <span className="font-display font-semibold text-2xl text-ink font-numeric">
                {(myStats.today.accuracy_rate || 0).toFixed(1)}<span className="text-base text-ink-soft">%</span>
              </span>
            </div>
            <div className="px-5 py-4 flex items-baseline justify-between">
              <span className="text-ink-soft text-sm">今日排名</span>
              <span className="font-display font-semibold text-2xl text-ink font-numeric">
                #{myStats.today.rank || '—'}
              </span>
            </div>
            <div className="px-5 py-4 flex items-baseline justify-between">
              <span className="text-ink-soft text-sm">最高连击</span>
              <span className="font-display font-semibold text-2xl text-ink font-numeric">
                {myStats.today.max_combo || 0}
              </span>
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <button
            onClick={() => navigate('/student/dashboard')}
            className="py-3.5 border border-black/15 text-ink rounded-xl text-base font-medium hover:bg-black/5 transition"
          >
            返回首页
          </button>
          <button
            onClick={() => {
              setIsCompleted(false);
              loadQuestion();
            }}
            className="py-3.5 bg-accent-warm text-white rounded-xl text-base font-semibold hover:opacity-90 transition"
          >
            再来一轮 →
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
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
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
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
                className="rounded-2xl bg-white p-5 sm:p-8"
              >
                {/* 题目头部信息 */}
                <div className="flex items-center justify-between mb-6 pb-4 border-b">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">{getTypeIcon(currentQuestion.question_type)}</span>
                    <div>
                      <div className="font-semibold text-gray-800">{getTypeText(currentQuestion.question_type)}</div>
                      {currentQuestion.source && (
                        <div className="text-xs text-gray-500">
                          {currentQuestion.source === 'ai' ? '🤖 AI生成' : '✍️ 教师创建'}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className={`px-4 py-2 rounded-lg font-medium border-2 ${getDifficultyColor(currentQuestion.difficulty)}`}>
                    {getDifficultyText(currentQuestion.difficulty)}
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
                className="min-h-11 rounded-xl border border-black/10 bg-white px-6 font-semibold text-ink transition hover:bg-black/[0.04]"
              >
                结束竞赛
              </button>
              <button
                type="button"
                onClick={() => void loadQuestion()}
                className="btn-glow inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-6 font-semibold text-white"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                换一道题
              </button>
            </div>
            )}
          </section>

          <aside className="space-y-4 lg:sticky lg:top-24" aria-label="竞赛排名">
            {rankInfo && (
              <div className="rounded-2xl bg-white p-5">
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
            <div className="flex items-center gap-2 px-1 text-sm font-semibold text-ink">
              <BarChart3 className="h-4 w-4 text-accent-warm" aria-hidden="true" />
              实时排行榜
            </div>
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
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
            onClick={handleCloseFeedback}
            role="presentation"
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl sm:p-8"
              role="dialog"
              aria-modal="true"
              aria-labelledby="competition-feedback-title"
            >
              {/* 结果图标 */}
              <div className="text-center mb-6">
                <div className="text-8xl mb-4">
                  {feedbackData.result.is_correct ? '🎉' : '💪'}
                </div>
                <h2 id="competition-feedback-title" className={`text-3xl font-bold ${feedbackData.result.is_correct ? 'text-green-600' : 'text-orange-600'}`}>
                  {feedbackData.result.is_correct ? '回答正确!' : '继续加油!'}
                </h2>
              </div>

              {/* 得分详情 */}
              <div className="bg-gray-50 rounded-xl p-6 mb-6">
                <div className="text-center mb-4">
                  <div className="text-4xl font-bold text-accent-warm">
                    {feedbackData.result.is_correct ? '+' : ''}{feedbackData.result.total_score}
                  </div>
                  <div className="text-sm text-gray-600">本题得分</div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">基础分:</span>
                    <span className="font-semibold">+{feedbackData.result.base_score}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">难度加成:</span>
                    <span className="font-semibold">+{feedbackData.result.difficulty_bonus}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">速度奖励:</span>
                    <span className="font-semibold">+{feedbackData.result.speed_bonus}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">连击奖励:</span>
                    <span className="font-semibold">+{feedbackData.result.combo_bonus}</span>
                  </div>
                </div>

                {feedbackData.result.multiplier > 1 && (
                  <div className="mt-3 text-center text-orange-600 font-bold">
                    🔥 连击倍数: x{feedbackData.result.multiplier}
                  </div>
                )}
              </div>

              {/* 正确答案 */}
              {!feedbackData.result.is_correct && feedbackData.correct_answer && (
                <div className="bg-green-50 border-2 border-green-200 rounded-xl p-4 mb-6">
                  <div className="font-semibold text-green-900 mb-2">✅ 正确答案:</div>
                  <div className="text-green-800 text-lg">
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
                  <div className="text-ink-soft">{feedbackData.answer_explanation}</div>
                </div>
              )}

              {/* 排名变化 */}
              {feedbackData.result.rank_change !== 0 && (
                <div className="text-center mb-6">
                  <div className="text-sm text-gray-600 mb-1">排名变化</div>
                  <div className={`text-2xl font-bold ${feedbackData.result.rank_change > 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {feedbackData.result.rank_change > 0 ? '↑' : '↓'} {Math.abs(feedbackData.result.rank_change)}
                  </div>
                </div>
              )}

              {/* 段位积分变化 */}
              {feedbackData.rank_tier && (
                <div className="text-center mb-6 p-3 bg-gray-50 rounded-xl">
                  <div className="text-sm text-gray-500 mb-1">段位积分</div>
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-lg">{feedbackData.rank_tier.tier_emoji}</span>
                    <span className="font-bold text-gray-800">{feedbackData.rank_tier.tier_label}</span>
                    <span className={`text-sm font-semibold ${feedbackData.rank_tier.points_delta >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {feedbackData.rank_tier.points_delta >= 0 ? '+' : ''}{feedbackData.rank_tier.points_delta}
                    </span>
                  </div>
                  {feedbackData.rank_tier.promoted && (
                    <motion.div
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      className="mt-2 text-orange-600 font-bold"
                    >
                      🎊 段位晋升！
                    </motion.div>
                  )}
                </div>
              )}

              {/* 下一题按钮 */}
              <button
                onClick={handleCloseFeedback}
                className="w-full rounded-xl bg-accent-warm py-4 text-lg font-bold text-white transition hover:opacity-90"
              >
                下一题 →
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
