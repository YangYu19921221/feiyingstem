import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import DeskLamp, { LAMP_PALETTES, pickNextPaletteIndex } from './DeskLamp';
import type { LampPalette } from './DeskLamp';

interface Props {
  children: (ctx: { palette: LampPalette; on: boolean }) => ReactNode;
}

/**
 * 暗色拉绳台灯外壳：
 * - 背景 #121921 + 随灯色染色的 radial gradient
 * - 左台灯 / 右表单，flex-wrap 响应式
 * - 表单在灯亮时弹性淡入
 */
export default function AuthShell({ children }: Props) {
  const [on, setOn] = useState(false);
  const [paletteIdx, setPaletteIdx] = useState(0);
  const palette = LAMP_PALETTES[paletteIdx];

  // 挂载 800ms 后自动开灯，给仪式感
  useEffect(() => {
    const t = setTimeout(() => setOn(true), 800);
    return () => clearTimeout(t);
  }, []);

  // 注入全局 CSS 变量，便于表单内外复用
  useEffect(() => {
    const el = document.documentElement;
    el.style.setProperty('--lamp-h', String(palette.hue));
    el.style.setProperty('--lamp-s', `${palette.sat}%`);
    el.style.setProperty('--lamp-l', `${palette.light}%`);
    el.style.setProperty('--on', on ? '1' : '0');
    el.style.setProperty('--glow', `hsl(${palette.hue} ${palette.sat}% ${palette.light}%)`);
    el.style.setProperty('--glow-soft', `hsl(${palette.hue} ${palette.sat}% ${palette.light}% / ${on ? 0.35 : 0.05})`);
    el.style.setProperty('--glow-ring', `hsl(${palette.hue} ${palette.sat}% ${palette.light}% / 0.55)`);
    return () => {
      ['--lamp-h','--lamp-s','--lamp-l','--on','--glow','--glow-soft','--glow-ring'].forEach(k => el.style.removeProperty(k));
    };
  }, [palette, on]);

  const toggle = () => {
    setOn(v => !v);
    setPaletteIdx(i => pickNextPaletteIndex(i));
  };

  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-start p-4 sm:p-8 transition-colors relative"
      style={{
        background: `radial-gradient(60% 50% at 50% 20%, var(--glow-soft), transparent 70%), #121921`,
        color: '#e8edf3',
      }}
    >
      {/* 顶部品牌栏 */}
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.2, 0.8, 0.2, 1] }}
        className="w-full max-w-5xl flex flex-col items-center justify-center gap-2 py-4 sm:py-6"
      >
        <div className="flex items-center gap-4 sm:gap-5">
          {/* 鹰翅图标 */}
          <svg width="56" height="56" viewBox="0 0 64 64" aria-hidden className="sm:w-16 sm:h-16">
            <defs>
              <linearGradient id="eagleGrad" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--glow)" />
                <stop offset="100%" stopColor="hsl(var(--lamp-h) 100% 78%)" />
              </linearGradient>
            </defs>
            <path
              d="M32 6 L52 22 L42 24 L58 36 L46 36 L54 52 L32 44 L10 52 L18 36 L6 36 L22 24 L12 22 Z"
              fill="url(#eagleGrad)"
              style={{ filter: 'drop-shadow(0 0 14px var(--glow-soft))' }}
            />
          </svg>

          {/* 品牌字 */}
          <motion.h1
            initial={{ letterSpacing: '0.4em', opacity: 0 }}
            animate={{ letterSpacing: '0.12em', opacity: 1 }}
            transition={{ duration: 1.1, ease: [0.2, 0.8, 0.2, 1], delay: 0.15 }}
            className="font-black leading-none"
            style={{
              fontSize: 'clamp(30px, 5.2vw, 54px)',
              background: `linear-gradient(180deg, #ffffff 0%, #ffffff 55%, hsl(var(--lamp-h) 100% 78%) 100%)`,
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              color: 'transparent',
              textShadow: '0 0 24px var(--glow-soft)',
              filter: 'drop-shadow(0 2px 10px var(--glow-soft))',
              fontFamily: '"ZCOOL KuaiLe","PingFang SC","Microsoft YaHei",system-ui,sans-serif',
            }}
          >
            飞鹰<span style={{ color: 'var(--glow)', WebkitTextFillColor: 'var(--glow)' }}>AI</span>英语
          </motion.h1>
        </div>

        {/* 副标 + 左右分隔线 */}
        <div className="flex items-center gap-3 mt-1">
          <span
            className="h-px w-10 sm:w-20"
            style={{ background: 'linear-gradient(90deg, transparent, var(--glow))' }}
          />
          <span
            className="text-[11px] sm:text-sm font-semibold tracking-[0.35em]"
            style={{ color: 'var(--glow)', textShadow: '0 0 10px var(--glow-soft)' }}
          >
            展翅高飞 · 征服英语
          </span>
          <span
            className="h-px w-10 sm:w-20"
            style={{ background: 'linear-gradient(-90deg, transparent, var(--glow))' }}
          />
        </div>
      </motion.div>

      {/* 主体 */}
      <div className="flex-1 w-full flex items-center justify-center">
        <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-10 w-full max-w-5xl">
          <div className="flex items-center justify-center">
            <DeskLamp on={on} palette={palette} onToggle={toggle} />
          </div>

          <motion.div
            animate={{ opacity: on ? 1 : 0, scale: on ? 1 : 0.85, y: on ? 0 : 20 }}
            transition={{ type: 'spring', stiffness: 180, damping: 16 }}
            style={{
              pointerEvents: on ? 'auto' : 'none',
              borderColor: 'var(--glow)',
              boxShadow: `0 0 48px var(--glow-soft), 0 0 0 1px rgba(255,255,255,0.03) inset`,
              background: 'linear-gradient(180deg, rgba(26,36,48,0.85), rgba(18,25,33,0.85))',
              backdropFilter: 'blur(6px)',
            }}
            className="w-full max-w-md rounded-2xl border-2 p-6 sm:p-8 transition-colors"
          >
            {children({ palette, on })}
          </motion.div>
        </div>
      </div>

      {/* 右下角水印 */}
      <div
        className="pointer-events-none select-none fixed bottom-3 right-4 text-[10px] tracking-widest"
        style={{ color: '#3a4656' }}
      >
        © FEIYING AI · v1.6
      </div>
    </div>
  );
}
