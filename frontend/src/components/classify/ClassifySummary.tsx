/**
 * 分类记忆学习 - 总结页
 * 听写结果 + 句子填空结果 + 学习耗时
 */
import { motion } from 'framer-motion';
import type { DictationResult } from './DictationPhase';
import type { FillBlankResult } from './SentenceFillPhase';

interface ClassifySummaryProps {
  dictationResults: DictationResult[];
  fillBlankResults: FillBlankResult[];
  totalWords: number;
  startTime: number;
  onBack: () => void;
  /** 组内小结模式：显示"继续下一组"按钮 */
  mode?: 'groupSummary' | 'finalSummary';
  /** 当前组索引（0开始） */
  groupIndex?: number;
  /** 总组数 */
  totalGroups?: number;
  /** 点击"继续下一组" */
  onNextGroup?: () => void;
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
  // 学习耗时
  const totalSeconds = Math.round((Date.now() - startTime) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  // 听写统计
  const dictTotal = dictationResults.length;
  const dictCorrect = dictationResults.filter(r => r.isCorrect).length;
  const dictRate = dictTotal > 0 ? Math.round((dictCorrect / dictTotal) * 100) : 0;
  const dictWrong = dictationResults.filter(r => !r.isCorrect);

  // 句子填空统计
  const fillTotal = fillBlankResults.length;
  const fillCorrect = fillBlankResults.filter(r => r.isCorrect).length;
  const fillRate = fillTotal > 0 ? Math.round((fillCorrect / fillTotal) * 100) : 0;
  const fillWrong = fillBlankResults.filter(r => !r.isCorrect);

  // 总正确率
  const allTotal = dictTotal + fillTotal;
  const allCorrect = dictCorrect + fillCorrect;
  const overallRate = allTotal > 0 ? Math.round((allCorrect / allTotal) * 100) : 100;

  const rateColor = (rate: number) =>
    rate >= 80 ? 'text-green-600' : rate >= 50 ? 'text-orange-600' : 'text-red-600';

  return (
    <div className="flex flex-col items-center justify-center min-h-[70vh] px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-3xl shadow-lg p-8 w-full max-w-md"
      >
        {/* 标题 */}
        <div className="text-center mb-6">
          <span className="text-5xl block mb-2">{mode === 'groupSummary' ? '👏' : '🎉'}</span>
          <h2 className="text-2xl font-bold text-gray-800">
            {mode === 'groupSummary' ? `第${groupIndex + 1}组完成` : '学习完成'}
          </h2>
          <p className="text-gray-500 text-sm mt-1">
            {mode === 'groupSummary'
              ? `第${groupIndex + 1}/${totalGroups}组 · ${totalWords} 个单词`
              : `共学习 ${totalWords} 个单词 · 用时 ${minutes > 0 ? `${minutes}分` : ''}${seconds}秒`
            }
          </p>
        </div>

        {/* 总体得分圆环 */}
        <div className="flex justify-center mb-6">
          <div className="relative">
            <svg width="100" height="100" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="40" fill="none" stroke="#e5e7eb" strokeWidth="8" />
              <motion.circle
                cx="50" cy="50" r="40" fill="none"
                stroke={overallRate >= 80 ? '#5FD35F' : overallRate >= 50 ? '#FF9F43' : '#FF5757'}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={2 * Math.PI * 40}
                initial={{ strokeDashoffset: 2 * Math.PI * 40 }}
                animate={{ strokeDashoffset: 2 * Math.PI * 40 * (1 - overallRate / 100) }}
                transition={{ duration: 1, delay: 0.3 }}
                transform="rotate(-90 50 50)"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={`text-2xl font-bold ${rateColor(overallRate)}`}>{overallRate}%</span>
              <span className="text-xs text-gray-400">总正确率</span>
            </div>
          </div>
        </div>

        {/* 听写结果 */}
        {dictTotal > 0 && (
          <div className="mb-4 p-4 bg-blue-50 rounded-2xl">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-blue-700">✍️ 听写</h3>
              <span className={`text-lg font-bold ${rateColor(dictRate)}`}>{dictRate}%</span>
            </div>
            <p className="text-sm text-gray-500">
              {dictCorrect}/{dictTotal} 正确
              {dictWrong.length > 0 && `，${dictWrong.length} 个首轮拼错`}
            </p>
            {dictWrong.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {dictWrong.map(r => (
                  <span key={r.wordId} className="px-2 py-0.5 bg-white rounded text-xs text-red-500 font-medium">
                    {r.word}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 句子填空结果 */}
        {fillTotal > 0 && (
          <div className="mb-4 p-4 bg-violet-50 rounded-2xl">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-violet-700">📝 句子填空</h3>
              <span className={`text-lg font-bold ${rateColor(fillRate)}`}>{fillRate}%</span>
            </div>
            <p className="text-sm text-gray-500">
              {fillCorrect}/{fillTotal} 正确
              {fillWrong.length > 0 && `，${fillWrong.length} 个首轮填错`}
            </p>
            {fillWrong.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {fillWrong.map(r => (
                  <span key={r.wordId} className="px-2 py-0.5 bg-white rounded text-xs text-red-500 font-medium">
                    {r.word}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 5阶段完成标记 */}
        <div className="mb-6 flex items-center justify-center gap-2">
          {[
            { label: '分类', emoji: '🧠' },
            { label: '语音', emoji: '🎙️' },
            { label: '听写', emoji: '✍️' },
            { label: '填空', emoji: '📝' },
          ].map((stage, i) => (
            <motion.div
              key={stage.label}
              initial={{ opacity: 0, scale: 0 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.5 + i * 0.15 }}
              className="flex flex-col items-center gap-1"
            >
              <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center text-lg">
                {stage.emoji}
              </div>
              <span className="text-xs text-gray-400">{stage.label}</span>
            </motion.div>
          ))}
          <motion.div
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 1.1 }}
            className="text-2xl"
          >
            ✅
          </motion.div>
        </div>

        {/* 底部按钮 */}
        {mode === 'groupSummary' && onNextGroup ? (
          <div className="space-y-3">
            <motion.button
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={onNextGroup}
              className="w-full py-3 rounded-2xl text-lg font-medium bg-primary text-white shadow-lg hover:opacity-90 cursor-pointer"
            >
              继续第{groupIndex + 2}组
            </motion.button>
            <p className="text-center text-xs text-gray-400">
              还剩 {totalGroups - groupIndex - 1} 组未学
            </p>
          </div>
        ) : (
          <motion.button
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            onClick={onBack}
            className="w-full py-3 rounded-2xl text-lg font-medium bg-primary text-white shadow-lg hover:opacity-90 cursor-pointer"
          >
            返回
          </motion.button>
        )}
      </motion.div>
    </div>
  );
}
