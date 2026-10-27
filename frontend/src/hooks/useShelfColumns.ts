import { useEffect, useState } from 'react';

/**
 * 书架每排几本(components/book/BookShelf): 手机 2、平板 4、电脑 5、宽屏 6。
 * 一本书在各尺寸下都在 127–229px 宽之间,书封上的字号因此可以写死。
 */
const QUERIES: Array<[number, string]> = [
  [6, '(min-width: 1280px)'],
  [5, '(min-width: 1024px)'],
  [4, '(min-width: 640px)'],
];

function readColumns(): number {
  if (typeof window === 'undefined' || !window.matchMedia) return 4;
  for (const [cols, q] of QUERIES) {
    if (window.matchMedia(q).matches) return cols;
  }
  return 2;
}

export function useShelfColumns(): number {
  const [cols, setCols] = useState(readColumns);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mqls = QUERIES.map(([, q]) => window.matchMedia(q));
    const onChange = () => setCols(readColumns());
    // iOS 12 的 MediaQueryList 没有 addEventListener,只有 addListener
    mqls.forEach((m) => (m.addEventListener ? m.addEventListener('change', onChange) : m.addListener(onChange)));
    onChange();
    return () => mqls.forEach((m) => (m.removeEventListener ? m.removeEventListener('change', onChange) : m.removeListener(onChange)));
  }, []);
  return cols;
}

/** 收起时先放几本: 正好一排;手机一排只有 2 本,放两排 */
export function shelfPreviewCount(cols: number): number {
  return cols <= 2 ? 4 : cols;
}
