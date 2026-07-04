/** PK 四阶段步进条:🗂️分类 → 🎤语音 → ✍️听写 → 🏁过关,含阶段内进度。 */
import { motion } from 'framer-motion';

interface Props {
  phase: string;
  /** 全局题号(跨阶段累计,0 基) */
  currentIdx: number;
  /** 每阶段的词数 */
  wordsPerPhase: number;
  /** 本题分值(按当前单词学段:小学100/初中120/高中150) */
  currentPoints?: number;
}

const PHASES = [
  { key: 'classify', label: '分类', emoji: '🗂️' },
  { key: 'speech', label: '语音', emoji: '🎤' },
  { key: 'dictation', label: '听写', emoji: '✍️' },
  { key: 'exam', label: '过关', emoji: '🏁' },
];

export default function PkPhaseStepper({ phase, currentIdx, wordsPerPhase, currentPoints }: Props) {
  const phaseIdx = Math.max(0, PHASES.findIndex((p) => p.key === phase));
  const idxInPhase = wordsPerPhase > 0 ? (currentIdx % wordsPerPhase) : 0;
  const phasePct = wordsPerPhase > 0 ? Math.min(100, ((idxInPhase + 1) / wordsPerPhase) * 100) : 0;

  return (
    <div className="bg-white/90 backdrop-blur border-b border-orange-100 px-4 py-2.5">
      <div className="max-w-5xl mx-auto flex items-center gap-3">
        <div className="flex items-center gap-1 sm:gap-2 flex-1">
          {PHASES.map((p, i) => {
            const done = i < phaseIdx;
            const active = i === phaseIdx;
            return (
              <div key={p.key} className="flex items-center gap-1 sm:gap-2 flex-1 min-w-0">
                <div
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-primary text-white shadow-sm'
                      : done
                        ? 'bg-success/15 text-success'
                        : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  <span>{done ? '✅' : p.emoji}</span>
                  <span className="hidden sm:inline">{p.label}</span>
                </div>
                {i < PHASES.length - 1 && (
                  <div className={`h-0.5 flex-1 rounded ${done ? 'bg-success/50' : 'bg-gray-200'}`} />
                )}
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {currentPoints != null && (
            <span className={`text-[11px] sm:text-xs px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${
              currentPoints >= 150
                ? 'bg-red-100 text-red-600'
                : currentPoints >= 120
                  ? 'bg-secondary/30 text-amber-700'
                  : 'bg-success/15 text-green-700'
            }`}>
              {currentPoints >= 150 ? '🎓 高中词' : currentPoints >= 120 ? '📗 初中词' : '📘 小学词'} · 本题{currentPoints}分
            </span>
          )}
          <span className="text-xs sm:text-sm text-ink-soft font-numeric whitespace-nowrap">
            第 {Math.min(idxInPhase + 1, wordsPerPhase)}/{wordsPerPhase} 词
          </span>
        </div>
      </div>
      {/* 阶段内进度条 */}
      <div className="max-w-5xl mx-auto mt-1.5 h-1 bg-orange-100 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-primary to-secondary"
          animate={{ width: `${phasePct}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        />
      </div>
    </div>
  );
}
