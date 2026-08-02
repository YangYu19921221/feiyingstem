import { useState } from 'react';

/**
 * 带上下限的数字输入框状态。
 *
 * 为什么需要它:直接 `onChange` 里 clamp 会打断输入 —— 想输 100 时刚敲下 "1"
 * 就被顶成下限,三位数根本打不进去。所以要保留一份「原始文本」,
 * 只在失焦时收敛到合法值。
 *
 * 另一个坑:用户打完数字直接点提交按钮时 **不会触发 onBlur**,
 * 只读数值 state 会漏掉最后一次输入(填 7 却按 4 提交)。
 * 所以提交前必须调 `commit()` 取一次最终值。
 *
 * 用法:
 *   const players = useClampedNumber(2, 200, 4);
 *   <input value={players.raw} onChange={e => players.onChangeText(e.target.value)}
 *          onBlur={players.onBlur} />
 *   <button onClick={() => submit(players.commit())}>创建</button>
 */
export interface ClampedNumber {
  /** 输入框里显示的原始文本 */
  raw: string;
  /** 已收敛的合法数值 */
  value: number;
  /** 输入中:只留数字,不 clamp */
  onChangeText: (text: string) => void;
  /** 失焦:收敛到 [min, max] */
  onBlur: () => void;
  /** 直接设值(步进器 / 快捷档用) */
  set: (n: number) => void;
  /** 提交前取最终值:以输入框当前文本为准并收敛,同时同步 state */
  commit: () => number;
}

export function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.floor(n) || min));
}

export function useClampedNumber(
  min: number,
  max: number,
  initial: number,
  /** 输入框最多几位数字,默认按 max 的位数 */
  maxDigits = String(max).length,
): ClampedNumber {
  const [value, setValue] = useState(clampInt(initial, min, max));
  const [raw, setRaw] = useState(String(clampInt(initial, min, max)));

  const set = (n: number) => {
    const v = clampInt(n, min, max);
    setValue(v);
    setRaw(String(v));
  };

  return {
    raw,
    value,
    onChangeText: (text) => setRaw(text.replace(/\D/g, '').slice(0, maxDigits)),
    onBlur: () => set(Number(raw)),
    set,
    commit: () => {
      const v = clampInt(Number(raw), min, max);
      if (v !== value) set(v);
      return v;
    },
  };
}
