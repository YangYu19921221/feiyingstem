import { useCallback, useEffect, useMemo, useState } from 'react';
import axios from 'axios';
import { Activity, BarChart3, BookOpen, RefreshCw, TrendingUp, Users } from 'lucide-react';
import { API_BASE_URL } from '../config/env';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';

interface Statistics {
  total_users: number;
  total_words: number;
  total_books: number;
  total_units: number;
  active_users_today: number;
  active_users_week: number;
  learning_records_today: number;
  learning_records_week: number;
}

const number = (value: number | undefined) => (value ?? 0).toLocaleString('zh-CN');

export default function AdminStatistics() {
  const [stats, setStats] = useState<Statistics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const loadStatistics = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const token = localStorage.getItem('access_token');
      const response = await axios.get(`${API_BASE_URL}/admin/stats`, { headers: { Authorization: `Bearer ${token}` } });
      setStats(response.data);
    } catch (requestError) {
      console.error('加载统计数据失败:', requestError);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadStatistics(); }, [loadStatistics]);

  const metrics = useMemo(() => [
    { label: '总用户数', value: stats?.total_users, detail: `今日活跃 ${number(stats?.active_users_today)}`, icon: Users, tone: 'blue' },
    { label: '总词汇量', value: stats?.total_words, detail: `${number(stats?.total_books)} 本单词本`, icon: BookOpen, tone: 'orange' },
    { label: '今日活跃', value: stats?.active_users_today, detail: `本周 ${number(stats?.active_users_week)}`, icon: Activity, tone: 'green' },
    { label: '本周学习次数', value: stats?.learning_records_week, detail: `今日 ${number(stats?.learning_records_today)}`, icon: TrendingUp, tone: 'violet' },
  ], [stats]);

  const userRows = [
    ['总用户数', stats?.total_users, 'blue'],
    ['今日活跃用户', stats?.active_users_today, 'green'],
    ['本周活跃用户', stats?.active_users_week, 'teal'],
    ['日活跃率', stats?.total_users ? `${((stats.active_users_today / stats.total_users) * 100).toFixed(1)}%` : '0.0%', 'violet'],
  ] as const;
  const contentRows = [
    ['总词汇量', stats?.total_words, 'orange'],
    ['单词本数量', stats?.total_books, 'blue'],
    ['单元数量', stats?.total_units, 'teal'],
    ['平均每本词汇', stats?.total_books ? Math.round(stats.total_words / stats.total_books) : 0, 'violet'],
  ] as const;

  return (
    <div className="admin-legacy-page min-h-screen">
      <StaffWorkspaceHeader role="admin" title="数据统计" subtitle="用一组可读的信号，判断平台今天是否健康。" action={<button type="button" onClick={() => void loadStatistics()} disabled={loading} className="admin-secondary-light admin-focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition disabled:cursor-wait disabled:opacity-60"><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />刷新数据</button>} />

      <div className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6 lg:px-10 lg:py-8">

        {error ? (
          <section className="admin-panel rounded-2xl p-10 text-center sm:p-16"><div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[#fce9dc] text-[#c76333]"><BarChart3 className="h-6 w-6" /></div><h2 className="mt-4 text-lg font-bold text-[#173047]">统计数据暂时不可用</h2><p className="mt-2 text-sm text-slate-500">请检查服务状态后重试，已有页面内容不会受到影响。</p><button type="button" onClick={() => void loadStatistics()} className="admin-primary admin-focus-ring mt-5 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold">重新加载 <RefreshCw className="h-4 w-4" /></button></section>
        ) : (
          <>
            <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4" aria-label="核心指标">
              {metrics.map(({ label, value, detail, icon: Icon, tone }) => <div key={label} className="admin-stat-strip rounded-2xl p-4 sm:p-5"><div className="flex items-start justify-between gap-3"><span className={`admin-stat-icon admin-stat-icon-${tone} flex h-9 w-9 items-center justify-center rounded-xl`}><Icon className="h-[18px] w-[18px]" /></span><span className="hidden text-[11px] text-slate-400 sm:block">{detail}</span></div><p className="mt-5 text-2xl font-bold tracking-tight text-[#173047] font-numeric sm:text-3xl">{loading ? '—' : number(value)}</p><div className="mt-1 flex items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-500 sm:text-sm">{label}</p><span className="text-[11px] text-slate-400 sm:hidden">{detail}</span></div></div>)}
            </section>

            <section className="mt-6 grid gap-6 lg:grid-cols-2">
              <MetricPanel title="用户活跃度" description="关注规模和回访情况" icon={Users} rows={userRows} />
              <MetricPanel title="内容资产" description="平台词库的内容规模" icon={BookOpen} rows={contentRows} />
            </section>

            <section className="admin-panel mt-6 rounded-2xl p-5 sm:p-6"><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#e8f6ef] text-[#32815f]"><TrendingUp className="h-5 w-5" /></span><div><h2 className="text-xl font-bold tracking-tight text-[#173047]">学习活动</h2><p className="mt-1 text-sm text-slate-500">比较今日与本周学习行为，及时发现异常波动。</p></div></div><div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4"><ActivityCard label="今日学习次数" value={stats?.learning_records_today} tone="green" /><ActivityCard label="本周学习次数" value={stats?.learning_records_week} tone="teal" /><ActivityCard label="日均学习次数" value={stats ? Math.round(stats.learning_records_week / 7) : 0} tone="blue" /><ActivityCard label="活跃用户人均" value={stats?.active_users_week ? (stats.learning_records_week / stats.active_users_week).toFixed(1) : '0.0'} tone="violet" /></div></section>
          </>
        )}
      </div>
    </div>
  );
}

function MetricPanel({ title, description, icon: Icon, rows }: { title: string; description: string; icon: typeof Users; rows: readonly (readonly [string, number | string | undefined, string])[] }) {
  return <section className="admin-panel rounded-2xl p-5 sm:p-6"><div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#eaf5fa] text-[#397b9b]"><Icon className="h-5 w-5" /></span><div><h2 className="text-xl font-bold tracking-tight text-[#173047]">{title}</h2><p className="mt-1 text-sm text-slate-500">{description}</p></div></div><div className="mt-5 space-y-2">{rows.map(([label, value, tone]) => <div key={label} className={`admin-metric-row admin-metric-row-${tone} flex items-center justify-between gap-4 rounded-xl px-4 py-3.5`}><span className="text-sm font-medium text-slate-600">{label}</span><span className="font-numeric text-lg font-bold text-[#173047]">{typeof value === 'number' ? number(value) : value || '—'}</span></div>)}</div></section>;
}

function ActivityCard({ label, value, tone }: { label: string; value: number | string | undefined; tone: string }) {
  return <div className={`admin-activity-card admin-activity-card-${tone} rounded-xl p-4`}><p className="text-xs font-medium text-slate-600">{label}</p><p className="mt-2 font-numeric text-2xl font-bold text-[#173047]">{typeof value === 'number' ? number(value) : value || '—'}</p></div>;
}
