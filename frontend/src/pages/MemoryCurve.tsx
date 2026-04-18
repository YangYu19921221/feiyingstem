import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import {
  getMemoryCurveStats,
  getReviewDueWords,
  type MemoryCurveStats,
  type ReviewWord,
} from '../api/memoryCurve';
import { getRetentionCurve, type RetentionCurveResponse } from '../api/analytics';

const SRS_STAGE_COLORS = [
  '#ef4444', // Stage 0 - 5分钟 (红)
  '#f97316', // Stage 1 - 30分钟 (橙)
  '#f59e0b', // Stage 2 - 12小时 (琥珀)
  '#eab308', // Stage 3 - 1天 (黄)
  '#84cc16', // Stage 4 - 2天 (黄绿)
  '#22c55e', // Stage 5 - 4天 (绿)
  '#14b8a6', // Stage 6 - 7天 (蓝绿)
  '#06b6d4', // Stage 7 - 15天 (青)
  '#3b82f6', // Stage 8 - 30天 (蓝)
  '#5FD35F', // 已掌握 (草绿)
];

const REVIEW_PAGE_SIZE = 20;

const MemoryCurve = () => {
  const navigate = useNavigate();
  const [stats, setStats] = useState<MemoryCurveStats | null>(null);
  const [retentionData, setRetentionData] = useState<RetentionCurveResponse | null>(null);
  const [reviewWords, setReviewWords] = useState<ReviewWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWordList, setShowWordList] = useState(false);
  const [startingReview, setStartingReview] = useState(false);
  const [reviewPage, setReviewPage] = useState(1);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [statsData, retentionRes, wordsData] = await Promise.all([
        getMemoryCurveStats(),
        getRetentionCurve().catch(() => null),
        getReviewDueWords(200),
      ]);
      setStats(statsData);
      setRetentionData(retentionRes);
      setReviewWords(wordsData || []);
    } catch (error) {
      console.error('加载记忆曲线数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStartReview = async () => {
    if (reviewWords.length === 0) return;
    setStartingReview(true);
    try {
      // 转换为 FlashCardLearning 期望的格式
      const wordData = reviewWords.slice(0, 20).map((w, index) => ({
        id: w.word_id,
        word: w.word,
        phonetic: w.phonetic || '',
        meaning: w.meaning || '',
        part_of_speech: w.part_of_speech || '',
        example_sentence: w.example_sentence || '',
        example_translation: w.example_translation || '',
        difficulty: w.difficulty,
        syllables: w.syllables || '',
        audio_url: '',
        image_url: '',
        tags: [],
        definitions: w.meaning ? [{
          id: 0,
          part_of_speech: w.part_of_speech || '',
          meaning: w.meaning,
          example_sentence: w.example_sentence || '',
          example_translation: w.example_translation || '',
          is_primary: true,
        }] : [],
        order_index: index,
      }));

      sessionStorage.setItem('review_practice_words', JSON.stringify(wordData));
      sessionStorage.setItem('is_review_practice', 'true');
      navigate('/student/units/0/classify');
    } catch (error) {
      console.error('开始复习失败:', error);
    } finally {
      setStartingReview(false);
    }
  };

  const getMasteryBadge = (level: number, stage: number) => {
    if (stage >= 9) return { text: '已掌握', color: 'bg-green-100 text-green-700' };
    if (level >= 4) return { text: '熟练', color: 'bg-blue-100 text-blue-700' };
    if (level >= 2) return { text: '一般', color: 'bg-yellow-100 text-yellow-700' };
    return { text: '薄弱', color: 'bg-red-100 text-red-700' };
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 to-yellow-50 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-500"></div>
          <p className="text-gray-500 mt-4">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-cyan-50 via-blue-50 to-indigo-50">
      {/* 顶部导航栏 */}
      <nav className="bg-white/80 backdrop-blur-md shadow-sm sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <button
              onClick={() => navigate(-1)}
              className="flex items-center gap-2 px-4 py-2 hover:bg-white rounded-xl transition-all hover:shadow-md"
            >
              <ArrowLeft className="w-5 h-5 text-gray-600" />
              <span className="text-gray-600 font-medium">返回</span>
            </button>

            <h1 className="text-xl font-bold text-gray-800">记忆曲线</h1>

            <div className="w-24"></div>
          </div>
        </div>
      </nav>

      {/* Hero 横幅 */}
      <div className="relative overflow-hidden" style={{ height: 160 }}>
        <img src="/hero-memory.jpeg" alt="" className="absolute inset-0 w-full h-full object-cover object-center" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/40 to-transparent" />
        <div className="relative z-10 h-full flex items-center px-6 max-w-7xl mx-auto">
          <div className="text-white">
            <h2 className="text-3xl font-bold drop-shadow">🧠 记忆曲线</h2>
            <p className="text-sm opacity-80 mt-1 drop-shadow">科学复习，让知识永驻脑海</p>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* 今日复习卡片 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          {stats && stats.due_today > 0 ? (
            <div className="bg-gradient-to-r from-cyan-500 to-blue-600 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -translate-y-8 translate-x-8" />
              <div className="absolute bottom-0 left-0 w-24 h-24 bg-white/10 rounded-full translate-y-6 -translate-x-6" />
              <div className="relative z-10">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-white/80 text-sm mb-1">今日待复习</p>
                    <div className="flex items-baseline gap-2">
                      <span className="text-5xl font-bold">{stats.due_today}</span>
                      <span className="text-white/70">个单词</span>
                    </div>
                    <p className="text-white/60 text-sm mt-2">
                      明天还有 {stats.due_tomorrow} 个待复习
                    </p>
                  </div>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    onClick={handleStartReview}
                    disabled={startingReview}
                    className="bg-white text-cyan-600 font-bold px-6 py-3 rounded-xl shadow-lg hover:shadow-xl transition-all disabled:opacity-50"
                  >
                    <motion.span
                      animate={{ scale: [1, 1.05, 1] }}
                      transition={{ repeat: Infinity, duration: 2 }}
                      className="inline-block"
                    >
                      {startingReview ? '准备中...' : '开始复习'}
                    </motion.span>
                  </motion.button>
                </div>
              </div>
            </div>
          ) : stats && stats.total_learned === 0 ? (
            <div className="bg-gradient-to-r from-blue-50 to-cyan-50 border border-cyan-200 rounded-2xl p-6 shadow-sm">
              <div className="flex items-start gap-4">
                <span className="text-4xl">📖</span>
                <div>
                  <h3 className="text-lg font-bold text-gray-800 mb-2">还没有开始学习</h3>
                  <p className="text-gray-600 text-sm mb-3">
                    完成单词学习后，系统会根据<span className="font-bold text-cyan-600">艾宾浩斯遗忘曲线</span>自动安排复习计划。
                  </p>
                  <div className="bg-white rounded-xl p-4 mb-3">
                    <p className="text-sm font-bold text-gray-700 mb-2">使用方法：</p>
                    <ol className="text-sm text-gray-600 space-y-1.5">
                      <li className="flex items-start gap-2"><span className="text-cyan-500 font-bold">1.</span> 回到首页，选择单词本进入学习</li>
                      <li className="flex items-start gap-2"><span className="text-cyan-500 font-bold">2.</span> 完成分类记忆学习后，单词自动加入复习计划</li>
                      <li className="flex items-start gap-2"><span className="text-cyan-500 font-bold">3.</span> 系统按间隔提醒你复习：5分钟→30分钟→12小时→1天→2天→4天→7天→15天→30天</li>
                      <li className="flex items-start gap-2"><span className="text-cyan-500 font-bold">4.</span> 复习答对→进入下一阶段；答错→回退2级重新巩固</li>
                      <li className="flex items-start gap-2"><span className="text-cyan-500 font-bold">5.</span> 通过全部9个阶段 = 完全掌握</li>
                    </ol>
                  </div>
                  <button
                    onClick={() => navigate('/student/dashboard')}
                    className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-blue-500 text-white rounded-xl font-medium hover:shadow-lg transition"
                  >
                    去学习单词
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <div className="bg-gradient-to-r from-green-400 to-emerald-500 rounded-2xl p-6 text-white shadow-lg">
              <div className="flex items-center gap-4">
                <span className="text-4xl">🎉</span>
                <div>
                  <h3 className="text-xl font-bold">今日复习已完成!</h3>
                  <p className="text-white/80 text-sm mt-1">
                    {stats?.due_tomorrow ? `明天有 ${stats.due_tomorrow} 个单词需要复习` : '继续保持!'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </motion.div>

        {/* 总体统计 */}
        {stats && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="grid grid-cols-3 gap-4"
          >
            <div className="bg-white rounded-2xl p-4 shadow-sm text-center">
              <p className="text-3xl font-bold text-cyan-600">{stats.total_learned}</p>
              <p className="text-sm text-gray-500 mt-1">已学单词</p>
            </div>
            <div className="bg-white rounded-2xl p-4 shadow-sm text-center">
              <p className="text-3xl font-bold text-green-500">{stats.total_mastered}</p>
              <p className="text-sm text-gray-500 mt-1">已掌握</p>
            </div>
            <div className="bg-white rounded-2xl p-4 shadow-sm text-center">
              <p className="text-3xl font-bold text-blue-500">{stats.retention_rate}%</p>
              <p className="text-sm text-gray-500 mt-1">保留率</p>
            </div>
          </motion.div>
        )}

        {/* 艾宾浩斯记忆曲线 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white rounded-2xl p-6 shadow-lg"
        >
          <h2 className="text-lg font-bold text-gray-800 mb-1">📈 艾宾浩斯遗忘曲线</h2>
          <p className="text-sm text-gray-500 mb-4">
            {retentionData?.message || '理论遗忘曲线 vs 你的实际保留率'}
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

            const W = 600, H = 280;
            const padL = 50, padR = 30, padT = 20, padB = 40;
            const chartW = W - padL - padR;
            const chartH = H - padT - padB;

            const minLog = Math.log(1);
            const maxLog = Math.log(720);
            const xScale = (hours: number) => {
              const logVal = Math.log(Math.max(hours, 1));
              return padL + ((logVal - minLog) / (maxLog - minLog)) * chartW;
            };
            const yScale = (val: number) => padT + chartH - (val / 100) * chartH;

            const theoreticalPath = points
              .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.hours_since_learning)} ${yScale(p.theoretical_retention)}`)
              .join(' ');

            const actualPoints = points.filter(p => p.actual_retention !== null);
            const actualPath = actualPoints
              .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xScale(p.hours_since_learning)} ${yScale(p.actual_retention!)}`)
              .join(' ');

            // 复习节点标记（SRS间隔对应的时间点）
            const reviewIntervals = [0.083, 0.5, 12, 24, 48, 96, 168, 360, 720];

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

                  {/* 复习节点标记线 */}
                  {reviewIntervals.filter(h => h >= 1).map((h, i) => (
                    <line key={`rv-${i}`} x1={xScale(h)} y1={padT} x2={xScale(h)} y2={padT + chartH} stroke="#06b6d4" strokeWidth="1" strokeDasharray="3 3" opacity="0.3" />
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
                <div className="flex items-center justify-center gap-6 mt-3">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-0.5 border-t-2 border-dashed border-red-500" />
                    <span className="text-sm text-gray-600">理论遗忘曲线</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-0.5 bg-blue-500" />
                    <span className="text-sm text-gray-600">实际保留率</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-0.5 border-t border-dashed border-cyan-500" />
                    <span className="text-sm text-gray-600">复习节点</span>
                  </div>
                </div>
              </div>
            );
          })()}
        </motion.div>

        {/* 7天复习预测 */}
        {stats && stats.upcoming_7_days.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
            className="bg-white rounded-2xl p-6 shadow-lg"
          >
            <h2 className="text-lg font-bold text-gray-800 mb-4">📅 7天复习计划</h2>
            <div className="grid grid-cols-7 gap-2">
              {stats.upcoming_7_days.map((day) => {
                const maxCount = Math.max(...stats.upcoming_7_days.map(d => d.count), 1);
                const barHeight = (day.count / maxCount) * 60;
                return (
                  <div
                    key={day.date}
                    className={`flex flex-col items-center p-2 rounded-xl transition-all ${
                      day.is_today ? 'ring-2 ring-cyan-400 bg-cyan-50' : 'bg-gray-50'
                    }`}
                  >
                    <span className={`text-xs font-medium ${day.is_today ? 'text-cyan-600' : 'text-gray-500'}`}>
                      {day.is_today ? '今天' : day.weekday}
                    </span>
                    <div className="w-full flex justify-center items-end h-16 my-2">
                      <div
                        className={`w-6 rounded-t-md transition-all ${
                          day.is_today ? 'bg-gradient-to-t from-cyan-500 to-cyan-300' : 'bg-gradient-to-t from-gray-300 to-gray-200'
                        }`}
                        style={{ height: `${Math.max(barHeight, 4)}px` }}
                      />
                    </div>
                    <span className={`text-lg font-bold ${day.is_today ? 'text-cyan-600' : 'text-gray-700'}`}>
                      {day.count}
                    </span>
                    <span className="text-[10px] text-gray-400">
                      {day.date.slice(5)}
                    </span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* SRS 阶段分布 */}
        {stats && stats.total_learned > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5 }}
            className="bg-white rounded-2xl p-6 shadow-lg"
          >
            <h2 className="text-lg font-bold text-gray-800 mb-4">🎯 学习阶段分布</h2>

            {/* 水平进度条 */}
            <div className="h-8 rounded-full overflow-hidden flex bg-gray-100 mb-4">
              {stats.stage_distribution.map((item) => {
                const percentage = stats.total_learned > 0 ? (item.count / stats.total_learned) * 100 : 0;
                if (percentage === 0) return null;
                return (
                  <div
                    key={item.stage}
                    className="h-full transition-all relative group cursor-pointer"
                    style={{
                      width: `${Math.max(percentage, 2)}%`,
                      backgroundColor: SRS_STAGE_COLORS[item.stage],
                    }}
                    title={`${item.label}: ${item.count}个 (${percentage.toFixed(1)}%)`}
                  />
                );
              })}
            </div>

            {/* 阶段图例 */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
              {stats.stage_distribution.filter(item => item.count > 0).map((item) => (
                <div key={item.stage} className="flex items-center gap-2 text-sm">
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: SRS_STAGE_COLORS[item.stage] }}
                  />
                  <span className="text-gray-600 truncate">{item.label}</span>
                  <span className="font-medium text-gray-800">{item.count}</span>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* 待复习单词列表 */}
        {reviewWords.length > 0 && (() => {
          const totalReviewCount = stats?.due_today || reviewWords.length;
          const totalPages = Math.ceil(reviewWords.length / REVIEW_PAGE_SIZE);
          const pagedWords = reviewWords.slice(
            (reviewPage - 1) * REVIEW_PAGE_SIZE,
            reviewPage * REVIEW_PAGE_SIZE,
          );
          return (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            className="bg-white rounded-2xl p-6 shadow-lg"
          >
            <button
              onClick={() => setShowWordList(!showWordList)}
              className="w-full flex items-center justify-between"
            >
              <h2 className="text-lg font-bold text-gray-800">
                📋 待复习单词 ({totalReviewCount})
              </h2>
              <span className={`text-gray-400 transition-transform ${showWordList ? 'rotate-180' : ''}`}>
                ▼
              </span>
            </button>

            <AnimatePresence>
              {showWordList && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.3 }}
                  className="overflow-hidden"
                >
                  <div className="mt-4 space-y-2">
                    {pagedWords.map((word) => {
                      const badge = getMasteryBadge(word.mastery_level, word.review_stage);
                      return (
                        <div
                          key={word.word_id}
                          className="flex items-center justify-between p-3 rounded-xl bg-gray-50 hover:bg-gray-100 transition-colors"
                        >
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-gray-800">{word.word}</span>
                              {word.phonetic && (
                                <span className="text-sm text-gray-400">{word.phonetic}</span>
                              )}
                            </div>
                            {word.meaning && (
                              <p className="text-sm text-gray-500 mt-0.5">{word.meaning}</p>
                            )}
                          </div>
                          <span className={`text-xs px-2 py-1 rounded-full font-medium ${badge.color}`}>
                            {badge.text}
                          </span>
                        </div>
                      );
                    })}
                  </div>

                  {/* 分页控件 */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-2 mt-4 pt-3 border-t border-gray-100">
                      <button
                        onClick={() => setReviewPage(p => Math.max(1, p - 1))}
                        disabled={reviewPage <= 1}
                        className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        上一页
                      </button>
                      <span className="text-sm text-gray-500">
                        {reviewPage} / {totalPages}
                      </span>
                      <button
                        onClick={() => setReviewPage(p => Math.min(totalPages, p + 1))}
                        disabled={reviewPage >= totalPages}
                        className="px-3 py-1.5 text-sm rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                      >
                        下一页
                      </button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
          );
        })()}

        {/* 空状态 */}
        {stats && stats.total_learned === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="bg-white rounded-2xl p-8 shadow-lg text-center"
          >
            <span className="text-6xl">📚</span>
            <h3 className="text-xl font-bold text-gray-700 mt-4">还没有学习记录</h3>
            <p className="text-gray-500 mt-2">去学习一些单词后,记忆曲线就会出现啦!</p>
            <button
              onClick={() => navigate('/student')}
              className="mt-4 px-6 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 text-white rounded-xl font-medium hover:shadow-lg transition-all"
            >
              去学习
            </button>
          </motion.div>
        )}
      </div>
    </div>
  );
};

export default MemoryCurve;
