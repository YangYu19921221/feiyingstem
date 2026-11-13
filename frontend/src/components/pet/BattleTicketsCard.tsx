/**
 * 今天还能打几场对战(2026-11-11)。规则真源 backend/app/services/battle_tickets.py ——
 * 这里的每一句说明、每一项「怎么再拿」都是接口给的,不在前端另写一份。
 *
 * 对战大厅放完整版,宠物页放 compact 版(一行 + 点开看怎么再拿)。
 * 平台关了这条规则(enabled=false)时整块不显示: 不限场数就没什么可说的。
 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronRight, Swords } from 'lucide-react';
import type { BattleTickets } from '../../api/petBattle';

function Pips({ t }: { t: BattleTickets }) {
  const cap = t.cap ?? 0;
  const used = t.used ?? 0;
  const earned = t.earned ?? 0;
  return (
    <div className="flex flex-wrap gap-1.5" aria-hidden="true">
      {Array.from({ length: cap }).map((_, i) => {
        const state = i < used ? 'used' : i < earned ? 'ready' : 'locked';
        return (
          <span
            key={i}
            className={`h-2.5 w-6 rounded-full sm:w-8 ${
              state === 'ready' ? 'bg-[#FF6B35]' : state === 'used' ? 'bg-[#f3c9b3]' : 'border border-dashed border-[#d9c2b2] bg-transparent'
            }`}
          />
        );
      })}
    </div>
  );
}

export default function BattleTicketsCard({
  tickets,
  compact = false,
}: {
  tickets: BattleTickets | undefined;
  compact?: boolean;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(!compact);
  if (!tickets || !tickets.enabled) return null;

  const left = tickets.left ?? 0;
  const cap = tickets.cap ?? 0;
  const used = tickets.used ?? 0;
  const earned = tickets.earned ?? 0;
  const headline = left > 0 ? `今天还能打 ${left} 场` : tickets.capped ? '今天的场数打完了' : '今天的场数用完了';
  const sub = tickets.capped && left === 0
    ? `一天最多 ${cap} 场,明天再来`
    : left > 0
      ? `已经打了 ${used} 场 · 一天最多 ${cap} 场`
      : '做下面任意一项就能再打';

  return (
    <section
      className="rounded-2xl border border-[#f0d9c8] bg-[#fffaf5] p-4 sm:p-5"
      aria-label={`对战场数: ${headline},今天挣到 ${earned} 场,已经打了 ${used} 场,一天最多 ${cap} 场`}
    >
      <div className="flex items-center gap-3">
        <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${left > 0 ? 'bg-[#FF6B35] text-white' : 'bg-[#f1e4d8] text-[#9a6b4f]'}`}>
          <Swords className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-[#3b2417] sm:text-lg">{headline}</p>
          <p className="mt-0.5 text-xs text-[#8a6652] sm:text-sm">{sub}</p>
        </div>
        {compact && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl px-2.5 text-sm font-semibold text-[#bd5227] hover:bg-[#fdebdd]"
          >
            {open ? '收起' : '怎么再拿'}
            <ChevronDown className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="mt-3">
        <Pips t={tickets} />
      </div>

      {open && (
        <>
          <ul className="mt-4 divide-y divide-[#f3e3d6] rounded-xl border border-[#f3e3d6] bg-white">
            {tickets.sources.map((s) => {
              const body = (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-[#3b2417]">{s.label}</span>
                    <span className="mt-0.5 block text-xs text-[#8a6652]">{s.detail}</span>
                  </span>
                  <span className={`shrink-0 text-sm font-bold tabular-nums ${s.got > 0 ? 'text-[#2f8a57]' : 'text-[#b9a394]'}`}>
                    {s.got > 0 ? `已拿 ${s.got} 场` : '还没拿'}
                  </span>
                  {s.route && <ChevronRight className="h-4 w-4 shrink-0 text-[#bd5227]" aria-hidden="true" />}
                </>
              );
              return (
                <li key={s.key}>
                  {s.route ? (
                    <button
                      type="button"
                      onClick={() => navigate(s.route!)}
                      className="flex min-h-14 w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-[#fff6ee]"
                    >
                      {body}
                    </button>
                  ) : (
                    <div className="flex min-h-14 items-center gap-3 px-3.5 py-2.5">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
          <ul className="mt-3 space-y-1 text-xs leading-5 text-[#8a6652]">
            {tickets.lines.map((line) => <li key={line}>· {line}</li>)}
          </ul>
        </>
      )}
    </section>
  );
}
