import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft,
  BookOpen,
  Brain,
  Calendar,
  CheckSquare2,
  ChevronDown,
  Clock,
  ListChecks,
  RefreshCw,
  SpellCheck2,
  TrendingUp,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import useGoBack from '../hooks/useGoBack';
import {
  getLearningOverview,
  getDailyStats,
  getModeStats,
  getRecentActivities,
  getRetentionCurve,
  type LearningOverview,
  type DailyStats,
  type ModeStats,
  type RecentActivity,
  type RetentionCurveResponse
} from '../api/analytics';
import { getWordTrends } from '../api/analytics';
import WordTrendChart from '../components/WordTrendChart';
import SpellingDiagnosisCard from '../components/SpellingDiagnosisCard';
import StudentIdentityBadge from '../components/StudentIdentityBadge';
import { getErrorMessage } from '../utils/errorMessage';

const LearningAnalytics = () => {
  const goBack = useGoBack('/student/dashboard');
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [overview, setOverview] = useState<LearningOverview | null>(null);
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [modeStats, setModeStats] = useState<ModeStats[]>([]);
  const [recentActivities, setRecentActivities] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedDays, setSelectedDays] = useState(7);
  const [retentionData, setRetentionData] = useState<RetentionCurveResponse | null>(null);
  const [showDetailedAnalytics, setShowDetailedAnalytics] = useState(false);

  useEffect(() => {
    loadData();
  }, [selectedDays]);

  const loadData = async () => {
    try {
      setLoading(true);
      setError('');
      const [overviewData, dailyData, modeData, activityData, retentionCurve] = await Promise.all([
        getLearningOverview(),
        getDailyStats(selectedDays),
        getModeStats(),
        getRecentActivities(10),
        getRetentionCurve().catch(() => null)
      ]);

      setOverview(overviewData);
      setDailyStats(dailyData);
      setModeStats(modeData);
      setRecentActivities(activityData);
      setRetentionData(retentionCurve);
    } catch (error) {
      console.error('加载数据失败:', error);
      setError(getErrorMessage(error, '学习数据暂时没有加载出来'));
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-paper px-4 py-10" aria-busy="true" aria-label="正在加载学习数据">
        <div className="mx-auto max-w-6xl space-y-5">
          <div className="h-40 animate-pulse rounded-2xl bg-white" />
          <div className="h-28 animate-pulse rounded-2xl bg-white" />
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="h-72 animate-pulse rounded-2xl bg-white" />
            <div className="h-72 animate-pulse rounded-2xl bg-white" />
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper p-4">
        <div className="card-soft w-full max-w-md rounded-2xl p-7 text-center sm:p-9" role="alert">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-50 text-accent-warm">
            <RefreshCw className="h-8 w-8" aria-hidden="true" />
          </div>
          <h1 className="font-display text-xl font-semibold text-ink">学习数据暂时没打开</h1>
          <p className="mt-2 text-sm leading-6 text-ink-soft">{error}。学习记录不会丢失，可以重试一次。</p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <button
              type="button"
              onClick={() => void loadData()}
              className="min-h-11 rounded-xl bg-accent-warm px-5 text-sm font-semibold text-white transition hover:opacity-90"
            >
              重新加载
            </button>
            <button
              type="button"
              onClick={() => goBack()}
              className="min-h-11 rounded-xl bg-black/[0.05] px-5 text-sm font-semibold text-ink-soft transition hover:bg-black/[0.08]"
            >
              返回学习中心
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 计算数据
  const maxDailyWords = Math.max(...dailyStats.map(d => d.words_learned), 1);
  const hasDailyActivity = dailyStats.some((day) => day.words_learned > 0);
  const totalDuration = overview ? Math.floor(overview.total_duration / 60) : 0; // 转换为分钟
  const masteryRate = overview && overview.total_words > 0
    ? (overview.mastered_words / overview.total_words * 100).toFixed(0)
    : '0';
  /** 占比:已学词数为 0 时返回 0,不然圆环百分比会显示 NaN%
   *  (纯新生、或只做过分类识别的学生 total_words 就是 0) */
  const shareOf = (n: number) => {
    const total = overview?.total_words ?? 0;
    return total > 0 ? n / total : 0;
  };

  // 模式名称映射
  const modeNames: Record<string, { name: string; icon: LucideIcon }> = {
    classify: { name: '分类学习', icon: Brain },
    spelling: { name: '拼写练习', icon: SpellCheck2 },
    fillblank: { name: '填空练习', icon: ListChecks },
    quiz: { name: '选择测试', icon: CheckSquare2 },
    dictation: { name: '听写练习', icon: SpellCheck2 },
    flashcard: { name: '分类记忆', icon: Brain },
    sentencefill: { name: '句子填空', icon: ListChecks },
    sentence_fill: { name: '句子填空', icon: ListChecks },
    competition: { name: '竞赛练习', icon: Zap },
  };

  return (
    <div className="min-h-screen bg-paper page-warm-glow">
      {/* 顶部导航 */}
      <nav className="bg-white/85 backdrop-blur-md shadow-sm sticky top-0 z-20 border-b border-slate-200/80">
        <div className="max-w-6xl mx-auto px-4 py-3">
          <div className="flex items-center gap-4">
            <button
              onClick={() => goBack()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg transition hover:bg-orange-50"
              aria-label="返回"
            >
              <ArrowLeft className="h-5 w-5 text-ink-soft" />
            </button>
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-100 text-accent-warm">
                <TrendingUp className="h-5 w-5" />
              </div>
              <div>
                <h1 className="font-display text-xl font-bold text-gray-800">学习数据</h1>
                <p className="hidden text-xs text-slate-500 sm:block">看看最近的练习和掌握情况</p>
              </div>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-4 py-7 sm:py-8">
        {/* 今日实时数据 */}
        {overview && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.38, ease: [0.16, 1, 0.3, 1] }}
            className="card-soft mb-8 rounded-2xl p-5 sm:p-6"
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                {/* 学生身份：家长拍照时一眼知道是谁 */}
                <StudentIdentityBadge tone="color" className="mb-2" />
                <h2 className="flex items-center gap-2 text-xl font-bold text-ink">
                  <Zap className="h-5 w-5 text-accent-warm" />
                  今日实时
                </h2>
                <p className="mt-1 text-xs text-ink-mute">
                  {new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
                </p>
              </div>
              <button
                type="button"
                onClick={loadData}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-accent-warm transition hover:bg-orange-50"
                title="刷新今日数据"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                刷新
              </button>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-5 border-t border-black/[0.06] pt-5 md:grid-cols-4">
              <div>
                <p className="text-xs text-ink-soft">今日背词</p>
                <p className="mt-1 text-3xl font-bold text-ink font-numeric">
                  {overview.today_words}
                  <span className="ml-1 text-sm font-normal text-ink-mute">个</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-soft">今日时长</p>
                <p className="mt-1 text-3xl font-bold text-ink font-numeric">
                  {Math.floor(overview.today_duration / 60)}
                  <span className="ml-1 text-sm font-normal text-ink-mute">分钟</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-soft">今日次数</p>
                <p className="mt-1 text-3xl font-bold text-ink font-numeric">
                  {overview.today_sessions}
                  <span className="ml-1 text-sm font-normal text-ink-mute">次</span>
                </p>
              </div>
              <div>
                <p className="text-xs text-ink-soft">今日正确率</p>
                <p className="mt-1 text-3xl font-bold text-ink font-numeric">
                  {overview.today_accuracy.toFixed(0)}
                  <span className="ml-1 text-sm font-normal text-ink-mute">%</span>
                </p>
              </div>
            </div>
            {overview.today_words === 0 && overview.today_sessions === 0 && (
              <div className="mt-5 flex flex-col gap-3 rounded-xl bg-orange-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-accent-warm">今天还没开始。完成一小段后，数据就会出现在这里。</p>
                <button
                  type="button"
                  onClick={() => navigate('/student/dashboard')}
                  className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-white px-4 text-sm font-semibold text-accent-warm transition hover:bg-orange-100"
                >
                  去书架学习
                </button>
              </div>
            )}
          </motion.div>
        )}

        {/* 累计数据放在同一个表面，降低首屏卡片噪音。 */}
        <section className="mb-8" aria-labelledby="analytics-summary-title">
          <h2 id="analytics-summary-title" className="mb-3 font-display text-lg font-semibold text-ink">累计数据</h2>
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.38, ease: [0.16, 1, 0.3, 1] }}
            className="grid grid-cols-2 overflow-hidden rounded-2xl bg-white md:grid-cols-4 md:divide-x md:divide-black/[0.06]"
          >
            {[
              { label: '学习单词', value: overview?.total_words || 0, note: `掌握 ${masteryRate}%`, icon: BookOpen },
              { label: '学习天数', value: overview?.total_study_days || 0, note: `连续 ${overview?.current_streak || 0} 天`, icon: Calendar },
              { label: '学习时长', value: totalDuration, note: '分钟', icon: Clock },
              { label: '日均单词', value: overview?.avg_daily_words || 0, note: '个/天', icon: Zap },
            ].map((item, index) => (
              <div
                key={item.label}
                className={`p-4 sm:p-5 ${index < 2 ? 'border-b border-black/[0.06] md:border-b-0' : ''} ${index % 2 === 0 ? 'border-r border-black/[0.06] md:border-r-0' : ''}`}
              >
                <div className="flex items-center gap-2 text-xs text-ink-soft">
                  <item.icon className="h-4 w-4 text-accent-warm" aria-hidden="true" />
                  {item.label}
                </div>
                <p className="mt-2 font-numeric text-2xl font-semibold text-ink sm:text-3xl">{item.value}</p>
                <p className="mt-1 text-xs text-ink-mute">{item.note}</p>
              </div>
            ))}
          </motion.div>
        </section>

        {/* 学习趋势图 */}
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.38, ease: [0.16, 1, 0.3, 1] }}
          className="card-soft rounded-2xl p-5 sm:p-6 mb-8"
        >
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-xl font-bold text-gray-800">学习趋势</h2>
            <div className="flex gap-2">
              {[7, 14, 30].map(days => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setSelectedDays(days)}
                  aria-pressed={selectedDays === days}
                  className={`min-h-11 flex-1 rounded-lg px-4 py-2 font-medium transition sm:flex-none ${
                    selectedDays === days
                      ? 'bg-accent-warm text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {days}天
                </button>
              ))}
            </div>
          </div>

          {/* 柱状图 */}
          {!hasDailyActivity ? (
            <div className="flex flex-col items-center justify-center rounded-xl bg-black/[0.025] px-5 py-8 text-center">
              <BookOpen className="mb-3 h-8 w-8 text-accent-warm" aria-hidden="true" />
              <p className="text-sm text-ink-mute">这个时间段还没有学习记录。完成一次练习后，趋势会显示在这里。</p>
              <button
                type="button"
                onClick={() => navigate('/student/dashboard')}
                className="mt-4 inline-flex min-h-11 items-center justify-center rounded-xl bg-orange-50 px-5 text-sm font-semibold text-accent-warm transition hover:bg-orange-100"
              >
                开始一次学习
              </button>
            </div>
          ) : (
          <div className="relative h-64 pl-8">
            <div className="flex items-end justify-between h-full gap-1">
              {dailyStats.slice(-selectedDays).map((stat, index) => {
                const height = (stat.words_learned / maxDailyWords) * 100;
                const date = new Date(stat.date);
                const isToday = date.toDateString() === new Date().toDateString();

                return (
                  <div key={index} className="flex-1 flex flex-col items-center justify-end group">
                    <div className="relative w-full">
                      {/* 提示气泡 */}
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition pointer-events-none">
                        <div className="bg-gray-800 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap">
                          {stat.date}
                          <br />
                          {stat.words_learned} 个单词
                          <br />
                          {Math.floor(stat.duration / 60)} 分钟
                        </div>
                      </div>

                      {/* 柱子 */}
                      <motion.div
                        initial={reduceMotion ? false : { height: 0 }}
                        animate={{ height: `${height}%` }}
                        transition={{ delay: reduceMotion ? 0 : index * 0.02, duration: reduceMotion ? 0 : 0.3 }}
                        className={`w-full rounded-t-md ${
                          isToday
                            ? 'bg-accent-warm'
                            : stat.words_learned > 0
                              ? 'bg-amber-300'
                              : 'bg-gray-200'
                        }`}
                        style={{ minHeight: stat.words_learned > 0 ? '4px' : '0' }}
                      />
                    </div>

                    {/* 日期标签(只显示部分) */}
                    {index % Math.ceil(selectedDays / 7) === 0 && (
                      <p className="text-xs text-gray-500 mt-2">{date.getDate()}</p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Y轴标签 */}
            <div className="absolute left-0 top-0 flex h-full flex-col justify-between text-xs text-ink-mute">
              <span>{maxDailyWords}</span>
              <span>{Math.floor(maxDailyWords / 2)}</span>
              <span>0</span>
            </div>
          </div>
          )}
        </motion.div>

        {/* 拼写错误模式诊断(数据不足时自动隐藏) */}
        <SpellingDiagnosisCard />

        <div
          id="analytics-mode-details"
          className={`${showDetailedAnalytics ? 'grid' : 'hidden'} grid-cols-1 gap-8 lg:grid lg:grid-cols-2`}
        >
          {/* 模式统计 */}
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.38, ease: [0.16, 1, 0.3, 1] }}
            className="card-soft rounded-2xl p-5 sm:p-6"
          >
            <h2 className="text-xl font-bold text-gray-800 mb-6">学习模式统计</h2>
            <div className="overflow-hidden rounded-xl bg-black/[0.025]">
              {modeStats.length === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-ink-mute">完成练习后，这里会显示各模式的次数和正确率。</p>
              ) : modeStats.map((stat, index) => {
                const modeInfo = modeNames[stat.mode] || { name: stat.mode, icon: BookOpen };
                const ModeIcon = modeInfo.icon;

                return (
                  <div key={`${stat.mode}-${index}`} className="flex items-center gap-3 border-b border-black/[0.06] px-3 py-3 last:border-b-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-accent-warm">
                      <ModeIcon className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-ink">{modeInfo.name}</p>
                      <p className="mt-0.5 text-xs text-ink-mute">{stat.total_words} 个词</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-numeric text-sm font-semibold text-ink">{stat.count} 次</p>
                      <p className="mt-0.5 text-xs text-ink-mute">正确率 {stat.avg_accuracy.toFixed(0)}%</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>

          {/* 最近活动 */}
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.38, ease: [0.16, 1, 0.3, 1] }}
            className="card-soft rounded-2xl p-5 sm:p-6"
          >
            <h2 className="text-xl font-bold text-gray-800 mb-6">最近活动</h2>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {recentActivities.length === 0 ? (
                <p className="text-gray-500 text-center py-8">暂无学习记录</p>
              ) : (
                recentActivities.map((activity, index) => {
                  const modeInfo = modeNames[activity.mode] || { name: activity.mode, icon: BookOpen };
                  const ModeIcon = modeInfo.icon;
                  const date = new Date(activity.date);
                  const accuracy = activity.total > 0 ? (activity.score / activity.total * 100).toFixed(0) : '0';

                  return (
                    <motion.div
                      key={index}
                      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: reduceMotion ? 0 : 0.3, delay: reduceMotion ? 0 : Math.min(index * 0.035, 0.2) }}
                      className="flex items-center gap-4 p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white text-accent-warm">
                        <ModeIcon className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <div className="flex-1">
                        <p className="font-medium text-gray-800">{activity.unit_name}</p>
                        <p className="text-sm text-gray-500">
                          {modeInfo.name}，{activity.score}/{activity.total}，正确率 {accuracy}%
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs text-gray-500">
                          {date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}
                        </p>
                        <p className="text-xs text-gray-400">
                          {date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                    </motion.div>
                  );
                })
              )}
            </div>
          </motion.div>
        </div>

        {/* 单词掌握度分布 */}
        {overview && overview.total_words > 0 && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.38, ease: [0.16, 1, 0.3, 1] }}
            className="card-soft rounded-2xl p-5 sm:p-6 mt-8"
          >
            <h2 className="text-xl font-bold text-gray-800 mb-6">单词掌握度分布</h2>
            <div className="grid grid-cols-3 gap-2 sm:gap-4">
              <div className="text-center">
                <div className="relative mx-auto mb-3 h-20 w-20 sm:h-28 sm:w-28 md:h-32 md:w-32">
                  <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
                    <circle
                      cx="64"
                      cy="64"
                      r="56"
                      stroke="#e5e7eb"
                      strokeWidth="16"
                      fill="none"
                    />
                    <motion.circle
                      cx="64"
                      cy="64"
                      r="56"
                      stroke="#10b981"
                      strokeWidth="16"
                      fill="none"
                      strokeDasharray={`${2 * Math.PI * 56}`}
                      initial={reduceMotion ? false : { strokeDashoffset: 2 * Math.PI * 56 }}
                      animate={{ strokeDashoffset: 2 * Math.PI * 56 * (1 - shareOf(overview.mastered_words)) }}
                      transition={{ duration: reduceMotion ? 0 : 0.7 }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div>
                      <p className="text-lg font-bold text-green-600 sm:text-2xl">{masteryRate}%</p>
                    </div>
                  </div>
                </div>
                <p className="text-sm font-medium text-gray-700 sm:text-base">已掌握</p>
                <p className="text-xl font-bold text-green-600 sm:text-2xl">{overview.mastered_words}</p>
              </div>

              <div className="text-center">
                <div className="relative mx-auto mb-3 h-20 w-20 sm:h-28 sm:w-28 md:h-32 md:w-32">
                  <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
                    <circle cx="64" cy="64" r="56" stroke="#e5e7eb" strokeWidth="16" fill="none" />
                    <motion.circle
                      cx="64"
                      cy="64"
                      r="56"
                      stroke="#f59e0b"
                      strokeWidth="16"
                      fill="none"
                      strokeDasharray={`${2 * Math.PI * 56}`}
                      initial={reduceMotion ? false : { strokeDashoffset: 2 * Math.PI * 56 }}
                      animate={{ strokeDashoffset: 2 * Math.PI * 56 * (1 - shareOf(overview.learning_words)) }}
                      transition={{ duration: reduceMotion ? 0 : 0.7 }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <p className="text-lg font-bold text-orange-500 sm:text-2xl">
                      {(shareOf(overview.learning_words) * 100).toFixed(0)}%
                    </p>
                  </div>
                </div>
                <p className="text-sm font-medium text-gray-700 sm:text-base">待巩固</p>
                <p className="text-xl font-bold text-orange-500 sm:text-2xl">{overview.learning_words}</p>
              </div>

              <div className="text-center">
                <div className="relative mx-auto mb-3 h-20 w-20 sm:h-28 sm:w-28 md:h-32 md:w-32">
                  <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90">
                    <circle cx="64" cy="64" r="56" stroke="#e5e7eb" strokeWidth="16" fill="none" />
                    <motion.circle
                      cx="64" cy="64" r="56"
                      stroke="#ef4444"
                      strokeWidth="16"
                      fill="none"
                      strokeDasharray={`${2 * Math.PI * 56}`}
                      initial={reduceMotion ? false : { strokeDashoffset: 2 * Math.PI * 56 }}
                      animate={{ strokeDashoffset: 2 * Math.PI * 56 * (1 - shareOf(overview.weak_words)) }}
                      transition={{ duration: reduceMotion ? 0 : 0.7 }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <p className="text-lg font-bold text-red-500 sm:text-2xl">
                      {(shareOf(overview.weak_words) * 100).toFixed(0)}%
                    </p>
                  </div>
                </div>
                <p className="text-sm font-medium text-gray-700 sm:text-base">薄弱</p>
                <p className="text-xl font-bold text-red-500 sm:text-2xl">{overview.weak_words}</p>
              </div>
            </div>
          </motion.div>
        )}

        <button
          type="button"
          onClick={() => setShowDetailedAnalytics((visible) => !visible)}
          aria-expanded={showDetailedAnalytics}
          aria-controls="analytics-mode-details analytics-chart-details"
          className="card-soft mt-8 flex min-h-16 w-full items-center justify-between gap-4 rounded-2xl px-4 py-3 text-left lg:hidden"
        >
          <span className="min-w-0">
            <span className="block font-display text-sm font-semibold text-ink">更多学习分析</span>
            <span className="mt-0.5 block text-xs text-ink-mute">学习模式、最近活动、单词趋势与记忆曲线</span>
          </span>
          <span className="inline-flex min-h-11 shrink-0 items-center gap-1 text-xs font-semibold text-accent-warm">
            {showDetailedAnalytics ? '收起' : '展开'}
            <ChevronDown className={`h-4 w-4 transition-transform ${showDetailedAnalytics ? 'rotate-180' : ''}`} aria-hidden="true" />
          </span>
        </button>

        <div id="analytics-chart-details" className={`${showDetailedAnalytics ? 'block' : 'hidden'} lg:block`}>
          {/* 单词学习趋势（日/月/年） */}
          <WordTrendChart fetchData={getWordTrends} tone="student" />

          {/* 记忆曲线 */}
          <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.38, ease: [0.16, 1, 0.3, 1] }}
          className="card-soft rounded-2xl p-5 sm:p-6 mt-8"
        >
          <h2 className="mb-2 flex items-center gap-2 text-xl font-bold text-gray-800">
            <TrendingUp className="h-5 w-5 text-accent-warm" aria-hidden="true" />
            记忆曲线
          </h2>
          <p className="text-sm text-gray-500 mb-6">
            {retentionData?.message || '系统参考曲线和你的实际保留率'}
          </p>

          {(() => {
            const points = retentionData?.data_points || [
              { hours_since_learning: 1, label: '1小时', theoretical_retention: 97.3, actual_retention: null, sample_size: 0 },
              { hours_since_learning: 24, label: '1天', theoretical_retention: 51.3, actual_retention: null, sample_size: 0 },
              { hours_since_learning: 48, label: '2天', theoretical_retention: 26.4, actual_retention: null, sample_size: 0 },
              { hours_since_learning: 96, label: '4天', theoretical_retention: 7.0, actual_retention: null, sample_size: 0 },
              { hours_since_learning: 168, label: '7天', theoretical_retention: 0.9, actual_retention: null, sample_size: 0 },
              { hours_since_learning: 336, label: '14天', theoretical_retention: 0.0, actual_retention: null, sample_size: 0 },
              { hours_since_learning: 720, label: '30天', theoretical_retention: 0.0, actual_retention: null, sample_size: 0 },
            ];

            const W = 600, H = 300;
            const padL = 50, padR = 30, padT = 20, padB = 40;
            const chartW = W - padL - padR;
            const chartH = H - padT - padB;

            // 对数刻度 X 轴
            const minLog = Math.log(1);
            const maxLog = Math.log(720);
            const xScale = (hours: number) => {
              const logVal = Math.log(Math.max(hours, 1));
              return padL + ((logVal - minLog) / (maxLog - minLog)) * chartW;
            };
            const yScale = (val: number) => padT + chartH - (val / 100) * chartH;

            // 理论曲线路径
            const theoreticalPath = points
              .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.hours_since_learning)} ${yScale(p.theoretical_retention)}`)
              .join(' ');

            // 实际曲线路径
            const actualPoints = points.filter(p => p.actual_retention !== null);
            const actualPath = actualPoints
              .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.hours_since_learning)} ${yScale(p.actual_retention!)}`)
              .join(' ');

            return (
              <div className="overflow-x-auto">
                <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[600px] mx-auto">
                  {/* 网格线 */}
                  {[0, 25, 50, 75, 100].map(v => (
                    <g key={v}>
                      <line x1={padL} y1={yScale(v)} x2={W - padR} y2={yScale(v)} stroke="#e5e7eb" strokeWidth="1" />
                      <text x={padL - 8} y={yScale(v) + 4} textAnchor="end" className="text-[10px]" fill="#9ca3af">{v}%</text>
                    </g>
                  ))}

                  {/* X轴标签 */}
                  {points.map((p) => (
                    <text key={p.label} x={xScale(p.hours_since_learning)} y={H - 8} textAnchor="middle" className="text-[10px]" fill="#9ca3af">
                      {p.label}
                    </text>
                  ))}

                  {/* 理论遗忘曲线 (红色虚线) */}
                  <path d={theoreticalPath} fill="none" stroke="#ef4444" strokeWidth="2" strokeDasharray="6 4" />

                  {/* 实际保留率 (蓝色实线) */}
                  {actualPoints.length > 1 && (
                    <path d={actualPath} fill="none" stroke="#3b82f6" strokeWidth="2.5" />
                  )}

                  {/* 理论曲线数据点 */}
                  {points.map((p) => (
                    <circle key={`t-${p.label}`} cx={xScale(p.hours_since_learning)} cy={yScale(p.theoretical_retention)} r="3" fill="#ef4444" />
                  ))}

                  {/* 实际数据点 */}
                  {actualPoints.map((p) => (
                    <g key={`a-${p.label}`}>
                      <circle cx={xScale(p.hours_since_learning)} cy={yScale(p.actual_retention!)} r="4" fill="#3b82f6" />
                      <text x={xScale(p.hours_since_learning)} y={yScale(p.actual_retention!) - 10} textAnchor="middle" className="text-[10px]" fill="#3b82f6" fontWeight="bold">
                        {p.actual_retention}%
                      </text>
                    </g>
                  ))}
                </svg>

                {/* 图例 */}
                <div className="flex items-center justify-center gap-6 mt-4">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-0.5 border-t-2 border-dashed border-red-500" />
                    <span className="text-sm text-gray-600">理论遗忘曲线</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-0.5 bg-blue-500" />
                    <span className="text-sm text-gray-600">实际保留率</span>
                  </div>
                </div>
              </div>
            );
          })()}
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default LearningAnalytics;
