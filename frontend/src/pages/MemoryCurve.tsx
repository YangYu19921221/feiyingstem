import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, HelpCircle } from 'lucide-react';
import ReviewRulesModal from '../components/ReviewRulesModal';
import {
  getMemoryCurveStats,
  getReviewDueWords,
  getReviewProgress,
  type MemoryCurveStats,
  type ReviewWord,
  type ReviewProgress,
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

// 复习分组:按掌握度把今日待复习词分成 薄弱/一般/熟练 三档(已毕业词不在待复习列表里)
type ReviewTier = 'weak' | 'medium' | 'fluent';

const tierOf = (level: number): ReviewTier => {
  if (level >= 4) return 'fluent';
  if (level >= 2) return 'medium';
  return 'weak';
};

// 三档视觉:珊瑚红=薄弱(最该补) / 琥珀=一般 / 草绿=熟练。OKLCH 暖色系
const TIER_META: Record<ReviewTier, {
  key: ReviewTier; emoji: string; name: string; hint: string;
  fill: string; edge: string; text: string; dot: string;
}> = {
  weak: {
    key: 'weak', emoji: '🌱', name: '薄弱', hint: '最该补的词，先把它们拿下',
    fill: 'oklch(0.965 0.035 25)', edge: 'oklch(0.82 0.11 25)',
    text: 'oklch(0.52 0.17 25)', dot: 'oklch(0.65 0.2 25)',
  },
  medium: {
    key: 'medium', emoji: '⚡', name: '一般', hint: '再巩固一遍就稳了',
    fill: 'oklch(0.965 0.05 80)', edge: 'oklch(0.83 0.1 78)',
    text: 'oklch(0.5 0.12 68)', dot: 'oklch(0.72 0.15 75)',
  },
  fluent: {
    key: 'fluent', emoji: '✨', name: '熟练', hint: '快毕业了，确认一遍就过',
    fill: 'oklch(0.96 0.05 150)', edge: 'oklch(0.8 0.12 150)',
    text: 'oklch(0.46 0.12 150)', dot: 'oklch(0.72 0.16 150)',
  },
};
const TIER_ORDER: ReviewTier[] = ['weak', 'medium', 'fluent'];

const MemoryCurve = () => {
  const navigate = useNavigate();
  // 当前学生身份，给家长拍照时辨认是谁
  const me = (() => {
    try { return JSON.parse(localStorage.getItem('user') || '{}'); }
    catch { return {}; }
  })();
  const myName: string = me.full_name || me.username || '同学';
  const myAccount: string = me.username || '';
  const [stats, setStats] = useState<MemoryCurveStats | null>(null);
  const [progress, setProgress] = useState<ReviewProgress | null>(null);
  const [retentionData, setRetentionData] = useState<RetentionCurveResponse | null>(null);
  const [reviewWords, setReviewWords] = useState<ReviewWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showWordList, setShowWordList] = useState(false);
  const [startingReview, setStartingReview] = useState(false);
  const [reviewPage, setReviewPage] = useState(1);
  const [showRules, setShowRules] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  // 首次进入复习页自动弹一次规则说明
  useEffect(() => {
    try {
      if (!localStorage.getItem('review_rules_seen')) {
        setShowRules(true);
        localStorage.setItem('review_rules_seen', '1');
      }
    } catch {}
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [statsData, retentionRes, wordsData, progressData] = await Promise.all([
        getMemoryCurveStats(),
        getRetentionCurve().catch(() => null),
        getReviewDueWords(500),  // 不限上限：把今日全部到期词都拿回来
        getReviewProgress().catch(() => null),
      ]);
      setStats(statsData);
      setRetentionData(retentionRes);
      setReviewWords(wordsData || []);
      setProgress(progressData);
    } catch (error) {
      console.error('加载记忆曲线数据失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleStartReview = async (subset?: ReviewWord[]) => {
    const list = subset && subset.length > 0 ? subset : reviewWords;
    if (list.length === 0) return;
    setStartingReview(true);
    try {
      // 把待复习词传给 FlashCardLearning（可只传某一档）
      const wordData = list.map((w, index) => ({
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

  // 今日待复习词按掌握度分三档,供分组复习
  const tierGroups = {
    weak: reviewWords.filter(w => tierOf(w.mastery_level) === 'weak'),
    medium: reviewWords.filter(w => tierOf(w.mastery_level) === 'medium'),
    fluent: reviewWords.filter(w => tierOf(w.mastery_level) === 'fluent'),
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <p className="text-ink-mute text-sm">加载中…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper">
      {/* 顶部导航 */}
      <nav className="border-b border-black/[0.06] bg-paper/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-5 py-3.5 flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-ink-soft hover:text-ink transition text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            返回
          </button>
          <h1 className="font-display text-base font-semibold text-ink">记忆曲线</h1>
          <button
            onClick={() => setShowRules(true)}
            className="flex items-center gap-1 text-ink-soft hover:text-accent-warm transition text-xs"
            title="复习规则"
          >
            <HelpCircle className="w-4 h-4" />
            规则
          </button>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-5 py-10 space-y-10">
        {/* 学生身份：家长拍照时一眼知道是谁 */}
        <div className="flex items-center gap-2.5 -mb-4">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-accent-warm/15 text-accent-warm text-base font-bold">
            {myName.slice(0, 1)}
          </span>
          <div className="leading-tight">
            <p className="font-display text-base font-semibold text-ink">{myName}</p>
            {myAccount && <p className="text-ink-mute text-xs">账号 @{myAccount}</p>}
          </div>
        </div>

        {/* Hero：今日复习 */}
        <section>
          {stats && stats.due_today > 0 ? (
            <>
              <p className="text-ink-mute text-sm mb-2">今日复习</p>
              <h2 className="font-display text-4xl md:text-5xl font-semibold text-ink leading-[1.05] tracking-tight mb-4">
                <span className="font-numeric text-accent-warm">{progress?.review_due_today ?? stats.due_today}</span>{' '}
                <span className="text-ink-soft">个该回顾的词</span>
              </h2>
              {progress && (progress.review_done_today > 0 || progress.review_due_today > 0) && (() => {
                const total = progress.review_done_today + progress.review_due_today;
                const pct = total > 0 ? Math.round((progress.review_done_today / total) * 100) : 0;
                return (
                  <div className="max-w-xl mb-5">
                    <div className="flex items-baseline justify-between text-sm mb-1.5">
                      <span className="text-ink-soft">今日进度</span>
                      <span className="text-ink-soft">
                        已复习 <span className="font-numeric text-ink font-semibold">{progress.review_done_today}</span>
                        {' / 共 '}
                        <span className="font-numeric text-ink font-semibold">{total}</span>
                      </span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden bg-black/5">
                      <div
                        className="h-full bg-accent-warm transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })()}
              <p className="text-ink-soft text-base max-w-xl leading-relaxed mb-6">
                按掌握度分成三组，先啃硬骨头再确认熟词；今日全部清零会触发庆祝 🎉
              </p>

              {/* 分组复习:薄弱/一般/熟练，各组单独开练，薄弱排首位最该先做 */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                {TIER_ORDER.map((t) => {
                  const meta = TIER_META[t];
                  const group = tierGroups[t];
                  const empty = group.length === 0;
                  return (
                    <button
                      key={t}
                      onClick={() => !empty && handleStartReview(group)}
                      disabled={empty || startingReview}
                      className="text-left rounded-2xl p-4 transition disabled:opacity-45 disabled:cursor-not-allowed enabled:hover:-translate-y-0.5"
                      style={{
                        background: meta.fill,
                        border: `1px solid ${meta.edge}`,
                        boxShadow: empty ? 'none' : `0 8px 20px -12px ${meta.edge}`,
                      }}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-2xl">{meta.emoji}</span>
                        <span className="font-numeric font-bold text-3xl" style={{ color: meta.text }}>
                          {group.length}
                        </span>
                      </div>
                      <p className="font-display font-semibold text-base" style={{ color: meta.text }}>
                        {meta.name}
                      </p>
                      <p className="text-xs mt-0.5 leading-snug" style={{ color: meta.text, opacity: 0.78 }}>
                        {empty ? '这组今天没有待复习的词' : meta.hint}
                      </p>
                      {!empty && (
                        <span className="inline-block mt-3 text-xs font-semibold" style={{ color: meta.text }}>
                          复习这组 →
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <button
                onClick={() => handleStartReview()}
                disabled={startingReview}
                className="px-7 py-3.5 bg-accent-warm text-white rounded-xl text-base font-semibold hover:opacity-90 transition disabled:opacity-50"
              >
                {startingReview ? '准备中…' : `全部一起复习 (${reviewWords.length}) →`}
              </button>
            </>
          ) : stats && stats.total_learned === 0 ? (
            <>
              <h2 className="font-display text-3xl md:text-4xl font-semibold text-ink leading-[1.1] tracking-tight mb-4">
                还没开始学习
              </h2>
              <p className="text-ink-soft text-base max-w-xl leading-relaxed mb-6">
                完成新单词学习后，系统按艾宾浩斯曲线自动安排复习：5 分 → 30 分 → 12 时 → 1 天 → 2 天 → 4 天 → 7 天 → 15 天 → 30 天。答对进下一阶段；答错回退 2 级。
              </p>
              <button
                onClick={() => navigate('/student/dashboard')}
                className="px-7 py-3.5 bg-accent-warm text-white rounded-xl text-base font-semibold hover:opacity-90 transition"
              >
                去学习单词 →
              </button>
            </>
          ) : (
            <>
              <h2 className="font-display text-3xl md:text-4xl font-semibold text-ink leading-[1.1] tracking-tight mb-3">
                🎉 今日复习已清零
              </h2>
              <p className="text-ink-soft text-base">
                今日已复习 <span className="font-numeric font-semibold text-ink">{progress?.review_done_today ?? 0}</span> 个单词。
                {stats?.due_tomorrow ? ` 明天有 ${stats.due_tomorrow} 个等你回顾。` : ' 继续保持节奏。'}
              </p>
            </>
          )}
        </section>

        {/* 复习全景 3 个数字 */}
        {progress && (stats?.total_learned ?? 0) > 0 && (
          <section className="grid grid-cols-3 gap-3">
            {[
              { label: '今日待复习', value: progress.review_due_today, tone: 'text-accent-warm' },
              { label: '今日已复习', value: progress.review_done_today, tone: 'text-ink' },
              { label: '已毕业单词', value: progress.graduated_words, tone: 'text-green-600' },
            ].map((m) => (
              <div key={m.label} className="bg-white rounded-2xl border border-black/[0.05] p-4 text-center">
                <p className="text-ink-soft text-xs mb-1">{m.label}</p>
                <p className={`font-numeric font-bold text-3xl ${m.tone}`}>{m.value}</p>
              </div>
            ))}
          </section>
        )}

        {/* 总体统计 — 数据条带 */}
        {stats && (
          <section>
            <div className="bg-white rounded-2xl border border-black/[0.05] divide-y divide-black/[0.05]">
              {[
                { label: '已学单词', value: stats.total_learned, suffix: '' },
                { label: '已掌握', value: stats.total_mastered, suffix: '' },
                { label: '保留率', value: stats.retention_rate, suffix: '%' },
              ].map((row) => (
                <div key={row.label} className="px-5 py-4 flex items-baseline justify-between">
                  <span className="text-ink-soft text-sm">{row.label}</span>
                  <span className="font-display font-semibold text-2xl text-ink font-numeric">
                    {row.value}{row.suffix && <span className="text-base text-ink-soft">{row.suffix}</span>}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* 艾宾浩斯记忆曲线 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="bg-white rounded-2xl p-6 border border-black/[0.05]"
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
            className="bg-white rounded-2xl p-6 border border-black/[0.05]"
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
            className="bg-white rounded-2xl p-6 border border-black/[0.05]"
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
            className="bg-white rounded-2xl p-6 border border-black/[0.05]"
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

      <ReviewRulesModal
        open={showRules}
        onClose={() => setShowRules(false)}
        audience="student"
      />
    </div>
  );
};

export default MemoryCurve;
