/**
 * 成就解锁：全屏电影级展示
 * 暗色背景图 + 徽章从中心炸出 + 文字依次浮现
 * 多个成就时左右切换。点击任意处或 5s 后自动收束
 */
import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { AchievementIcon } from './AchievementIcon';

interface UnlockedAchievement {
  id: number;
  name: string;
  description: string;
  icon: string;
  reward_points: number;
}

interface AchievementModalProps {
  achievements: UnlockedAchievement[];
  onClose: () => void;
}

const AchievementModal = ({ achievements, onClose }: AchievementModalProps) => {
  const [index, setIndex] = useState(0);

  if (achievements.length === 0) return null;

  const current = achievements[index];
  const hasNext = index < achievements.length - 1;
  const totalPoints = achievements.reduce((sum, a) => sum + a.reward_points, 0);

  const advance = () => {
    if (hasNext) {
      setIndex(i => i + 1);
    } else {
      onClose();
    }
  };

  return (
    <AnimatePresence>
      <motion.div
        key="achievement-fx"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.4 }}
        className="fixed inset-0 z-[100] cursor-pointer overflow-hidden"
        onClick={advance}
      >
        {/* 背景：缓慢推近 + 略微旋转，模拟"门户打开" */}
        <motion.div
          initial={{ scale: 1.15, rotate: -1, opacity: 0 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ duration: 1.2, ease: [0.16, 1, 0.3, 1] }}
          className="absolute inset-0"
        >
          <img
            src="/fx-achievement.jpeg"
            alt=""
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-radial from-transparent via-black/30 to-black/80" />
        </motion.div>

        {/* 中心光晕：从徽章后面扩散 */}
        <motion.div
          key={`glow-${current.id}`}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1.5, opacity: [0, 0.8, 0] }}
          transition={{ duration: 1.6, ease: 'easeOut', delay: 0.3 }}
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 rounded-full pointer-events-none"
          style={{
            background: 'radial-gradient(circle, oklch(0.85 0.18 60 / 0.5), transparent 70%)',
            filter: 'blur(20px)',
          }}
        />

        {/* 上飘星点 */}
        <div className="absolute inset-0 pointer-events-none">
          {Array.from({ length: 20 }).map((_, i) => {
            const x = 30 + Math.random() * 40;
            const delay = 0.2 + Math.random() * 1.5;
            return (
              <motion.div
                key={`star-${current.id}-${i}`}
                initial={{ y: '50vh', x: 0, opacity: 0, scale: 0 }}
                animate={{
                  y: '-10vh',
                  x: (Math.random() - 0.5) * 100,
                  opacity: [0, 1, 1, 0],
                  scale: [0, 1, 1, 0],
                }}
                transition={{ duration: 3 + Math.random(), delay, ease: 'easeOut' }}
                className="absolute"
                style={{
                  left: `${x}%`,
                  width: 4 + Math.random() * 6,
                  height: 4 + Math.random() * 6,
                  background: 'oklch(0.9 0.15 60)',
                  borderRadius: '50%',
                  boxShadow: '0 0 12px oklch(0.85 0.18 60 / 0.8)',
                }}
              />
            );
          })}
        </div>

        {/* 徽章主体：从中心放大 + 旋转登场 */}
        <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center">
          <motion.p
            key={`label-${current.id}`}
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.6 }}
            className="text-white/70 tracking-[0.5em] text-xs md:text-sm mb-8 uppercase"
            style={{ textShadow: '0 2px 8px oklch(0 0 0 / 0.5)' }}
          >
            ACHIEVEMENT UNLOCKED
          </motion.p>

          <motion.div
            key={`icon-${current.id}`}
            initial={{ scale: 0, rotate: -180, opacity: 0 }}
            animate={{ scale: 1, rotate: 0, opacity: 1 }}
            transition={{ duration: 0.9, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
            className="mb-6"
            style={{
              filter: 'drop-shadow(0 8px 32px oklch(0.85 0.18 60 / 0.6))',
            }}
          >
            <AchievementIcon icon={current.icon} size={180} />
          </motion.div>

          <motion.h2
            key={`name-${current.id}`}
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.6, delay: 1.0 }}
            className="font-display font-bold text-white text-4xl md:text-5xl tracking-tight mb-3"
            style={{
              textShadow: `
                0 0 24px oklch(0.85 0.18 60 / 0.6),
                0 4px 12px oklch(0 0 0 / 0.5)
              `,
            }}
          >
            {current.name}
          </motion.h2>

          <motion.p
            key={`desc-${current.id}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 1.4 }}
            className="text-white/85 text-base md:text-lg max-w-md leading-relaxed mb-6"
            style={{ textShadow: '0 2px 8px oklch(0 0 0 / 0.5)' }}
          >
            {current.description}
          </motion.p>

          <motion.div
            key={`reward-${current.id}`}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.5, delay: 1.7, type: 'spring', damping: 14 }}
            className="px-5 py-2 rounded-full bg-white/15 backdrop-blur-md border border-white/30 text-white font-numeric font-semibold tracking-wide"
          >
            +{current.reward_points} 积分
          </motion.div>

          {achievements.length > 1 && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 2.0 }}
              className="absolute bottom-12 text-white/50 text-xs font-numeric"
            >
              {index + 1} / {achievements.length} {hasNext ? '· 点击查看下一个' : `· 共获得 ${totalPoints} 积分`}
            </motion.p>
          )}

          {achievements.length === 1 && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 2.5 }}
              className="absolute bottom-12 text-white/40 text-xs"
            >
              点击关闭
            </motion.p>
          )}
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default AchievementModal;
