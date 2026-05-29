import { motion } from 'framer-motion';
import type { ClozeBankWord } from '../../api/cloze';

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * 选词填空的共享词库。每个词只能用一次，被填进句子后在这里淡出并打勾。
 * 点一个可用的词 → 填入当前选中的空格。
 */
export default function ClozeBank({
  bank, usedIds, onPick, disabled,
}: {
  bank: ClozeBankWord[];
  usedIds: Set<number>;
  onPick: (wordId: number) => void;
  disabled: boolean;
}) {
  return (
    <div
      className="rounded-2xl bg-white p-4 md:p-5"
      style={{
        border: '1px solid oklch(0.68 0.185 40 / 0.12)',
        boxShadow: '0 10px 30px -18px oklch(0.6 0.16 60 / 0.4)',
      }}
    >
      <div className="flex items-baseline justify-between mb-3">
        <p className="font-display text-sm font-semibold text-ink">词库</p>
        <p className="text-xs text-ink-mute">点单词，填进句子的空格里</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {bank.map((b) => {
          const used = usedIds.has(b.word_id);
          return (
            <motion.button
              key={b.word_id}
              type="button"
              onClick={() => !used && !disabled && onPick(b.word_id)}
              disabled={used || disabled}
              whileTap={!used && !disabled ? { scale: 0.94 } : {}}
              transition={{ duration: 0.18, ease: EASE }}
              className="px-4 py-2 rounded-xl font-semibold text-base transition-colors"
              style={used ? {
                background: 'oklch(0.96 0.006 55)',
                color: 'oklch(0.78 0.008 55)',
                border: '1px solid oklch(0.9 0.006 55)',
              } : {
                background: 'oklch(0.97 0.03 60)',
                color: 'oklch(0.5 0.16 50)',
                border: '1px solid oklch(0.85 0.07 60)',
              }}
            >
              {used && <span className="mr-1 opacity-70">✓</span>}
              <span className={used ? 'line-through' : ''}>{b.word}</span>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
