import { AnimatePresence } from 'framer-motion';
import { useEffect, useState } from 'react';
import SwordSlash from './SwordSlash';
import ParticleBurst from './ParticleBurst';
import RewardReveal, { type RewardTier } from './RewardReveal';

export interface ChallengeVictoryProps {
  /** 用来展示劈字的单词（推荐用本关最后一个答对的词） */
  featureWord: string;
  /** 奖励档位，Phase 1 全部传 normal */
  tier: RewardTier;
  expGained: number;
  coinGained: number;
  /** 4 幕全部结束后回调，外层展示下一关按钮 */
  onFinished: () => void;
}

type Phase = 'slash' | 'particles' | 'reveal' | 'done';

export default function ChallengeVictory({
  featureWord, tier, expGained, coinGained, onFinished,
}: ChallengeVictoryProps) {
  const [phase, setPhase] = useState<Phase>('slash');

  useEffect(() => {
    if (phase === 'done') onFinished();
  }, [phase, onFinished]);

  return (
    <AnimatePresence>
      {phase === 'slash' && (
        <SwordSlash word={featureWord} onComplete={() => setPhase('particles')} />
      )}
      {phase === 'particles' && (
        <ParticleBurst onComplete={() => setPhase('reveal')} />
      )}
      {phase === 'reveal' && (
        <RewardReveal
          tier={tier}
          expGained={expGained}
          coinGained={coinGained}
          onComplete={() => setPhase('done')}
        />
      )}
    </AnimatePresence>
  );
}
