/**
 * 一个词条一行:单词 + 音标格 + 释义
 *
 * 版面照纸质教材:一页 20 个词并排,同韵的词(bad/babe/bade)看得见地排在一起,
 * 拼读规律自己就浮出来了 —— 这正是拼读节要教的东西。
 * 一次只显示一个词反而把规律藏起来了。
 */
import AnswerSlots from './AnswerSlots';

interface Props {
  index: number;
  word: string;
  meaning?: string | null;
  slots: (string | null)[];
  editable: number[];
  /** 该行是否为当前作答行 */
  active: boolean;
  /** 当前光标格(仅 active 行有效) */
  cursor: number;
  correct?: (boolean | null)[];
  answerDisplay?: string | null;
  onFocusRow: () => void;
  onSlotClick: (i: number) => void;
}

export default function WordRow({
  index, word, meaning, slots, editable, active, cursor,
  correct, answerDisplay, onFocusRow, onSlotClick,
}: Props) {
  const judged = correct?.some(v => v != null);
  const allRight = judged && correct?.every(v => v !== false);

  return (
    <div
      onClick={onFocusRow}
      className={[
        'flex items-center gap-3 rounded-xl px-3 py-2 transition',
        active ? 'bg-orange-50/70 ring-1 ring-orange-200' : 'hover:bg-slate-50',
        judged && !allRight ? 'bg-rose-50/40' : '',
      ].join(' ')}
    >
      <span className="w-5 shrink-0 text-right text-xs text-slate-300">{index + 1}</span>

      <span className="w-24 shrink-0 truncate font-mono text-lg text-slate-800" title={word}>
        {word}
      </span>

      <div className="shrink-0">
        <AnswerSlots
          slots={slots}
          editable={editable}
          cursor={active ? cursor : -1}
          correct={correct}
          onSlotClick={onSlotClick}
          compact
        />
      </div>

      <span className="min-w-0 flex-1 truncate text-sm text-slate-500" title={meaning ?? ''}>
        {meaning}
      </span>

      {/* 第二遍还错才显示答案 */}
      {answerDisplay && (
        <span className="shrink-0 font-mono text-sm text-rose-500">{answerDisplay}</span>
      )}
    </div>
  );
}
