/** PK 掌握赛阶段条：第 X/Y 组 · 分类 → 听写 → 过关。 */
import { motion, useReducedMotion } from 'framer-motion';
import { Check, Flag, GraduationCap, Layers3, PencilLine, type LucideIcon } from 'lucide-react';

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

interface StageItem {
  key: 'classify' | 'dictation' | 'exam';
  label: string;
  icon: LucideIcon;
}

const STAGES: StageItem[] = [
  { key: 'classify', label: '分类', icon: Layers3 },
  { key: 'dictation', label: '听写', icon: PencilLine },
  { key: 'exam', label: '过关', icon: Flag },
];

function getLevelLabel(points: number) {
  if (points >= 150) return '高中词';
  if (points >= 120) return '初中词';
  return '小学词';
}

export default function PkPhaseStepper({ stage, groupIdx, groupTotal, progress, currentPoints }: Props) {
  const reduceMotion = useReducedMotion();
  const totalGroups = Math.max(1, groupTotal || 1);
  const currentGroup = Math.min(totalGroups, Math.max(1, groupIdx + 1));
  const resolvedStageIndex = STAGES.findIndex((item) => item.key === stage);
  const stageIndex = stage === 'done' ? STAGES.length : Math.max(0, resolvedStageIndex);
  const progressPercent = Math.min(100, Math.max(0, progress * 100));
  const roundedProgress = Math.round(progressPercent);

  return (
    <section className="border-b border-orange-100 bg-white px-3 py-3 sm:px-4" aria-label="PK 学习进度">
      <div className="mx-auto max-w-5xl">
        <div className="mb-2.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="font-display text-sm font-semibold text-ink sm:text-base">
              第 <span className="font-numeric text-accent-warm">{currentGroup}</span>/{totalGroups} 组
            </span>
            <span className="text-xs text-ink-mute">
              {stage === 'done' ? '本局已完成' : `本局掌握 ${roundedProgress}%`}
            </span>
          </div>

          {currentPoints != null && (
            <span className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-lg bg-orange-50 px-2.5 text-xs font-semibold text-accent-warm">
              <GraduationCap className="h-3.5 w-3.5" aria-hidden="true" />
              {getLevelLabel(currentPoints)} · <span className="font-numeric">{currentPoints}</span> 分
            </span>
          )}
        </div>

        <ol className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1" aria-label="当前组的三个学习阶段">
          {STAGES.map((item, index) => {
            const complete = index < stageIndex;
            const active = index === stageIndex;
            const Icon = complete ? Check : item.icon;

            return (
              <li
                key={item.key}
                aria-current={active ? 'step' : undefined}
                className={`flex min-h-10 min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold transition-colors duration-200 sm:text-sm ${
                  active
                    ? 'bg-accent-warm text-white'
                    : complete
                      ? 'bg-green-50 text-green-700'
                      : 'text-ink-mute'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{item.label}</span>
                <span className="sr-only">
                  {complete ? '，已完成' : active ? '，当前阶段' : '，尚未开始'}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="mt-2 flex items-center gap-2.5">
          <div
            className="h-1.5 flex-1 overflow-hidden rounded-full bg-orange-100"
            role="progressbar"
            aria-label="本局掌握进度"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={roundedProgress}
          >
            <motion.div
              className="h-full w-full rounded-full bg-accent-warm"
              style={{ transformOrigin: 'left center' }}
              initial={false}
              animate={{ scaleX: progressPercent / 100 }}
              transition={{ duration: reduceMotion ? 0 : 0.35, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
          <span className="font-numeric w-9 shrink-0 text-right text-xs font-semibold text-ink-soft">
            {roundedProgress}%
          </span>
        </div>
      </div>
    </section>
  );
}
