/**
 * 全局 WebP 支持检测（同步缓存版）：
 *   - 启动时探一次（1x1 透明 webp 的 base64），结果存内存 + sessionStorage
 *   - 同步 isWebpSupported() 返回 true/false/null（null = 还在探）
 *   - resolveImage('/foo/bar.webp') 自动按支持情况返回 webp 或 jpg
 *
 * 用法：
 *   import { resolveImage } from '../utils/webp';
 *   <div style={{ backgroundImage: `url(${resolveImage('/victory/perfect-1.webp')})` }} />
 *
 * 老 iOS 12 Safari 同步返回 false（探测异步完成前，sessionStorage 命中即用）。
 * 探测期间默认按支持（不阻塞主流）；若不支持，下次访问起就走 jpg。
 */

const STORE_KEY = 'webp_supported_v1';

let cached: boolean | null = (() => {
  try {
    const v = sessionStorage.getItem(STORE_KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {}
  return null;
})();

function probe(): void {
  if (typeof Image === 'undefined') return;
  const img = new Image();
  img.onload = () => {
    cached = img.width > 0 && img.height > 0;
    try { sessionStorage.setItem(STORE_KEY, cached ? '1' : '0'); } catch {}
  };
  img.onerror = () => {
    cached = false;
    try { sessionStorage.setItem(STORE_KEY, '0'); } catch {}
  };
  img.src =
    'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=';
}

if (cached === null && typeof window !== 'undefined') probe();

export function isWebpSupported(): boolean | null {
  return cached;
}

/**
 * webp 路径 → 按支持情况返回 webp 或 jpg。
 * 非 webp 路径原样返回。探测中默认按支持（最常见情况）。
 */
export function resolveImage(src: string): string {
  if (!src.endsWith('.webp')) return src;
  if (cached === false) return src.slice(0, -5) + '.jpg';
  return src;
}
