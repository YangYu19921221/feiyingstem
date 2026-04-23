import { motion } from 'framer-motion';
import { useEffect, useRef, useState } from 'react';
import { useChallengeSfx } from '../../hooks/useChallengeSfx';

export type RewardTier = 'normal' | 'lucky' | 'crit' | 'miracle';

interface Props {
  tier: RewardTier;
  expGained: number;
  coinGained: number;
  onComplete: () => void;
}

const TIER_COLOR: Record<RewardTier, string> = {
  normal:  '#06B6D4',
  lucky:   '#8B5CF6',
  crit:    '#DC2626',
  miracle: '#FCD34D',
};

/**
 * 第三幕（2.5 – 4.0s）：奖励入账
 * Phase 1 只做 normal 档（70%）；lucky/crit/miracle 留给 Phase 2 扩展
 */
export default function RewardReveal({ tier, expGained, coinGained, onComplete }: Props) {
  const { play } = useChallengeSfx();
  const [expDisplay, setExpDisplay] = useState(0);
  const [coinDisplay, setCoinDisplay] = useState(0);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    play('coin_drop', { volume: 0.5 });
    const duration = 800;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      setExpDisplay(Math.round(expGained * p));
      setCoinDisplay(Math.round(coinGained * p));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const done = setTimeout(() => onCompleteRef.current(), 1500);
    return () => { cancelAnimationFrame(raf); clearTimeout(done); };
  }, [expGained, coinGained, play]);

  const tierColor = TIER_COLOR[tier];

  return (
    <div className="fixed inset-0 z-[98] pointer-events-none flex flex-col items-center justify-center">
      <motion.div
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', damping: 14, stiffness: 200 }}
        className="bg-gradient-to-br from-gray-900/90 to-gray-800/90 backdrop-blur rounded-3xl px-10 py-6 border-2"
        style={{ borderColor: tierColor }}
      >
        <div className="flex items-center gap-8">
          <div className="text-center">
            <div className="text-xs text-gray-400 mb-1">EXP</div>
            <div className="text-4xl font-black" style={{ color: tierColor }}>+{expDisplay}</div>
          </div>
          <div className="w-px h-10 bg-gray-600" />
          <div className="text-center">
            <div className="text-xs text-gray-400 mb-1">金币</div>
            <div className="text-4xl font-black text-yellow-400">+{coinDisplay}</div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
