import { motion, AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import { useChallengeSfx } from '../../hooks/useChallengeSfx';

interface Props {
  word: string;
  onComplete: () => void;
}

const SHAKE_X = [0, -8, 8, -6, 6, 0];
const SHAKE_Y = [0, 4, -4, 2, -2, 0];

/**
 * 第一幕（0 – 1.2s）：震屏 + 光剑劈字 + 闪白
 * 完成后调 onComplete 进入第二幕
 */
export default function SwordSlash({ word, onComplete }: Props) {
  const { play } = useChallengeSfx();
  const [flash, setFlash] = useState(false);
  const [split, setSplit] = useState(false);

  useEffect(() => {
    const t1 = setTimeout(() => {
      play('sword_slash');
      setSplit(true);
      setFlash(true);
    }, 500);
    const t2 = setTimeout(() => setFlash(false), 580);
    const t3 = setTimeout(onComplete, 1200);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onComplete, play]);

  const half = Math.ceil(word.length / 2);
  const w1 = word.slice(0, half);
  const w2 = word.slice(half);

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none flex items-center justify-center">
      {/* 震屏容器 */}
      <motion.div
        animate={{ x: SHAKE_X, y: SHAKE_Y }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="relative"
      >
        {/* 光剑 */}
        <motion.svg
          width="600" height="600"
          viewBox="0 0 600 600"
          className="absolute pointer-events-none"
          style={{ left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
        >
          <motion.line
            x1="0" y1="0" x2="600" y2="600"
            stroke="#FFFFFF"
            strokeWidth="8"
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: [0, 1, 1], opacity: [0, 1, 0] }}
            transition={{ duration: 0.35, delay: 0.35, times: [0, 0.5, 1] }}
            style={{ filter: 'drop-shadow(0 0 12px #FCD34D)' }}
          />
        </motion.svg>

        {/* 单词 */}
        <motion.div
          initial={{ scale: 1, opacity: 1 }}
          animate={{ scale: [1, 1.5, 1.5], opacity: 1 }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
          className="text-6xl font-black text-white text-center relative"
          style={{ WebkitTextStroke: '2px #FCD34D' }}
        >
          {!split ? (
            <span>{word}</span>
          ) : (
            <span className="inline-flex">
              <motion.span
                initial={{ x: 0, rotate: 0 }}
                animate={{ x: -40, rotate: -8, opacity: [1, 1, 0] }}
                transition={{ duration: 0.6 }}
              >
                {w1}
              </motion.span>
              <motion.span
                initial={{ x: 0, rotate: 0 }}
                animate={{ x: 40, rotate: 8, opacity: [1, 1, 0] }}
                transition={{ duration: 0.6 }}
              >
                {w2}
              </motion.span>
            </span>
          )}
        </motion.div>
      </motion.div>

      {/* 闪白 */}
      <AnimatePresence>
        {flash && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.08 }}
            className="absolute inset-0 bg-white"
          />
        )}
      </AnimatePresence>
    </div>
  );
}
