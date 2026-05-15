import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import {
  getLeaderboard,
  type LeaderboardKind,
  type LeaderboardPeriod,
  type LeaderboardResponse,
} from '../api/leaderboard';

const KIND_TABS: { id: LeaderboardKind; label: string; unit: string; emoji: string }[] = [
  { id: 'vocabulary', label: '词汇王', unit: '词', emoji: '📚' },
  { id: 'diligence',  label: '勤奋王', unit: '分钟', emoji: '🔥' },
  { id: 'accuracy',   label: '精准王', unit: '%', emoji: '🎯' },
];

const PERIOD_TABS: { id: LeaderboardPeriod; label: string }[] = [
  { id: 'this_week',  label: '本周' },
  { id: 'last_week',  label: '上周' },
  { id: 'this_month', label: '本月' },
];

const RANK_DECOR: Record<number, { medal: string; ring: string; text: string }> = {
  1: { medal: '🥇', ring: 'ring-2 ring-amber-400', text: 'text-amber-600' },
  2: { medal: '🥈', ring: 'ring-1 ring-zinc-300',  text: 'text-zinc-500' },
  3: { medal: '🥉', ring: 'ring-1 ring-orange-300', text: 'text-orange-500' },
};

const StudentLeaderboard = () => {
  const navigate = useNavigate();
  const [kind, setKind] = useState<LeaderboardKind>('vocabulary');
  const [period, setPeriod] = useState<LeaderboardPeriod>('this_week');
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getLeaderboard(kind, period)
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => console.error('加载光荣榜失败:', e))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, period]);

  const tabInfo = KIND_TABS.find(t => t.id === kind)!;

  const formatValue = (v: number) => {
    if (kind === 'accuracy') return `${v}%`;
    return v.toLocaleString();
  };

  const formatDelta = (delta: number) => {
    if (delta === 0) return '持平';
    const sign = delta > 0 ? '↑' : '↓';
    const abs = Math.abs(delta);
    if (kind === 'accuracy') return `${sign} ${abs} 个百分点`;
    return `${sign} ${abs}${tabInfo.unit}`;
  };

  return (
    <div className="min-h-screen bg-paper page-warm-glow">
      {/* 顶部导航 */}
      <nav className="border-b border-black/[0.06] bg-paper/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-5 py-3.5 flex items-center justify-between">
          <button
            onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-ink-soft hover:text-ink transition text-sm"
          >
            <ArrowLeft className="w-4 h-4" />
            返回
          </button>
          <h1 className="font-display text-base font-semibold text-ink">光荣榜</h1>
          <div className="w-12" />
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-5 py-10">
        {/* Hero */}
        <section className="mb-8">
          <p className="text-ink-mute text-sm mb-2">向同学看齐 · 也跟自己比</p>
          <h2 className="font-display text-3xl md:text-4xl font-semibold text-ink leading-[1.1] tracking-tight">
            光荣榜
          </h2>
        </section>

        {/* Tab：榜种切换 */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          {KIND_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setKind(t.id)}
              className={`py-3 rounded-xl text-sm font-semibold transition-all ${
                kind === t.id
                  ? 'btn-glow text-white'
                  : 'card-soft text-ink hover:text-accent-warm'
              }`}
            >
              <span className="text-lg mr-1.5">{t.emoji}</span>
              {t.label}
            </button>
          ))}
        </div>

        {/* 周期切换 */}
        <div className="inline-flex card-soft rounded-full p-1 mb-8">
          {PERIOD_TABS.map(p => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`px-4 py-1.5 rounded-full text-xs font-medium transition ${
                period === p.id
                  ? 'bg-accent-warm text-white'
                  : 'text-ink-soft hover:text-ink'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* 榜单内容 */}
        {loading ? (
          <div className="py-16 text-center text-ink-mute text-sm">加载中…</div>
        ) : !data || data.top.length === 0 ? (
          <div className="card-soft rounded-2xl p-12 text-center">
            <p className="text-ink-soft mb-1">暂时还没有上榜记录</p>
            <p className="text-xs text-ink-mute">
              {kind === 'accuracy'
                ? '至少答 20 道题，正确率达标即可入榜'
                : '继续努力，下次榜上有名'}
            </p>
          </div>
        ) : (
          <>
            {/* 前三名特殊展示 */}
            <AnimatePresence mode="wait">
              <motion.div
                key={`${kind}-${period}-top`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                {/* 第 1 名巨型卡 */}
                {data.top[0] && (
                  <div className="card-soft rounded-3xl p-6 mb-3 relative overflow-hidden">
                    <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full opacity-20"
                      style={{ background: 'radial-gradient(circle, oklch(0.85 0.18 60), transparent 70%)' }} />
                    <div className="relative flex items-center gap-4">
                      <div className="text-5xl">🥇</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-ink-mute text-xs mb-0.5">本{period === 'this_month' ? '月' : '周'}{tabInfo.label}</p>
                        <p className="font-display text-xl font-semibold text-ink truncate">
                          {data.top[0].full_name || data.top[0].username}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-display text-3xl font-semibold text-accent-warm font-numeric text-glow-warm leading-none">
                          {formatValue(data.top[0].value)}
                        </p>
                        <p className="text-xs text-ink-mute mt-1">
                          {kind === 'accuracy' ? '正确率' : tabInfo.unit}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* 第 2-10 名列表 */}
                {data.top.slice(1).length > 0 && (
                  <div className="card-soft rounded-2xl divide-y divide-black/[0.05] mb-6">
                    {data.top.slice(1).map(entry => {
                      const decor = RANK_DECOR[entry.rank];
                      return (
                        <div
                          key={entry.user_id}
                          className="flex items-center gap-3 px-5 py-3.5"
                        >
                          <div className={`w-9 h-9 rounded-full flex items-center justify-center font-numeric font-semibold text-sm shrink-0 ${
                            decor ? `bg-white ${decor.ring} ${decor.text}` : 'bg-black/[0.04] text-ink-soft'
                          }`}>
                            {decor ? decor.medal : entry.rank}
                          </div>
                          <p className="flex-1 min-w-0 font-medium text-ink truncate">
                            {entry.full_name || entry.username}
                          </p>
                          <p className="font-numeric font-semibold text-ink">
                            {formatValue(entry.value)}
                            <span className="text-xs text-ink-mute ml-1 font-normal">
                              {kind === 'accuracy' ? '' : tabInfo.unit}
                            </span>
                          </p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </motion.div>
            </AnimatePresence>

            {/* 我的位置（不显示完整名次，只显示是否上榜 + 周环比） */}
            <div className="card-soft rounded-2xl p-5">
              <p className="text-ink-mute text-xs mb-2">你本{period === 'this_month' ? '月' : '周'}的成绩</p>
              <div className="flex items-baseline justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-display text-3xl font-semibold text-ink font-numeric leading-none">
                    {formatValue(data.my_value)}
                  </p>
                  <p className="text-xs text-ink-soft mt-1">
                    {kind === 'accuracy'
                      ? '本期正确率'
                      : `本期累计 ${tabInfo.unit}`}
                  </p>
                </div>
                <div className="text-right">
                  {data.my_rank && data.my_rank <= 10 ? (
                    <p className="font-display text-2xl font-semibold text-accent-warm font-numeric">
                      第 {data.my_rank} 名
                    </p>
                  ) : data.my_rank ? (
                    <p className="font-display text-base font-medium text-ink-soft">
                      继续加油上榜
                    </p>
                  ) : (
                    <p className="font-display text-base font-medium text-ink-mute">
                      {kind === 'accuracy' ? '答够 20 题就能入榜' : '本期还没参与'}
                    </p>
                  )}
                  {period === 'this_week' && data.my_value > 0 && (
                    <p className={`text-xs mt-1 font-numeric ${
                      data.my_delta > 0 ? 'text-accent-warm font-semibold'
                      : data.my_delta < 0 ? 'text-ink-soft'
                      : 'text-ink-mute'
                    }`}>
                      比上周 {formatDelta(data.my_delta)}
                    </p>
                  )}
                </div>
              </div>
              {data.total_participants > 0 && (
                <p className="text-[11px] text-ink-mute mt-3 pt-3 border-t border-black/[0.04]">
                  共 {data.total_participants} 名同学参与
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default StudentLeaderboard;
