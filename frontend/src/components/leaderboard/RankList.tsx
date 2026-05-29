import { motion } from 'framer-motion';
import { useEffect, useRef } from 'react';
import { formatValue, unitOf, type LeaderboardEntry } from './shared';
import type { LeaderboardKind } from '../../api/leaderboard';

const EASE = [0.16, 1, 0.3, 1] as const;

function Row({
  entry, kind, isMe, index,
}: {
  entry: LeaderboardEntry;
  kind: LeaderboardKind;
  isMe: boolean;
  index: number;
}) {
  const unit = unitOf(kind);
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.32, ease: EASE, delay: Math.min(index * 0.03, 0.3) }}
      className="flex items-center gap-3 px-4 md:px-5 py-3"
      style={isMe ? {
        background: 'oklch(0.68 0.185 40 / 0.07)',
        boxShadow: 'inset 0 0 0 1.5px oklch(0.68 0.185 40 / 0.35)',
        borderRadius: '0.85rem',
      } : undefined}
    >
      <span className={`font-numeric font-semibold text-sm w-7 shrink-0 ${
        isMe ? 'text-accent-warm' : 'text-ink-mute'}`}>
        {entry.rank}
      </span>
      <p className={`flex-1 min-w-0 truncate text-sm ${
        isMe ? 'font-semibold text-ink' : 'font-medium text-ink'}`}>
        {entry.full_name || entry.username}
        {isMe && <span className="ml-2 text-[11px] font-semibold text-accent-warm">· 你</span>}
      </p>
      <p className="font-numeric font-semibold text-ink text-sm shrink-0">
        {formatValue(kind, entry.value)}
        {unit && <span className="text-xs text-ink-mute ml-1 font-normal">{unit}</span>}
      </p>
    </motion.div>
  );
}

/**
 * 名次列表：前 10 名常驻；若我排在 11+，单独的「邻居区」把我和上下各 2 名钉在下方，
 * 让靠后的孩子不用滚很久就看到自己，且看到的是「身边的同学 + 可追的目标」而非垫底。
 */
export default function RankList({
  top, neighbors, kind, myUserId, myRank,
}: {
  top: LeaderboardEntry[];
  neighbors: LeaderboardEntry[];
  kind: LeaderboardKind;
  myUserId: number;
  myRank: number | null;
}) {
  const meRef = useRef<HTMLDivElement>(null);
  // 我在前 10 内时，进入页面后柔和滚动到自己那一行
  const meInTop = myRank != null && myRank <= 10;
  useEffect(() => {
    if (!meInTop) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t = setTimeout(() => {
      meRef.current?.scrollIntoView({
        behavior: reduce ? 'auto' : 'smooth', block: 'center',
      });
    }, 700);
    return () => clearTimeout(t);
  }, [meInTop, myRank]);

  // 前 10 里第 4 名起进列表（前 3 已在领奖台）
  const listRows = top.filter(e => e.rank >= 4);
  const showNeighbors = myRank != null && myRank > 10 && neighbors.length > 0;

  return (
    <div className="space-y-4">
      {listRows.length > 0 && (
        <div>
          <p className="text-ink-mute text-xs font-medium mb-2 px-1">第 4 名以后</p>
          <div className="card-soft rounded-2xl p-1.5">
            {listRows.map((e, i) => (
              <div key={e.user_id} ref={e.user_id === myUserId ? meRef : undefined}>
                <Row entry={e} kind={kind} isMe={e.user_id === myUserId} index={i} />
              </div>
            ))}
          </div>
        </div>
      )}

      {showNeighbors && (
        <div>
          <div className="flex items-center gap-2 mb-2 px-1">
            <span className="text-ink-mute text-xs font-medium">你的位置附近</span>
            <span className="h-px flex-1 bg-black/[0.06]" />
          </div>
          <div className="card-soft rounded-2xl p-1.5"
               style={{ borderColor: 'oklch(0.68 0.185 40 / 0.2)' }}>
            {neighbors.map((e, i) => (
              <Row key={e.user_id} entry={e} kind={kind} isMe={e.user_id === myUserId} index={i} />
            ))}
          </div>
        </div>
      )}

      {top.length === 0 && (
        <div className="card-soft rounded-2xl p-12 text-center">
          <p className="text-ink-soft mb-1">这一榜还没人上来，先抢个位置？</p>
          <p className="text-xs text-ink-mute">
            {kind === 'accuracy' ? '答够 20 道题、正确率达标就能入榜' : '今天学起来，几分钟就能上榜'}
          </p>
        </div>
      )}
    </div>
  );
}
