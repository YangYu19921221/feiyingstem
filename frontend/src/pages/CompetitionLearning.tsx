/**
 * 竞赛模式学习页面 - 对齐教师端数据结构
 */
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../api/client';
import LiveLeaderboard from '../components/LiveLeaderboard';
import RankNotification from '../components/RankNotification';
import RankBadge, { type RankInfo } from '../components/RankBadge';
import { competitionWS } from '../services/websocket';

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

const CompetitionLearning: React.FC = () => {
  const navigate = useNavigate();
  const [token] = useState(localStorage.getItem('access_token') || '');
  const [currentQuestion, setCurrentQuestion] = useState<QuestionState | null>(null);
  const [loading, setLoading] = useState(false);
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedbackData, setFeedbackData] = useState<any>(null);
  const [myStats, setMyStats] = useState<any>(null);
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
    } catch (error: any) {
      console.error('❌ 加载题目失败:', error);

      // 如果是404错误,说明没有更多题目了
      if (error.response?.status === 404) {
        setIsCompleted(true);
        setLoading(false);
        return;
      }

      const errorMsg = error.response?.data?.detail || '加载题目失败,请稍后重试';
      alert(errorMsg);
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
    } catch (error: any) {
      console.error('提交答案失败:', error);
      alert(error.response?.data?.detail || '提交失败');
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
        <div className="grid grid-cols-2 gap-4">
          {currentQuestion.options.map((option) => {
            const isSelected = selectedOption === option.option_key;
            const isCorrect = feedbackData?.correct_answer &&
              feedbackData.correct_answer.key === option.option_key;
            const isWrong = isSelected && feedbackData && !feedbackData.result.is_correct;

            // 动态设置样式
            let buttonStyle = "p-6 text-lg font-medium rounded-xl transition-all border-2 ";
            let iconStyle = "w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg ";

            if (isSubmitting || feedbackData) {
              // 提交后或显示反馈时
              if (isCorrect) {
                // 正确答案 - 绿色
                buttonStyle += "bg-gradient-to-br from-green-100 to-green-200 border-green-500 text-gray-800";
                iconStyle += "bg-green-500 text-white";
              } else if (isWrong) {
                // 选错的答案 - 红色
                buttonStyle += "bg-gradient-to-br from-red-100 to-red-200 border-red-500 text-gray-800";
                iconStyle += "bg-red-500 text-white";
              } else if (isSelected) {
                // 选中但还未判断 - 蓝色
                buttonStyle += "bg-gradient-to-br from-blue-100 to-blue-200 border-blue-500 text-gray-800";
                iconStyle += "bg-blue-500 text-white";
              } else {
                // 未选中的选项 - 灰色禁用
                buttonStyle += "bg-gray-50 border-gray-200 text-gray-400 opacity-60";
                iconStyle += "bg-gray-200 text-gray-500";
              }
              buttonStyle += " cursor-not-allowed";
            } else {
              // 未提交时 - 可选择状态
              buttonStyle += "text-gray-700 bg-gradient-to-br from-gray-50 to-gray-100 hover:from-orange-50 hover:to-red-50 border-gray-200 hover:border-orange-400 cursor-pointer";
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
            type="text"
            value={userAnswer}
            onChange={(e) => setUserAnswer(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && userAnswer.trim() && handleSubmitAnswer(userAnswer)}
            className="w-full px-6 py-4 text-lg border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
            placeholder="请输入答案..."
          />
          <button
            onClick={() => userAnswer.trim() && handleSubmitAnswer(userAnswer)}
            disabled={!userAnswer.trim()}
            className="w-full mt-4 py-4 bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold text-lg rounded-xl hover:shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
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
            type="text"
            value={userAnswer}
            onChange={(e) => setUserAnswer(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && userAnswer.trim() && handleSubmitAnswer(userAnswer)}
            className="w-full px-6 py-4 text-xl text-center font-mono tracking-wider border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
            placeholder="请拼写单词..."
          />
          <button
            onClick={() => userAnswer.trim() && handleSubmitAnswer(userAnswer)}
            disabled={!userAnswer.trim()}
            className="w-full mt-4 py-4 bg-gradient-to-r from-blue-500 to-purple-500 text-white font-bold text-lg rounded-xl hover:shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
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
          <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-6 mb-6">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-2xl">📖</span>
              <h3 className="text-lg font-bold text-blue-900">阅读文章</h3>
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
                className="p-4 text-left text-gray-700 bg-white hover:bg-blue-50 border-2 border-gray-200 hover:border-blue-400 rounded-lg transition-all"
              >
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center font-bold text-blue-600 flex-shrink-0">
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
              value={userAnswer}
              onChange={(e) => setUserAnswer(e.target.value)}
              className="w-full px-4 py-3 text-base border-2 border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              rows={3}
              placeholder="请输入答案..."
            />
            <button
              onClick={() => userAnswer.trim() && handleSubmitAnswer(userAnswer)}
              disabled={!userAnswer.trim()}
              className="w-full mt-4 py-3 bg-gradient-to-r from-blue-500 to-indigo-500 text-white font-bold rounded-xl hover:shadow-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
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
      <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
        <div className="mb-6">
          <div className="text-8xl mb-4">🎉</div>
          <h2 className="text-3xl font-bold text-gray-800 mb-2">恭喜完成!</h2>
          <p className="text-gray-600">你已经完成了所有可用的题目</p>
        </div>

        {myStats?.today && (
          <div className="space-y-6 mb-8">
            {/* 总分卡片 */}
            <div className="bg-gradient-to-br from-orange-100 to-red-100 rounded-xl p-6">
              <div className="text-sm text-gray-600 mb-1">今日总积分</div>
              <div className="text-5xl font-bold text-orange-600">
                {myStats.today.score || 0}
              </div>
            </div>

            {/* 统计数据 */}
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-blue-50 rounded-xl p-4">
                <div className="text-3xl font-bold text-blue-600">
                  {myStats.today.questions_answered || 0}
                </div>
                <div className="text-sm text-gray-600 mt-1">答题总数</div>
              </div>
              <div className="bg-green-50 rounded-xl p-4">
                <div className="text-3xl font-bold text-green-600">
                  {(myStats.today.accuracy_rate || 0).toFixed(1)}%
                </div>
                <div className="text-sm text-gray-600 mt-1">正确率</div>
              </div>
              <div className="bg-purple-50 rounded-xl p-4">
                <div className="text-3xl font-bold text-purple-600">
                  #{myStats.today.rank || '-'}
                </div>
                <div className="text-sm text-gray-600 mt-1">今日排名</div>
              </div>
              <div className="bg-yellow-50 rounded-xl p-4">
                <div className="text-3xl font-bold text-yellow-600">
                  {myStats.today.max_combo || 0}
                </div>
                <div className="text-sm text-gray-600 mt-1">最高连击</div>
              </div>
            </div>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-4">
          <button
            onClick={() => navigate('/student/dashboard')}
            className="flex-1 py-3 bg-gradient-to-r from-gray-500 to-gray-600 text-white font-bold rounded-xl hover:shadow-lg transition"
          >
            返回首页
          </button>
          <button
            onClick={() => {
              setIsCompleted(false);
              loadQuestion();
            }}
            className="flex-1 py-3 bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold rounded-xl hover:shadow-lg transition"
          >
            再来一轮
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-red-50 p-4">
      <div className="max-w-7xl mx-auto">
        {/* 顶部标题栏 */}
        <div className="mb-6">
          <h1 className="text-4xl font-bold text-center mb-2">
            🏆 竞赛模式学习
          </h1>
          <p className="text-center text-gray-600">
            边学边PK,冲击排行榜!
          </p>
        </div>

        {/* 主要内容区域 */}
        <div className="flex gap-6">
          {/* 左侧 - 学习区域 (2/3宽度) */}
          <div className="flex-1 space-y-6">
            {/* 段位卡片 */}
            {rankInfo && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-2xl shadow-lg p-6"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <RankBadge rank={rankInfo} size="lg" />
                    <div>
                      <div className="text-sm text-gray-500">段位积分</div>
                      <div className="text-2xl font-bold text-gray-800">{rankInfo.rank_points}</div>
                    </div>
                  </div>
                  {rankInfo.next_tier && (
                    <div className="text-right">
                      <div className="text-xs text-gray-400">距离 {rankInfo.next_tier.label}</div>
                      <div className="text-sm font-semibold text-gray-600">
                        还需 {rankInfo.next_tier.min_points - rankInfo.rank_points} 分
                      </div>
                    </div>
                  )}
                </div>
                {rankInfo.next_tier && (
                  <div className="mt-3">
                    <div className="h-2.5 bg-gray-200 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-gradient-to-r from-orange-400 to-red-500 rounded-full"
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(rankInfo.progress_to_next * 100, 100)}%` }}
                        transition={{ duration: 1, ease: 'easeOut' }}
                      />
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {/* 个人统计卡片 */}
            {myStats?.today ? (
              <div className="bg-white rounded-2xl shadow-lg p-6">
                <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                  📊 我的战绩
                </h2>
                <div className="grid grid-cols-3 gap-4">
                  <div className="text-center p-4 bg-gradient-to-br from-orange-50 to-red-50 rounded-lg">
                    <div className="text-3xl font-bold text-orange-600">
                      #{myStats.today.rank || '-'}
                    </div>
                    <div className="text-sm text-gray-600 mt-1">今日排名</div>
                  </div>
                  <div className="text-center p-4 bg-gradient-to-br from-blue-50 to-cyan-50 rounded-lg">
                    <div className="text-3xl font-bold text-blue-600">
                      {myStats.today.score || 0}
                    </div>
                    <div className="text-sm text-gray-600 mt-1">今日积分</div>
                  </div>
                  <div className="text-center p-4 bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg">
                    <div className="text-3xl font-bold text-green-600">
                      {myStats.today.max_combo || 0}
                    </div>
                    <div className="text-sm text-gray-600 mt-1">最高连击</div>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <span className="text-sm text-gray-600">答题数</span>
                    <span className="font-semibold">{myStats.today.questions_answered || 0}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <span className="text-sm text-gray-600">正确率</span>
                    <span className="font-semibold text-green-600">
                      {(myStats.today.accuracy_rate || 0).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-white rounded-2xl shadow-lg p-6 text-center">
                <div className="text-4xl mb-2">🎯</div>
                <p className="text-gray-600">开始答题即可参与排名竞赛!</p>
              </div>
            )}

            {/* 题目卡片 */}
            {loading ? (
              <div className="bg-white rounded-2xl shadow-lg p-12 text-center">
                <div className="text-6xl mb-4 animate-bounce">📚</div>
                <p className="text-gray-600">正在加载题目...</p>
              </div>
            ) : isCompleted ? (
              renderCompletionScreen()
            ) : currentQuestion ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-white rounded-2xl shadow-lg p-8"
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
                <div className="mt-6 text-center text-sm text-gray-500">
                  💡 答题越快,得分越高!保持连击可获得倍数加成!
                </div>
              </motion.div>
            ) : null}

            {/* 操作按钮 */}
            <div className="flex gap-4">
              <button
                onClick={loadQuestion}
                className="flex-1 py-3 px-6 bg-gradient-to-r from-gray-500 to-gray-600 text-white font-semibold rounded-xl hover:shadow-lg transition-shadow"
              >
                🔄 跳过这题
              </button>
              <button
                onClick={() => window.history.back()}
                className="py-3 px-6 bg-white text-gray-700 font-semibold rounded-xl border-2 border-gray-300 hover:border-gray-400 transition-colors"
              >
                返回
              </button>
            </div>
          </div>

          {/* 右侧 - 实时排行榜 (1/3宽度) */}
          <div className="w-96">
            <LiveLeaderboard
              token={token}
              seasonId={1}
              className="sticky top-4"
            />
          </div>
        </div>
      </div>

      {/* 答题反馈弹窗 */}
      <AnimatePresence>
        {showFeedback && feedbackData && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
            onClick={handleCloseFeedback}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full p-8"
            >
              {/* 结果图标 */}
              <div className="text-center mb-6">
                <div className="text-8xl mb-4">
                  {feedbackData.result.is_correct ? '🎉' : '💪'}
                </div>
                <h2 className={`text-3xl font-bold ${feedbackData.result.is_correct ? 'text-green-600' : 'text-orange-600'}`}>
                  {feedbackData.result.is_correct ? '回答正确!' : '继续加油!'}
                </h2>
              </div>

              {/* 得分详情 */}
              <div className="bg-gray-50 rounded-xl p-6 mb-6">
                <div className="text-center mb-4">
                  <div className="text-4xl font-bold text-blue-600">
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
                <div className="bg-blue-50 border-2 border-blue-200 rounded-xl p-4 mb-6">
                  <div className="font-semibold text-blue-900 mb-2">💡 答案解析:</div>
                  <div className="text-blue-800">{feedbackData.answer_explanation}</div>
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
                className="w-full py-4 bg-gradient-to-r from-orange-500 to-red-500 text-white font-bold text-lg rounded-xl hover:shadow-lg transition"
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
