/** PK 实时排行榜:每题结算后刷新;名次变化用 layout 弹簧动画滑动交换。 */
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

export default function PkLiveRanking({ items, meId, totalQuestions, gains, settleSeq = 0 }: Props) {
  return (
    <div className="card-soft rounded-2xl p-3">
      <div className="flex items-center justify-between mb-2 px-1">
        <h3 className="font-display font-semibold text-ink flex items-center gap-1.5">
          <span>🏆</span> 实时排名
        </h3>
        <span className="text-[11px] text-ink-mute">答对越快分越高</span>
      </div>
      <div className="space-y-1.5">
        {items.map((it) => {
          const isMe = it.user_id === meId;
          const gain = gains?.[String(it.user_id)] ?? 0;
          const answered = it.correct + it.wrong;
          const pct = totalQuestions > 0 ? Math.min(100, (answered / totalQuestions) * 100) : 0;
          return (
            <motion.div
              key={it.user_id}
              layout
              transition={{ type: 'spring', stiffness: 350, damping: 28 }}
              className={`relative flex items-center gap-2 rounded-xl px-2.5 py-2 ${
                isMe
                  ? 'bg-orange-50 ring-2 ring-primary/40'
                  : 'bg-gray-50'
              } ${!it.online ? 'opacity-50' : ''}`}
            >
              {/* 名次 */}
              <span className="w-7 text-center shrink-0">
                {RANK_BADGE[it.rank] ?? (
                  <span className="text-sm font-semibold text-ink-mute font-numeric">{it.rank}</span>
                )}
              </span>

              {/* 昵称 + 状态 */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={`truncate text-sm font-medium ${isMe ? 'text-primary' : 'text-ink'}`}>
                    {it.nickname}
                  </span>
                  {isMe && (
                    <span className="text-[10px] bg-primary text-white px-1 py-px rounded shrink-0">我</span>
                  )}
                  {it.streak >= 2 && it.online && (
                    <span className="text-[11px] text-orange-500 font-semibold shrink-0 font-numeric">
                      🔥×{it.streak}
                    </span>
                  )}
                  {!it.online && <span className="text-[10px] text-red-400 shrink-0">掉线</span>}
                </div>
                {/* 进度微条 */}
                <div className="mt-1 h-1 bg-gray-200 rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-gradient-to-r from-accent to-success"
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.4 }}
                  />
                </div>
              </div>

              {/* 得分 + 浮动增量 */}
              <div className="relative shrink-0 text-right w-14">
                <motion.span
                  key={it.points}
                  initial={{ scale: 1.25 }}
                  animate={{ scale: 1 }}
                  className="text-base font-bold text-ink font-numeric"
                >
                  {it.points}
                </motion.span>
                <AnimatePresence>
                  {gain > 0 && (
                    <motion.span
                      key={`gain-${settleSeq}`}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: [0, 1, 1, 0], y: [4, -8, -12, -18] }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 1.4, times: [0, 0.15, 0.7, 1], ease: 'easeOut' }}
                      className="absolute -top-1 right-0 text-xs font-bold text-success font-numeric pointer-events-none"
                    >
                      +{gain}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
