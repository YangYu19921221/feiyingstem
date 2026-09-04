/**
 * 读对了的那一刻 —— 音标格变绿的庆祝特效
 *
 * 这一格变绿是孩子在这个页面唯一的奖励,值得做扎实:
 *   ① 卡片弹一下(scale 1 → 1.12 → 1)—— 有回弹才有"成了"的手感
 *   ② 描边从下往上扫过一圈绿光
 *   ③ 六个小星星从中心散开(不用 canvas,六个 div 足够,省性能)
 *   ④ 音标淡出、单词淡入 —— 揭示"原来是这个词"
 *
 * 全部尊重 prefers-reduced-motion:关掉动画后仍然能看到绿色和单词,
 * 只是不动 —— 前庭敏感的孩子不该被迫看弹跳。
 */
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';

interface Props {
  phonetic: string;
  word: string;
  meaning?: string | null;
  /** todo=没读 / done=读了(绿) / retry=没听到(琥珀) */
  status: 'todo' | 'done' | 'retry';
  active: boolean;
  /** 刚刚变绿(用来只对新变绿的那一格放特效,不是每次重渲染都放) */
  justDone: boolean;
  onClick: () => void;
}

/** 星星散开的方向,六个角度均分 */
const SPARKS = [0, 60, 120, 180, 240, 300];

export default function PhonemeCell({
  phonetic, word, meaning, status, active, justDone, onClick,
}: Props) {
  const reduce = useReducedMotion();
  const done = status === 'done';

  return (
    <motion.div
      onClick={onClick}
      // 变绿时弹一下。reduce 模式下不缩放,只保留颜色变化
      animate={justDone && !reduce
        ? { scale: [1, 1.12, 1] }
        : { scale: 1 }}
      transition={{ duration: 0.42, times: [0, 0.45, 1], ease: [0.34, 1.56, 0.64, 1] }}
      className={[
        'relative cursor-pointer overflow-hidden rounded-xl p-3 text-center',
        'transition-colors duration-300',
        done
          ? 'bg-emerald-50 ring-1 ring-emerald-300'
          : status === 'retry'
            ? 'bg-amber-50 ring-1 ring-amber-300'
            : 'bg-white ring-1 ring-slate-100',
        active && !done ? 'ring-2 ring-orange-400' : '',
      ].join(' ')}
    >
      {/* 绿光从下往上扫 */}
      {justDone && !reduce && (
        <motion.div
          initial={{ y: '100%', opacity: 0.9 }}
          animate={{ y: '-100%', opacity: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          className="pointer-events-none absolute inset-0 bg-gradient-to-t
                     from-emerald-300/60 via-emerald-200/30 to-transparent"
        />
      )}

      {/* 星星散开。六个 div 就够,不必上 canvas */}
      {justDone && !reduce && SPARKS.map(deg => (
        <motion.span
          key={deg}
          initial={{ x: 0, y: 0, opacity: 1, scale: 0.4 }}
          animate={{
            x: Math.cos((deg * Math.PI) / 180) * 34,
            y: Math.sin((deg * Math.PI) / 180) * 34,
            opacity: 0,
            scale: 1.1,
          }}
          transition={{ duration: 0.62, ease: 'easeOut' }}
          className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5
                     rounded-full bg-emerald-400"
        />
      ))}

      <p className={[
        'relative font-mono text-xl transition-colors',
        done ? 'text-emerald-700' : 'text-slate-800',
      ].join(' ')}>
        {phonetic}
      </p>

      {/* 读对之后音标下方从释义换成单词:这是"揭示"动作,值得有过渡 */}
      <div className="relative mt-1 h-4">
        <AnimatePresence mode="wait" initial={false}>
          {done ? (
            <motion.p
              key="word"
              initial={reduce ? {} : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? {} : { opacity: 0, y: -6 }}
              transition={{ duration: 0.28 }}
              className="font-mono text-xs text-emerald-600"
            >
              {word}
            </motion.p>
          ) : (
            <motion.p
              key="meaning"
              initial={false}
              animate={{ opacity: 1 }}
              exit={reduce ? {} : { opacity: 0 }}
              className="truncate text-xs text-slate-400"
            >
              {meaning}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
