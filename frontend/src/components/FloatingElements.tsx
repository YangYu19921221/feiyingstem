import { useMemo } from 'react';
import { motion } from 'framer-motion';

/**
 * 飞鹰英语品牌浮动字母背景
 * 用于登录/注册页的品牌展示区
 */
const FloatingElements = () => {
  const items = useMemo(() => {
    const chars = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P'];
    const colors = ['#1E40AF', '#3B82F6', '#60A5FA', '#93C5FD'];
    return Array.from({ length: 16 }, (_, i) => ({
      id: i,
      char: chars[i],
      x: Math.random() * 100,
      y: Math.random() * 100,
      xDrift: (Math.random() - 0.5) * 15,
      yDrift: (Math.random() - 0.5) * 20,
      size: Math.random() * 80 + 40,
      color: colors[Math.floor(Math.random() * colors.length)],
      duration: Math.random() * 15 + 20,
      delay: Math.random() * 8,
      rotation: Math.random() * 360,
    }));
  }, []);

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {items.map((l) => (
        <motion.div
          key={l.id}
          initial={{ x: `${l.x}%`, y: `${l.y}%`, rotate: l.rotation, opacity: 0 }}
          animate={{
            x: [`${l.x}%`, `${l.x + l.xDrift}%`, `${l.x}%`],
            y: [`${l.y}%`, `${l.y + l.yDrift}%`, `${l.y}%`],
            rotate: [l.rotation, l.rotation + 360],
            opacity: [0, 0.08, 0.08, 0],
          }}
          transition={{ duration: l.duration, delay: l.delay, repeat: Infinity, ease: 'easeInOut' }}
          style={{ position: 'absolute', fontSize: `${l.size}px`, fontWeight: 900, color: l.color, userSelect: 'none' }}
        >
          {l.char}
        </motion.div>
      ))}
    </div>
  );
};

export default FloatingElements;
