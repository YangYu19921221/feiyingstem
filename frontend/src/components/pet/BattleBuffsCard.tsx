/**
 * 今天的学习增益(2026-11-12): 今天把该做的做了,对战里就更强。
 * 规则在后端(GET /student/battles/buffs): 作业做完攻击 +10%、今日复习做完开局带一格大招、学满 30 个词血量 +10%。
 * 这里每一行的字都是接口给的,不在前端另写一份。平台关了(enabled=false)或老后端没有这个接口时整块不显示。
 *
 * 和「今天还能打几场」那张卡是一对: 做作业以前只换来场数,现在还换来变强。
 */
import { useNavigate } from 'react-router-dom';
import { Check, ChevronRight, Sparkles } from 'lucide-react';
import type { BattleBuffPreview } from '../../api/petBattle';

export default function BattleBuffsCard({ data }: { data: BattleBuffPreview | undefined }) {
  const navigate = useNavigate();
  if (!data?.enabled || !data.items.length) return null;
  const got = data.items.filter((b) => b.got).length;
  return (
    <section aria-labelledby="battle-buffs-title" className="rounded-2xl border border-[#f1e2c4] bg-[#fffaf0] p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#FFD23F] text-[#6b4a00]">
          <Sparkles className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <h3 id="battle-buffs-title" className="font-bold text-ink">今天的学习增益</h3>
          <p className="text-xs text-ink-soft sm:text-sm">
            {got ? `已经拿到 ${got} 项,开打就带着` : '今天把该做的做了,对战里宠物会更强'}
          </p>
        </div>
      </div>
      <ul className="mt-3 divide-y divide-[#f1e2c4] overflow-hidden rounded-xl border border-[#f1e2c4] bg-white">
        {data.items.map((b) => {
          const go = !b.got && b.route ? () => navigate(b.route as string) : undefined;
          const body = (
            <>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-ink">{b.label} · {b.detail}</span>
                {!b.got && b.how && <span className="block text-xs text-ink-soft">{b.how}</span>}
              </span>
              {b.got ? (
                <span className="inline-flex shrink-0 items-center gap-1 text-sm font-bold text-[#15803d]">
                  <Check className="h-4 w-4" aria-hidden="true" />已生效
                </span>
              ) : (
                <span className="inline-flex shrink-0 items-center gap-1 text-sm text-ink-soft">
                  还没拿{go && <ChevronRight className="h-4 w-4 text-accent-warm" aria-hidden="true" />}
                </span>
              )}
            </>
          );
          return (
            <li key={b.key}>
              {go ? (
                <button type="button" onClick={go} className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-[#fff6e0]">
                  {body}
                </button>
              ) : (
                <div className="flex min-h-12 items-center gap-3 px-3 py-2">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
