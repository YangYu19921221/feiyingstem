/**
 * 整本书 100% 完成：全屏电影级庆祝（极稀有时刻）
 * 飞鹰托书飞过云海背景 + 文字依次浮现 + 金色光雨
 * 5s 后自动 onComplete，可点击跳过
 */
import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useRef } from 'react';

interface Props {
  bookName: string;
  onComplete: () => void;
}

export default function FullscreenBookComplete({ bookName, onComplete }: Props) {
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const t = setTimeout(() => onCompleteRef.current(), 5500);
    return () => clearTimeout(t);
  }, []);

  return (
    <AnimatePresence>
      <motion.div
        key="fx-book"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.5 }}
        className="fixed inset-0 z-[100] cursor-pointer overflow-hidden"
        onClick={() => onCompleteRef.current()}
      >
        {/* 背景：缓慢推近 5s + 平移 */}
        <motion.div
          initial={{ scale: 1.15, y: '2%', opacity: 0 }}
          animate={{ scale: 1, y: '0%', opacity: 1 }}
          transition={{ duration: 5.5, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-0"
        >
          <img
            src="/fx-book.jpeg"
            alt=""
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/20 via-transparent to-black/75" />
        </motion.div>

        {/* 金色光雨 — 50 粒，比 Victory 更密集 */}
        <div className="absolute inset-0 pointer-events-none">
          {Array.from({ length: 50 }).map((_, i) => {
            const xStart = Math.random() * 100;
            const drift = (Math.random() - 0.5) * 30;
            const delay = Math.random() * 3;
            const duration = 4 + Math.random() * 3;
            const size = 4 + Math.random() * 10;
            return (
              <motion.div
                key={i}
                initial={{ y: '-10%', x: 0, opacity: 0, rotate: 0 }}
                animate={{
                  y: '110vh',
                  x: `${drift}vw`,
                  opacity: [0, 1, 1, 0],
                  rotate: 720,
                }}
                transition={{ duration, delay, ease: 'linear' }}
                className="absolute rounded-sm"
                style={{
                  left: `${xStart}%`,
                  width: size,
                  height: size * 1.4,
                  background: i % 4 === 0
                    ? 'oklch(0.85 0.18 80)'
                    : i % 4 === 1
                    ? 'oklch(0.78 0.18 75)'
                    : i % 4 === 2
                    ? 'oklch(0.68 0.185 40)'
                    : 'oklch(0.92 0.12 70)',
                  boxShadow: '0 0 12px oklch(0.85 0.15 60 / 0.7)',
                }}
              />
            );
          })}
        </div>

        {/* 主标题区：底部 1/3 */}
        <div className="absolute inset-x-0 bottom-0 px-8 pb-16 md:pb-24 flex flex-col items-center text-center">
          <motion.p
            initial={{ y: -10, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.7 }}
            className="text-white/70 tracking-[0.6em] text-xs md:text-sm uppercase mb-4"
            style={{ textShadow: '0 2px 8px oklch(0 0 0 / 0.6)' }}
          >
            BOOK MASTERED
          </motion.p>

          <motion.h1
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 1, delay: 1.0, ease: [0.16, 1, 0.3, 1] }}
            className="font-display font-bold text-white text-5xl md:text-7xl tracking-tight mb-2"
            style={{
              textShadow: `
                0 0 32px oklch(0.85 0.18 60 / 0.7),
                0 4px 16px oklch(0 0 0 / 0.6)
              `,
            }}
          >
            {bookName}
          </motion.h1>

          <motion.p
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.7, delay: 1.7 }}
            className="font-display text-white/90 text-2xl md:text-3xl tracking-wide mt-3"
            style={{ textShadow: '0 2px 12px oklch(0 0 0 / 0.6)' }}
          >
            完整通关
          </motion.p>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 2.4 }}
            className="text-white/75 text-base md:text-lg mt-6 max-w-md leading-relaxed"
            style={{ textShadow: '0 2px 8px oklch(0 0 0 / 0.5)' }}
          >
            从第一个单词，到现在的熟练自如。<br />
            这背后是日复一日的坚持。
          </motion.p>

          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 4.2 }}
            className="text-white/40 text-xs mt-12"
          >
            点击关闭
          </motion.p>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
