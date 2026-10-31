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
  /**
   * todo 没读 / green 读对了 / yellow 过了但接近(词尾多带一个音、自己点的)/
   * near 没过但差一点(黄)/ red 没过、差得多(红)。green / yellow 揭示单词
   */
  status: 'todo' | 'green' | 'yellow' | 'near' | 'red';
  active: boolean;
  /** 刚刚变绿(用来只对新变绿的那一格放特效,不是每次重渲染都放) */
  justDone: boolean;
  onClick: () => void;
}

/** 读屏软件念出的颜色含义(颜色本身读屏读不出来) */
const STATUS_SAY: Record<Props['status'], string> = {
  todo: '', green: ',读对了', yellow: ',接近', near: ',差一点', red: ',差得多',
};

/** 星星散开的方向,六个角度均分 */
const SPARKS = [0, 60, 120, 180, 240, 300];

/**
 * 底色 × 选中态。**每种组合只给一组 ring 类,不叠加**(2026-10-30 用户「鼠标选中音标模块要有选中的样式」):
 * 以前底色的 ring-emerald-300 / ring-amber-300 和选中的 ring-orange-400 同时写在一个元素上,
 * Tailwind 生成的 CSS 里 amber、emerald 排在 orange 后面,于是绿格、琥珀格被点中后选中框直接被盖掉,
 * 看不出点中了哪一格;白格的边框是 slate-100,几乎看不见,鼠标移上去也没有任何变化。
 */
function cellTone(status: Props['status'], active: boolean): string {
  // ⚠️ 白底不能写 bg-white: index.css 里 `body.student-interface .bg-white.rounded-xl` 会把 box-shadow
  // 整个改掉,而 Tailwind 的 ring 就是 box-shadow —— 写 bg-white 的话选中框、悬停框一律画不出来
  // (浏览器实测: 白格点中后 box-shadow 仍是那条全局卡片阴影)。bg-white/95 是另一个类名,那条规则匹配不到
  const bg = status === 'green' ? 'bg-emerald-50'
    : status === 'yellow' || status === 'near' ? 'bg-amber-50'
      : status === 'red' ? 'bg-rose-50' : 'bg-white/95';
  if (active) {
    // 没读的那一格选中时底色换成浅橙,和别的白格一眼分开。
    // ⚠️ 不能加 shadow-md / shadow-lg: index.css 的 `body.student-interface .shadow-md` 同样会把 box-shadow
    // 整个改掉,ring 跟着没了(浏览器实测)
    return `${status === 'todo' ? 'bg-orange-50' : bg} ring-[3px] ring-[#FF6B35]`;
  }
  // 黄 / 红用 2px 框: 1px 的浅色框在平板上看不出是黄还是红
  const idle = status === 'green'
    ? 'ring-1 ring-emerald-300 hover:ring-2 hover:ring-emerald-400'
    : status === 'yellow' || status === 'near'
      ? 'ring-2 ring-amber-300 hover:ring-amber-400'
      : status === 'red'
        ? 'ring-2 ring-rose-300 hover:ring-rose-400'
        : 'ring-1 ring-slate-200 hover:ring-2 hover:ring-orange-300 hover:bg-orange-50/40';
  return `${bg} ${idle} hover:shadow-sm`;
}

export default function PhonemeCell({
  phonetic, word, meaning, status, active, justDone, onClick,
}: Props) {
  const reduce = useReducedMotion();
  // 过了(绿 / 黄)才揭示单词
  const done = status === 'green' || status === 'yellow';
  const wordTone = status === 'green' ? 'text-emerald-600' : 'text-amber-600';

  return (
    <motion.div
      onClick={onClick}
      // 不用 <button>: 里面是 <p>,按钮里不能放段落。键盘也要能选(Tab 到这一格,回车 / 空格)
      role="button"
      tabIndex={0}
      aria-pressed={active}
      aria-label={`${phonetic}${done ? ` ${word}` : ''}${STATUS_SAY[status]}`}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) { e.preventDefault(); onClick(); }
      }}
      // 变绿时弹一下。reduce 模式下不缩放,只保留颜色变化
      animate={justDone && !reduce
        ? { scale: [1, 1.12, 1] }
        : { scale: 1 }}
      transition={{ duration: 0.42, times: [0, 0.45, 1], ease: [0.34, 1.56, 0.64, 1] }}
      className={[
        'relative cursor-pointer overflow-hidden rounded-xl p-3 text-center outline-none',
        'transition-[background-color,box-shadow] duration-200',
        'focus-visible:ring-[3px] focus-visible:ring-[#FF6B35]',
        cellTone(status, active),
      ].join(' ')}
    >
      {/* 选中的格子右上角一个小橙点: 不靠颜色深浅也能一眼看出点中了哪一格 */}
      {active && (
        <span className="pointer-events-none absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#FF6B35]" aria-hidden="true" />
      )}
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
        status === 'green' ? 'text-emerald-700'
          : status === 'yellow' || status === 'near' ? 'text-amber-800'
            : status === 'red' ? 'text-rose-700' : 'text-slate-800',
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
              className={`font-mono text-xs ${wordTone}`}
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
