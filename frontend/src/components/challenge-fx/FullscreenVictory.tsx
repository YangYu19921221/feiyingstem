/**
 * 错题闯关满分通关：全屏电影级庆祝
 * 4 秒动画：背景图缓慢推近 → 主题词从中爆出 → 文案飘入 → 收束
 * 不绑定到具体页面，由调用方控制 mount / unmount
 */
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useRef } from 'react';

interface Props {
  /** 本关最后答对的代表词（增强主角感）*/
  featureWord?: string;
  /** 满分时显示，约 4s 后自动 onComplete */
  onComplete: () => void;
}

export default function FullscreenVictory({ featureWord, onComplete }: Props) {
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const t = setTimeout(() => onCompleteRef.current(), 4000);
    return () => clearTimeout(t);
  }, []);

  return (
    <AnimatePresence>
      <motion.div
        key="fx-victory"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4 }}
        className="fixed inset-0 z-[100] overflow-hidden cursor-pointer"
        onClick={() => onCompleteRef.current()}
      >
        {/* 背景：缓慢 KenBurns 推近 */}
        <motion.div
          initial={{ scale: 1.1, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 4, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-0"
        >
          <img
            src="/fx-victory.jpeg"
            alt=""
            className="w-full h-full object-cover"
          />
          {/* 暖色色调过滤 + 底部渐隐让文字可读 */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/0 via-black/20 to-black/70" />
        </motion.div>

        {/* 金色光雨粒子 — 30 粒，从顶部飘下 */}
        <div className="absolute inset-0 pointer-events-none">
          {Array.from({ length: 30 }).map((_, i) => {
            const xStart = Math.random() * 100;
            const drift = (Math.random() - 0.5) * 20;
            const delay = Math.random() * 2;
            const duration = 3 + Math.random() * 2;
            const size = 6 + Math.random() * 8;
            return (
              <motion.div
                key={i}
                initial={{ y: '-10%', x: 0, opacity: 0, rotate: 0 }}
                animate={{
                  y: '110vh',
                  x: `${drift}vw`,
                  opacity: [0, 1, 1, 0],
                  rotate: 360 + Math.random() * 360,
                }}
                transition={{ duration, delay, ease: 'linear' }}
                className="absolute rounded-sm"
                style={{
                  left: `${xStart}%`,
                  width: size,
                  height: size * 1.6,
                  background: i % 3 === 0
                    ? 'oklch(0.78 0.18 80)'
                    : i % 3 === 1
                    ? 'oklch(0.68 0.185 40)'
                    : 'oklch(0.85 0.15 60)',
                  boxShadow: '0 0 8px oklch(0.85 0.15 60 / 0.6)',
                }}
              />
            );
          })}
        </div>

        {/* 主标题：从下飘入 */}
        <div className="absolute inset-x-0 bottom-0 px-8 pb-12 md:pb-20 flex flex-col items-center text-center">
          {featureWord && (
            <motion.span
              initial={{ y: 40, opacity: 0, scale: 0.8 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              transition={{ duration: 0.7, delay: 0.6, ease: [0.16, 1, 0.3, 1] }}
              className="font-display font-bold text-white/80 text-2xl md:text-3xl mb-3 italic tracking-wide"
              style={{ textShadow: '0 2px 12px oklch(0 0 0 / 0.6)' }}
            >
              "{featureWord}"
            </motion.span>
          )}

          <motion.h1
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.8, delay: 0.9, ease: [0.16, 1, 0.3, 1] }}
            className="font-display font-bold text-white text-6xl md:text-7xl tracking-tight"
            style={{
              textShadow: `
                0 0 24px oklch(0.78 0.18 80 / 0.6),
                0 4px 12px oklch(0 0 0 / 0.5)
              `,
            }}
          >
            满分通关
          </motion.h1>

          <motion.p
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.6, delay: 1.4, ease: [0.16, 1, 0.3, 1] }}
            className="text-white/85 text-base md:text-lg mt-4 font-light"
            style={{ textShadow: '0 2px 8px oklch(0 0 0 / 0.6)' }}
          >
            一题不错,真正的高手
          </motion.p>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 2.5 }}
            className="text-white/40 text-xs mt-8"
          >
            点击继续
          </motion.p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
