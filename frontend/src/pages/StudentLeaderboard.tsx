import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import {
  getLeaderboard,
  type LeaderboardKind,
  type LeaderboardPeriod,
  type LeaderboardScope,
  type LeaderboardResponse,
} from '../api/leaderboard';
import { generateParentBindCode } from '../api/parent';
import { toast } from '../components/Toast';
import Podium from '../components/leaderboard/Podium';
import RankList from '../components/leaderboard/RankList';
import {
  KIND_TABS, PERIOD_TABS, RANK_TIER, TIER_THEME,
  formatValue, unitOf, encourage,
} from '../components/leaderboard/shared';
import BindCodeDialog from '../components/leaderboard/BindCodeDialog';

const EASE = [0.16, 1, 0.3, 1] as const;

const myUserId = (): number => {
  try { return JSON.parse(localStorage.getItem('user') || '{}').id ?? -1; }
  catch { return -1; }
};

const StudentLeaderboard = () => {
  const navigate = useNavigate();
  const [kind, setKind] = useState<LeaderboardKind>('vocabulary');
  const [period, setPeriod] = useState<LeaderboardPeriod>('this_week');
  const [scope, setScope] = useState<LeaderboardScope>('class');
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [bindCode, setBindCode] = useState<{ code: string; minutesLeft: number } | null>(null);
  const [genLoading, setGenLoading] = useState(false);
  const uid = myUserId();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getLeaderboard(kind, period, scope)
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => console.error('加载光荣榜失败:', e))
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [kind, period, scope]);

  const handleGenerateBindCode = async () => {
    setGenLoading(true);
    try {
      const res = await generateParentBindCode();
      setBindCode({ code: res.code, minutesLeft: res.minutes_left });
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '生成失败');
    } finally {
      setGenLoading(false);
    }
  };

  const tab = KIND_TABS.find(t => t.id === kind)!;
  const enc = data ? encourage(data) : null;
  const periodWord = period === 'this_month' ? '月' : '周';

  return (
    <div className="min-h-screen bg-paper page-warm-glow">
      <nav className="border-b border-black/[0.06] bg-paper/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-5 py-3.5 flex items-center justify-between">
          <button onClick={() => navigate(-1)}
            className="flex items-center gap-2 text-ink-soft hover:text-ink transition text-sm">
            <ArrowLeft className="w-4 h-4" />返回
          </button>
          <h1 className="font-display text-base font-semibold text-ink">🏆 光荣榜</h1>
          <div className="w-12" />
        </div>
      </nav>

      <div className="max-w-6xl mx-auto px-5 py-7 md:py-9">
        {/* Hero */}
        <section className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-ink-mute text-sm mb-1.5">向同学看齐，也跟自己比 {tab.emoji}</p>
            <h2 className="font-display text-3xl md:text-4xl font-semibold text-ink leading-[1.1] tracking-tight">
              {tab.label}争霸
            </h2>
            <p className="text-ink-soft text-sm mt-1.5">{tab.sub}</p>
          </div>
          {/* 范围切换：仅当学生在班级里才出现 */}
          {data?.has_class && (
            <div className="inline-flex card-soft rounded-full p-1">
              {([['class', data.class_name || '本班'], ['global', '全平台']] as const).map(([s, label]) => (
                <button key={s} onClick={() => setScope(s)}
                  className={`px-4 py-1.5 rounded-full text-xs font-semibold transition max-w-[8rem] truncate ${
                    scope === s ? 'bg-accent-warm text-white' : 'text-ink-soft hover:text-ink'}`}>
                  {label}
                </button>
              ))}
            </div>
          )}
        </section>

        {bindCode && (
          <BindCodeDialog code={bindCode.code} minutesLeft={bindCode.minutesLeft}
            onClose={() => setBindCode(null)} />
        )}

        {/* 榜种切换 */}
        <div className="grid grid-cols-3 gap-2 mb-5">
          {KIND_TABS.map(t => (
            <button key={t.id} onClick={() => setKind(t.id)}
              className={`py-3 rounded-xl text-sm font-semibold transition-all ${
                kind === t.id ? 'btn-glow text-white' : 'card-soft text-ink hover:text-accent-warm'}`}>
              <span className="text-lg mr-1.5">{t.emoji}</span>{t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="py-24 text-center text-ink-mute text-sm">加载中…</div>
        ) : !data ? (
          <div className="card-soft rounded-2xl p-12 text-center text-ink-soft">数据加载失败，稍后再试</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
            {/* 左：领奖台 + 名单 */}
            <div className="lg:col-span-7 space-y-6">
              <AnimatePresence mode="wait">
                <motion.div key={`${kind}-${period}-${scope}-podium`}
                  initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  transition={{ duration: 0.35, ease: EASE }}>
                  <Podium top={data.top ?? []} kind={kind} myUserId={uid} />
                </motion.div>
              </AnimatePresence>
              <RankList top={data.top ?? []} neighbors={data.neighbors ?? []} kind={kind}
                myUserId={uid} myRank={data.my_rank} />
            </div>

            {/* 右：周期 + 我的位置 + 邀请家长 */}
            <aside className="lg:col-span-5 space-y-5 lg:sticky lg:top-20 self-start">
              <div className="inline-flex card-soft rounded-full p-1">
                {PERIOD_TABS.map(p => (
                  <button key={p.id} onClick={() => setPeriod(p.id)}
                    className={`px-4 py-1.5 rounded-full text-xs font-medium transition ${
                      period === p.id ? 'bg-accent-warm text-white' : 'text-ink-soft hover:text-ink'}`}>
                    {p.label}
                  </button>
                ))}
              </div>

              {enc && (
                <MyPosition data={data} enc={enc} kind={kind} periodWord={periodWord} />
              )}

              <button onClick={handleGenerateBindCode} disabled={genLoading || !!bindCode}
                className="card-soft rounded-xl px-5 py-3.5 w-full text-left flex items-center justify-between hover:border-accent-warm/30 disabled:cursor-not-allowed">
                <div>
                  <p className="font-medium text-ink text-sm">让家长看到你的进步</p>
                  <p className="text-xs text-ink-soft mt-0.5">生成 6 位绑定码，5 分钟内告诉家长去注册</p>
                </div>
                <span className="text-accent-warm text-sm font-medium ml-3 shrink-0">
                  {genLoading ? '生成中…' : bindCode ? '已生成' : '生成 →'}
                </span>
              </button>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
};

// 「我的位置」：以成长和下一步目标为主，名次为辅，绝不打击靠后的孩子
function MyPosition({ data, enc, kind, periodWord }: {
  data: LeaderboardResponse;
  enc: { headline: string; hook: string | null; beat: number };
  kind: LeaderboardKind;
  periodWord: string;
}) {
  const onPodium = data.my_rank != null && data.my_rank <= 3;
  const tierText = onPodium ? TIER_THEME[RANK_TIER[data.my_rank!]].text : undefined;
  return (
    <div className="rounded-2xl p-5 bg-white relative overflow-hidden"
      style={{ border: '1px solid oklch(0.68 0.185 40 / 0.16)',
               boxShadow: '0 10px 30px -14px oklch(0.6 0.16 60 / 0.4)' }}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-16"
        style={{ background: 'radial-gradient(ellipse 60% 100% at 50% 0%, oklch(0.9 0.13 60 / 0.18), transparent 70%)' }} />
      <p className="text-ink-mute text-xs mb-3 relative">你本{periodWord}的战绩</p>
      <div className="flex items-baseline justify-between gap-4 relative">
        <div className="min-w-0">
          <p className="font-display text-3xl font-semibold text-ink font-numeric leading-none">
            {formatValue(kind, data.my_value)}
            {unitOf(kind) && <span className="text-base text-ink-soft ml-1 font-normal">{unitOf(kind)}</span>}
          </p>
          <p className="text-xs text-ink-soft mt-1.5">
            {kind === 'accuracy' ? '本期正确率' : `本期累计`}
          </p>
        </div>
        <div className="text-right shrink-0">
          {data.my_rank ? (
            <p className="font-display text-2xl font-semibold font-numeric"
               style={tierText ? { color: tierText } : { color: 'oklch(0.62 0.19 40)' }}>
              {onPodium ? TIER_THEME[RANK_TIER[data.my_rank]].label : `第 ${data.my_rank} 名`}
            </p>
          ) : (
            <p className="font-display text-sm font-medium text-ink-mute">尚未上榜</p>
          )}
          {period_delta(data)}
        </div>
      </div>

      {/* 鼓励钩子 */}
      <div className="mt-4 pt-4 border-t border-black/[0.05] relative">
        <p className="text-sm font-semibold text-ink">{enc.headline}</p>
        {enc.hook && <p className="text-xs text-accent-warm mt-1 font-medium">🎯 {enc.hook}</p>}
        {data.total_participants > 0 && (
          <p className="text-[11px] text-ink-mute mt-2">
            {data.scope === 'class' ? '本班' : '全平台'}共 {data.total_participants} 名同学参与
          </p>
        )}
      </div>
    </div>
  );
}

function period_delta(data: LeaderboardResponse) {
  if (data.period !== 'this_week' || data.my_value <= 0 || data.my_delta === 0) return null;
  const up = data.my_delta > 0;
  return (
    <p className={`text-xs mt-1 font-numeric font-semibold ${up ? 'text-accent-warm' : 'text-ink-soft'}`}>
      比上周 {up ? '↑' : '↓'} {Math.abs(data.my_delta)}{data.kind === 'accuracy' ? ' 点' : ''}
    </p>
  );
}

export default StudentLeaderboard;
