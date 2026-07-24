/** PK 掌握赛阶段条(分类记忆法流程):第 X/Y 组 · 🗂️分类 → ✍️听写 → 🏁过关。 */
import { motion } from 'framer-motion';

interface Props {
  /** 当前组内阶段:classify / dictation / exam / done */
  stage: string;
  /** 第几组(0 基) */
  groupIdx: number;
  /** 总组数 */
  groupTotal: number;
  /** 掌握进度 0..1(整局) */
  progress: number;
  /** 本题分值(按当前单词学段:小学100/初中120/高中150) */
  currentPoints?: number;
}

const STAGES = [
  { key: 'classify', label: '分类', emoji: '🗂️' },
  { key: 'dictation', label: '听写', emoji: '✍️' },
  { key: 'exam', label: '过关', emoji: '🏁' },
];

export default function PkPhaseStepper({ stage, groupIdx, groupTotal, progress, currentPoints }: Props) {
  const stageIdx = stage === 'done'
    ? STAGES.length
    : Math.max(0, STAGES.findIndex((s) => s.key === stage));
  const pct = Math.min(100, Math.max(0, progress * 100));

  return (
    <div className="bg-white/90 backdrop-blur border-b border-orange-100 px-4 py-2.5">
      <div className="max-w-5xl mx-auto flex items-center gap-3">
        <span className="shrink-0 text-xs sm:text-sm font-bold text-primary whitespace-nowrap">
          第 {Math.min(groupIdx + 1, groupTotal || 1)}/{groupTotal || 1} 组
        </span>
        <div className="flex items-center gap-1 sm:gap-2 flex-1">
          {STAGES.map((s, i) => {
            const done = i < stageIdx;
            const active = i === stageIdx;
            return (
              <div key={s.key} className="flex items-center gap-1 sm:gap-2 flex-1 min-w-0">
                <div
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-primary text-white shadow-sm'
                      : done
                        ? 'bg-success/15 text-success'
                        : 'bg-gray-100 text-gray-400'
                  }`}
                >
                  <span>{done ? '✅' : s.emoji}</span>
                  <span className="hidden sm:inline">{s.label}</span>
                </div>
                {i < STAGES.length - 1 && (
                  <div className={`h-0.5 flex-1 rounded ${done ? 'bg-success/50' : 'bg-gray-200'}`} />
                )}
              </div>
            );
          })}
        </div>
        {currentPoints != null && (
          <span className={`shrink-0 text-[11px] sm:text-xs px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${
            currentPoints >= 150
              ? 'bg-red-100 text-red-600'
              : currentPoints >= 120
                ? 'bg-secondary/30 text-amber-700'
                : 'bg-success/15 text-green-700'
          }`}>
            {currentPoints >= 150 ? '🎓 高中词' : currentPoints >= 120 ? '📗 初中词' : '📘 小学词'} · {currentPoints}分
          </span>
        )}
      </div>
      {/* 整局掌握进度条 */}
      <div className="max-w-5xl mx-auto mt-1.5 h-1 bg-orange-100 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-primary to-secondary"
          animate={{ width: `${pct}%` }}
          transition={{ type: 'spring', stiffness: 120, damping: 20 }}
        />
      </div>
    </div>
  );
}
