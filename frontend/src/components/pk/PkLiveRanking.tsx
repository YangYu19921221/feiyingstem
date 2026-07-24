/** PK 实时排行榜(擂台版):深色竞技场底 + 冠军金色聚光 + 赛道进度 + 抢分浮动。
 *  名次变化用 layout 弹簧动画滑动交换,营造你追我赶的紧迫感。 */
import { motion, AnimatePresence } from 'framer-motion';
import type { PkLiveRankItem } from '../../api/pk';

interface Props {
  items: PkLiveRankItem[];
  meId: number;
  totalQuestions: number;
  /** 最近一次结算各玩家的得分增量(user_id → points_gained) */
  gains?: Record<string, number>;
  /** 结算序号,用于让每次 +分 浮动动画都有新 key */
  settleSeq?: number;
}

const RANK_BADGE: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

/** 每个名次的赛道配色:冠军金、亚军银、季军铜,其余橙。 */
const LANE_TONE: Record<number, string> = {
  1: 'from-amber-400 via-yellow-300 to-amber-500',
  2: 'from-slate-300 via-slate-200 to-slate-400',
  3: 'from-orange-400 via-amber-500 to-orange-600',
};

export default function PkLiveRanking({ items, meId, totalQuestions, gains, settleSeq = 0 }: Props) {
  const leaderPoints = items.length ? Math.max(...items.map((i) => i.points)) : 0;

  return (
    <div className="relative overflow-hidden rounded-3xl bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 shadow-2xl ring-1 ring-white/10">
      {/* 顶部光晕 + 竞技场氛围 */}
      <div className="pointer-events-none absolute -top-16 left-1/2 -translate-x-1/2 h-40 w-56 rounded-full bg-primary/25 blur-3xl" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_-10%,rgba(255,107,53,0.18),transparent_60%)]" />

      {/* 标题栏:LIVE 脉冲 */}
      <div className="relative flex items-center justify-between px-4 pt-3.5 pb-2.5">
        <div className="flex items-center gap-2">
          <span className="text-lg">🏟️</span>
          <h3 className="font-display font-extrabold tracking-wide text-white text-[15px]">实时战况</h3>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-red-500/15 px-2 py-1">
          <motion.span
            className="h-2 w-2 rounded-full bg-red-500"
            animate={{ opacity: [1, 0.3, 1], scale: [1, 0.8, 1] }}
            transition={{ repeat: Infinity, duration: 1.2 }}
          />
          <span className="text-[10px] font-bold tracking-widest text-red-300">LIVE</span>
        </div>
      </div>

      {/* 榜单 */}
      <div className="relative space-y-1.5 px-2.5 pb-3">
        {items.map((it) => {
          const isMe = it.user_id === meId;
          const isLeader = it.rank === 1 && it.points > 0;
          const gain = gains?.[String(it.user_id)] ?? 0;
          const answered = it.correct + it.wrong;
          const pct = totalQuestions > 0 ? Math.min(100, (answered / totalQuestions) * 100) : 0;
          // 与领跑者的分差(展示"差多少分反超"的紧迫感)
          const behind = leaderPoints - it.points;
          const lane = LANE_TONE[it.rank] ?? 'from-primary via-orange-400 to-primary';

          return (
            <motion.div
              key={it.user_id}
              layout
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
              className={`relative overflow-hidden rounded-2xl px-2.5 py-2 ${
                isLeader
                  ? 'bg-gradient-to-r from-amber-500/25 via-amber-400/10 to-transparent ring-1 ring-amber-300/50'
                  : isMe
                    ? 'bg-primary/15 ring-1 ring-primary/50'
                    : 'bg-white/[0.04] ring-1 ring-white/5'
              } ${!it.online ? 'opacity-45 grayscale' : ''}`}
            >
              {/* 冠军流光 */}
              {isLeader && it.online && (
                <motion.div
                  className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/15 to-transparent"
                  initial={{ x: '-120%' }}
                  animate={{ x: '120%' }}
                  transition={{ repeat: Infinity, duration: 2.4, ease: 'easeInOut' }}
                />
              )}

              <div className="relative flex items-center gap-2">
                {/* 名次徽章 */}
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center ${isLeader ? 'text-2xl' : 'text-lg'}`}>
                  {RANK_BADGE[it.rank] ?? (
                    <span className="font-numeric text-sm font-bold text-slate-400">{it.rank}</span>
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  {/* 昵称行 */}
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`truncate text-sm font-bold ${
                        isLeader ? 'text-amber-200' : isMe ? 'text-orange-200' : 'text-slate-100'
                      }`}
                    >
                      {it.nickname}
                    </span>
                    {isMe && (
                      <span className="shrink-0 rounded bg-primary px-1 py-px text-[9px] font-bold text-white">我</span>
                    )}
                    {it.streak >= 2 && it.online && (
                      <motion.span
                        key={`streak-${it.streak}`}
                        initial={{ scale: 1.4 }}
                        animate={{ scale: 1 }}
                        className="shrink-0 font-numeric text-[11px] font-extrabold text-orange-400"
                      >
                        🔥×{it.streak}
                      </motion.span>
                    )}
                    {!it.online && <span className="shrink-0 text-[10px] text-red-400">掉线</span>}
                  </div>

                  {/* 赛道进度条 */}
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/40">
                    <motion.div
                      className={`h-full rounded-full bg-gradient-to-r ${lane}`}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.5, ease: 'easeOut' }}
                    />
                  </div>
                </div>

                {/* 得分 + 抢分浮动 */}
                <div className="relative w-16 shrink-0 text-right">
                  <motion.div
                    key={it.points}
                    initial={{ scale: 1.35, color: '#5FD35F' }}
                    animate={{ scale: 1, color: isLeader ? '#FCD34D' : '#FFFFFF' }}
                    transition={{ duration: 0.35 }}
                    className="font-numeric text-lg font-extrabold leading-none"
                  >
                    {it.points}
                  </motion.div>
                  {/* 落后领跑者多少分(非领跑且在线时显示) */}
                  {!isLeader && it.online && behind > 0 && (
                    <span className="font-numeric text-[10px] text-slate-500">-{behind}</span>
                  )}
                  <AnimatePresence>
                    {gain > 0 && (
                      <motion.span
                        key={`gain-${settleSeq}`}
                        initial={{ opacity: 0, y: 6, scale: 0.8 }}
                        animate={{ opacity: [0, 1, 1, 0], y: [6, -10, -16, -24], scale: [0.8, 1.2, 1.1, 1] }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 1.5, times: [0, 0.15, 0.7, 1], ease: 'easeOut' }}
                        className="pointer-events-none absolute -top-2 right-0 font-numeric text-sm font-extrabold text-success drop-shadow-[0_0_6px_rgba(95,211,95,0.7)]"
                      >
                        +{gain}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          );
        })}

        {items.length === 0 && (
          <p className="py-6 text-center text-sm text-slate-500">等待选手上场…</p>
        )}
      </div>
    </div>
  );
}
