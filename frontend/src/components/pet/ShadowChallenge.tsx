/**
 * 挑战同学的影子(2026-11-12)
 *
 * 真人对战要两个人同时在线,近 30 天只打了 8 场。影子 = 同学的宠物 + 他平时答题的水平,电脑替他打,
 * 不用他在线;他回来能看到「你的影子守住了 / 被打败了」。想让自己的影子厉害,就得平时答得又准又快。
 * 规则在后端 services/pet_shadow(只能挑战同班的、一个同学一天一次、吃一场对战场数、等级最多比我高 3 级)。
 *
 * 这里只列正向的东西: 同学的宠物、他的正确率、我的影子守住几次。不排名次。
 */
import { useState } from 'react';
import { motion } from 'framer-motion';
import { Ghost, Shield, Swords } from 'lucide-react';
import type { ShadowLog, ShadowOverview } from '../../api/petBattle';
import { getPetImage } from '../../config/petSpecies';

interface Props {
  data: ShadowOverview | undefined;
  /** 正在开哪一场(那个同学的 id) */
  starting: number | null;
  /** 今天没场数了 / 宠物受伤了: 按钮上不能点的原因 */
  blockReason: string | null;
  error?: string;
  onStart: (userId: number) => void;
  /** 点开「影子战报」: 取最近的战报(取的时候顺手标成看过) */
  loadLogs: () => Promise<ShadowLog[]>;
}

function when(iso: string): string {
  const t = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`);
  if (Number.isNaN(t.getTime())) return '';
  const days = Math.floor((Date.now() - t.getTime()) / 86400000);
  const hm = `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
  if (days <= 0 && new Date().getDate() === t.getDate()) return `今天 ${hm}`;
  if (days <= 1) return `昨天 ${hm}`;
  return `${t.getMonth() + 1} 月 ${t.getDate()} 日`;
}

export default function ShadowChallenge({ data, starting, blockReason, error, onStart, loadLogs }: Props) {
  const [logs, setLogs] = useState<ShadowLog[] | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logsBusy, setLogsBusy] = useState(false);
  const [seen, setSeen] = useState(false);
  const [showAll, setShowAll] = useState(false);

  if (!data?.enabled) return null;
  const items = data.items ?? [];
  const unseen = seen ? 0 : data.unseen ?? 0;
  const record = data.my_record;
  const shown = showAll ? items : items.slice(0, 6);
  const busy = starting !== null;

  const toggleLogs = async () => {
    if (logsOpen) {
      setLogsOpen(false);
      return;
    }
    setLogsOpen(true);
    if (logs || logsBusy) return;
    setLogsBusy(true);
    try {
      setLogs(await loadLogs());
      setSeen(true);
    } catch {
      setLogs([]);
    } finally {
      setLogsBusy(false);
    }
  };

  return (
    <section aria-labelledby="shadow-title" className="rounded-2xl border border-black/10 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e9e4ff] text-[#5b3fd1]">
            <Ghost className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h3 id="shadow-title" className="font-bold text-ink">挑战同学的影子</h3>
            <p className="text-xs text-ink-soft sm:text-sm">
              用同学的宠物和他平时答题的水平来打,不用他在线。一个同学一天一次。
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={toggleLogs}
          aria-expanded={logsOpen}
          className="relative inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-xl bg-[#f3f0ff] px-3 text-sm font-semibold text-[#4a32b3] transition hover:bg-[#e9e4ff]"
        >
          <Shield className="h-4 w-4" aria-hidden="true" />
          我的影子战报
          {unseen > 0 && (
            <span className="ml-1 rounded-full bg-[#FF6B35] px-1.5 text-[11px] font-bold leading-5 text-white" aria-label={`${unseen} 条没看过`}>
              {unseen}
            </span>
          )}
        </button>
      </div>

      {logsOpen && (
        <div className="mt-3 rounded-xl bg-[#f8f6ff] p-3">
          {record && (
            <p className="text-sm font-semibold text-ink">
              你的影子一共守住了 {record.defended} 次{record.lost ? `,被打败 ${record.lost} 次` : ''}。
              <span className="font-normal text-ink-soft"> 平时对战答得越准越快,影子越难打。</span>
            </p>
          )}
          {logsBusy && <p className="mt-2 text-sm text-ink-soft">正在取战报…</p>}
          {logs && !logs.length && <p className="mt-2 text-sm text-ink-soft">还没有同学来挑战你的影子。</p>}
          {logs && logs.length > 0 && (
            <ul className="mt-2 space-y-1.5">
              {logs.map((l, i) => (
                // 战报没有 id,同一个人同一时刻不会有两条
                <li key={`${l.at}-${l.challenger_name}-${i}`} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">
                    <span className="font-semibold">{l.challenger_name}</span> 来挑战,
                    {l.owner_won
                      ? <span className="font-semibold text-[#15803d]">你的影子守住了</span>
                      : <span className="font-semibold text-[#b45309]">影子被打败了</span>}
                  </span>
                  <span className="shrink-0 text-xs text-ink-soft">{when(l.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
      {blockReason && items.length > 0 && (
        <p className="mt-3 rounded-lg bg-[#fff4e5] px-3 py-2 text-sm text-[#7c4a03]">{blockReason}</p>
      )}

      {items.length === 0 ? (
        <p className="mt-3 rounded-xl bg-black/[0.03] px-3 py-4 text-center text-sm text-ink-soft">
          {data.reason || '班里还没有别的同学养宠物,等他们领了伙伴就能挑战了。'}
        </p>
      ) : (
        <>
          <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((s) => {
              const off = s.challenged_today || busy || !!blockReason;
              return (
                <li key={s.user_id} className="flex items-center gap-3 rounded-xl border border-black/10 px-3 py-2">
                  <motion.img
                    src={getPetImage(s.species, s.evolution_stage)}
                    alt=""
                    loading="lazy"
                    draggable={false}
                    className={`h-12 w-12 shrink-0 select-none object-contain ${s.challenged_today ? 'opacity-50 grayscale' : ''}`}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold text-ink">{s.name}的{s.pet_name}</span>
                    <span className="block text-xs text-ink-soft">Lv.{s.level} · 平时答对 {s.accuracy}%</span>
                  </span>
                  <button
                    type="button"
                    disabled={off}
                    onClick={() => onStart(s.user_id)}
                    aria-label={s.challenged_today ? `今天已经挑战过${s.name}的影子` : `挑战${s.name}的影子`}
                    className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl bg-[#5b3fd1] px-3 text-sm font-bold text-white transition hover:bg-[#4a32b3] disabled:cursor-not-allowed disabled:bg-black/10 disabled:text-black/40"
                  >
                    {starting === s.user_id ? '进场…' : s.challenged_today ? '明天再来' : (
                      <>
                        <Swords className="h-4 w-4" aria-hidden="true" />
                        挑战
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {items.length > 6 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="mt-2 min-h-11 w-full rounded-xl text-sm font-semibold text-[#4a32b3] transition hover:bg-[#f3f0ff]"
            >
              {showAll ? '收起' : `看全部 ${items.length} 位同学`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
