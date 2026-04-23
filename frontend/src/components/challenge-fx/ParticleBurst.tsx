import { motion } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChallengeSfx } from '../../hooks/useChallengeSfx';

interface Props {
  onComplete: () => void;
  particleCount?: number;
}

const SYMBOLS = ['★', '福', '⚔', '✦', '◆'];
const COLORS = ['#8B5CF6', '#06B6D4', '#FCD34D', '#F472B6'];

interface Particle {
  id: number;
  symbol: string;
  color: string;
  startX: number;
  startY: number;
  ctrlX: number;
  ctrlY: number;
  delay: number;
  duration: number;
}

/**
 * 第二幕（1.2 – 2.5s）：粒子沿贝塞尔曲线飞向宠物头像
 * 终点：document.getElementById('floating-pet-anchor') 的中心
 * 命中音效：每颗粒子触发 particle_tick（前 10 颗音高递增）
 */
export default function ParticleBurst({ onComplete, particleCount = 60 }: Props) {
  const { play } = useChallengeSfx();
  const [target, setTarget] = useState<{ x: number; y: number } | null>(null);
  const hitCountRef = useRef(0);
  const pendingTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const { cx, cy, actualCount } = useMemo(() => {
    const cores = (navigator as unknown as { hardwareConcurrency?: number }).hardwareConcurrency || 4;
    return {
      cx: window.innerWidth / 2,
      cy: window.innerHeight / 2,
      actualCount: cores < 4 ? Math.min(30, particleCount) : particleCount,
    };
  }, [particleCount]);

  const particles = useMemo<Particle[]>(() => {
    return Array.from({ length: actualCount }, (_, i) => {
      const angle = (Math.random() - 0.5) * Math.PI;
      const radius = 40 + Math.random() * 40;
      return {
        id: i,
        symbol: SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)],
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        startX: cx + Math.cos(angle) * radius,
        startY: cy + Math.sin(angle) * radius,
        ctrlX: cx + (Math.random() - 0.5) * 400,
        ctrlY: cy - 200 - Math.random() * 100,
        delay: Math.random() * 0.3,
        duration: 0.9 + Math.random() * 0.3,
      };
    });
  }, [actualCount, cx, cy]);

  useEffect(() => {
    const el = document.getElementById('floating-pet-anchor');
    if (el) {
      const rect = el.getBoundingClientRect();
      setTarget({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    } else {
      setTarget({ x: window.innerWidth - 60, y: 60 });
    }
    const t = setTimeout(onComplete, 1300);
    const timers = pendingTimersRef.current;
    return () => {
      clearTimeout(t);
      timers.forEach(clearTimeout);
      timers.length = 0;
    };
  }, [onComplete]);

  const handleHit = useCallback(() => {
    hitCountRef.current += 1;
    if (hitCountRef.current <= 10) {
      const rate = 1 + (hitCountRef.current - 1) * 0.06;
      play('particle_tick', { rate, volume: 0.4 });
    }
    const el = document.getElementById('floating-pet-anchor');
    if (el) {
      el.style.transition = 'transform 0.12s';
      el.style.transform = 'scale(1.08)';
      const timer = setTimeout(() => { el.style.transform = 'scale(1)'; }, 120);
      pendingTimersRef.current.push(timer);
    }
  }, [play]);

  if (!target) return null;

  return (
    <div className="fixed inset-0 z-[99] pointer-events-none">
      {particles.map((p) => (
        <motion.span
          key={p.id}
          initial={{ x: p.startX, y: p.startY, opacity: 0, scale: 0.5 }}
          animate={{
            x: [p.startX, p.ctrlX, target.x],
            y: [p.startY, p.ctrlY, target.y],
            opacity: [0, 1, 0.3],
            scale: [0.5, 1.2, 0.6],
          }}
          transition={{
            duration: p.duration,
            delay: p.delay,
            ease: [0.22, 0.68, 0.42, 1],
            times: [0, 0.5, 1],
          }}
          onAnimationComplete={handleHit}
          className="absolute text-2xl select-none"
          style={{
            color: p.color,
            filter: `drop-shadow(0 0 6px ${p.color})`,
            fontWeight: 900,
            left: 0,
            top: 0,
          }}
        >
          {p.symbol}
        </motion.span>
      ))}
    </div>
  );
}
