import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  getMyHomework,
  startHomework,
  getMyHomeworkAttempts,
  type StudentHomeworkResponse,
  type HomeworkAttemptResponse,
} from '../api/homework';
import { toast } from '../components/Toast';

// 学习模式中文映射
const LEARNING_MODE_MAP: Record<string, string> = {
  flashcard: '闪卡记忆',
  spelling: '拼写练习',
  fillblank: '填空练习',
  quiz: '选择题测试',
};

// 状态中文映射
const STATUS_MAP: Record<string, string> = {
  pending: '待开始',
  in_progress: '进行中',
  completed: '已完成',
  overdue: '已过期',
};

// 状态颜色配置
const STATUS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  pending: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-300' },
  in_progress: { bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-300' },
  completed: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-300' },
  overdue: { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-300' },
};

const StudentHomework = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<any>(null);
  const [homeworks, setHomeworks] = useState<StudentHomeworkResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('all');
  const [expandedHomework, setExpandedHomework] = useState<number | null>(null);
  const [attempts, setAttempts] = useState<Record<number, HomeworkAttemptResponse[]>>({});
  const [loadingAttempts, setLoadingAttempts] = useState<Record<number, boolean>>({});

  useEffect(() => {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      setUser(JSON.parse(userStr));
    }
    loadHomeworks();
  }, []);

  const loadHomeworks = async () => {
    try {
      setLoading(true);
      const data = await getMyHomework();
      setHomeworks(data);
    } catch (error) {
      console.error('加载作业失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStartHomework = async (assignmentId: number) => {
    try {
      const result = await startHomework(assignmentId);
      // 跳转到学习页面
      navigate(`/student/units/${result.unit_id}/${result.learning_mode}`, {
        state: { fromHomework: true, assignmentId },
      });
    } catch (error: any) {
      toast.error(error.response?.data?.detail || '开始作业失败');
    }
  };

  const toggleAttempts = async (assignmentId: number) => {
    if (expandedHomework === assignmentId) {
      setExpandedHomework(null);
    } else {
      setExpandedHomework(assignmentId);

      // 如果还没加载过尝试记录,就加载
      if (!attempts[assignmentId]) {
        setLoadingAttempts({ ...loadingAttempts, [assignmentId]: true });
        try {
          const attemptsData = await getMyHomeworkAttempts(assignmentId);
          setAttempts({ ...attempts, [assignmentId]: attemptsData });
        } catch (error) {
          console.error('加载尝试记录失败:', error);
        } finally {
          setLoadingAttempts({ ...loadingAttempts, [assignmentId]: false });
        }
      }
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  // 计算倒计时
  const getDeadlineInfo = (deadline?: string) => {
    if (!deadline) return null;

    const now = new Date();
    const deadlineDate = new Date(deadline);
    const diff = deadlineDate.getTime() - now.getTime();

    if (diff < 0) {
      return { text: '已过期', isUrgent: true, days: 0 };
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    const isUrgent = days < 3;

    let text = '';
    if (days > 0) {
      text = `${days}天${hours}小时`;
    } else {
      text = `${hours}小时`;
    }

    return { text, isUrgent, days };
  };

  // 格式化耗时
  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${minutes}分${secs}秒`;
  };

  // 格式化日期时间
  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // 根据tab过滤作业
  const filteredHomeworks = homeworks.filter((hw) => {
    if (activeTab === 'all') return true;
    return hw.status === activeTab;
  });

  // 统计各状态数量
  const statusCounts = {
    all: homeworks.length,
    pending: homeworks.filter((hw) => hw.status === 'pending').length,
    in_progress: homeworks.filter((hw) => hw.status === 'in_progress').length,
    completed: homeworks.filter((hw) => hw.status === 'completed').length,
    overdue: homeworks.filter((hw) => hw.status === 'overdue').length,
  };

  const tabs = [
    { key: 'all', label: '全部', emoji: '📋' },
    { key: 'pending', label: '待开始', emoji: '🆕' },
    { key: 'in_progress', label: '进行中', emoji: '⏳' },
    { key: 'completed', label: '已完成', emoji: '✅' },
    { key: 'overdue', label: '已过期', emoji: '⚠️' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-yellow-50 to-blue-50">
      {/* 顶部导航栏 */}
      <nav className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/student/dashboard')}
              className="text-gray-600 hover:text-gray-800 transition"
            >
              <span className="text-2xl">←</span>
            </button>
            <span className="text-3xl">📝</span>
            <h1 className="text-xl font-bold text-gray-800">我的作业</h1>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-600">
              👤 {user?.full_name || '学生'}
            </span>
            <button
              onClick={handleLogout}
              className="text-sm px-3 py-1 bg-gray-100 hover:bg-gray-200 rounded-md transition"
            >
              退出
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* 状态筛选标签 */}
        <div className="mb-6 bg-white rounded-xl shadow-md p-2">
          <div className="flex gap-2 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`
                  flex-shrink-0 px-4 py-2 rounded-lg font-medium transition-all
                  ${
                    activeTab === tab.key
                      ? 'bg-gradient-to-r from-orange-500 to-yellow-500 text-white shadow-md'
                      : 'text-gray-600 hover:bg-gray-100'
                  }
                `}
              >
                <span className="mr-1">{tab.emoji}</span>
                {tab.label}
                <span className="ml-2 text-sm opacity-80">
                  ({statusCounts[tab.key as keyof typeof statusCounts]})
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* 作业列表 */}
        {loading ? (
          <div className="flex justify-center items-center py-20">
            <div className="text-center">
              <div className="text-6xl mb-4 animate-bounce">📚</div>
              <p className="text-gray-600">加载作业中...</p>
            </div>
          </div>
        ) : filteredHomeworks.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl p-12 text-center shadow-md"
          >
            <div className="text-8xl mb-4">📭</div>
            <h3 className="text-xl font-bold text-gray-700 mb-2">暂无作业</h3>
            <p className="text-gray-500">
              {activeTab === 'all' ? '老师还没有布置作业' : `暂无${tabs.find((t) => t.key === activeTab)?.label}的作业`}
            </p>
          </motion.div>
        ) : (
          <div className="grid gap-4">
            <AnimatePresence mode="popLayout">
              {filteredHomeworks.map((homework, index) => {
                const deadlineInfo = getDeadlineInfo(homework.deadline);
                const statusColor = STATUS_COLORS[homework.status];
                const isPassed = homework.best_score >= homework.target_score;
                const isExpanded = expandedHomework === homework.id;

                return (
                  <motion.div
                    key={homework.id}
                    layout
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ delay: index * 0.05 }}
                    className="bg-white rounded-xl shadow-md overflow-hidden hover:shadow-lg transition-shadow"
                  >
                    <div className="p-6">
                      {/* 作业标题和状态 */}
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h3 className="text-lg font-bold text-gray-800">
                              {homework.title}
                            </h3>
                            <span
                              className={`px-3 py-1 rounded-full text-xs font-medium ${statusColor.bg} ${statusColor.text}`}
                            >
                              {STATUS_MAP[homework.status]}
                            </span>
                            {isPassed && homework.status === 'completed' && (
                              <span className="px-3 py-1 rounded-full text-xs font-medium bg-gradient-to-r from-green-400 to-green-600 text-white">
                                🎉 已达标
                              </span>
                            )}
                          </div>
                          {homework.description && (
                            <p className="text-sm text-gray-600 mb-3">{homework.description}</p>
                          )}
                        </div>

                        {/* 截止时间警告 */}
                        {deadlineInfo && (
                          <div
                            className={`ml-4 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${
                              deadlineInfo.isUrgent
                                ? 'bg-red-100 text-red-700 border-2 border-red-300'
                                : 'bg-blue-100 text-blue-700'
                            }`}
                          >
                            <div className="text-xs opacity-75 mb-1">
                              {deadlineInfo.days === 0 ? '⏰ 即将到期' : '📅 剩余时间'}
                            </div>
                            <div className="font-bold">{deadlineInfo.text}</div>
                          </div>
                        )}
                      </div>

                      {/* 作业详情 */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                        <div className="bg-gradient-to-br from-orange-50 to-yellow-50 rounded-lg p-3">
                          <div className="text-xs text-gray-600 mb-1">📚 单词本</div>
                          <div className="font-medium text-gray-800">{homework.book_name}</div>
                        </div>
                        <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-lg p-3">
                          <div className="text-xs text-gray-600 mb-1">📖 单元</div>
                          <div className="font-medium text-gray-800">{homework.unit_name}</div>
                        </div>
                        <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-lg p-3">
                          <div className="text-xs text-gray-600 mb-1">🎯 学习模式</div>
                          <div className="font-medium text-gray-800">
                            {LEARNING_MODE_MAP[homework.learning_mode] || homework.learning_mode}
                          </div>
                        </div>
                        <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-3">
                          <div className="text-xs text-gray-600 mb-1">👨‍🏫 教师</div>
                          <div className="font-medium text-gray-800">{homework.teacher_name}</div>
                        </div>
                      </div>

                      {/* 进度和成绩 */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                        <div className="text-center p-3 bg-gray-50 rounded-lg">
                          <div className="text-2xl font-bold text-orange-600">
                            {homework.target_score}
                          </div>
                          <div className="text-xs text-gray-600 mt-1">🎯 目标分数</div>
                        </div>
                        <div className="text-center p-3 bg-gray-50 rounded-lg">
                          <div className="text-2xl font-bold text-blue-600">
                            {homework.best_score}
                          </div>
                          <div className="text-xs text-gray-600 mt-1">⭐ 最佳成绩</div>
                        </div>
                        <div className="text-center p-3 bg-gray-50 rounded-lg">
                          <div className="text-2xl font-bold text-purple-600">
                            {homework.attempts_count}/{homework.max_attempts}
                          </div>
                          <div className="text-xs text-gray-600 mt-1">🔄 尝试次数</div>
                        </div>
                        <div className="text-center p-3 bg-gray-50 rounded-lg">
                          <div className="text-2xl font-bold text-green-600">
                            {formatTime(homework.total_time_spent)}
                          </div>
                          <div className="text-xs text-gray-600 mt-1">⏱️ 累计用时</div>
                        </div>
                      </div>

                      {/* 操作按钮 */}
                      <div className="flex gap-3">
                        {homework.status !== 'completed' &&
                          homework.status !== 'overdue' &&
                          homework.attempts_count < homework.max_attempts && (
                            <button
                              onClick={() => handleStartHomework(homework.id)}
                              className="flex-1 px-6 py-3 bg-gradient-to-r from-orange-500 to-yellow-500 text-white rounded-lg font-medium hover:shadow-lg transition-all transform hover:scale-105"
                            >
                              {homework.status === 'pending' ? '🚀 开始作业' : '📝 继续作业'}
                            </button>
                          )}

                        {homework.attempts_count > 0 && (
                          <button
                            onClick={() => toggleAttempts(homework.id)}
                            className="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg font-medium transition-all"
                          >
                            {isExpanded ? '▲ 收起记录' : '▼ 查看尝试记录'}
                            <span className="ml-2 text-sm opacity-75">
                              ({homework.attempts_count}次)
                            </span>
                          </button>
                        )}

                        {homework.status === 'overdue' && (
                          <div className="flex-1 px-6 py-3 bg-red-100 text-red-700 rounded-lg font-medium text-center">
                            ⚠️ 作业已过期
                          </div>
                        )}

                        {homework.status === 'completed' &&
                          homework.attempts_count >= homework.max_attempts && (
                            <div className="flex-1 px-6 py-3 bg-gray-100 text-gray-700 rounded-lg font-medium text-center">
                              🔒 已达到最大尝试次数
                            </div>
                          )}
                      </div>
                    </div>

                    {/* 尝试记录展开区域 */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.3 }}
                          className="border-t border-gray-200 bg-gray-50"
                        >
                          <div className="p-6">
                            <h4 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                              <span>📊</span> 尝试历史记录
                            </h4>

                            {loadingAttempts[homework.id] ? (
                              <div className="text-center py-8 text-gray-500">
                                加载中...
                              </div>
                            ) : attempts[homework.id]?.length > 0 ? (
                              <div className="space-y-3">
                                {attempts[homework.id].map((attempt) => (
                                  <motion.div
                                    key={attempt.id}
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    className="bg-white rounded-lg p-4 shadow-sm"
                                  >
                                    <div className="flex items-center justify-between mb-3">
                                      <div className="flex items-center gap-3">
                                        <div className="px-3 py-1 bg-gradient-to-r from-purple-500 to-pink-500 text-white rounded-full font-bold text-sm">
                                          第 {attempt.attempt_number} 次
                                        </div>
                                        <div className="text-sm text-gray-500">
                                          {formatDateTime(attempt.completed_at)}
                                        </div>
                                      </div>
                                      <div
                                        className={`text-2xl font-bold ${
                                          attempt.score >= homework.target_score
                                            ? 'text-green-600'
                                            : 'text-orange-600'
                                        }`}
                                      >
                                        {attempt.score} 分
                                      </div>
                                    </div>

                                    <div className="grid grid-cols-4 gap-3">
                                      <div className="text-center p-2 bg-gray-50 rounded">
                                        <div className="text-lg font-bold text-green-600">
                                          {attempt.correct_count}
                                        </div>
                                        <div className="text-xs text-gray-600">✅ 正确</div>
                                      </div>
                                      <div className="text-center p-2 bg-gray-50 rounded">
                                        <div className="text-lg font-bold text-red-600">
                                          {attempt.wrong_count}
                                        </div>
                                        <div className="text-xs text-gray-600">❌ 错误</div>
                                      </div>
                                      <div className="text-center p-2 bg-gray-50 rounded">
                                        <div className="text-lg font-bold text-blue-600">
                                          {attempt.total_words}
                                        </div>
                                        <div className="text-xs text-gray-600">📝 总题数</div>
                                      </div>
                                      <div className="text-center p-2 bg-gray-50 rounded">
                                        <div className="text-lg font-bold text-purple-600">
                                          {formatTime(attempt.time_spent)}
                                        </div>
                                        <div className="text-xs text-gray-600">⏱️ 耗时</div>
                                      </div>
                                    </div>
                                  </motion.div>
                                ))}
                              </div>
                            ) : (
                              <div className="text-center py-8 text-gray-500">
                                暂无尝试记录
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
};

export default StudentHomework;
