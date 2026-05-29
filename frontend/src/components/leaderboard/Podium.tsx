import { motion } from 'framer-motion';
import PictureFallback from '../PictureFallback';
import {
  TIER_THEME, formatValue, unitOf, useCountUp,
  type Tier, type LeaderboardEntry,
} from './shared';
import type { LeaderboardKind } from '../../api/leaderboard';

const EASE = [0.16, 1, 0.3, 1] as const;

// 三档领奖台的几何：金最高居中，银次之居左，铜最矮居右
const SLOT: Record<Tier, {
  order: number; pedestalH: number; portrait: string; delay: number;
}> = {
  silver: { order: 1, pedestalH: 96,  portrait: 'w-20 h-20 md:w-24 md:h-24', delay: 0.18 },
  gold:   { order: 2, pedestalH: 132, portrait: 'w-28 h-28 md:w-36 md:h-36', delay: 0 },
  bronze: { order: 3, pedestalH: 72,  portrait: 'w-20 h-20 md:w-24 md:h-24', delay: 0.32 },
};

function PodiumColumn({
  entry, tier, kind, isMe,
}: {
  entry: LeaderboardEntry | undefined;
  tier: Tier;
  kind: LeaderboardKind;
  isMe: boolean;
}) {
  const theme = TIER_THEME[tier];
  const slot = SLOT[tier];
  const value = useCountUp(entry?.value ?? 0);
  const isGold = tier === 'gold';
  const name = entry ? (entry.full_name || entry.username) : null;

  return (
    <div className="flex flex-col items-center justify-end flex-1 min-w-0"
         style={{ order: slot.order }}>
      {/* 皇冠 / 奖牌 */}
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.6 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: EASE, delay: slot.delay + 0.25 }}
        className={isGold ? 'text-3xl md:text-4xl' : 'text-xl md:text-2xl'}
        style={{ filter: `drop-shadow(0 4px 10px ${theme.glow})` }}
      >
        {entry ? theme.crown : '✨'}
      </motion.div>

      {/* 立绘 + 光晕 */}
      <motion.div
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: EASE, delay: slot.delay + 0.1 }}
        className="relative flex items-end justify-center mt-1"
        style={{ background: `radial-gradient(circle at 50% 70%, ${theme.glow}, transparent 68%)` }}
      >
        {entry ? (
          <PictureFallback
            src={`/champions/${kind}-${tier}.webp`}
            alt={`${theme.label} ${name}`}
            className={`${slot.portrait} object-contain drop-shadow-md select-none`}
            draggable={false}
            decoding="async"
            {...(isGold ? { fetchPriority: 'high' as const } : {})}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
          />
        ) : (
          <div className={`${slot.portrait} grid place-items-center text-2xl opacity-40`}>👤</div>
        )}
      </motion.div>

      {/* 姓名 */}
      <p className={`mt-1 font-display font-semibold text-center truncate max-w-full px-1
                     ${isGold ? 'text-base md:text-lg' : 'text-sm'}`}
         style={{ color: entry ? 'oklch(0.22 0.015 55)' : 'oklch(0.72 0.008 55)' }}>
        {name || '虚位以待'}
      </p>

      {/* 领奖台柱体：高度差表达名次，从地面升起 */}
      <motion.div
        initial={{ height: 0 }}
        animate={{ height: slot.pedestalH }}
        transition={{ duration: 0.6, ease: EASE, delay: slot.delay }}
        className="relative w-full max-w-[150px] mt-2 rounded-t-xl overflow-hidden"
        style={{
          background: theme.pedestal,
          boxShadow: `inset 0 1px 0 oklch(1 0 0 / 0.5), 0 -1px 0 ${theme.pedestalEdge}`,
        }}
      >
        {/* 名次大数字刻在台面 */}
        <div className="absolute inset-x-0 top-2 flex flex-col items-center">
          <span className="font-display font-bold leading-none"
                style={{ fontSize: isGold ? '2rem' : '1.5rem',
                         color: 'oklch(1 0 0 / 0.92)',
                         textShadow: `0 1px 2px ${theme.pedestalEdge}` }}>
            {entry?.rank ?? ''}
          </span>
          {entry && (
            <span className="font-numeric font-bold mt-1 px-2 py-0.5 rounded-full text-xs md:text-sm"
                  style={{ background: theme.badge, color: theme.badgeText }}>
              {formatValue(kind, value)}
              {unitOf(kind) && <span className="opacity-70 ml-0.5">{unitOf(kind)}</span>}
            </span>
          )}
        </div>
        {isMe && (
          <span className="absolute bottom-1.5 inset-x-0 text-center text-[10px] font-semibold"
                style={{ color: 'oklch(1 0 0 / 0.92)' }}>
            就是你
          </span>
        )}
      </motion.div>
    </div>
  );
}

export default function Podium({
  top, kind, myUserId,
}: {
  top: LeaderboardEntry[];
  kind: LeaderboardKind;
  myUserId: number;
}) {
  const byRank = (r: number) => top.find(e => e.rank === r);
  return (
    <div
      className="relative rounded-3xl overflow-hidden px-4 pt-6 pb-0 bg-white"
      style={{
        border: '1px solid oklch(0.68 0.185 40 / 0.1)',
        boxShadow: '0 1px 0 oklch(0.68 0.185 40 / 0.05), 0 14px 40px -16px oklch(0.6 0.16 60 / 0.35)',
      }}
    >
      {/* 顶部庆祝暖光 */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40"
           style={{ background: 'radial-gradient(ellipse 70% 100% at 50% 0%, oklch(0.9 0.13 78 / 0.3), transparent 70%)' }} />
      <div className="relative flex items-end gap-2 md:gap-4">
        <PodiumColumn entry={byRank(2)} tier="silver" kind={kind} isMe={byRank(2)?.user_id === myUserId} />
        <PodiumColumn entry={byRank(1)} tier="gold"   kind={kind} isMe={byRank(1)?.user_id === myUserId} />
        <PodiumColumn entry={byRank(3)} tier="bronze" kind={kind} isMe={byRank(3)?.user_id === myUserId} />
      </div>
    </div>
  );
}
