import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Plus } from 'lucide-react';
import {
  parentListChildren,
  parentChildDashboard,
  parentBindAdditional,
  type ChildSummary,
  type ChildDashboard,
} from '../api/parent';
import { toast } from '../components/Toast';

const ParentDashboard = () => {
  const navigate = useNavigate();
  const [children, setChildren] = useState<ChildSummary[]>([]);
  const [activeStudentId, setActiveStudentId] = useState<number | null>(null);
  const [dashboard, setDashboard] = useState<ChildDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [showBindDialog, setShowBindDialog] = useState(false);
  const [bindCode, setBindCode] = useState('');
  const [binding, setBinding] = useState(false);

  useEffect(() => {
    loadChildren();
  }, []);

  const loadChildren = async () => {
    try {
      setLoading(true);
      const list = await parentListChildren();
      setChildren(list);
      if (list.length > 0 && activeStudentId === null) {
        setActiveStudentId(list[0].student_id);
      }
    } catch (err) {
      console.error('加载孩子列表失败:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeStudentId === null) return;
    setDashboardLoading(true);
    parentChildDashboard(activeStudentId)
      .then(d => setDashboard(d))
      .catch(e => console.error(e))
      .finally(() => setDashboardLoading(false));
  }, [activeStudentId]);

  const handleLogout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    navigate('/parent/login');
  };

  const handleBindAdditional = async () => {
    if (!bindCode.trim()) return;
    setBinding(true);
    try {
      await parentBindAdditional(bindCode.trim());
      toast.success('绑定成功');
      setShowBindDialog(false);
      setBindCode('');
      loadChildren();
    } catch (err: any) {
      toast.error(err?.response?.data?.detail || '绑定失败');
    } finally {
      setBinding(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <p className="text-ink-mute text-sm">加载中…</p>
      </div>
    );
  }

  if (children.length === 0) {
    return (
      <div className="min-h-screen bg-paper page-warm-glow flex items-center justify-center px-5">
        <div className="card-soft rounded-2xl p-8 text-center max-w-sm">
          <h1 className="font-display text-2xl font-semibold text-ink mb-3">还没有绑定孩子</h1>
          <p className="text-ink-soft text-sm mb-6">请孩子生成绑定码后绑定。</p>
          <button
            onClick={() => setShowBindDialog(true)}
            className="btn-glow w-full py-3.5 text-white rounded-xl font-semibold"
          >
            绑定孩子
          </button>
          <button
            onClick={handleLogout}
            className="text-ink-mute text-xs mt-4 hover:text-ink-soft"
          >
            退出登录
          </button>
        </div>
        {showBindDialog && <BindDialog
          code={bindCode} setCode={setBindCode}
          loading={binding} onConfirm={handleBindAdditional}
          onClose={() => { setShowBindDialog(false); setBindCode(''); }}
        />}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-paper page-warm-glow">
      {/* 顶部导航 */}
      <nav className="border-b border-black/[0.06] bg-paper/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-5xl mx-auto px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-lg font-semibold text-ink tracking-tight">飞鹰</span>
            <span className="text-xs text-ink-mute">家长端</span>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <button
              onClick={() => setShowBindDialog(true)}
              className="text-ink-soft hover:text-ink transition flex items-center gap-1"
            >
              <Plus className="w-4 h-4" /> 绑定孩子
            </button>
            <button
              onClick={handleLogout}
              className="text-ink-soft hover:text-ink transition"
            >
              退出
            </button>
          </div>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-5 py-8">
        {/* 多孩切换 */}
        {children.length > 1 && (
          <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
            {children.map(c => (
              <button
                key={c.student_id}
                onClick={() => setActiveStudentId(c.student_id)}
                className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition ${
                  activeStudentId === c.student_id
                    ? 'bg-accent-warm text-white'
                    : 'card-soft text-ink hover:text-accent-warm'
                }`}
              >
                {c.full_name || c.username}
              </button>
            ))}
          </div>
        )}

        {dashboardLoading || !dashboard ? (
          <div className="py-16 text-center text-ink-mute text-sm">加载孩子数据中…</div>
        ) : (
          <DashboardContent data={dashboard} />
        )}
      </div>

      {showBindDialog && <BindDialog
        code={bindCode} setCode={setBindCode}
        loading={binding} onConfirm={handleBindAdditional}
        onClose={() => { setShowBindDialog(false); setBindCode(''); }}
      />}
    </div>
  );
};

// ============ 看板内容 ============

function DashboardContent({ data }: { data: ChildDashboard }) {
  // 7 天热力图分级
  const heatColor = (mins: number) => {
    if (mins === 0) return 'bg-black/[0.04]';
    if (mins < 10) return 'bg-accent-warm/20';
    if (mins < 30) return 'bg-accent-warm/45';
    if (mins < 60) return 'bg-accent-warm/70';
    return 'bg-accent-warm';
  };

  const heatmapWeeks = useMemo(() => {
    // 把 30 天切成 5 周 × 7 天的网格（按日期实际星期对齐）
    return data.heatmap;
  }, [data.heatmap]);

  return (
    <>
      {/* 标题 */}
      <section className="mb-8">
        <p className="text-ink-mute text-sm mb-2">孩子的学习数据</p>
        <h1 className="font-display text-3xl md:text-4xl font-semibold text-ink leading-[1.1] tracking-tight">
          {data.full_name || data.username}
        </h1>
      </section>

      {/* 今日状态 */}
      <section className="card-soft rounded-2xl p-6 mb-6">
        <p className="text-ink-mute text-xs mb-3">今日</p>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="font-display text-3xl font-semibold text-ink font-numeric leading-none">
              {data.today_minutes}
            </p>
            <p className="text-xs text-ink-soft mt-1.5">分钟学习</p>
          </div>
          <div>
            <p className="font-display text-3xl font-semibold text-ink font-numeric leading-none">
              {data.today_words}
            </p>
            <p className="text-xs text-ink-soft mt-1.5">个新词</p>
          </div>
          <div>
            <p className="font-display text-3xl font-semibold text-accent-warm font-numeric leading-none text-glow-warm">
              {data.streak_days}
            </p>
            <p className="text-xs text-ink-soft mt-1.5">天连续打卡</p>
          </div>
        </div>
      </section>

      {/* 复习进度（艾宾浩斯曲线同口径） */}
      <section className="card-soft rounded-2xl p-6 mb-6">
        <div className="flex items-baseline justify-between mb-3">
          <p className="text-ink-mute text-xs">复习</p>
          {(data.review_due_today + data.review_done_today) > 0 && (
            <p className="text-xs text-ink-soft">
              进度{' '}
              <span className="font-numeric text-ink font-semibold">
                {Math.round(
                  (data.review_done_today /
                    Math.max(1, data.review_due_today + data.review_done_today)) * 100
                )}
              </span>
              %
            </p>
          )}
        </div>
        <div className="grid grid-cols-3 gap-4 mb-3">
          <div>
            <p className="font-display text-3xl font-semibold text-accent-warm font-numeric leading-none">
              {data.review_due_today}
            </p>
            <p className="text-xs text-ink-soft mt-1.5">今日待复习</p>
          </div>
          <div>
            <p className="font-display text-3xl font-semibold text-ink font-numeric leading-none">
              {data.review_done_today}
            </p>
            <p className="text-xs text-ink-soft mt-1.5">今日已复习</p>
          </div>
          <div>
            <p className="font-display text-3xl font-semibold text-green-600 font-numeric leading-none">
              {data.graduated_words}
            </p>
            <p className="text-xs text-ink-soft mt-1.5">已毕业单词</p>
          </div>
        </div>
        {data.review_due_today === 0 && data.review_done_today > 0 && (
          <p className="text-xs text-green-700">🎉 今日复习已清零</p>
        )}
        {data.review_due_today > 0 && (
          <div className="h-1.5 rounded-full overflow-hidden bg-black/5">
            <div
              className="h-full bg-accent-warm transition-all"
              style={{
                width: `${(data.review_done_today / Math.max(1, data.review_due_today + data.review_done_today)) * 100}%`,
              }}
            />
          </div>
        )}
      </section>

      {/* 本周对比 */}
      <section className="mb-6">
        <h2 className="font-display text-lg font-semibold text-ink mb-3">本周与上周</h2>
        <div className="card-soft rounded-2xl divide-y divide-black/[0.05]">
          <CompareRow label="学习时长" unit="分钟" current={data.this_week_minutes} previous={data.last_week_minutes} />
          <CompareRow label="新掌握词" unit="个" current={data.this_week_words} previous={data.last_week_words} />
          <CompareRow label="正确率" unit="%" current={data.this_week_accuracy} previous={data.last_week_accuracy} isPercent />
        </div>
      </section>

      {/* 系统排名 */}
      <section className="mb-6">
        <h2 className="font-display text-lg font-semibold text-ink mb-3">本周在系统中的位置</h2>
        <div className="grid grid-cols-3 gap-3">
          <RankCard emoji="📚" label="词汇王" info={data.rank_vocabulary} unit="词" />
          <RankCard emoji="🔥" label="勤奋王" info={data.rank_diligence} unit="分钟" />
          <RankCard emoji="🎯" label="精准王" info={data.rank_accuracy} unit="%" isPercent />
        </div>
      </section>

      {/* 累计 */}
      <section className="mb-6">
        <h2 className="font-display text-lg font-semibold text-ink mb-3">累计成绩</h2>
        <div className="card-soft rounded-2xl divide-y divide-black/[0.05]">
          <DataRow label="已学单词" value={data.total_words_learned} suffix="个" />
          <DataRow label="已掌握" value={data.total_words_mastered} suffix={`个 · ${data.total_words_learned > 0 ? Math.round(data.total_words_mastered / data.total_words_learned * 100) : 0}%`} />
          <DataRow label="累计学习" value={data.total_minutes} suffix="分钟" />
          <DataRow label="解锁成就" value={data.unlocked_achievements} suffix={`/ ${data.total_achievements} 个`} />
        </div>
      </section>

      {/* 学习日历 */}
      <section className="mb-6">
        <h2 className="font-display text-lg font-semibold text-ink mb-3">30 天学习日历</h2>
        <div className="card-soft rounded-2xl p-5">
          <div className="grid grid-cols-10 gap-1.5">
            {heatmapWeeks.map(d => (
              <div
                key={d.date}
                title={`${d.date}: ${d.minutes} 分钟`}
                className={`aspect-square rounded ${heatColor(d.minutes)}`}
              />
            ))}
          </div>
          <div className="flex items-center justify-end gap-2 mt-3 text-[10px] text-ink-mute">
            <span>少</span>
            <div className="w-3 h-3 rounded bg-black/[0.04]" />
            <div className="w-3 h-3 rounded bg-accent-warm/20" />
            <div className="w-3 h-3 rounded bg-accent-warm/45" />
            <div className="w-3 h-3 rounded bg-accent-warm/70" />
            <div className="w-3 h-3 rounded bg-accent-warm" />
            <span>多</span>
          </div>
        </div>
      </section>

      {/* 单词本进度 */}
      {data.books.length > 0 && (
        <section className="mb-6">
          <h2 className="font-display text-lg font-semibold text-ink mb-3">正在学的书</h2>
          <div className="card-soft rounded-2xl divide-y divide-black/[0.05]">
            {data.books.map(b => (
              <div key={b.book_id} className="px-5 py-4">
                <div className="flex items-baseline justify-between mb-2">
                  <p className="font-medium text-ink truncate flex-1 min-w-0">{b.book_name}</p>
                  <p className="text-sm font-numeric text-ink-soft ml-3">
                    {b.completed_units} / {b.total_units} 单元
                  </p>
                </div>
                <div className="w-full h-1.5 bg-black/[0.05] rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      b.progress_percentage >= 100 ? 'progress-gold' : 'bg-accent-warm'
                    }`}
                    style={{ width: `${b.progress_percentage}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 薄弱词 */}
      {data.weak_words.length > 0 && (
        <section className="mb-6">
          <h2 className="font-display text-lg font-semibold text-ink mb-3">最薄弱的 10 个词</h2>
          <div className="card-soft rounded-2xl divide-y divide-black/[0.05]">
            {data.weak_words.map((w, i) => (
              <div key={i} className="px-5 py-3 flex items-center gap-3">
                <span className="text-xs font-numeric text-ink-mute w-6">#{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-display font-semibold text-ink">{w.word}</p>
                  {w.meaning && <p className="text-xs text-ink-soft truncate">{w.meaning}</p>}
                </div>
                <p className="text-xs text-accent-warm font-numeric font-semibold">
                  错 {w.wrong_count} 次
                </p>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// ============ 子组件 ============

function CompareRow({ label, unit, current, previous, isPercent }: {
  label: string; unit: string; current: number; previous: number; isPercent?: boolean;
}) {
  const delta = current - previous;
  const arrow = delta > 0 ? '↑' : delta < 0 ? '↓' : '·';
  const color = delta > 0 ? 'text-accent-warm' : delta < 0 ? 'text-ink-soft' : 'text-ink-mute';
  return (
    <div className="px-5 py-4 flex items-baseline justify-between">
      <span className="text-ink-soft text-sm">{label}</span>
      <div className="flex items-baseline gap-2">
        <span className="font-display font-semibold text-2xl text-ink font-numeric">
          {current}{isPercent ? '%' : ''}
        </span>
        <span className={`text-xs font-numeric ${color}`}>
          {arrow} {Math.abs(delta)}{isPercent ? ' pt' : ` ${unit}`}
        </span>
      </div>
    </div>
  );
}

function RankCard({ emoji, label, info, unit, isPercent }: {
  emoji: string; label: string; info: { rank: number | null; total: number; value: number }; unit: string; isPercent?: boolean;
}) {
  return (
    <div className="card-soft rounded-xl p-4">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-2xl">{emoji}</span>
        <span className="text-xs text-ink-mute">{label}</span>
      </div>
      {info.rank ? (
        <>
          <p className="font-display text-2xl font-semibold text-ink font-numeric leading-none">
            #{info.rank}
          </p>
          <p className="text-[11px] text-ink-mute mt-1">
            / {info.total} 人 · {info.value}{isPercent ? '%' : ''}{!isPercent ? ` ${unit}` : ''}
          </p>
        </>
      ) : (
        <>
          <p className="font-display text-base font-medium text-ink-mute">未上榜</p>
          <p className="text-[11px] text-ink-mute mt-1">{info.value}{isPercent ? '%' : ''}{!isPercent ? ` ${unit}` : ''}</p>
        </>
      )}
    </div>
  );
}

function DataRow({ label, value, suffix }: { label: string; value: number; suffix: string }) {
  return (
    <div className="px-5 py-4 flex items-baseline justify-between">
      <span className="text-ink-soft text-sm">{label}</span>
      <div className="flex items-baseline gap-1.5">
        <span className="font-display font-semibold text-2xl text-ink font-numeric">{value}</span>
        <span className="text-xs text-ink-mute">{suffix}</span>
      </div>
    </div>
  );
}

function BindDialog({ code, setCode, loading, onConfirm, onClose }: {
  code: string; setCode: (s: string) => void; loading: boolean; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center px-5"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 20 }}
        animate={{ y: 0 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl p-6 w-full max-w-sm"
      >
        <h3 className="font-display text-lg font-semibold text-ink mb-2">绑定新的孩子</h3>
        <p className="text-ink-soft text-sm mb-4">请孩子在「光荣榜 → 邀请家长查看」中生成绑定码。</p>
        <input
          type="text"
          inputMode="numeric"
          maxLength={8}
          value={code}
          onChange={e => setCode(e.target.value.replace(/\s/g, ''))}
          autoFocus
          className="w-full px-4 py-3 rounded-xl border border-black/10 bg-white text-ink font-numeric text-lg tracking-widest focus:border-accent-warm focus:outline-none mb-4"
          placeholder="6 位数字"
        />
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-3 border border-black/15 text-ink rounded-xl font-medium hover:bg-black/5 transition">取消</button>
          <button onClick={onConfirm} disabled={loading || !code.trim()}
            className="flex-1 py-3 btn-glow text-white rounded-xl font-semibold disabled:opacity-50">
            {loading ? '绑定中…' : '确认绑定'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default ParentDashboard;
