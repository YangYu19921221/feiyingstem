import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  AlarmClock,
  ArrowLeft,
  BookOpenText,
  CalendarClock,
  ChevronDown,
  ClipboardCheck,
  ClipboardList,
  Clock3,
  Lock,
  LogOut,
  RotateCcw,
  Target,
  UserRound,
} from 'lucide-react';
import {
  getMyHomework,
  startHomework,
  getMyHomeworkAttempts,
  type StudentHomeworkResponse,
  type HomeworkAttemptResponse,
} from '../api/homework';
import { toast } from '../components/Toast';
import { formatOpenDay } from '../utils/openDay';
import { getErrorMessage } from '../utils/errorMessage';

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
  failed: '未达标结束',
};

// 状态颜色配置
const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending: { bg: 'bg-slate-100', text: 'text-slate-700' },
  in_progress: { bg: 'bg-orange-50', text: 'text-orange-700' },
  completed: { bg: 'bg-emerald-50', text: 'text-emerald-700' },
  overdue: { bg: 'bg-rose-50', text: 'text-rose-700' },
  failed: { bg: 'bg-slate-100', text: 'text-slate-700' },
};

const StudentHomework = () => {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [user, setUser] = useState<any>(null);
  const [homeworks, setHomeworks] = useState<StudentHomeworkResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
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
      setError('');
      const data = await getMyHomework();
      setHomeworks(data);
    } catch (error) {
      console.error('加载作业失败:', error);
      setError(getErrorMessage(error, '作业列表暂时没有加载出来'));
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
      toast.error(getErrorMessage(error, '开始作业失败'));
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

  // 统计各状态数量。「待开始」只算现在真能做的:未开放任务的 status 也是 pending,
  // 计进去会让"待开始 5 项"里混着今天根本做不了的,孩子会以为自己漏做了
  const statusCounts = {
    all: homeworks.length,
    pending: homeworks.filter((hw) => hw.status === 'pending' && !hw.is_locked).length,
    in_progress: homeworks.filter((hw) => hw.status === 'in_progress').length,
    completed: homeworks.filter((hw) => hw.status === 'completed').length,
    overdue: homeworks.filter((hw) => hw.status === 'overdue').length,
  };

  const tabs = [
    { key: 'all', label: '全部' },
    { key: 'pending', label: '待开始' },
    { key: 'in_progress', label: '进行中' },
    { key: 'completed', label: '已完成' },
    { key: 'overdue', label: '已过期' },
  ];

  return (
    <div className="min-h-screen bg-paper page-warm-glow">
      {/* 顶部导航栏 */}
      <nav className="border-b border-slate-200/80 bg-white/85 shadow-sm backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate('/student/dashboard')}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 transition hover:bg-orange-50 hover:text-orange-600"
              aria-label="返回学生首页"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-100 text-orange-600">
              <ClipboardList className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-display text-xl font-bold text-slate-800">我的作业</h1>
              <p className="hidden text-xs text-slate-500 sm:block">按截止时间安排今天的任务</p>
            </div>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <button
              type="button"
              onClick={() => navigate('/student/assignments')}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-orange-50 px-3 text-sm font-semibold text-orange-700 transition hover:bg-orange-100"
              title="查看老师指定的教材任务"
              aria-label="查看教材任务"
            >
              <BookOpenText className="h-4 w-4" />
              <span className="sm:hidden">教材</span>
              <span className="hidden sm:inline">教材任务</span>
            </button>
            <span className="hidden text-sm text-slate-500 sm:inline">
              {user?.full_name || user?.username || '同学'}
            </span>
            <button
              onClick={handleLogout}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              aria-label="退出登录"
              title="退出登录"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 py-7 sm:py-8">
        <section className="student-colorful-surface mb-6 overflow-hidden rounded-2xl border border-orange-100 px-5 py-5 shadow-md sm:px-7">
          <div className="flex items-center justify-between gap-5">
            <div>
              <h2 className="font-display text-2xl font-bold text-slate-800">先完成最紧急的一项</h2>
              <p className="mt-2 text-sm text-slate-600">
                待开始 {statusCounts.pending} 项，进行中 {statusCounts.in_progress} 项
              </p>
            </div>
            <img src="/eagle-homework.jpeg" alt="" className="hidden h-24 w-32 rounded-xl object-cover shadow-sm sm:block" />
          </div>
        </section>

        {/* 状态筛选标签 */}
        <div className="card-soft mb-6 rounded-xl p-2">
          <div className="flex gap-2 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveTab(tab.key)}
                aria-pressed={activeTab === tab.key}
                className={`
                  min-h-11 flex-shrink-0 px-4 py-2 rounded-lg font-medium transition-all
                  ${
                    activeTab === tab.key
                      ? 'bg-accent-warm text-white'
                      : 'text-gray-600 hover:bg-gray-100'
                  }
                `}
              >
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
              <div className="mx-auto mb-4 flex h-16 w-16 animate-pulse items-center justify-center rounded-2xl bg-orange-50 text-orange-500">
                <ClipboardList className="h-8 w-8" />
              </div>
              <p className="text-gray-600">加载作业中...</p>
            </div>
          </div>
        ) : error ? (
          <div className="card-soft rounded-2xl px-5 py-12 text-center" role="alert">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 text-accent-warm">
              <RotateCcw className="h-8 w-8" aria-hidden="true" />
            </div>
            <h2 className="font-display text-xl font-semibold text-ink">作业列表暂时没打开</h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-soft">{error}。学习记录不会丢失，可以重试一次。</p>
            <button
              type="button"
              onClick={() => void loadHomeworks()}
              className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-accent-warm px-5 text-sm font-semibold text-white transition hover:opacity-90"
            >
              重新加载
            </button>
          </div>
        ) : filteredHomeworks.length === 0 ? (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="card-soft rounded-2xl p-12 text-center"
          >
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 text-orange-500">
              <ClipboardCheck className="h-8 w-8" />
            </div>
            <h3 className="text-xl font-bold text-slate-700 mb-2">暂无作业</h3>
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
                // 明天(或更晚)才开放的任务:能看见但做不了
                const isLocked = !!homework.is_locked;
                const openDayText = formatOpenDay(homework.available_from);

                return (
                  <motion.div
                    key={homework.id}
                    layout
                    initial={reduceMotion ? false : { opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={reduceMotion ? undefined : { opacity: 0, y: -12 }}
                    transition={{ duration: 0.32, delay: reduceMotion ? 0 : Math.min(index * 0.035, 0.2), ease: [0.16, 1, 0.3, 1] }}
                    className="card-soft overflow-hidden rounded-2xl"
                  >
                    <div className="p-5 sm:p-6">
                      {/* 作业标题和状态 */}
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-4">
                        <div className="flex-1">
                          <div className="mb-2 flex flex-wrap items-center gap-2">
                            <h3 className="font-display text-lg font-semibold text-ink">
                              {homework.title}
                            </h3>
                            <span
                              className={`px-3 py-1 rounded-full text-xs font-medium ${statusColor.bg} ${statusColor.text}`}
                            >
                              {STATUS_MAP[homework.status]}
                            </span>
                            {isLocked && (
                              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                                <Lock className="h-3 w-3" aria-hidden="true" />
                                {openDayText}开放
                              </span>
                            )}
                            {isPassed && homework.status === 'completed' && (
                              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                                已达标
                              </span>
                            )}
                          </div>
                          {homework.description && (
                            <p className="mb-3 max-w-2xl text-sm leading-6 text-ink-soft">{homework.description}</p>
                          )}
                        </div>

                        {/* 未开放:显示"哪天能做",不显示倒计时(否则"剩余1天X小时"
                            看着像现在就能做) */}
                        {isLocked ? (
                          <div className="inline-flex items-center gap-2 self-start whitespace-nowrap rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-700">
                            <CalendarClock className="h-4 w-4" aria-hidden="true" />
                            <span>{openDayText}才能做</span>
                          </div>
                        ) : (
                          deadlineInfo && (
                            <div
                              className={`inline-flex items-center gap-2 self-start rounded-xl px-3 py-2 text-sm font-semibold whitespace-nowrap ${
                                deadlineInfo.isUrgent
                                  ? 'bg-rose-50 text-rose-700'
                                  : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              <AlarmClock className="h-4 w-4" aria-hidden="true" />
                              <span>
                                {homework.status === 'overdue' || deadlineInfo.text === '已过期'
                                  ? '已过期'
                                  : deadlineInfo.days === 0
                                    ? '即将到期'
                                    : `剩余 ${deadlineInfo.text}`}
                              </span>
                            </div>
                          )
                        )}
                      </div>

                      {/* 教材范围紧凑展示，避免每个作业堆叠四张彩色卡。 */}
                      <div className="mb-4 grid gap-2 rounded-xl bg-black/[0.025] p-3 text-sm text-ink-soft sm:grid-cols-2">
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <BookOpenText className="h-4 w-4 shrink-0 text-accent-warm" aria-hidden="true" />
                          <span className="truncate">{homework.book_name} / {homework.unit_name}</span>
                        </span>
                        <span className="inline-flex min-w-0 items-center gap-2">
                          <Target className="h-4 w-4 shrink-0 text-accent-warm" aria-hidden="true" />
                          <span className="truncate">{LEARNING_MODE_MAP[homework.learning_mode] || homework.learning_mode}</span>
                        </span>
                        <span className="inline-flex min-w-0 items-center gap-2 sm:col-span-2">
                          <UserRound className="h-4 w-4 shrink-0 text-accent-warm" aria-hidden="true" />
                          <span className="truncate">布置老师：{homework.teacher_name}</span>
                        </span>
                      </div>

                      {/* 成绩放在一个连续表面，手机上两列，桌面四列。 */}
                      <div className="mb-4 grid grid-cols-2 overflow-hidden rounded-xl bg-white ring-1 ring-black/[0.06] md:grid-cols-4 md:divide-x md:divide-black/[0.06]">
                        {[
                          { label: '目标分数', value: homework.target_score },
                          { label: '最佳成绩', value: homework.best_score },
                          { label: '尝试次数', value: `${homework.attempts_count}/${homework.max_attempts}` },
                          { label: '累计用时', value: formatTime(homework.total_time_spent) },
                        ].map((item, itemIndex) => (
                          <div
                            key={item.label}
                            className={`px-3 py-3 ${itemIndex < 2 ? 'border-b border-black/[0.06] md:border-b-0' : ''} ${itemIndex % 2 === 0 ? 'border-r border-black/[0.06] md:border-r-0' : ''}`}
                          >
                            <p className="font-numeric text-lg font-semibold text-ink sm:text-xl">{item.value}</p>
                            <p className="mt-0.5 text-xs text-ink-mute">{item.label}</p>
                          </div>
                        ))}
                      </div>

                      {/* 操作按钮 */}
                      <div className="flex flex-col gap-2 sm:flex-row">
                        {homework.status !== 'completed' &&
                          homework.status !== 'overdue' &&
                          homework.attempts_count < homework.max_attempts && (
                            isLocked ? (
                              // 故意保持可点击(不用 disabled):点了要给提示,
                              // 死按钮会让孩子反复戳以为卡了
                              <button
                                onClick={() =>
                                  toast.info(`这是${openDayText}的任务，${openDayText}才能开始做哦`)
                                }
                                aria-label={`${homework.title}，${openDayText}才能开始`}
                                className="inline-flex min-h-11 flex-1 cursor-not-allowed items-center justify-center gap-2 rounded-xl bg-black/[0.05] px-6 py-3 font-semibold text-ink-mute transition hover:bg-black/[0.08]"
                              >
                                <Lock className="h-4 w-4" aria-hidden="true" />
                                {openDayText}才能开始
                              </button>
                            ) : (
                              <button
                                onClick={() => handleStartHomework(homework.id)}
                                className="min-h-11 flex-1 rounded-xl bg-accent-warm px-6 py-3 font-semibold text-white transition hover:opacity-90"
                              >
                                {homework.status === 'pending' ? '开始作业' : '继续作业'}
                              </button>
                            )
                          )}

                        {homework.attempts_count > 0 && (
                          <button
                            type="button"
                            onClick={() => toggleAttempts(homework.id)}
                            aria-expanded={isExpanded}
                            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-black/[0.05] px-5 py-3 font-semibold text-ink-soft transition hover:bg-black/[0.08]"
                          >
                            <span>{isExpanded ? '收起记录' : `尝试记录 (${homework.attempts_count})`}</span>
                            <ChevronDown className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} aria-hidden="true" />
                          </button>
                        )}

                        {homework.status === 'overdue' && (
                          <div className="flex min-h-11 flex-1 items-center justify-center rounded-xl bg-rose-50 px-6 py-3 font-semibold text-rose-700">
                            作业已过期
                          </div>
                        )}

                        {homework.status === 'completed' &&
                          homework.attempts_count >= homework.max_attempts && (
                            <div className="flex min-h-11 flex-1 items-center justify-center rounded-xl bg-black/[0.05] px-6 py-3 font-semibold text-ink-soft">
                              已达到最大尝试次数
                            </div>
                          )}
                      </div>
                    </div>

                    {/* 尝试记录展开区域 */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={reduceMotion ? false : { height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={reduceMotion ? undefined : { height: 0, opacity: 0 }}
                          transition={{ duration: reduceMotion ? 0 : 0.3, ease: [0.16, 1, 0.3, 1] }}
                          className="border-t border-gray-200 bg-gray-50"
                        >
                          <div className="p-6">
                            <h4 className="mb-4 flex items-center gap-2 font-semibold text-ink">
                              <Clock3 className="h-4 w-4 text-accent-warm" aria-hidden="true" />
                              尝试历史记录
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
                                    initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    className="rounded-xl bg-white p-4"
                                  >
                                    <div className="flex items-center justify-between mb-3">
                                      <div className="flex items-center gap-3">
                                        <div className="rounded-lg bg-orange-50 px-3 py-1 text-sm font-semibold text-orange-700">
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

                                    <div className="grid grid-cols-2 overflow-hidden rounded-xl bg-black/[0.025] sm:grid-cols-4 sm:divide-x sm:divide-black/[0.06]">
                                      <div className="border-b border-r border-black/[0.06] p-2 text-center sm:border-b-0 sm:border-r-0">
                                        <div className="text-lg font-semibold text-emerald-700">
                                          {attempt.correct_count}
                                        </div>
                                        <div className="text-xs text-ink-mute">正确</div>
                                      </div>
                                      <div className="border-b border-black/[0.06] p-2 text-center sm:border-b-0">
                                        <div className="text-lg font-semibold text-rose-700">
                                          {attempt.wrong_count}
                                        </div>
                                        <div className="text-xs text-ink-mute">错误</div>
                                      </div>
                                      <div className="border-r border-black/[0.06] p-2 text-center sm:border-r-0">
                                        <div className="text-lg font-semibold text-ink">
                                          {attempt.total_words}
                                        </div>
                                        <div className="text-xs text-ink-mute">总题数</div>
                                      </div>
                                      <div className="p-2 text-center">
                                        <div className="text-lg font-semibold text-ink">
                                          {formatTime(attempt.time_spent)}
                                        </div>
                                        <div className="text-xs text-ink-mute">耗时</div>
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
