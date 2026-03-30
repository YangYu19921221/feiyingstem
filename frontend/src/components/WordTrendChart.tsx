import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { WordTrendResponse, TrendDataItem } from '../api/analytics';

type Period = 'daily' | 'monthly' | 'yearly';

interface WordTrendChartProps {
  fetchData: (period: Period, year?: number, month?: number) => Promise<WordTrendResponse>;
}

const PERIOD_LABELS: Record<Period, string> = { daily: '日', monthly: '月', yearly: '年' };

// 趋势分析：根据数据生成文字总结
function analyzeTrend(data: WordTrendResponse): { icon: string; color: string; messages: string[]; changePercent: number | null } {
  const items = data.data.filter(d => d.words_learned > 0);
  const summary = data.summary;
  const messages: string[] = [];

  if (items.length === 0) {
    return { icon: '📭', color: 'text-gray-400', messages: ['本时段暂无学习记录'], changePercent: null };
  }

  // 环比/同比变化
  const prev = summary.prev_total_words;
  let computedChangePercent: number | null = null;
  if (prev !== undefined && prev > 0) {
    computedChangePercent = Math.round(((summary.total_words - prev) / prev) * 100);
    const label = data.period === 'daily' ? '上月' : '去年';
    if (computedChangePercent > 20) {
      messages.push(`较${label}提升 ${computedChangePercent}%，进步显著！`);
    } else if (computedChangePercent > 0) {
      messages.push(`较${label}提升 ${computedChangePercent}%，继续保持`);
    } else if (computedChangePercent === 0) {
      messages.push(`与${label}持平，尝试突破一下`);
    } else {
      messages.push(`较${label}下降 ${Math.abs(computedChangePercent)}%，需要加把劲`);
    }
  }

  // 学习节奏分析
  if (data.period === 'daily') {
    const totalDays = data.data.length;
    const ratio = items.length / totalDays;
    if (ratio >= 0.8) {
      messages.push(`出勤率 ${Math.round(ratio * 100)}%，学习非常规律`);
    } else if (ratio >= 0.5) {
      messages.push(`出勤率 ${Math.round(ratio * 100)}%，可以更稳定一些`);
    } else if (ratio > 0) {
      messages.push(`出勤率 ${Math.round(ratio * 100)}%，建议每天坚持学习`);
    }
  }

  // 日均单词量评价
  const avg = summary.avg_daily_words;
  if (avg !== undefined) {
    if (avg >= 30) messages.push(`日均 ${avg} 词，效率出色`);
    else if (avg >= 15) messages.push(`日均 ${avg} 词，节奏不错`);
    else if (avg >= 5) messages.push(`日均 ${avg} 词，可以适当加量`);
    else if (avg > 0) messages.push(`日均 ${avg} 词，试着每天多背几个`);
  }

  // 趋势方向（比较前半段和后半段）
  if (items.length >= 4) {
    const half = Math.floor(items.length / 2);
    const firstHalf = items.slice(0, half).reduce((s, d) => s + d.words_learned, 0) / half;
    const secondHalf = items.slice(half).reduce((s, d) => s + d.words_learned, 0) / (items.length - half);
    if (secondHalf > firstHalf * 1.2) {
      messages.push('后半段学习量明显增加，势头很好');
    } else if (secondHalf < firstHalf * 0.7) {
      messages.push('后半段学习量有所下降，注意保持');
    }
  }

  // 综合判定图标和颜色
  const prevW = summary.prev_total_words;
  const isUp = prevW !== undefined && prevW > 0 && summary.total_words > prevW;
  const isDown = prevW !== undefined && prevW > 0 && summary.total_words < prevW * 0.8;

  if (isDown) return { icon: '📉', color: 'text-orange-500', messages, changePercent: computedChangePercent };
  if (isUp) return { icon: '📈', color: 'text-green-500', messages, changePercent: computedChangePercent };
  return { icon: '📊', color: 'text-blue-500', messages, changePercent: computedChangePercent };
}

const WordTrendChart = ({ fetchData }: WordTrendChartProps) => {
  const today = new Date();
  const [period, setPeriod] = useState<Period>('daily');
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [data, setData] = useState<WordTrendResponse | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchData(period, year, month)
      .then(result => { if (!cancelled) setData(result); })
      .catch(e => console.error('加载趋势数据失败:', e))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period, year, month, fetchData]);

  const handlePrev = () => {
    if (period === 'daily') {
      setMonth(m => { if (m === 1) { setYear(y => y - 1); return 12; } return m - 1; });
    } else if (period === 'monthly') {
      setYear(y => y - 1);
    }
  };

  const handleNext = () => {
    if (period === 'daily') {
      setMonth(m => { if (m === 12) { setYear(y => y + 1); return 1; } return m + 1; });
    } else if (period === 'monthly') {
      setYear(y => y + 1);
    }
  };

  const navLabel = period === 'daily' ? `${year}年${month}月` : period === 'monthly' ? `${year}年` : '';

  const items = data?.data || [];
  const summary = data?.summary;
  const trend = useMemo(() => data ? analyzeTrend(data) : null, [data]);
  const hasData = items.some(d => d.words_learned > 0);
  const maxWords = Math.max(...items.map(d => d.words_learned), 1);

  const formatDuration = (mins: number) => {
    if (mins < 60) return `${mins}分钟`;
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m > 0 ? `${h}小时${m}分` : `${h}小时`;
  };

  const changePercent = trend?.changePercent ?? null;

  // 图表参数
  const W = 600, H = 220;
  const padL = 40, padR = 15, padT = 15, padB = 35;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const barCount = items.length || 1;
  const slotW = innerW / barCount;
  const barW = Math.max(4, Math.min(16, slotW * 0.55));

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white rounded-2xl shadow-lg overflow-hidden"
    >
      {/* 头部 */}
      <div className="px-6 pt-5 pb-3">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-gray-800">📊 单词学习趋势</h2>
          <div className="flex bg-gray-100 rounded-lg p-0.5">
            {(['daily', 'monthly', 'yearly'] as Period[]).map(p => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition ${
                  period === p ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {PERIOD_LABELS[p]}
              </button>
            ))}
          </div>
        </div>

        {/* 日期导航 + 变化指标 */}
        <div className="flex items-center justify-between">
          {period !== 'yearly' ? (
            <div className="flex items-center gap-3">
              <button onClick={handlePrev} className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 text-sm transition">◀</button>
              <span className="text-sm font-medium text-gray-700 min-w-[90px] text-center">{navLabel}</span>
              <button onClick={handleNext} className="w-7 h-7 rounded-full bg-gray-100 hover:bg-gray-200 flex items-center justify-center text-gray-500 text-sm transition">▶</button>
            </div>
          ) : <div />}

          {/* 环比变化标签 */}
          {changePercent !== null && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${
                changePercent > 0
                  ? 'bg-green-50 text-green-600'
                  : changePercent < 0
                  ? 'bg-red-50 text-red-500'
                  : 'bg-gray-50 text-gray-500'
              }`}
            >
              <span>{changePercent > 0 ? '↑' : changePercent < 0 ? '↓' : '→'}</span>
              <span>{changePercent > 0 ? '+' : ''}{changePercent}%</span>
              <span className="text-gray-400">vs {period === 'daily' ? '上月' : '去年'}</span>
            </motion.div>
          )}
        </div>
      </div>

      {/* 图表区 */}
      <div className="px-4">
        {loading ? (
          <div className="h-52 flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
          </div>
        ) : !hasData ? (
          <div className="h-52 flex items-center justify-center text-gray-400">
            <div className="text-center">
              <span className="text-4xl block mb-2">📚</span>
              <p>暂无学习数据</p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[600px] mx-auto">
              {/* 背景色带 */}
              <rect x={padL} y={padT} width={innerW} height={innerH} fill="#FAFBFC" rx="4" />

              {/* Y 轴刻度 */}
              {[0, 0.25, 0.5, 0.75, 1].map(pct => {
                const y = padT + innerH * (1 - pct);
                return (
                  <g key={pct}>
                    <line x1={padL} y1={y} x2={padL + innerW} y2={y} stroke={pct === 0 ? '#E5E7EB' : '#F3F4F6'} strokeWidth="1" />
                    <text x={padL - 6} y={y + 3} textAnchor="end" className="text-[9px]" fill="#9CA3AF">{Math.round(maxWords * pct)}</text>
                  </g>
                );
              })}

              {/* 柱状图 */}
              {items.map((item, i) => {
                const cx = padL + slotW * i + slotW / 2;
                const h = (item.words_learned / maxWords) * innerH;
                const barX = cx - barW / 2;

                // 渐变色根据数值
                const intensity = item.words_learned / maxWords;
                const fill = intensity > 0.7 ? '#3B82F6' : intensity > 0.3 ? '#60A5FA' : '#93C5FD';

                return (
                  <g key={i}>
                    <motion.rect
                      x={barX}
                      width={barW}
                      rx={barW > 8 ? 4 : 2}
                      fill={fill}
                      initial={{ height: 0, y: padT + innerH }}
                      animate={{ height: Math.max(h, 1), y: padT + innerH - Math.max(h, 1) }}
                      transition={{ delay: i * 0.015, duration: 0.4, ease: 'easeOut' }}
                    />

                    {/* 柱顶数值（只在柱子够高时显示） */}
                    {h > 15 && (
                      <motion.text
                        x={cx}
                        y={padT + innerH - h - 4}
                        textAnchor="middle"
                        className="text-[8px]"
                        fill="#3B82F6"
                        fontWeight="600"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: i * 0.015 + 0.3 }}
                      >
                        {item.words_learned}
                      </motion.text>
                    )}

                    {/* X 轴标签 */}
                    {(period !== 'daily' || i % Math.max(1, Math.floor(barCount / 12)) === 0) && (
                      <text x={cx} y={H - 8} textAnchor="middle" className="text-[9px]" fill="#9CA3AF">
                        {period === 'daily' ? item.label.split('/')[1]
                          : item.label.replace('月', '').replace('年', '')}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* 掌握单词折线（如果有数据） */}
              {items.some(d => d.words_mastered && d.words_mastered > 0) && (
                <>
                  <motion.path
                    d={items.map((item, i) => {
                      const cx = padL + slotW * i + slotW / 2;
                      const y = padT + innerH - ((item.words_mastered || 0) / maxWords) * innerH;
                      return `${i === 0 ? 'M' : 'L'} ${cx} ${y}`;
                    }).join(' ')}
                    fill="none"
                    stroke="#22C55E"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.8, delay: 0.4 }}
                  />
                  {items.map((item, i) => {
                    if (!item.words_mastered) return null;
                    const cx = padL + slotW * i + slotW / 2;
                    const y = padT + innerH - (item.words_mastered / maxWords) * innerH;
                    return <circle key={`m-${i}`} cx={cx} cy={y} r="2.5" fill="#22C55E" />;
                  })}
                </>
              )}
            </svg>
          </div>
        )}
      </div>

      {/* 图例 */}
      {hasData && (
        <div className="flex items-center justify-center gap-5 px-6 py-2">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-sm bg-blue-500" />
            <span className="text-xs text-gray-500">学习单词</span>
          </div>
          {items.some(d => d.words_mastered && d.words_mastered > 0) && (
            <div className="flex items-center gap-1.5">
              <div className="w-4 h-0.5 bg-green-500 rounded" />
              <span className="text-xs text-gray-500">掌握单词</span>
            </div>
          )}
        </div>
      )}

      {/* 统计卡片 + 趋势总结 */}
      {hasData && summary && (
        <div className="px-6 pb-5">
          {/* 数据卡片 */}
          <div className="grid grid-cols-4 gap-2 mb-4">
            <div className="bg-blue-50 rounded-xl p-2.5 text-center">
              <div className="text-lg font-bold text-blue-600">{summary.total_words}</div>
              <div className="text-[10px] text-gray-500">学习单词</div>
            </div>
            <div className="bg-green-50 rounded-xl p-2.5 text-center">
              <div className="text-lg font-bold text-green-600">{summary.total_mastered ?? '-'}</div>
              <div className="text-[10px] text-gray-500">已掌握</div>
            </div>
            <div className="bg-orange-50 rounded-xl p-2.5 text-center">
              <div className="text-lg font-bold text-orange-600">{formatDuration(summary.total_duration_minutes)}</div>
              <div className="text-[10px] text-gray-500">学习时长</div>
            </div>
            <div className="bg-purple-50 rounded-xl p-2.5 text-center">
              <div className="text-lg font-bold text-purple-600">{summary.avg_daily_words ?? summary.study_days}</div>
              <div className="text-[10px] text-gray-500">{summary.avg_daily_words !== undefined ? '日均单词' : '学习天数'}</div>
            </div>
          </div>

          {/* AI 趋势总结 */}
          {trend && trend.messages.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="bg-gradient-to-r from-gray-50 to-blue-50/50 rounded-xl p-4"
            >
              <div className="flex items-start gap-3">
                <span className="text-2xl flex-shrink-0">{trend.icon}</span>
                <div className="space-y-1.5">
                  {trend.messages.map((msg, i) => (
                    <p key={i} className={`text-sm ${i === 0 ? `font-medium ${trend.color}` : 'text-gray-500'}`}>
                      {i === 0 ? msg : `· ${msg}`}
                    </p>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </div>
      )}
    </motion.div>
  );
};

export default WordTrendChart;
