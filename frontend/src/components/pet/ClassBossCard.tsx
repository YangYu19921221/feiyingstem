/**
 * 全班打大怪(2026-11-12)
 *
 * 一个班一周一只大怪。**伤害只来自把该做的做完**: 做完老师布置的任务、做完今日复习、学新词 ——
 * 打对战不加伤害(对战已经有场数管着,再给它加伤害就成了刷的入口)。每人每天有上限,
 * 一个孩子刷不满全班的,大家都来大怪才打得死。打死了,这一周出过力的人都能领奖励。
 * 规则和数字都在后端 services/class_boss,这里每一行字都是接口给的。
 *
 * 只列正向的: 全班打了多少、我打了多少、出力最多的几个人。不列谁没出力。
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Check, ChevronRight, Gift, Users } from 'lucide-react';
import type { ClassBoss } from '../../api/petBattle';
import { getPetImage } from '../../config/petSpecies';

interface Props {
  data: ClassBoss | undefined;
  /** 领奖励: 这一周的 / 上一周的。返回领到了什么;失败抛错(外面把原因显示出来) */
  onClaim: (week: 'this' | 'last') => Promise<{ food: number; xp: number; leveled_up?: boolean }>;
  error?: string;
}

/** 「11 月 10 日 – 16 日」 */
function weekText(start?: string, end?: string): string {
  if (!start || !end) return '';
  const a = start.slice(5).split('-').map(Number);
  const b = end.slice(5).split('-').map(Number);
  if (a.length < 2 || b.length < 2 || a.some(Number.isNaN) || b.some(Number.isNaN)) return '';
  return a[0] === b[0] ? `${a[0]} 月 ${a[1]} 日 – ${b[1]} 日` : `${a[0]} 月 ${a[1]} 日 – ${b[0]} 月 ${b[1]} 日`;
}

export default function ClassBossCard({ data, onClaim, error }: Props) {
  const navigate = useNavigate();
  const [claiming, setClaiming] = useState<'this' | 'last' | null>(null);
  const [got, setGot] = useState<{ food: number; xp: number; leveled_up?: boolean } | null>(null);

  if (!data?.enabled || !data.has_class || !data.boss) return null;
  const max = Math.max(1, data.hp_max ?? 1);
  const left = Math.max(0, Math.min(max, data.hp_left ?? max));
  const ratio = left / max;
  const dealt = max - left;
  const mine = data.mine;
  const reward = data.reward;
  const defeated = !!data.defeated;

  const claim = async (week: 'this' | 'last') => {
    if (claiming) return;
    setClaiming(week);
    try {
      setGot(await onClaim(week));
    } catch {
      /* 原因由外面的 error 显示 */
    } finally {
      setClaiming(null);
    }
  };

  return (
    <section aria-labelledby="class-boss-title" className="overflow-hidden rounded-2xl border border-black/10 bg-white">
      <div className={`relative flex items-center gap-3 p-4 text-white sm:gap-5 sm:p-5 ${defeated ? 'bg-[#2f6b3a]' : 'bg-[#3b2a55]'}`}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold text-white/80 sm:text-sm">
            <span id="class-boss-title" className="font-display text-base font-black text-white sm:text-lg">全班打大怪</span>
            {data.class_name && <span className="max-w-[12rem] truncate">{data.class_name}</span>}
            <span>{weekText(data.week_start, data.week_end)}</span>
          </div>
          <h3 className="mt-1.5 font-display text-xl font-black leading-tight sm:text-2xl">
            {defeated ? `${data.boss.name} 被全班打败了!` : data.boss.name}
          </h3>
          {/* 血条 */}
          <div
            className="mt-2 h-3.5 overflow-hidden rounded-full bg-white/20"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={max}
            aria-valuenow={left}
            aria-label={`大怪还剩 ${left} 点血,一共 ${max} 点`}
          >
            <motion.div
              className={`h-full rounded-full ${defeated ? 'bg-[#9be7a8]' : ratio > 0.5 ? 'bg-[#ff7a59]' : ratio > 0.2 ? 'bg-[#FFD23F]' : 'bg-[#9be7a8]'}`}
              initial={false}
              animate={{ width: `${ratio * 100}%` }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 text-xs text-white/85 sm:text-sm">
            <span className="font-numeric tabular-nums">{defeated ? `全班一共打了 ${dealt} 点` : `还剩 ${left} / ${max}`}</span>
            <span className="inline-flex items-center gap-1">
              <Users className="h-3.5 w-3.5" aria-hidden="true" />
              {data.joined ?? 0} / {data.students ?? 0} 人出过力
            </span>
          </div>
        </div>
        <motion.img
          src={getPetImage(data.boss.species, data.boss.evolution_stage)}
          alt=""
          draggable={false}
          className={`w-20 shrink-0 select-none drop-shadow-[0_8px_10px_rgba(0,0,0,0.45)] sm:w-28 ${defeated ? 'rotate-[70deg] opacity-70 grayscale-[40%]' : ''}`}
          animate={defeated ? undefined : { y: [0, -5, 0] }}
          transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <div className="space-y-3 p-4 sm:p-5">
        {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}

        {/* 奖励 */}
        {got ? (
          <p className="rounded-xl bg-[#ecfdf0] px-3 py-2 text-sm font-bold text-[#15803d]">
            领到了: 粮食 +{got.food}、经验 +{got.xp}{got.leveled_up ? ',宠物升级了!' : ''}
          </p>
        ) : (
          <>
            {data.last_week?.can_claim && (
              <button
                type="button"
                onClick={() => claim('last')}
                disabled={!!claiming}
                className="btn-glow flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-base font-bold text-white disabled:opacity-60"
              >
                <Gift className="h-5 w-5" aria-hidden="true" />
                {claiming === 'last' ? '正在领…' : '上周的大怪打败了,领奖励'}
              </button>
            )}
            {defeated && reward?.can_claim && (
              <button
                type="button"
                onClick={() => claim('this')}
                disabled={!!claiming}
                className="btn-glow flex min-h-12 w-full items-center justify-center gap-2 rounded-xl px-4 text-base font-bold text-white disabled:opacity-60"
              >
                <Gift className="h-5 w-5" aria-hidden="true" />
                {claiming === 'this' ? '正在领…' : `领奖励: 粮食 +${reward.food}、经验 +${reward.xp}`}
              </button>
            )}
            {defeated && reward?.claimed && (
              <p className="inline-flex items-center gap-1 text-sm font-semibold text-[#15803d]">
                <Check className="h-4 w-4" aria-hidden="true" />这一周的奖励已经领了,下周一换新的大怪
              </p>
            )}
            {!defeated && reward && (
              <p className="text-sm text-ink-soft">
                打败它,这一周出过力的人都能领: 粮食 +{reward.food}、经验 +{reward.xp}。
              </p>
            )}
          </>
        )}

        {/* 我今天打了多少、还能怎么打 */}
        {mine && (
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="text-sm font-bold text-ink">我这周打了 {mine.total} 点</h4>
              <span className="text-xs text-ink-soft">今天 {mine.today} / {mine.today_cap}</span>
            </div>
            <ul className="mt-1.5 divide-y divide-black/10 overflow-hidden rounded-xl border border-black/10">
              {mine.items.map((it) => {
                const go = it.route && it.how ? () => navigate(it.route as string) : undefined;
                const body = (
                  <>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ink">{it.label}</span>
                      {it.how && <span className="block text-xs text-ink-soft">{it.how}</span>}
                    </span>
                    <span className={`shrink-0 text-sm font-bold tabular-nums ${it.points > 0 ? 'text-[#15803d]' : 'text-ink-soft'}`}>
                      {it.points > 0 ? `+${it.points}` : '0'}
                    </span>
                    {go && <ChevronRight className="h-4 w-4 shrink-0 text-accent-warm" aria-hidden="true" />}
                  </>
                );
                return (
                  <li key={it.key}>
                    {go ? (
                      <button type="button" onClick={go} className="flex min-h-12 w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-black/[0.03]">
                        {body}
                      </button>
                    ) : (
                      <div className="flex min-h-12 items-center gap-2 px-3 py-2">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
            <p className="mt-1.5 text-xs text-ink-soft">打对战不算伤害。把老师布置的做完、把今天的复习做完、学新词,才打得到它。</p>
          </div>
        )}

        {/* 出力最多的几个人(只有正向的) */}
        {!!data.top?.length && (
          <p className="text-sm text-ink-soft">
            这周出力最多:{' '}
            {data.top.map((t, i) => (
              <span key={`${t.name}-${t.points}`} className="font-semibold text-ink">
                {i > 0 ? '、' : ''}{t.name}({t.points})
              </span>
            ))}
          </p>
        )}
      </div>
    </section>
  );
}
