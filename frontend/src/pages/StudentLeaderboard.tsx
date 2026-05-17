import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft } from 'lucide-react';
import {
  getLeaderboard,
  type LeaderboardKind,
  type LeaderboardPeriod,
  type LeaderboardResponse,
  type LeaderboardEntry,
} from '../api/leaderboard';
import { generateParentBindCode } from '../api/parent';
import { toast } from '../components/Toast';

const KIND_TABS: { id: LeaderboardKind; label: string; unit: string; emoji: string; sub: string }[] = [
  { id: 'vocabulary', label: '词汇王', unit: '词',    emoji: '📚', sub: '本期累计学了多少词' },
  { id: 'diligence',  label: '勤奋王', unit: '分钟',  emoji: '🔥', sub: '本期累计学习时长' },
  { id: 'accuracy',   label: '精准王', unit: '%',     emoji: '🎯', sub: '本期答题正确率（≥20 题）' },
];

const PERIOD_TABS: { id: LeaderboardPeriod; label: string }[] = [
  { id: 'this_week',  label: '本周' },
  { id: 'last_week',  label: '上周' },
  { id: 'this_month', label: '本月' },
];

type Tier = 'gold' | 'silver' | 'bronze';

// 金 / 银 / 铜 视觉系统 — OKLCH 暖色系，仍兼容温暖米白底
const TIER_THEME: Record<Tier, {
  label: string;
  frame: string;     // 外框边色
  glow: string;      // 角色卡身后的光晕色
  ribbon: string;    // 顶部装饰条
  text: string;      // 段位文字色
  badge: string;     // 数值徽章背景
  badgeText: string;
}> = {
  gold: {
    label: '冠 军',
    frame:     'oklch(0.78 0.15 80)',
    glow:      'oklch(0.85 0.18 75 / 0.45)',
    ribbon:    'linear-gradient(135deg, oklch(0.88 0.16 78), oklch(0.72 0.17 60))',
    text:      'oklch(0.55 0.16 65)',
    badge:     'oklch(0.93 0.07 80)',
    badgeText: 'oklch(0.45 0.16 60)',
  },
  silver: {
    label: '亚 军',
    frame:     'oklch(0.80 0.02 250)',
    glow:      'oklch(0.85 0.03 250 / 0.4)',
    ribbon:    'linear-gradient(135deg, oklch(0.90 0.02 240), oklch(0.72 0.03 240))',
    text:      'oklch(0.50 0.03 240)',
    badge:     'oklch(0.94 0.01 240)',
    badgeText: 'oklch(0.45 0.04 240)',
  },
  bronze: {
    label: '季 军',
    frame:     'oklch(0.65 0.13 45)',
    glow:      'oklch(0.75 0.14 40 / 0.4)',
    ribbon:    'linear-gradient(135deg, oklch(0.74 0.14 45), oklch(0.55 0.14 35))',
    text:      'oklch(0.45 0.13 35)',
    badge:     'oklch(0.92 0.06 45)',
    badgeText: 'oklch(0.42 0.13 35)',
  },
};

const RANK_TIER: Record<number, Tier> = { 1: 'gold', 2: 'silver', 3: 'bronze' };

const StudentLeaderboard = () => {
  const navigate = useNavigate();
  const [kind, setKind] = useState<LeaderboardKind>('vocabulary');
  const [period, setPeriod] = useState<LeaderboardPeriod>('this_week');
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [bindCode, setBindCode] = useState<{ code: string; minutesLeft: number } | null>(null);
  const [genLoading, setGenLoading] = useState(false);

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

  const formatValue = (v: number) => kind === 'accuracy' ? `${v}%` : v.toLocaleString();
  const formatDelta = (delta: number) => {
    if (delta === 0) return '持平';
    const sign = delta > 0 ? '↑' : '↓';
    const abs = Math.abs(delta);
    if (kind === 'accuracy') return `${sign} ${abs} 个百分点`;
    return `${sign} ${abs}${tabInfo.unit}`;
  };

  const champCard = (entry: LeaderboardEntry | undefined, tier: Tier, size: 'lg' | 'md') => {
    if (!entry) return (
      <EmptyCard tier={tier} size={size} />
    );
    return (
      <ChampionCard
        entry={entry}
        tier={tier}
        size={size}
        kind={kind}
        valueText={formatValue(entry.value)}
        unit={kind === 'accuracy' ? '' : tabInfo.unit}
      />
    );
  };

  return (
    <div className="min-h-screen bg-paper page-warm-glow">
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

      <div className="max-w-3xl mx-auto px-5 py-8 md:py-10">
        {/* Hero 标题 */}
        <section className="mb-6">
          <p className="text-ink-mute text-sm mb-1.5">向同学看齐 · 也跟自己比</p>
          <h2 className="font-display text-3xl md:text-4xl font-semibold text-ink leading-[1.1] tracking-tight">
            {tabInfo.label}争霸
          </h2>
          <p className="text-ink-soft text-sm mt-1.5">{tabInfo.sub}</p>
        </section>

        {/* 邀请家长 */}
        <button
          onClick={handleGenerateBindCode}
          disabled={genLoading || !!bindCode}
          className="card-soft rounded-xl px-5 py-3.5 w-full text-left mb-6 flex items-center justify-between hover:border-accent-warm/30 disabled:cursor-not-allowed"
        >
          <div>
            <p className="font-medium text-ink text-sm">让家长看到你的进步</p>
            <p className="text-xs text-ink-soft mt-0.5">生成 6 位绑定码，5 分钟内告诉家长去注册</p>
          </div>
          <span className="text-accent-warm text-sm font-medium">
            {genLoading ? '生成中…' : bindCode ? '已生成' : '生成绑定码 →'}
          </span>
        </button>

        {bindCode && (
          <BindCodeDialog
            code={bindCode.code}
            minutesLeft={bindCode.minutesLeft}
            onClose={() => setBindCode(null)}
          />
        )}

        {/* 榜种切换 */}
        <div className="grid grid-cols-3 gap-2 mb-3">
          {KIND_TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setKind(t.id)}
              className={`py-3 rounded-xl text-sm font-semibold transition-all ${
                kind === t.id ? 'btn-glow text-white' : 'card-soft text-ink hover:text-accent-warm'
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
                period === p.id ? 'bg-accent-warm text-white' : 'text-ink-soft hover:text-ink'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="py-20 text-center text-ink-mute text-sm">加载中…</div>
        ) : !data ? (
          <div className="card-soft rounded-2xl p-12 text-center text-ink-soft">数据加载失败</div>
        ) : (
          <>
            {/* 冠 / 亚 / 季：1 大 + 2 小 平铺，不堆叠 */}
            <AnimatePresence mode="wait">
              <motion.div
                key={`${kind}-${period}-top3`}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              >
                {/* 冠军大卡 */}
                <div className="mb-3">
                  {champCard(data.top.find(e => e.rank === 1), 'gold', 'lg')}
                </div>
                {/* 亚 + 季并列 */}
                <div className="grid grid-cols-2 gap-3 mb-8">
                  {champCard(data.top.find(e => e.rank === 2), 'silver', 'md')}
                  {champCard(data.top.find(e => e.rank === 3), 'bronze', 'md')}
                </div>
              </motion.div>
            </AnimatePresence>

            {/* 4 - 10 名简洁列表 */}
            {data.top.filter(e => e.rank >= 4).length > 0 && (
              <div className="card-soft rounded-2xl divide-y divide-black/[0.05] mb-6 overflow-hidden">
                {data.top.filter(e => e.rank >= 4).map(entry => (
                  <div key={entry.user_id} className="flex items-center gap-3 px-5 py-3">
                    <span className="font-numeric font-semibold text-ink-mute text-sm w-7">
                      {entry.rank}
                    </span>
                    <p className="flex-1 min-w-0 font-medium text-ink truncate text-sm">
                      {entry.full_name || entry.username}
                    </p>
                    <p className="font-numeric font-semibold text-ink text-sm">
                      {formatValue(entry.value)}
                      <span className="text-xs text-ink-mute ml-1 font-normal">
                        {kind === 'accuracy' ? '' : tabInfo.unit}
                      </span>
                    </p>
                  </div>
                ))}
              </div>
            )}

            {data.top.length === 0 && (
              <div className="card-soft rounded-2xl p-12 text-center mb-6">
                <p className="text-ink-soft mb-1">这周还没人解锁这个段位</p>
                <p className="text-xs text-ink-mute">
                  {kind === 'accuracy' ? '至少答 20 道题，正确率达标即可入榜' : '坚持几天就能上榜'}
                </p>
              </div>
            )}

            {/* 我的位置 */}
            <div className="card-soft rounded-2xl p-5">
              <p className="text-ink-mute text-xs mb-2">你本{period === 'this_month' ? '月' : '周'}的成绩</p>
              <div className="flex items-baseline justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-display text-3xl font-semibold text-ink font-numeric leading-none">
                    {formatValue(data.my_value)}
                  </p>
                  <p className="text-xs text-ink-soft mt-1">
                    {kind === 'accuracy' ? '本期正确率' : `本期累计 ${tabInfo.unit}`}
                  </p>
                </div>
                <div className="text-right">
                  {data.my_rank && data.my_rank <= 3 ? (
                    <p className="font-display text-2xl font-semibold font-numeric"
                       style={{ color: TIER_THEME[RANK_TIER[data.my_rank]].text }}>
                      {TIER_THEME[RANK_TIER[data.my_rank]].label}
                    </p>
                  ) : data.my_rank && data.my_rank <= 10 ? (
                    <p className="font-display text-2xl font-semibold text-accent-warm font-numeric">
                      第 {data.my_rank} 名
                    </p>
                  ) : data.my_rank ? (
                    <p className="font-display text-base font-medium text-ink-soft">继续加油上榜</p>
                  ) : (
                    <p className="font-display text-base font-medium text-ink-mute">
                      {kind === 'accuracy' ? '答够 20 题就能入榜' : '本期还没参与'}
                    </p>
                  )}
                  {period === 'this_week' && data.my_value > 0 && (
                    <p className={`text-xs mt-1 font-numeric ${
                      data.my_delta > 0 ? 'text-accent-warm font-semibold' :
                      data.my_delta < 0 ? 'text-ink-soft' : 'text-ink-mute'
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

// ============ 冠军卡 ============

function ChampionCard({
  entry, tier, size, kind, valueText, unit,
}: {
  entry: LeaderboardEntry;
  tier: Tier;
  size: 'lg' | 'md';
  kind: LeaderboardKind;
  valueText: string;
  unit: string;
}) {
  const theme = TIER_THEME[tier];
  const isLg = size === 'lg';
  const imgSrc = `/champions/${kind}-${tier}.webp`;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="relative rounded-3xl bg-white overflow-hidden no-select"
      style={{
        border: `2px solid ${theme.frame}`,
        boxShadow: `0 1px 0 rgba(0,0,0,0.02), 0 10px 32px -12px ${theme.glow}`,
      }}
    >
      {/* 顶部段位丝带 */}
      <div
        className="px-4 py-1.5 flex items-center justify-between text-white font-display text-[11px] tracking-[0.2em] font-semibold"
        style={{ background: theme.ribbon }}
      >
        <span>{theme.label}</span>
        <span className="opacity-80 font-numeric tracking-normal">No.{entry.rank}</span>
      </div>

      {/* 主体 */}
      <div className={`flex items-stretch ${isLg ? 'gap-3 md:gap-5' : 'gap-2 flex-col'}`}>
        {/* 角色立绘 */}
        <div
          className={`relative shrink-0 ${isLg ? 'w-32 md:w-44' : 'w-full'} flex items-end justify-center`}
          style={{
            background: `radial-gradient(circle at 50% 65%, ${theme.glow}, transparent 70%)`,
          }}
        >
          <img
            src={imgSrc}
            alt={`${theme.label} ${entry.full_name || entry.username}`}
            className={`tile-image select-none ${isLg ? 'w-32 md:w-44 h-32 md:h-44' : 'w-28 h-28'} object-contain drop-shadow-md`}
            draggable={false}
            decoding="async"
            {...(isLg ? { fetchPriority: 'high' as 'high' } : {})}
            onError={(e) => { (e.currentTarget as HTMLImageElement).style.visibility = 'hidden'; }}
          />
        </div>

        {/* 文字区 */}
        <div className={`flex-1 min-w-0 ${isLg ? 'py-4 pr-5' : 'px-4 pb-4 -mt-1'}`}>
          <p className="text-ink-mute text-[11px] mb-1">姓名</p>
          <p className={`font-display font-semibold text-ink truncate ${isLg ? 'text-xl md:text-2xl' : 'text-base'}`}>
            {entry.full_name || entry.username}
          </p>

          <div
            className={`inline-flex items-baseline gap-1.5 mt-3 px-3 py-1.5 rounded-full font-numeric font-bold ${isLg ? 'text-2xl md:text-3xl' : 'text-lg'}`}
            style={{
              background: theme.badge,
              color: theme.badgeText,
              boxShadow: `inset 0 0 0 1px ${theme.frame}`,
            }}
          >
            {valueText}
            {unit && <span className="text-xs font-medium opacity-70">{unit}</span>}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function EmptyCard({ tier, size }: { tier: Tier; size: 'lg' | 'md' }) {
  const theme = TIER_THEME[tier];
  const isLg = size === 'lg';
  return (
    <div
      className={`relative rounded-3xl bg-white/60 overflow-hidden ${isLg ? 'py-8' : 'py-6'}`}
      style={{
        border: `2px dashed ${theme.frame}`,
      }}
    >
      <div
        className="px-4 py-1.5 absolute top-0 left-0 right-0 flex items-center text-white font-display text-[11px] tracking-[0.2em] font-semibold opacity-60"
        style={{ background: theme.ribbon }}
      >
        {theme.label}
      </div>
      <div className="text-center pt-6">
        <p className="font-display text-sm font-medium" style={{ color: theme.text }}>虚位以待</p>
        <p className="text-xs text-ink-mute mt-1">来抢这把交椅</p>
      </div>
    </div>
  );
}

export default StudentLeaderboard;

// ============ 绑定码使用说明弹窗 ============

function BindCodeDialog({ code, minutesLeft, onClose }: {
  code: string;
  minutesLeft: number;
  onClose: () => void;
}) {
  const parentUrl = `${window.location.origin}/parent/register?code=${code}`;
  const shareText =
    `我在「飞鹰AI英语」学习呢，邀请你查看我的学习数据：\n\n` +
    `1. 打开链接：${parentUrl}\n` +
    `2. 输入手机号 + 设置密码（绑定码已自动填好：${code}）\n` +
    `3. 注册后就能看到我的学习情况啦\n\n` +
    `（绑定码 ${minutesLeft} 分钟内有效，过期我会再发一个）`;

  const [copied, setCopied] = useState<'code' | 'text' | null>(null);

  const copy = async (text: string, kind: 'code' | 'text') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // 兜底：选中可手动复制
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-center justify-center px-5 py-10 overflow-y-auto"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 20, scale: 0.97 }}
        animate={{ y: 0, scale: 1 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl p-6 w-full max-w-md my-auto"
      >
        {/* 大号绑定码 */}
        <p className="text-ink-mute text-xs uppercase tracking-widest mb-3 text-center">家长绑定码</p>
        <button
          onClick={() => copy(code, 'code')}
          className="w-full py-4 rounded-xl bg-paper hover:bg-black/[0.03] transition mb-2 group"
        >
          <p className="font-display text-5xl font-bold text-accent-warm font-numeric text-glow-warm tracking-[0.25em]">
            {code}
          </p>
          <p className="text-xs text-ink-mute mt-2 group-hover:text-accent-warm">
            {copied === 'code' ? '✓ 已复制' : '点击复制绑定码'}
          </p>
        </button>
        <p className="text-center text-xs text-ink-mute mb-6">
          ⏱ {minutesLeft} 分钟内有效，过期请重新生成
        </p>

        {/* 使用说明 */}
        <div className="bg-paper rounded-xl p-4 mb-4">
          <p className="font-display text-sm font-semibold text-ink mb-3">告诉家长怎么用：</p>
          <ol className="space-y-2.5 text-sm text-ink-soft leading-relaxed">
            <li className="flex gap-2">
              <span className="font-numeric font-semibold text-accent-warm shrink-0">1.</span>
              <span>家长用手机或电脑打开网址 <span className="font-mono text-xs bg-white px-1.5 py-0.5 rounded border border-black/[0.06]">{window.location.host}/parent/register</span></span>
            </li>
            <li className="flex gap-2">
              <span className="font-numeric font-semibold text-accent-warm shrink-0">2.</span>
              <span>输入这 6 位绑定码：<span className="font-numeric font-semibold text-ink">{code}</span></span>
            </li>
            <li className="flex gap-2">
              <span className="font-numeric font-semibold text-accent-warm shrink-0">3.</span>
              <span>填家长手机号 + 设置密码 → 注册成功</span>
            </li>
            <li className="flex gap-2">
              <span className="font-numeric font-semibold text-accent-warm shrink-0">4.</span>
              <span>以后家长用 <span className="font-mono text-xs bg-white px-1.5 py-0.5 rounded border border-black/[0.06]">{window.location.host}/parent/login</span> 登录就能查看你的学习数据</span>
            </li>
          </ol>
        </div>

        {/* 一键复制邀请文案 */}
        <button
          onClick={() => copy(shareText, 'text')}
          className="w-full py-3 mb-2 rounded-xl border border-black/15 text-ink hover:bg-black/5 transition text-sm font-medium"
        >
          {copied === 'text' ? '✓ 邀请文案已复制，去微信粘贴给家长' : '📋 复制完整邀请文案'}
        </button>

        <button
          onClick={onClose}
          className="btn-glow w-full py-3 text-white rounded-xl font-semibold"
        >
          我已告诉家长
        </button>
      </motion.div>
    </motion.div>
  );
}
