import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  Activity,
  ArrowRight,
  BarChart3,
  BookOpen,
  Building2,
  ChevronRight,
  CircleDollarSign,
  Gauge,
  GraduationCap,
  Handshake,
  Megaphone,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Ticket,
  Trophy,
  Users,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { API_BASE_URL } from '../config/env';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';

interface UserData { full_name: string }
interface Statistics { total_users: number; students?: number; total_words: number; total_books: number; active_users_today: number; active_users_week: number; learning_records_today: number; learning_records_week: number }
interface RecentUser { id: number; username: string; full_name: string | null; role: string; is_active: boolean; created_at: string | null }
interface ToolItem { title: string; description: string; path: string; icon: LucideIcon; tone: 'orange' | 'blue' | 'teal' | 'green' | 'indigo' | 'amber' | 'violet' }

const toolGroups: Array<{ title: string; description: string; items: ToolItem[] }> = [
  {
    title: '组织与人员',
    description: '掌握机构、教师和班级的运行状态',
    items: [
      { title: '机构管理', description: '加盟商开户与配额', path: '/admin/organizations', icon: Building2, tone: 'orange' },
      { title: '加盟线索', description: '意向客户跟进与导出', path: '/admin/franchise-leads', icon: Handshake, tone: 'amber' },
      { title: '用户管理', description: '管理师生账号', path: '/admin/users', icon: Users, tone: 'blue' },
      { title: '教师管理', description: '教师列表与班级', path: '/admin/teachers', icon: GraduationCap, tone: 'teal' },
      { title: '班级监控', description: '学习统计与名册', path: '/admin/classes', icon: BarChart3, tone: 'indigo' },
    ],
  },
  {
    title: '内容与服务',
    description: '保持学习内容和智能服务稳定',
    items: [
      { title: '内容管理', description: '单词与单词本', path: '/admin/content', icon: BookOpen, tone: 'green' },
      { title: 'AI 配置', description: '模型与服务设置', path: '/admin/ai-config', icon: Sparkles, tone: 'violet' },
      { title: '订阅管理', description: '兑换码与订阅', path: '/admin/subscriptions', icon: Ticket, tone: 'amber' },
      { title: '单词比赛', description: '竞赛排行与概览', path: '/admin/competition', icon: Trophy, tone: 'orange' },
    ],
  },
  {
    title: '系统与数据',
    description: '发现异常，快速定位运营问题',
    items: [
      { title: '数据统计', description: '系统使用情况', path: '/admin/statistics', icon: Activity, tone: 'blue' },
      { title: '服务器监控', description: 'CPU、内存、网络状态', path: '/admin/server-monitor', icon: Gauge, tone: 'teal' },
      { title: '系统设置', description: '配置与版本更新', path: '/admin/settings', icon: Settings, tone: 'indigo' },
    ],
  },
];

const formatNumber = (value: number | undefined) => (value ?? 0).toLocaleString('zh-CN');

export default function AdminDashboard() {
  const navigate = useNavigate();
  const [user] = useState<UserData | null>(() => { try { return JSON.parse(localStorage.getItem('user') || 'null') as UserData | null; } catch { return null; } });
  const [stats, setStats] = useState<Statistics | null>(null);
  const [recentUsers, setRecentUsers] = useState<RecentUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentVersion, setCurrentVersion] = useState('');
  const [hasUpdate, setHasUpdate] = useState(false);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setLoadErrors([]);
    const headers = { Authorization: `Bearer ${localStorage.getItem('access_token')}` };
    const results = await Promise.allSettled([
      axios.get(`${API_BASE_URL}/admin/stats`, { headers }),
      axios.get(`${API_BASE_URL}/admin/users`, { params: { page: 1, page_size: 5 }, headers }),
      axios.get(`${API_BASE_URL}/admin/system/version`, { headers }),
      axios.get(`${API_BASE_URL}/admin/system/check-update`, { headers }),
    ]);
    const [statsResult, usersResult, versionResult, updateResult] = results;
    const errors: string[] = [];
    if (statsResult.status === 'fulfilled') setStats(statsResult.value.data);
    else errors.push('系统指标');
    if (usersResult.status === 'fulfilled') setRecentUsers(usersResult.value.data?.users || []);
    else errors.push('最近用户');
    if (versionResult.status === 'fulfilled') setCurrentVersion(versionResult.value.data?.version || '');
    else errors.push('版本信息');
    if (updateResult.status === 'fulfilled') setHasUpdate(Boolean(updateResult.value.data?.has_update));
    else errors.push('更新检查');
    if (errors.length) setLoadErrors(errors);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  const summary = useMemo(() => [
    { label: '总用户数', value: stats?.total_users || 0, note: `学生 ${stats?.students || 0}`, icon: Users, tone: 'blue' },
    { label: '词汇总量', value: stats?.total_words || 0, note: `${stats?.total_books || 0} 本单词本`, icon: BookOpen, tone: 'orange' },
    { label: '今日活跃', value: stats?.active_users_today || 0, note: `本周 ${stats?.active_users_week || 0}`, icon: Activity, tone: 'green' },
    { label: '本周学习', value: stats?.learning_records_week || 0, note: `今日 ${stats?.learning_records_today || 0}`, icon: BarChart3, tone: 'violet' },
  ], [stats]);

  const displayName = user?.full_name || '管理员';

  return (
    <div className="admin-dashboard min-h-screen text-slate-900">
      <StaffWorkspaceHeader
        role="admin"
        title="系统管理后台"
        subtitle="用户、内容、服务与运营数据"
        icon={ShieldCheck}
        action={hasUpdate ? <button type="button" onClick={() => navigate('/admin/settings')} className="admin-update inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold"><Megaphone className="h-3.5 w-3.5" />有新版本</button> : undefined}
      />

      <main className="mx-auto max-w-[1440px] space-y-5 px-4 py-4 sm:space-y-6 sm:px-6 sm:py-6 lg:px-10 lg:py-8">
        {loadErrors.length > 0 && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status"><span>部分数据暂时不可用：{loadErrors.join('、')}。</span><button type="button" onClick={() => void loadDashboard()} className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-amber-800 shadow-sm transition hover:bg-amber-100">重新加载</button></div>}
        <section className="admin-hero overflow-hidden rounded-2xl border p-5 sm:p-6 lg:p-7">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end"><div className="max-w-2xl"><div className="admin-pill mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold"><ShieldCheck className="h-3.5 w-3.5" /> 系统运行概览</div><h2 className="text-2xl font-bold text-[#173047] sm:text-3xl">欢迎回来，{displayName}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">先确认系统服务和用户活动，再处理机构、内容与账号任务。</p><div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3"><button type="button" onClick={() => navigate('/admin/statistics')} className="admin-primary admin-focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition">查看数据报告 <ArrowRight className="h-4 w-4" /></button><button type="button" onClick={() => navigate('/admin/server-monitor')} className="admin-secondary admin-focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition">检查服务状态 <Server className="h-4 w-4" /></button></div></div><div className="grid w-full grid-cols-2 gap-2 sm:max-w-sm sm:gap-3 md:w-[19rem]"><div className="rounded-xl border border-[#d6e2eb] bg-white p-3.5 sm:p-4"><p className="text-xs text-slate-500">今日活跃</p><p className="mt-2 text-2xl font-bold text-[#173047] font-numeric sm:text-3xl">{formatNumber(stats?.active_users_today)}</p><p className="mt-1 text-[11px] text-slate-500 sm:text-xs">位用户有学习记录</p></div><div className="rounded-xl border border-[#d6e2eb] bg-white p-3.5 sm:p-4"><p className="text-xs text-slate-500">当前版本</p><p className="mt-2 truncate text-xl font-bold text-[#173047] font-numeric sm:text-2xl">{currentVersion ? `v${currentVersion}` : '—'}</p><p className="mt-1 text-[11px] text-slate-500 sm:text-xs">{hasUpdate ? '有更新可查看' : '版本运行正常'}</p></div></div></div>
        </section>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4" aria-label="系统指标">
          {summary.map(({ label, value, note, icon: Icon, tone }) => <div key={label} className="admin-stat-strip rounded-2xl p-4 transition sm:p-5"><div className="flex items-start justify-between gap-3"><span className={`admin-stat-icon admin-stat-icon-${tone} flex h-9 w-9 items-center justify-center rounded-xl`}><Icon className="h-[18px] w-[18px]" /></span><span className="hidden text-[11px] text-slate-400 sm:block">{note}</span></div><p className="mt-5 text-2xl font-bold tracking-tight text-[#173047] font-numeric sm:text-3xl">{loading ? '—' : formatNumber(value)}</p><div className="mt-1 flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-500 sm:text-sm">{label}</p><span className="text-[11px] text-slate-400 sm:hidden">{note}</span></div></div>)}
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.12fr)_minmax(20rem,0.88fr)]">
          <div className="admin-panel rounded-2xl p-5 sm:p-6"><div className="mb-5 flex items-end justify-between gap-4"><div><h3 className="text-xl font-bold tracking-tight text-[#173047]">今天先看这几件事</h3><p className="mt-1 text-xs text-slate-500">按影响面排列的运营入口</p></div><span className="text-xs text-slate-400">快速处理</span></div><div className="divide-y divide-slate-100"><button type="button" onClick={() => navigate('/admin/server-monitor')} className="admin-focus-ring group flex w-full items-center gap-4 py-4 text-left transition first:pt-0"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#e4f3f5] text-[#2f8791]"><Gauge className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="font-semibold text-[#173047]">确认服务容量与在线状态</span><span className="mt-1 block text-xs leading-5 text-slate-500">看 CPU、内存、带宽和在线人数是否在安全范围内。</span></span><ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-1 group-hover:text-[#2f8791]" /></button><button type="button" onClick={() => navigate('/admin/organizations')} className="admin-focus-ring group flex w-full items-center gap-4 py-4 text-left transition"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#fce9dc] text-[#c76333]"><Building2 className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="font-semibold text-[#173047]">检查机构与配额</span><span className="mt-1 block text-xs leading-5 text-slate-500">处理即将到期、名额紧张或需要开管理员的机构。</span></span><ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-1 group-hover:text-[#c76333]" /></button><button type="button" onClick={() => navigate('/admin/users')} className="admin-focus-ring group flex w-full items-center gap-4 py-4 text-left transition last:pb-0"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#e8edf8] text-[#4f6ea7]"><Users className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="font-semibold text-[#173047]">处理账号和权限</span><span className="mt-1 block text-xs leading-5 text-slate-500">集中处理新用户、教师账号和账号状态。</span></span><ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-1 group-hover:text-[#4f6ea7]" /></button></div></div>
          <div className="admin-panel rounded-2xl p-5 sm:p-6"><div className="mb-5 flex items-start justify-between gap-4"><div><h3 className="text-xl font-bold tracking-tight text-[#173047]">最近注册用户</h3><p className="mt-1 text-xs text-slate-500">平台最新加入的账号</p></div><button type="button" onClick={() => navigate('/admin/users')} className="admin-focus-ring inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-[#397b9b] transition hover:bg-[#eaf5fa]">全部用户 <ChevronRight className="h-4 w-4" /></button></div><div className="space-y-2">{loading ? <div className="space-y-2"><div className="admin-skeleton h-14 rounded-xl" /><div className="admin-skeleton h-14 rounded-xl" /><div className="admin-skeleton h-14 rounded-xl" /></div> : recentUsers.length ? recentUsers.map((item) => { const role = item.role === 'teacher' ? '教师' : item.role === 'admin' ? '管理员' : '学生'; const displayName = item.full_name || item.username; const date = item.created_at ? new Date(item.created_at).toLocaleDateString('zh-CN') : '—'; return <div key={item.id} className="flex items-center justify-between gap-3 rounded-xl bg-[#f5f8fa] px-3.5 py-3"><div className="flex min-w-0 items-center gap-3"><span className={`admin-user-icon admin-user-icon-${item.role} flex h-9 w-9 shrink-0 items-center justify-center rounded-lg`}><Users className="h-4 w-4" /></span><div className="min-w-0"><p className="truncate text-sm font-semibold text-[#173047]">{displayName}</p><p className="mt-1 text-xs text-slate-400">{role} · 注册于 {date}</p></div></div><span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${item.is_active ? 'bg-[#e8f6ef] text-[#32815f]' : 'bg-slate-200 text-slate-500'}`}>{item.is_active ? '已激活' : '已停用'}</span></div>; }) : <div className="rounded-xl bg-[#f4f8fa] py-12 text-center text-sm text-slate-500">暂无用户数据</div>}</div></div>
        </section>

        <section className="admin-tool-list rounded-2xl p-5 sm:p-6"><div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h3 className="text-xl font-bold tracking-tight text-[#173047]">运营工具箱</h3><p className="mt-1 text-xs text-slate-500">每个入口都对应一个可执行的管理动作</p></div><span className="text-xs text-slate-400">{toolGroups.reduce((sum, group) => sum + group.items.length, 0)} 项工具</span></div><div className="grid gap-6 md:grid-cols-3">{toolGroups.map((group) => <div key={group.title}><div className="mb-2 px-1"><p className="text-sm font-semibold text-[#173047]">{group.title}</p><p className="mt-1 text-xs text-slate-500">{group.description}</p></div><div className="admin-tool-row-group overflow-hidden rounded-xl border border-slate-100">{group.items.map(({ title, description, path, icon: Icon, tone }) => <button key={path} type="button" onClick={() => navigate(path)} className="admin-tool-row admin-focus-ring group flex w-full items-center gap-3 px-3 py-3 text-left transition"><span className={`admin-tool-icon admin-tool-icon-${tone} flex h-9 w-9 shrink-0 items-center justify-center rounded-lg`}><Icon className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-[#173047]">{title}</span><span className="mt-0.5 block truncate text-[11px] text-slate-500">{description}</span></span><ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-600" /></button>)}</div></div>)}</div></section>

        <section className="admin-panel flex flex-col gap-5 rounded-2xl p-5 sm:p-6 md:flex-row md:items-center md:justify-between"><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#eaf5fa] text-[#397b9b]"><CircleDollarSign className="h-5 w-5" /></span><div><h3 className="font-bold text-[#173047]">版本与服务提醒</h3><p className="mt-1 text-sm leading-6 text-slate-500">{hasUpdate ? '检测到新版本，建议在低峰期完成更新。' : '当前版本运行正常，定期查看设置与服务监控即可。'}</p></div></div><button type="button" onClick={() => navigate(hasUpdate ? '/admin/settings' : '/admin/server-monitor')} className="admin-secondary-light admin-focus-ring inline-flex shrink-0 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition">{hasUpdate ? '查看更新' : '打开服务监控'} <ArrowRight className="h-4 w-4" /></button></section>
      </main>
    </div>
  );
}
