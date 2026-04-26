/**
 * 分类记忆学习 - 总结页
 * - groupSummary: 轻量小结，快速进入下一组
 * - finalSummary: 颁奖典礼级别仪式感，国风赛博配色
 */
import { motion } from 'framer-motion';
import { useMemo } from 'react';
import type { DictationResult } from './DictationPhase';
import type { FillBlankResult } from './SentenceFillPhase';

interface ClassifySummaryProps {
  dictationResults: DictationResult[];
  fillBlankResults: FillBlankResult[];
  totalWords: number;
  startTime: number;
  onBack: () => void;
  mode?: 'groupSummary' | 'finalSummary';
  groupIndex?: number;
  totalGroups?: number;
  onNextGroup?: () => void;
}

interface Rank {
  emoji: string;
  label: string;
  subtitle: string;
  ringColor: string;
  glow: string;
  textGradient: string;
}

function getRank(rate: number): Rank {
  if (rate === 100) return {
    emoji: '👑',
    label: 'PERFECT',
    subtitle: '满分通关 · 传说级表现',
    ringColor: '#FCD34D',
    glow: 'drop-shadow(0 0 24px #FCD34D) drop-shadow(0 0 60px #F97316)',
    textGradient: 'linear-gradient(135deg, #FCD34D 0%, #F97316 50%, #DC2626 100%)',
  };
  if (rate >= 90) return {
    emoji: '🏆',
    label: 'EXCELLENT',
    subtitle: '优秀 · 几乎完美',
    ringColor: '#A855F7',
    glow: 'drop-shadow(0 0 16px #A855F7) drop-shadow(0 0 40px #6366F1)',
    textGradient: 'linear-gradient(135deg, #A855F7 0%, #6366F1 100%)',
  };
  if (rate >= 80) return {
    emoji: '🌟',
    label: 'GREAT',
    subtitle: '非常棒 · 已掌握',
    ringColor: '#06B6D4',
    glow: 'drop-shadow(0 0 12px #06B6D4) drop-shadow(0 0 32px #0EA5E9)',
    textGradient: 'linear-gradient(135deg, #06B6D4 0%, #0EA5E9 100%)',
  };
  if (rate >= 60) return {
    emoji: '💪',
    label: 'GOOD',
    subtitle: '不错 · 继续巩固',
    ringColor: '#F59E0B',
    glow: 'drop-shadow(0 0 8px #F59E0B)',
    textGradient: 'linear-gradient(135deg, #F59E0B 0%, #EA580C 100%)',
  };
  return {
    emoji: '📚',
    label: 'KEEP GOING',
    subtitle: '再接再厉',
    ringColor: '#EF4444',
    glow: 'none',
    textGradient: 'linear-gradient(135deg, #EF4444 0%, #DC2626 100%)',
  };
}

const rateColor = (rate: number) =>
  rate >= 80 ? 'text-emerald-400' : rate >= 50 ? 'text-amber-400' : 'text-rose-400';

function StarDust({ count = 40 }: { count?: number }) {
  const stars = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: 4 + Math.random() * 8,
        delay: Math.random() * 4,
        duration: 3 + Math.random() * 4,
        symbol: ['★', '✦', '◆', '·'][Math.floor(Math.random() * 4)],
      })),
    [count],
  );
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {stars.map(s => (
        <motion.span
          key={s.id}
          className="absolute select-none"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            fontSize: s.size,
            color: '#FCD34D',
            filter: `drop-shadow(0 0 ${s.size}px #FCD34D)`,
          }}
          initial={{ opacity: 0, scale: 0.4 }}
          animate={{ opacity: [0, 1, 0], scale: [0.4, 1.2, 0.4], y: [0, -30, -60] }}
          transition={{ duration: s.duration, delay: s.delay, repeat: Infinity, repeatDelay: 1 }}
        >
          {s.symbol}
        </motion.span>
      ))}
    </div>
  );
}

export default function ClassifySummary({
  dictationResults,
  fillBlankResults,
  totalWords,
  startTime,
  onBack,
  mode = 'finalSummary',
  groupIndex = 0,
  totalGroups = 1,
  onNextGroup,
}: ClassifySummaryProps) {
  const totalSeconds = Math.round((Date.now() - startTime) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  const dictTotal = dictationResults.length;
  const dictCorrect = dictationResults.filter(r => r.isCorrect).length;
  const dictRate = dictTotal > 0 ? Math.round((dictCorrect / dictTotal) * 100) : 0;
  const dictWrong = dictationResults.filter(r => !r.isCorrect);

  const fillTotal = fillBlankResults.length;
  const fillCorrect = fillBlankResults.filter(r => r.isCorrect).length;
  const fillRate = fillTotal > 0 ? Math.round((fillCorrect / fillTotal) * 100) : 0;
  const fillWrong = fillBlankResults.filter(r => !r.isCorrect);

  const allTotal = dictTotal + fillTotal;
  const allCorrect = dictCorrect + fillCorrect;
  const overallRate = allTotal > 0 ? Math.round((allCorrect / allTotal) * 100) : 100;

  // ========== groupSummary：轻量小结 ==========
  if (mode === 'groupSummary') {
    return (
      <div className="flex flex-col items-center justify-center min-h-[70vh] px-4">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-3xl shadow-lg p-8 w-full max-w-md"
        >
          <div className="text-center mb-6">
            <span className="text-5xl block mb-2">👏</span>
            <h2 className="text-2xl font-bold text-gray-800">第{groupIndex + 1}组完成</h2>
            <p className="text-gray-500 text-sm mt-1">
              第{groupIndex + 1}/{totalGroups}组 · {totalWords} 个单词
            </p>
          </div>
          <div className="flex justify-center mb-6">
            <div className="relative">
              <svg width="160" height="160" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="42" fill="none" stroke="#e5e7eb" strokeWidth="6" />
                <motion.circle
                  cx="50" cy="50" r="42" fill="none"
                  stroke={overallRate >= 80 ? '#10B981' : overallRate >= 50 ? '#F59E0B' : '#EF4444'}
                  strokeWidth="6"
                  strokeLinecap="round"
                  strokeDasharray={2 * Math.PI * 42}
                  initial={{ strokeDashoffset: 2 * Math.PI * 42 }}
                  animate={{ strokeDashoffset: 2 * Math.PI * 42 * (1 - overallRate / 100) }}
                  transition={{ duration: 1, delay: 0.3, ease: 'easeOut' }}
                  transform="rotate(-90 50 50)"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={`text-4xl font-black ${rateColor(overallRate)}`}>
                  {overallRate}<span className="text-lg align-top">%</span>
                </span>
                <span className="text-xs text-gray-400 mt-0.5">总正确率</span>
              </div>
            </div>
          </div>
          {onNextGroup && (
            <div className="space-y-3">
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={onNextGroup}
                className="w-full py-3 rounded-2xl text-lg font-medium bg-primary text-white shadow-lg hover:opacity-90"
              >
                继续第{groupIndex + 2}组
              </motion.button>
              <p className="text-center text-xs text-gray-400">
                还剩 {totalGroups - groupIndex - 1} 组未学
              </p>
            </div>
          )}
        </motion.div>
      </div>
    );
  }

  // ========== finalSummary：颁奖典礼级别 ==========
  const rank = getRank(overallRate);
  const isPerfect = overallRate === 100;

  return (
    <div
      className="relative flex flex-col items-center justify-start min-h-screen px-4 py-8 overflow-hidden -mt-6"
      style={{
        background: 'radial-gradient(ellipse at top, #1E1B4B 0%, #0F172A 40%, #020617 100%)',
      }}
    >
      <StarDust count={isPerfect ? 60 : 35} />

      <motion.div
        initial={{ opacity: 0, y: 30, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-md"
      >
        {/* 顶部奖杯 */}
        <motion.div
          initial={{ scale: 0, rotate: -30 }}
          animate={{ scale: 1, rotate: 0 }}
          transition={{ delay: 0.2, type: 'spring', damping: 10, stiffness: 180 }}
          className="text-center mb-2"
        >
          <span
            className="text-8xl inline-block"
            style={{ filter: rank.glow }}
          >
            {rank.emoji}
          </span>
        </motion.div>

        {/* 评级文字 */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="text-center mb-6"
        >
          <h1
            className="text-5xl font-black tracking-wider"
            style={{
              background: rank.textGradient,
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              filter: isPerfect ? 'drop-shadow(0 0 20px #FCD34D)' : 'none',
            }}
          >
            {rank.label}
          </h1>
          <p className="mt-2 text-base text-slate-300">{rank.subtitle}</p>
        </motion.div>

        {/* 大圆环 */}
        <div className="flex justify-center mb-6">
          <div className="relative">
            <svg width="240" height="240" viewBox="0 0 100 100">
              <defs>
                <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor={rank.ringColor} />
                  <stop offset="100%" stopColor={isPerfect ? '#F97316' : rank.ringColor} />
                </linearGradient>
              </defs>
              <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="5" />
              <motion.circle
                cx="50" cy="50" r="42" fill="none"
                stroke="url(#ringGrad)"
                strokeWidth="5"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 42}
                initial={{ strokeDashoffset: 2 * Math.PI * 42 }}
                animate={{ strokeDashoffset: 2 * Math.PI * 42 * (1 - overallRate / 100) }}
                transition={{ duration: 1.4, delay: 0.6, ease: 'easeOut' }}
                transform="rotate(-90 50 50)"
                style={{ filter: rank.glow }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <motion.span
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 1.0, type: 'spring', stiffness: 220, damping: 12 }}
                className="text-7xl font-black tracking-tight leading-none"
                style={{
                  background: rank.textGradient,
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  WebkitTextStroke: isPerfect ? '0.5px #FCD34D' : 'none',
                }}
              >
                {overallRate}
              </motion.span>
              <span className="text-sm text-slate-400 tracking-widest mt-1">% 总正确率</span>
            </div>
          </div>
        </div>

        {/* 数据卡片三联（玻璃拟态） */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 1.2 }}
          className="grid grid-cols-3 gap-3 mb-6"
        >
          <div
            className="rounded-2xl p-3 text-center backdrop-blur"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <div className="text-2xl font-bold text-white">{totalWords}</div>
            <div className="text-xs text-slate-400 mt-1">单词总数</div>
          </div>
          <div
            className="rounded-2xl p-3 text-center backdrop-blur"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <div className="text-2xl font-bold text-emerald-400">{allCorrect}</div>
            <div className="text-xs text-slate-400 mt-1">答对题数</div>
          </div>
          <div
            className="rounded-2xl p-3 text-center backdrop-blur"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <div className="text-2xl font-bold text-cyan-400">
              {minutes > 0 ? `${minutes}` : seconds}
              <span className="text-sm text-slate-400 ml-0.5">{minutes > 0 ? '分' : '秒'}</span>
            </div>
            <div className="text-xs text-slate-400 mt-1">学习用时</div>
          </div>
        </motion.div>

        {/* 听写 / 句子填空 详细面板 */}
        {dictTotal > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.4 }}
            className="rounded-2xl p-4 mb-3 backdrop-blur"
            style={{ background: 'rgba(59,130,246,0.12)', border: '1px solid rgba(59,130,246,0.3)' }}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-blue-300">✍️ 听写</h3>
              <span className={`text-xl font-black ${rateColor(dictRate)}`}>{dictRate}%</span>
            </div>
            <p className="text-xs text-slate-400">
              {dictCorrect}/{dictTotal} 正确{dictWrong.length > 0 && ` · ${dictWrong.length} 个首轮拼错`}
            </p>
            {dictWrong.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {dictWrong.map(r => (
                  <span
                    key={r.wordId}
                    className="px-2 py-0.5 bg-rose-500/20 text-rose-300 rounded text-xs font-medium border border-rose-500/30"
                  >
                    {r.word}
                  </span>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {fillTotal > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.5 }}
            className="rounded-2xl p-4 mb-6 backdrop-blur"
            style={{ background: 'rgba(168,85,247,0.12)', border: '1px solid rgba(168,85,247,0.3)' }}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-violet-300">📝 句子填空</h3>
              <span className={`text-xl font-black ${rateColor(fillRate)}`}>{fillRate}%</span>
            </div>
            <p className="text-xs text-slate-400">
              {fillCorrect}/{fillTotal} 正确{fillWrong.length > 0 && ` · ${fillWrong.length} 个首轮填错`}
            </p>
            {fillWrong.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {fillWrong.map(r => (
                  <span
                    key={r.wordId}
                    className="px-2 py-0.5 bg-rose-500/20 text-rose-300 rounded text-xs font-medium border border-rose-500/30"
                  >
                    {r.word}
                  </span>
                ))}
              </div>
            )}
          </motion.div>
        )}

        {/* 阶段勋章 */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.6 }}
          className="flex items-center justify-center gap-3 mb-8"
        >
          {[
            { label: '分类', emoji: '🧠' },
            { label: '听写', emoji: '✍️' },
            { label: '过关', emoji: '🎯' },
            { label: '完成', emoji: '✅' },
          ].map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 1.7 + i * 0.12, type: 'spring', stiffness: 200, damping: 12 }}
              className="flex flex-col items-center gap-1"
            >
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-xl"
                style={{
                  background: 'linear-gradient(135deg, rgba(252,211,77,0.2), rgba(249,115,22,0.2))',
                  border: '1.5px solid rgba(252,211,77,0.4)',
                  boxShadow: '0 0 12px rgba(252,211,77,0.3)',
                }}
              >
                {s.emoji}
              </div>
              <span className="text-xs text-slate-400">{s.label}</span>
            </motion.div>
          ))}
        </motion.div>

        {/* 返回按钮 */}
        <motion.button
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 2.2 }}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          onClick={onBack}
          className="w-full py-4 rounded-2xl text-lg font-bold text-white shadow-2xl"
          style={{
            background: rank.textGradient,
            boxShadow: `0 8px 32px ${rank.ringColor}66`,
          }}
        >
          返回首页 →
        </motion.button>
      </motion.div>
    </div>
  );
}
