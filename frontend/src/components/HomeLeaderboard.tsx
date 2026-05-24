import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getLeaderboard,
  type LeaderboardKind,
  type LeaderboardPeriod,
  type LeaderboardScope,
  type LeaderboardResponse,
} from '../api/leaderboard';

const KIND_TABS: { id: LeaderboardKind; label: string; emoji: string; unit: string }[] = [
  { id: 'vocabulary', label: '词汇王', emoji: '📚', unit: '词' },
  { id: 'diligence', label: '勤奋王', emoji: '⏱️', unit: '分钟' },
  { id: 'accuracy', label: '精准王', emoji: '🎯', unit: '%' },
];

const SCOPE_TABS: { id: LeaderboardScope; label: string }[] = [
  { id: 'class', label: '我的班级' },
  { id: 'all', label: '全平台' },
];

const TIER_BG: Record<1 | 2 | 3, string> = {
  1: 'bg-gradient-to-br from-yellow-50 to-amber-100 border-yellow-200',
  2: 'bg-gradient-to-br from-slate-50 to-gray-100 border-gray-200',
  3: 'bg-gradient-to-br from-orange-50 to-amber-50 border-orange-200',
};
const TIER_BADGE: Record<1 | 2 | 3, string> = {
  1: 'text-yellow-600',
  2: 'text-gray-500',
  3: 'text-orange-500',
};
const TIER_MEDAL: Record<1 | 2 | 3, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };

const ENCOURAGE_LINES = [
  '继续加油，离上一名只差一点点',
  '每天 5 分钟，下周就能反超',
  '坚持比天赋重要，你已经在路上',
  '今天比昨天多记一个词，就是进步',
  '稳住节奏，名次会自己来',
];

function pickEncourage(rank: number): string {
  return ENCOURAGE_LINES[rank % ENCOURAGE_LINES.length];
}

const HomeLeaderboard = () => {
  const navigate = useNavigate();
  const [scope, setScope] = useState<LeaderboardScope>('class');
  const [kind, setKind] = useState<LeaderboardKind>('vocabulary');
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoFellBack, setAutoFellBack] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getLeaderboard(kind, 'this_week', scope)
      .then(d => {
        if (cancelled) return;
        // 班级模式但没班 / 班级人数 < 5 → 自动切到 all 并提示
        if (scope === 'class' && (d.class_name === null || d.total_participants < 5)) {
          setAutoFellBack(true);
          setScope('all');
          return;
        }
        setAutoFellBack(false);
        setData(d);
      })
      .catch(e => console.error('加载榜单失败:', e))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, scope]);

  const tabInfo = KIND_TABS.find(t => t.id === kind)!;
  const formatValue = (v: number) => kind === 'accuracy' ? `${v}%` : v.toLocaleString();

  const { topThree, middle, encourage } = useMemo(() => {
    if (!data) return { topThree: [], middle: [], encourage: [] };
    const top = data.top;
    const t3 = top.filter(e => e.rank <= 3);
    const total = data.total_participants;
    if (total < 8) {
      return { topThree: t3, middle: top.filter(e => e.rank >= 4), encourage: [] };
    }
    const encourageCount = Math.min(5, Math.max(3, Math.floor(total * 0.2)));
    const encourageStartRank = Math.max(4, total - encourageCount + 1);
    const middleRows = top.filter(e => e.rank >= 4 && e.rank < encourageStartRank);
    const encourageRows = top.filter(e => e.rank >= encourageStartRank);
    return { topThree: t3, middle: middleRows, encourage: encourageRows };
  }, [data]);

  return (
    <section className="mb-12">
      <header className="flex items-baseline justify-between mb-4">
        <h2 className="font-display text-xl font-semibold text-ink">
          {data?.scope === 'class' && data.class_name ? `${data.class_name} · 本周` : '光荣榜 · 本周'}
        </h2>
        <button
          onClick={() => navigate('/student/leaderboard')}
          className="text-sm text-ink-soft hover:text-accent-warm"
        >
          完整光荣榜 →
        </button>
      </header>

      <div className="card-soft rounded-2xl p-5 md:p-6">
        {/* 范围 + 榜种 tabs */}
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <div className="inline-flex card-soft rounded-full p-1 mr-2">
            {SCOPE_TABS.map(s => (
              <button
                key={s.id}
                onClick={() => setScope(s.id)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                  scope === s.id ? 'bg-accent-warm text-white' : 'text-ink-soft hover:text-ink'
                }`}
              >{s.label}</button>
            ))}
          </div>
          <div className="flex gap-1">
            {KIND_TABS.map(t => (
              <button
                key={t.id}
                onClick={() => setKind(t.id)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition ${
                  kind === t.id ? 'bg-ink text-white' : 'text-ink-soft hover:text-ink'
                }`}
              >{t.emoji} {t.label}</button>
            ))}
          </div>
        </div>

        {autoFellBack && (
          <p className="text-xs text-ink-mute mb-3">
            班级人数较少,已切到「全平台」榜
          </p>
        )}

        {loading ? (
          <div className="py-8 text-center text-ink-mute text-sm">加载中…</div>
        ) : !data || data.top.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-ink-soft text-sm mb-1">本周还没有人入榜</p>
            <p className="text-ink-mute text-xs">坚持几天就能上榜</p>
          </div>
        ) : (
          <>
            {/* Top3 紧凑 */}
            <div className="grid grid-cols-3 gap-2 md:gap-3 mb-4">
              {[1, 2, 3].map(rank => {
                const entry = topThree.find(e => e.rank === rank);
                if (!entry) return (
                  <div key={rank} className="rounded-xl border border-dashed border-black/10 p-3 text-center text-ink-mute text-xs">
                    虚位以待
                  </div>
                );
                return (
                  <div key={rank}
                       className={`rounded-xl border p-3 text-center ${TIER_BG[rank as 1|2|3]}`}>
                    <div className="text-2xl mb-1">{TIER_MEDAL[rank as 1|2|3]}</div>
                    <p className="font-medium text-ink text-sm truncate">{entry.full_name || entry.username}</p>
                    <p className={`font-numeric text-lg font-semibold ${TIER_BADGE[rank as 1|2|3]}`}>
                      {formatValue(entry.value)}
                      {kind !== 'accuracy' && <span className="text-xs ml-0.5 font-normal">{tabInfo.unit}</span>}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* 中段 4-N */}
            {middle.length > 0 && (
              <div className="rounded-xl bg-paper/60 divide-y divide-black/[0.04] mb-3">
                {middle.map(e => (
                  <div key={e.user_id}
                       className={`flex items-center gap-3 px-4 py-2 ${
                         e.user_id === data.my_rank ? 'bg-accent-warm/5' : ''
                       }`}>
                    <span className="font-numeric text-ink-mute text-xs w-6">{e.rank}</span>
                    <p className="flex-1 min-w-0 text-ink text-sm truncate">
                      {e.full_name || e.username}
                    </p>
                    <p className="font-numeric text-ink text-sm">
                      {formatValue(e.value)}
                      {kind !== 'accuracy' && <span className="text-xs text-ink-mute ml-1 font-normal">{tabInfo.unit}</span>}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* 末位鼓励 */}
            {encourage.length > 0 && (
              <div className="rounded-xl bg-gradient-to-r from-orange-50 to-amber-50 border border-orange-100 p-3">
                <p className="text-xs text-orange-700 font-medium mb-2">💪 加油榜 · 离上面只差一步</p>
                <div className="space-y-1.5">
                  {encourage.map(e => (
                    <div key={e.user_id}
                         className={`flex items-center gap-3 px-2 py-1 rounded-lg ${
                           data.my_rank === e.rank ? 'bg-white' : ''
                         }`}>
                      <span className="font-numeric text-orange-500 text-xs w-6">{e.rank}</span>
                      <p className="flex-1 min-w-0 text-ink text-sm truncate">
                        {e.full_name || e.username}
                      </p>
                      <p className="font-numeric text-ink text-sm">
                        {formatValue(e.value)}
                        {kind !== 'accuracy' && <span className="text-xs text-ink-mute ml-1 font-normal">{tabInfo.unit}</span>}
                      </p>
                      <span className="text-xs text-orange-600/70 hidden md:inline">{pickEncourage(e.rank)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 我的位置脚注 */}
            {data.my_rank && (
              <p className="text-xs text-ink-mute mt-3 text-center">
                你目前第 <span className="font-numeric text-ink font-semibold">{data.my_rank}</span> 名 · 共 {data.total_participants} 人
                {data.my_delta !== 0 && (
                  <> · 比上周 <span className={data.my_delta > 0 ? 'text-accent-warm' : 'text-ink-soft'}>
                    {data.my_delta > 0 ? '↑' : '↓'} {Math.abs(data.my_delta)}{kind === 'accuracy' ? '%' : tabInfo.unit}
                  </span></>
                )}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
};

export default HomeLeaderboard;
