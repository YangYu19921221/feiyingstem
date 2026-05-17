import { useEffect, useState } from 'react';

const DISMISS_KEY = 'old_browser_banner_dismissed_v1';

/**
 * 检测老浏览器（iOS 12 及以下、Safari 13 及以下、其它无 oklch / webp 的旧引擎）。
 * 命中则在页面顶部显示一条提示横幅，可关闭。dismissed 状态存 localStorage。
 *
 * 通过 vite-plugin-legacy 自动产出的 ES5 包，老 Safari 仍能跑；
 * 但 oklch / webp / backdrop-filter 等渲染特性还是不支持，
 * 横幅是在告诉用户"建议升级体验"。
 */
function detectOldBrowser(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';

  // iOS 12 及以下
  const iosMatch = ua.match(/OS (\d+)_(\d+)(?:_\d+)? like Mac OS X/);
  if (iosMatch) {
    const major = parseInt(iosMatch[1], 10);
    if (major <= 13) return true;
  }

  // 桌面 Safari 13 及以下（Mac OS X）
  const macSafari = ua.match(/Version\/(\d+)\.(\d+)\sSafari/);
  if (macSafari && !ua.includes('Chrome') && !ua.includes('Edg')) {
    if (parseInt(macSafari[1], 10) <= 13) return true;
  }

  // 用 CSS.supports 兜底：不支持 oklch 也算老
  if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
    if (!CSS.supports('color', 'oklch(0.5 0.1 50)')) return true;
  }

  return false;
}

export default function OldBrowserBanner() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(DISMISS_KEY) === '1') return;
    } catch {}
    if (detectOldBrowser()) setShow(true);
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
