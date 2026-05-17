import { useEffect, useState } from 'react';

const DISMISS_KEY = 'old_browser_banner_dismissed_v1';

/**
 * 老浏览器一次性检测：用 oklch 支持作为现代特性闸门
 *   - Safari 15.4+ / Chrome 111+ / Firefox 113+ 才支持 oklch
 *   - 任何不支持 oklch 的引擎，几乎必然也不支持 webp、backdrop-filter 等其他特性
 *   - 模块级常量，全应用只评估一次，避免 UA 正则误判
 */
const IS_OLD_BROWSER = (() => {
  if (typeof window === 'undefined') return false;
  if (typeof CSS === 'undefined' || typeof CSS.supports !== 'function') return true;
  return !CSS.supports('color', 'oklch(0.5 0.1 50)');
})();

/**
 * 老浏览器提示横幅：靠 vite-plugin-legacy 让 JS 跑起来后，
 * 提示用户某些动效/色彩会降级。可关闭并 localStorage 记忆。
 */
export default function OldBrowserBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!IS_OLD_BROWSER) return;
    try {
      if (localStorage.getItem(DISMISS_KEY) === '1') return;
    } catch {}
    setShow(true);
  }, []);

  const dismiss = () => {
    setShow(false);
    try { localStorage.setItem(DISMISS_KEY, '1'); } catch {}
  };

  if (!show) return null;

  return (
    <div
      role="status"
      style={{
        background: '#FFF7E6',
        borderBottom: '1px solid #F2D88A',
        color: '#7A4B00',
        padding: '10px 16px',
        fontSize: 13,
        lineHeight: 1.5,
        display: 'flex',
        alignItems: 'flex-start',
        gap: 12,
        position: 'relative',
        zIndex: 50,
      }}
    >
      <span style={{ flexShrink: 0, marginTop: 1 }}>⚠️</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ fontWeight: 600 }}>检测到您使用较老版本的浏览器</strong>
        <span style={{ display: 'block', marginTop: 2 }}>
          建议升级到新一点的设备（iPad 2018 / iOS 15 以上、Chrome / Edge 最新版）以获得完整动画与色彩体验。
          基础学习功能仍可正常使用。
        </span>
      </div>
      <button
        onClick={dismiss}
        aria-label="关闭提示"
        style={{
          flexShrink: 0,
          background: 'transparent',
          border: 'none',
          color: '#7A4B00',
          cursor: 'pointer',
          fontSize: 18,
          padding: '0 4px',
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}
