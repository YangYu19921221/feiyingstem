import { motion } from 'framer-motion'
import type { WordData } from '../../../api/progress'

interface Props {
  unitName?: string
  masteredCount: number
  practiceWords: WordData[]
  onRetryDictation: (words: WordData[]) => void
  onSkipToSummary: () => void
}

export default function RecapSummary({
  unitName, masteredCount, practiceWords, onRetryDictation, onSkipToSummary,
}: Props) {
  const total = masteredCount + practiceWords.length
  const isPerfect = practiceWords.length === 0 && masteredCount > 0

  return (
    <div className="min-h-[80vh] px-4 py-10 flex items-center justify-center">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-md w-full bg-paper rounded-3xl shadow-xl p-8 text-center relative overflow-hidden"
      >
        {isPerfect && (
          <motion.div
            initial={{ scale: 0, opacity: 0.8 }}
            animate={{ scale: 4, opacity: 0 }}
            transition={{ duration: 1.6, ease: 'easeOut' }}
            className="absolute inset-0 m-auto w-24 h-24 rounded-full bg-amber-300 pointer-events-none"
          />
        )}

        {isPerfect ? (
          <>
            <div className="text-6xl mb-3">🏆</div>
            <h2 className="font-display text-3xl font-bold text-amber-700 mb-2">单元收官 · 完美</h2>
            <p className="text-ink-soft text-sm mb-6">
              {unitName ? `《${unitName}》` : ''}全部 {masteredCount} 个词都被你认领,了不起。
            </p>
            <button
              type="button"
              onClick={onSkipToSummary}
              className="w-full py-3 rounded-2xl bg-accent-warm text-white font-semibold shadow-lg"
            >
              领取奖励 →
            </button>
          </>
        ) : (
          <>
            <div className="text-5xl mb-3">📋</div>
            <h2 className="font-display text-2xl font-bold text-ink mb-1">单元复习完成</h2>
            <p className="text-ink-soft text-sm mb-5">
              我会了 <span className="font-numeric font-bold text-amber-600">{masteredCount}</span> 个 ·
              再练 <span className="font-numeric font-bold text-rose-500">{practiceWords.length}</span> 个
            </p>

            {practiceWords.length > 0 && (
              <div className="bg-rose-50 border border-rose-200 rounded-xl p-3 mb-5 text-left">
                <p className="text-xs text-rose-700 font-medium mb-2">需要再练的词</p>
                <div className="flex flex-wrap gap-1.5">
                  {practiceWords.slice(0, 12).map(w => (
                    <span key={w.id} className="text-xs px-2 py-0.5 rounded bg-white border border-rose-200 text-ink">
                      {w.word}
                    </span>
                  ))}
                  {practiceWords.length > 12 && (
                    <span className="text-xs px-2 py-0.5 text-ink-mute">+{practiceWords.length - 12}</span>
                  )}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => onRetryDictation(practiceWords)}
              disabled={practiceWords.length === 0}
              className="w-full py-3 rounded-2xl bg-accent-warm text-white font-semibold shadow-lg mb-2 disabled:opacity-40"
            >
              立刻听写这 {practiceWords.length} 个 →
            </button>
            <button
              type="button"
              onClick={onSkipToSummary}
              className="w-full py-2 text-sm text-ink-soft hover:text-ink"
            >
              跳过去结算
            </button>
          </>
        )}

        <p className="text-xs text-ink-mute mt-4">共 {total} 个词</p>
      </motion.div>
    </div>
  )
}
