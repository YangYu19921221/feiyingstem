import { motion } from 'framer-motion';
import type { ClozeItem } from '../../api/cloze';

const EASE = [0.16, 1, 0.3, 1] as const;

type Phase = 'loading' | 'filling' | 'checked';

/**
 * 一句选词填空。把句子按 ______ 切开，空格处渲染成可点的填空位。
 * filling 阶段点空格可选中/取回；checked 阶段按对错着色，错的把正确答案标出来。
 */
export default function SentenceCard({
  index, item, fillWord, isActive, phase, correct, onClick,
}: {
  index: number;
  item: ClozeItem;
  fillWord: string;
  isActive: boolean;
  phase: Phase;
  correct: boolean;
  onClick: () => void;
}) {
  const parts = item.sentence.split('______');
  const checked = phase === 'checked';

  // 空格视觉状态
  const blankStyle = (): React.CSSProperties => {
    if (checked) {
      return correct
        ? { color: 'oklch(0.5 0.14 145)', borderColor: 'oklch(0.7 0.15 145)', background: 'oklch(0.95 0.05 145)' }
        : { color: 'oklch(0.55 0.18 25)', borderColor: 'oklch(0.72 0.17 25)', background: 'oklch(0.96 0.04 25)' };
    }
    if (isActive) {
      return { color: 'oklch(0.5 0.16 50)', borderColor: 'oklch(0.68 0.185 40)', background: 'oklch(0.97 0.04 60)' };
    }
    return { color: 'oklch(0.5 0.16 50)', borderColor: 'oklch(0.85 0.05 60)', background: 'oklch(0.99 0.01 60)' };
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE, delay: Math.min(index * 0.04, 0.3) }}
      className="rounded-2xl bg-white p-4 md:p-5"
      style={{
        border: isActive && !checked
          ? '1.5px solid oklch(0.68 0.185 40 / 0.5)'
          : '1px solid oklch(0.68 0.185 40 / 0.1)',
        boxShadow: '0 1px 0 oklch(0.68 0.185 40 / 0.04)',
      }}
    >
      <div className="flex items-start gap-3">
        <span className="font-numeric text-sm font-semibold text-ink-mute mt-1 w-5 shrink-0">
          {index + 1}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-lg leading-relaxed text-ink">
            {parts.map((part, i) => (
              <span key={i}>
                {part}
                {i < parts.length - 1 && (
                  <button
                    type="button"
                    onClick={onClick}
                    disabled={checked}
                    className="inline-flex items-center justify-center mx-1 min-w-[68px] px-2 py-0.5 rounded-lg font-semibold align-middle transition-colors"
                    style={{ border: `1.5px solid`, ...blankStyle() }}
                  >
                    {fillWord || <span className="text-ink-mute font-normal opacity-60">？</span>}
                  </button>
                )}
              </span>
            ))}
          </p>

          {/* 中文翻译，帮助理解，不直接给答案 */}
          {item.translation && (
            <p className="text-xs text-ink-mute mt-2">{item.translation}</p>
          )}

          {/* 判分后：答错时给出正确答案 */}
          {checked && !correct && (
            <p className="text-xs mt-2 font-medium" style={{ color: 'oklch(0.55 0.16 25)' }}>
              正确答案：<span className="font-semibold">{item.answer}</span>
              {item.meaning ? `（${item.meaning}）` : ''}
            </p>
          )}
        </div>

        {checked && (
          <span className="text-lg shrink-0 mt-0.5">{correct ? '✅' : '❌'}</span>
        )}
      </div>
    </motion.div>
  );
}
