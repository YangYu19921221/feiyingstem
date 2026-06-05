import { motion, useReducedMotion } from 'framer-motion';

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * 冠军登顶星芒粒子:金牌冠军出现时,从中心向外迸发一圈星星,营造"登顶高光"庆祝感。
 * 纯 transform/opacity 动画(不碰布局属性),循环呼吸式重放。尊重 prefers-reduced-motion。
 */
export default function ChampionSparkles({ color }: { color: string }) {
  const reduce = useReducedMotion();
  if (reduce) return null;

  // 8 颗星沿圆周分布,交错相位,营造持续闪烁的星芒
  const stars = Array.from({ length: 8 }, (_, i) => {
    const angle = (i / 8) * Math.PI * 2;
    const dist = 46 + (i % 2) * 14;          // 内外两圈
    return {
      x: Math.cos(angle) * dist,
      y: Math.sin(angle) * dist,
      delay: (i % 4) * 0.35,
      size: i % 2 === 0 ? 7 : 5,
    };
  });

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center" aria-hidden>
      {stars.map((s, i) => (
        <motion.span
          key={i}
          className="absolute"
          style={{
            width: s.size, height: s.size,
            background: color,
            borderRadius: '9999px',
            boxShadow: `0 0 8px ${color}`,
          }}
          initial={{ x: 0, y: 0, scale: 0, opacity: 0 }}
          animate={{
            x: [0, s.x], y: [0, s.y],
            scale: [0, 1.1, 0],
            opacity: [0, 1, 0],
          }}
          transition={{
            duration: 1.9,
            ease: EASE,
            delay: s.delay,
            repeat: Infinity,
            repeatDelay: 1.4,
          }}
        />
      ))}
    </div>
  );
}
