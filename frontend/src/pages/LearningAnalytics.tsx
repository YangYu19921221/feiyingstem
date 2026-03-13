import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, TrendingUp, Calendar, Target, Clock, BookOpen, Zap } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
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

const LearningAnalytics = () => {
  const navigate = useNavigate();
  const [overview, setOverview] = useState<LearningOverview | null>(null);
  const [dailyStats, setDailyStats] = useState<DailyStats[]>([]);
  const [modeStats, setModeStats] = useState<ModeStats[]>([]);
  const [recentActivities, setRecentActivities] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDays, setSelectedDays] = useState(7);
  const [retentionData, setRetentionData] = useState<RetentionCurveResponse | null>(null);

  useEffect(() => {
    loadData();
  }, [selectedDays]);

  const loadData = async () => {
    try {
      setLoading(true);
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
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500"></div>
          <p className="text-gray-500 mt-4">加载中...</p>
        </div>
      </div>
    );
  }

  // 计算数据
  const maxDailyWords = Math.max(...dailyStats.map(d => d.words_learned), 1);
  const totalDuration = overview ? Math.floor(overview.total_duration / 60) : 0; // 转换为分钟
  const masteryRate = overview && overview.total_words > 0
    ? (overview.mastered_words / overview.total_words * 100).toFixed(0)
    : '0';

  // 模式名称映射
  const modeNames: Record<string, { name: string; icon: string; color: string }> = {
    flashcard: { name: '卡片学习', icon: '🃏', color: 'from-blue-500 to-cyan-500' },
    spelling: { name: '拼写练习', icon: '✏️', color: 'from-purple-500 to-pink-500' },
    fillblank: { name: '填空练习', icon: '📝', color: 'from-orange-500 to-red-500' },
    quiz: { name: '选择测试', icon: '✅', color: 'from-green-500 to-teal-500' }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-pink-50">
      {/* 顶部导航 */}
      <nav className="bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(-1)}
              className="p-2 hover:bg-gray-100 rounded-lg transition"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
            </button>
            <div className="flex items-center gap-3">
              <TrendingUp className="w-8 h-8 text-blue-500" />
              <h1 className="text-2xl font-bold text-gray-800">学习数据分析</h1>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* 总览卡片 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-white rounded-2xl p-6 shadow-lg"
          >
            <div className="flex items-center gap-3 mb-2">
              <BookOpen className="w-6 h-6 text-blue-500" />
              <p className="text-gray-600 text-sm">学习单词</p>
            </div>
            <p className="text-4xl font-bold text-gray-800">{overview?.total_words || 0}</p>
            <p className="text-sm text-gray-500 mt-1">掌握 {masteryRate}%</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="bg-white rounded-2xl p-6 shadow-lg"
          >
            <div className="flex items-center gap-3 mb-2">
              <Calendar className="w-6 h-6 text-green-500" />
              <p className="text-gray-600 text-sm">学习天数</p>
            </div>
            <p className="text-4xl font-bold text-gray-800">{overview?.total_study_days || 0}</p>
            <p className="text-sm text-gray-500 mt-1">连续 {overview?.current_streak || 0} 天</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-white rounded-2xl p-6 shadow-lg"
          >
            <div className="flex items-center gap-3 mb-2">
              <Clock className="w-6 h-6 text-purple-500" />
              <p className="text-gray-600 text-sm">学习时长</p>
            </div>
            <p className="text-4xl font-bold text-gray-800">{totalDuration}</p>
            <p className="text-sm text-gray-500 mt-1">分钟</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white rounded-2xl p-6 shadow-lg"
          >
            <div className="flex items-center gap-3 mb-2">
              <Zap className="w-6 h-6 text-orange-500" />
              <p className="text-gray-600 text-sm">日均单词</p>
            </div>
            <p className="text-4xl font-bold text-gray-800">{overview?.avg_daily_words || 0}</p>
            <p className="text-sm text-gray-500 mt-1">个/天</p>
          </motion.div>
        </div>

        {/* 学习趋势图 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="bg-white rounded-2xl p-6 shadow-lg mb-8"
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-gray-800">学习趋势</h2>
            <div className="flex gap-2">
              {[7, 14, 30].map(days => (
                <button
                  key={days}
                  onClick={() => setSelectedDays(days)}
                  className={`px-4 py-2 rounded-lg font-medium transition ${
                    selectedDays === days
                      ? 'bg-blue-500 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {days}天
                </button>
              ))}
            </div>
          </div>

          {/* 柱状图 */}
          <div className="relative h-64">
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
                        initial={{ height: 0 }}
                        animate={{ height: `${height}%` }}
                        transition={{ delay: 0.5 + index * 0.02, duration: 0.3 }}
                        className={`w-full rounded-t-md ${
                          isToday
                            ? 'bg-gradient-to-t from-blue-500 to-purple-500'
                            : stat.words_learned > 0
                              ? 'bg-gradient-to-t from-blue-400 to-cyan-400'
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
            <div className="absolute left-0 top-0 -translate-x-12 h-full flex flex-col justify-between text-xs text-gray-500">
              <span>{maxDailyWords}</span>
              <span>{Math.floor(maxDailyWords / 2)}</span>
              <span>0</span>
            </div>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* 模式统计 */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.6 }}
            className="bg-white rounded-2xl p-6 shadow-lg"
          >
            <h2 className="text-xl font-bold text-gray-800 mb-6">学习模式统计</h2>
            <div className="space-y-4">
              {modeStats.map((stat, index) => {
                const modeInfo = modeNames[stat.mode] || { name: stat.mode, icon: '📚', color: 'from-gray-500 to-gray-600' };
                const maxWords = Math.max(...modeStats.map(s => s.total_words), 1);
                const widthPercent = (stat.total_words / maxWords) * 100;

                return (
                  <div key={index}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{modeInfo.icon}</span>
                        <span className="font-medium text-gray-700">{modeInfo.name}</span>
                      </div>
                      <span className="text-sm text-gray-500">{stat.total_words} 词</span>
                    </div>
                    <div className="relative w-full h-8 bg-gray-100 rounded-lg overflow-hidden">
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${widthPercent}%` }}
                        transition={{ delay: 0.7 + index * 0.1, duration: 0.5 }}
                        className={`h-full bg-gradient-to-r ${modeInfo.color} flex items-center justify-end pr-3`}
                      >
                        <span className="text-white text-sm font-bold">{stat.count}次</span>
                      </motion.div>
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>

          {/* 最近活动 */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.6 }}
            className="bg-white rounded-2xl p-6 shadow-lg"
          >
            <h2 className="text-xl font-bold text-gray-800 mb-6">最近活动</h2>
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {recentActivities.length === 0 ? (
                <p className="text-gray-500 text-center py-8">暂无学习记录</p>
              ) : (
                recentActivities.map((activity, index) => {
                  const modeInfo = modeNames[activity.mode] || { name: activity.mode, icon: '📚', color: '' };
                  const date = new Date(activity.date);
                  const accuracy = activity.total > 0 ? (activity.score / activity.total * 100).toFixed(0) : '0';

                  return (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.7 + index * 0.05 }}
                      className="flex items-center gap-4 p-3 bg-gray-50 rounded-xl hover:bg-gray-100 transition"
                    >
                      <span className="text-3xl">{modeInfo.icon}</span>
                      <div className="flex-1">
                        <p className="font-medium text-gray-800">{activity.unit_name}</p>
                        <p className="text-sm text-gray-500">
                          {modeInfo.name} · {activity.score}/{activity.total} · {accuracy}%
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
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.8 }}
            className="bg-white rounded-2xl p-6 shadow-lg mt-8"
          >
            <h2 className="text-xl font-bold text-gray-800 mb-6">单词掌握度分布</h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="text-center">
                <div className="relative w-32 h-32 mx-auto mb-3">
                  <svg className="w-full h-full transform -rotate-90">
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
                      initial={{ strokeDashoffset: 2 * Math.PI * 56 }}
                      animate={{ strokeDashoffset: 2 * Math.PI * 56 * (1 - overview.mastered_words / overview.total_words) }}
                      transition={{ delay: 0.9, duration: 1 }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div>
                      <p className="text-2xl font-bold text-green-600">{masteryRate}%</p>
                    </div>
                  </div>
                </div>
                <p className="font-medium text-gray-700">已掌握</p>
                <p className="text-2xl font-bold text-green-600">{overview.mastered_words}</p>
              </div>

              <div className="text-center">
                <div className="relative w-32 h-32 mx-auto mb-3">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle cx="64" cy="64" r="56" stroke="#e5e7eb" strokeWidth="16" fill="none" />
                    <motion.circle
                      cx="64"
                      cy="64"
                      r="56"
                      stroke="#f59e0b"
                      strokeWidth="16"
                      fill="none"
                      strokeDasharray={`${2 * Math.PI * 56}`}
                      initial={{ strokeDashoffset: 2 * Math.PI * 56 }}
                      animate={{ strokeDashoffset: 2 * Math.PI * 56 * (1 - overview.learning_words / overview.total_words) }}
                      transition={{ delay: 1.0, duration: 1 }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <p className="text-2xl font-bold text-orange-500">
                      {((overview.learning_words / overview.total_words) * 100).toFixed(0)}%
                    </p>
                  </div>
                </div>
                <p className="font-medium text-gray-700">学习中</p>
                <p className="text-2xl font-bold text-orange-500">{overview.learning_words}</p>
              </div>

              <div className="text-center">
                <div className="relative w-32 h-32 mx-auto mb-3">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle cx="64" cy="64" r="56" stroke="#e5e7eb" strokeWidth="16" fill="none" />
                    <motion.circle
                      cx="64" cy="64" r="56"
                      stroke="#ef4444"
                      strokeWidth="16"
                      fill="none"
                      strokeDasharray={`${2 * Math.PI * 56}`}
                      initial={{ strokeDashoffset: 2 * Math.PI * 56 }}
                      animate={{ strokeDashoffset: 2 * Math.PI * 56 * (1 - overview.weak_words / overview.total_words) }}
                      transition={{ delay: 1.1, duration: 1 }}
                    />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <p className="text-2xl font-bold text-red-500">
                      {((overview.weak_words / overview.total_words) * 100).toFixed(0)}%
                    </p>
                  </div>
                </div>
                <p className="font-medium text-gray-700">薄弱</p>
                <p className="text-2xl font-bold text-red-500">{overview.weak_words}</p>
              </div>
            </div>
          </motion.div>
        )}

        {/* 记忆曲线 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.0 }}
          className="bg-white rounded-2xl p-6 shadow-lg mt-8"
        >
          <h2 className="text-xl font-bold text-gray-800 mb-2">📈 记忆曲线</h2>
          <p className="text-sm text-gray-500 mb-6">
            {retentionData?.message || '艾宾浩斯遗忘曲线 vs 你的实际保留率'}
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
  );
};

export default LearningAnalytics;
