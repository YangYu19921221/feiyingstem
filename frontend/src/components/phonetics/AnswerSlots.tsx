/**
 * 答案格 [ _ _ _ ]
 *
 * 格子数 = 答案音素个数,等于告诉学生这词几个音 —— 这是刻意保留的脚手架,
 * 省掉「长度也要猜」的额外难度(全书答案 2~8 个音素,平均 3.8)。
 * 第二遍只挖元音格,辅音已填好并置灰,聚焦这一节真正的教学点。
 */
interface Props {
  /** 每格当前内容,null = 空 */
  slots: (string | null)[];
  /** 可编辑的格下标(第一遍=全部,第二遍=仅元音格) */
  editable: number[];
  /** 当前光标所在格;传 -1 表示本行不是作答行 */
  cursor: number;
  /** 判过之后每格对错;未判时传 undefined */
  correct?: (boolean | null)[];
  onSlotClick?: (i: number) => void;
  /** 整页布局用的紧凑尺寸:一页 20 行要放得下 */
  compact?: boolean;
}

export default function AnswerSlots({
  slots, editable, cursor, correct, onSlotClick, compact = false,
}: Props) {
  const canEdit = new Set(editable);
  const box = compact
    ? 'h-9 min-w-[2.1rem] text-lg'
    : 'h-14 min-w-[3rem] text-3xl';

  return (
    <div className={`flex items-center gap-1 font-mono ${compact ? 'text-lg' : 'text-3xl'}`}>
      <span className="text-slate-300">[</span>
      {slots.map((v, i) => {
        const editing = canEdit.has(i);
        const judged = correct?.[i];
        const isCursor = i === cursor && editing && judged == null;

        let tone = 'border-slate-200 text-slate-800';
        if (judged === true) tone = 'border-emerald-300 bg-emerald-50 text-emerald-700';
        else if (judged === false) tone = 'border-rose-300 bg-rose-50 text-rose-600';
        else if (!editing) tone = 'border-transparent bg-slate-50 text-slate-400';
        else if (isCursor) tone = 'border-orange-400 bg-orange-50 text-slate-800';

        return (
          <button
            key={i}
            type="button"
            onClick={e => { e.stopPropagation(); if (editing) onSlotClick?.(i); }}
            disabled={!editing || judged != null}
            aria-label={`第 ${i + 1} 格${v ? `:${v}` : ':空'}`}
            className={[
              'flex items-center justify-center rounded-lg border-2 px-1',
              'transition disabled:cursor-default',
              box, tone,
              isCursor ? 'animate-pulse' : '',
            ].join(' ')}
          >
            {v ?? <span className="text-slate-300">_</span>}
          </button>
        );
      })}
      <span className="text-slate-300">]</span>
    </div>
  );
}
