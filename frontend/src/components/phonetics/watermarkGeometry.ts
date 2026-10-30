/**
 * 移动水印的纯函数(落点 / 打码 / 是否被藏)。组件在 MovingWatermark.tsx。
 * 单独一个文件: 组件文件只导出组件,开发时热更新才不出错。
 */

/**
 * 画面分 3×3,水印在**除正中间以外**的 8 格里轮流跳。正中间多半是老师的脸和口型(音标课要看口型),
 * 不挡它;四周 8 格已经让「裁掉一块再录」裁不干净 —— 要躲开全部 8 格,只剩正中间一小块画面。
 * y 最大 80 左右: 最下面一截是原生播放控件
 */
const XS = [6, 50, 94];
const YS = [10, 45, 80];
const CELLS = [0, 1, 2, 3, 5, 6, 7, 8];

export interface Spot { cell: number; x: number; y: number }

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 下一个落点: 8 格里挑一格,不和上一格重复(上一格 -1 = 第一次),再加一点随机偏移 */
export function nextSpot(prevCell: number, rand: () => number = Math.random): Spot {
  const pool = CELLS.filter((c) => c !== prevCell);
  const cell = pool[Math.min(pool.length - 1, Math.floor(rand() * pool.length))];
  const x = clamp(XS[cell % 3] + (rand() - 0.5) * 16, 0, 100);
  const y = clamp(YS[Math.floor(cell / 3)] + (rand() - 0.5) * 16, 4, 84);
  return { cell, x, y };
}

/**
 * 7 位以上的连续数字(多半是手机号当用户名)中间打码: 画面要被录走的,手机号不能跟着流出去。
 * 11 位以上留前 3 后 4(和常见的手机号打码一样),短的留前 2 后 2 —— 7 位留 3+4 等于一位没藏
 */
export function maskLongDigits(s: string): string {
  return s.replace(/\d{7,}/g, (m) => (m.length >= 11
    ? `${m.slice(0, 3)}****${m.slice(-4)}`
    : `${m.slice(0, 2)}****${m.slice(-2)}`));
}

export function clock(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const isDefault = (v: string | undefined, def: string) => !v || v === def;

/** 颜色里的透明度(rgb() 当 1) */
function colorAlpha(color: string): number {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m) return 1;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean);
  return parts.length >= 4 ? parseFloat(parts[3]) : 1;
}

/** 水印是不是被删了 / 藏了 / 挪走了。框还没排好(太小,比如播放器正在收起)时只查在不在,免得误停 */
export function looksTampered(el: HTMLElement | null, box: HTMLElement | null): boolean {
  if (!el || !box || !el.isConnected || !box.isConnected || el.parentElement !== box) return true;
  for (const n of [el, box]) {
    const cs = getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility !== 'visible' || parseFloat(cs.opacity) < 0.3) return true;
    // 老浏览器不认的属性读出来是 undefined / 空串,当没动过(否则老 Safari 上会一直误停)
    if (!isDefault(cs.filter, 'none') || !isDefault(cs.clipPath, 'none') || !isDefault(cs.mixBlendMode, 'normal')) return true;
  }
  const es = getComputedStyle(el);
  if (colorAlpha(es.color) < 0.3) return true;
  // 文字颜色不变、只把「填充色」设透明,字一样看不见
  const fill = es.getPropertyValue('-webkit-text-fill-color');
  if (fill && colorAlpha(fill) < 0.3) return true;
  if (Math.abs(parseFloat(es.textIndent) || 0) > 1) return true;
  const b = box.getBoundingClientRect();
  if (b.width < 80 || b.height < 50) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 30 || r.height < 8) return true;
  // 框很矮、字折成好几行比框还高时,字本来就会探出去一截,不算被挪走
  if (r.height > b.height * 0.9) return false;
  const ix = Math.max(0, Math.min(r.right, b.right) - Math.max(r.left, b.left));
  const iy = Math.max(0, Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top));
  return ix * iy < 0.5 * r.width * r.height;
}
