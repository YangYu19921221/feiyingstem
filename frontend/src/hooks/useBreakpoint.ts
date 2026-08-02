import { useEffect, useState } from 'react';

/**
 * 响应式断点(会随窗口变化重新渲染)。
 *
 * 为什么不用现成的 `isMobile()` 那种一次性判断:图表要在旋屏/分屏/投屏切换时
 * 重算柱宽和刻度密度,读一次 innerWidth 拿不到后续变化。
 * 用 matchMedia + change 事件,比 resize 监听便宜(只在跨过断点时才触发)。
 *
 * 断点与 tailwind 对齐:sm 640 / md 768 / lg 1024 / xl 1280。
 */
export type Breakpoint = 'mobile' | 'tablet' | 'desktop';

const QUERIES: Array<[Breakpoint, string]> = [
  ['mobile', '(max-width: 639px)'],
  ['tablet', '(min-width: 640px) and (max-width: 1023px)'],
];

function read(): Breakpoint {
  if (typeof window === 'undefined' || !window.matchMedia) return 'desktop';
  for (const [name, q] of QUERIES) {
    if (window.matchMedia(q).matches) return name;
  }
  return 'desktop';
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(read);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mqls = QUERIES.map(([, q]) => window.matchMedia(q));
    const onChange = () => setBp(read());
    mqls.forEach((m) => m.addEventListener('change', onChange));
    onChange();   // 挂载后再同步一次(SSR/首帧拿到的可能是兜底值)
    return () => mqls.forEach((m) => m.removeEventListener('change', onChange));
  }, []);

  return bp;
}
