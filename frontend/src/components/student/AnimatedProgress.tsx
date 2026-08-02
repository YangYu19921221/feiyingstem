import { motion, useReducedMotion } from 'framer-motion';

/**
 * 动效进度条(学生端通用)
 * - 挂载时从 0 生长到实际进度(easeOut,列表里一排同时长出来很有生命感)
 * - 填充上一道流光循环扫过(tailwind 现成的 animate-shimmer)
 * - 颜色跟显示的数字走: ≥100% 草绿(完成),否则暖橙(进行中);可用 fillClassName 覆盖
 * - 尊重系统"减弱动态效果": 直接静态渲染,不长条不流光
 */
interface AnimatedProgressProps {
  /** 0-100,越界自动截断 */
  percent: number;
  /** 覆盖填充色(默认 ≥100 草绿 / 未满暖橙) */
  fillClassName?: string;
  trackClassName?: string;
  /** 条高,如 h-1 / h-1.5 */
  heightClassName?: string;
  /** 关闭流光(密集列表想安静些时用) */
  shimmer?: boolean;
}

export default function AnimatedProgress({
  percent,
  fillClassName,
  trackClassName = 'bg-black/[0.05]',
  heightClassName = 'h-1',
  shimmer = true,
}: AnimatedProgressProps) {
  const reduceMotion = useReducedMotion();
  const pct = Math.min(100, Math.max(0, percent));
  const fill = fillClassName ?? (pct >= 100 ? 'bg-success' : 'bg-accent-warm');
  return (
    <div className={`w-full ${heightClassName} ${trackClassName} rounded-full overflow-hidden`}>
      <motion.div
        className={`relative h-full rounded-full overflow-hidden ${fill}`}
        initial={reduceMotion ? false : { width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={reduceMotion ? { duration: 0 } : { duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.05 }}
      >
        {shimmer && !reduceMotion && pct > 0 && (
          <span
            className="absolute inset-0 animate-shimmer bg-gradient-to-r from-transparent via-white/40 to-transparent"
            aria-hidden="true"
          />
        )}
      </motion.div>
    </div>
  );
}
