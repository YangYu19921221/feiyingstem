import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Crown, Flame, Medal, Radio, WifiOff } from 'lucide-react';
import type { PkLiveRankItem } from '../../api/pk';

interface Props {
  items: PkLiveRankItem[];
  meId: number;
  totalPlayers?: number;
  gains?: Record<string, number>;
  settleSeq?: number;
}

const STAGE_LABEL: Record<string, string> = {
  classify: '分类',
  dictation: '听写',
  exam: '过关',
  done: '已完成',
};

function rankTone(rank: number, isMe: boolean) {
  if (rank === 1) return 'bg-amber-100 text-amber-800';
  if (rank === 2) return 'bg-slate-200 text-slate-700';
  if (rank === 3) return 'bg-orange-100 text-orange-800';
  if (isMe) return 'bg-orange-50 text-accent-warm';
  return 'bg-slate-100 text-ink-soft';
}

export default function PkLiveRanking({ items, meId, totalPlayers, gains, settleSeq = 0 }: Props) {
  const reduceMotion = useReducedMotion();
  const resolvedTotal = Math.max(items.length, totalPlayers ?? items.length);
  const isTrimmed = resolvedTotal > items.length;

  return (
    <section className="card-soft overflow-hidden rounded-2xl" aria-labelledby="pk-live-ranking-title">
      <div className="flex items-center justify-between border-b border-black/[0.06] px-4 py-3.5">
        <div>
          <h2 id="pk-live-ranking-title" className="font-display text-base font-semibold text-ink">实时排名</h2>
          <p className="mt-0.5 text-xs text-ink-mute">
            {isTrimmed ? `共 ${resolvedTotal} 人，显示领先选手和我的排名` : `${resolvedTotal} 人参赛 · 按当前总分更新`}
          </p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
          <Radio className="h-3.5 w-3.5" aria-hidden="true" />
          实时
        </span>
      </div>

      <div className="divide-y divide-black/[0.05]">
        <AnimatePresence initial={false}>
          {items.map((item) => {
            const isMe = item.user_id === meId;
            const progress = Math.min(100, Math.max(0, Math.round((item.progress ?? 0) * 100)));
            const gain = gains?.[String(item.user_id)] ?? 0;
            const stageLabel = STAGE_LABEL[item.stage ?? 'classify'] ?? '分类';

            return (
              <motion.div
                key={item.user_id}
                layout
                initial={reduceMotion ? false : { opacity: 0, y: 5 }}
                animate={{ opacity: item.online ? 1 : 0.58, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0 }}
                transition={{ duration: reduceMotion ? 0 : 0.26, ease: [0.16, 1, 0.3, 1] }}
                className={`relative px-3 py-3 ${isMe ? 'bg-orange-50/70' : 'bg-white'}`}
                aria-label={`第 ${item.rank} 名，${item.nickname}，${item.points ?? 0} 分，完成 ${progress}%`}
              >
                <div className="flex items-center gap-3">
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${rankTone(item.rank, isMe)}`}>
                    {item.rank === 1
                      ? <Crown className="h-5 w-5" aria-label="第 1 名" />
                      : item.rank <= 3
                        ? <Medal className="h-5 w-5" aria-label={`第 ${item.rank} 名`} />
                        : <span className="font-numeric text-sm font-bold">#{item.rank}</span>}
                  </span>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-semibold text-ink">{item.nickname}</span>
                      {isMe && <span className="shrink-0 rounded bg-accent-warm px-1.5 py-0.5 text-[10px] font-semibold text-white">我</span>}
                      {!item.online && <WifiOff className="h-3.5 w-3.5 shrink-0 text-ink-mute" aria-label="暂时离线" />}
                      {item.streak >= 2 && item.online && (
                        <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-semibold text-accent-warm">
                          <Flame className="h-3 w-3" aria-hidden="true" />×{item.streak}
                        </span>
                      )}
                    </div>

                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-ink-mute">
                      <span>
                        {stageLabel}
                        {item.stage !== 'done' && (item.group_total ?? 0) > 1
                          ? ` · 第 ${(item.group_idx ?? 0) + 1}/${item.group_total} 组`
                          : ''}
                      </span>
                      <span className="font-numeric shrink-0">{progress}%</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <motion.div
                        className={`h-full w-full rounded-full ${item.finished ? 'bg-emerald-500' : 'bg-accent-warm'}`}
                        style={{ transformOrigin: 'left center' }}
                        initial={false}
                        animate={{ scaleX: progress / 100 }}
                        transition={{ duration: reduceMotion ? 0 : 0.38, ease: [0.16, 1, 0.3, 1] }}
                      />
                    </div>
                  </div>

                  <div className="relative w-16 shrink-0 text-right">
                    <p className="font-numeric text-lg font-semibold leading-none text-ink">{(item.points ?? 0).toLocaleString('zh-CN')}</p>
                    <p className="mt-1 text-[10px] text-ink-mute">总分</p>
                    <AnimatePresence>
                      {gain > 0 && (
                        <motion.span
                          key={`gain-${settleSeq}`}
                          initial={reduceMotion ? false : { opacity: 0, y: 4 }}
                          animate={reduceMotion ? { opacity: 1 } : { opacity: [0, 1, 1, 0], y: [4, -4, -8, -14] }}
                          exit={{ opacity: 0 }}
                          transition={{ duration: reduceMotion ? 0 : 1.2, times: [0, 0.15, 0.72, 1], ease: [0.16, 1, 0.3, 1] }}
                          className="pointer-events-none absolute -top-4 right-0 font-numeric text-sm font-semibold text-emerald-600"
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
        </AnimatePresence>
      </div>

      {items.length === 0 && (
        <p className="px-5 py-10 text-center text-sm text-ink-mute">比赛开始后，这里会显示实时排名。</p>
      )}
    </section>
  );
}
