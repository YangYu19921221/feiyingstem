import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { Activity, ArrowRight, BarChart3, BookOpen, Building2, ChevronRight, CircleDollarSign, Cog, GraduationCap, LogOut, Megaphone, Settings, ShieldCheck, Sparkles, Ticket, Trophy, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { API_BASE_URL } from '../config/env';

interface UserData { full_name: string }
interface Statistics { total_users: number; students?: number; total_words: number; total_books: number; active_users_today: number; active_users_week: number; learning_records_today: number; learning_records_week: number }
interface RecentUser { id: number; username: string; full_name: string | null; role: string; is_active: boolean; created_at: string | null }
interface ActionItem { title: string; description: string; path: string; icon: LucideIcon; tone: string }

const actions: ActionItem[] = [
  { title: '机构管理', description: '加盟商开户与配额', path: '/admin/organizations', icon: Building2, tone: 'bg-orange-50 text-orange-600' },
  { title: '用户管理', description: '管理师生账号', path: '/admin/users', icon: Users, tone: 'bg-blue-50 text-blue-600' },
  { title: '教师管理', description: '教师列表与班级', path: '/admin/teachers', icon: GraduationCap, tone: 'bg-cyan-50 text-cyan-600' },
  { title: '班级数据', description: '学习统计与名册', path: '/admin/classes', icon: BarChart3, tone: 'bg-indigo-50 text-indigo-600' },
  { title: '内容管理', description: '单词与单词本', path: '/admin/content', icon: BookOpen, tone: 'bg-emerald-50 text-emerald-600' },
  { title: 'AI 配置', description: '模型与服务设置', path: '/admin/ai-config', icon: Sparkles, tone: 'bg-violet-50 text-violet-600' },
  { title: '数据统计', description: '系统使用情况', path: '/admin/statistics', icon: Activity, tone: 'bg-sky-50 text-sky-600' },
  { title: '系统设置', description: '配置与版本更新', path: '/admin/settings', icon: Settings, tone: 'bg-slate-100 text-slate-600' },
  { title: '订阅管理', description: '兑换码与订阅', path: '/admin/subscriptions', icon: Ticket, tone: 'bg-amber-50 text-amber-600' },
  { title: '单词比赛', description: '竞赛排行与概览', path: '/admin/competition', icon: Trophy, tone: 'bg-rose-50 text-rose-600' },
];

const AdminDashboard = () => {
  const navigate = useNavigate();
  const [user] = useState<UserData | null>(() => { try { return JSON.parse(localStorage.getItem('user') || 'null') as UserData | null; } catch { return null; } });
  const [stats, setStats] = useState<Statistics | null>(null);
  const [recentUsers, setRecentUsers] = useState<RecentUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentVersion, setCurrentVersion] = useState('');
  const [hasUpdate, setHasUpdate] = useState(false);

  useEffect(() => {
    const headers = { Authorization: `Bearer ${localStorage.getItem('access_token')}` };
    Promise.allSettled([
      axios.get(`${API_BASE_URL}/admin/stats`, { headers }),
      axios.get(`${API_BASE_URL}/admin/users`, { params: { page: 1, page_size: 5 }, headers }),
      axios.get(`${API_BASE_URL}/admin/system/version`, { headers }),
      axios.get(`${API_BASE_URL}/admin/system/check-update`, { headers }),
    ]).then(([statsResult, usersResult, versionResult, updateResult]) => {
      if (statsResult.status === 'fulfilled') setStats(statsResult.value.data);
      if (usersResult.status === 'fulfilled') setRecentUsers(usersResult.value.data?.users || []);
      if (versionResult.status === 'fulfilled') setCurrentVersion(versionResult.value.data?.version || '');
      if (updateResult.status === 'fulfilled') setHasUpdate(Boolean(updateResult.value.data?.has_update));
    }).catch((error) => console.error('加载管理工作台失败:', error)).finally(() => setLoading(false));
  }, []);

  const logout = () => { localStorage.removeItem('access_token'); localStorage.removeItem('user'); navigate('/login'); };
  const summary = [
    { label: '总用户数', value: stats?.total_users || 0, note: `学生 ${stats?.students || 0}`, icon: Users, tone: 'bg-blue-50 text-blue-600' },
    { label: '词汇总量', value: stats?.total_words || 0, note: `${stats?.total_books || 0} 本单词本`, icon: BookOpen, tone: 'bg-orange-50 text-orange-600' },
    { label: '今日活跃', value: stats?.active_users_today || 0, note: `本周 ${stats?.active_users_week || 0}`, icon: Activity, tone: 'bg-emerald-50 text-emerald-600' },
    { label: '本周学习', value: stats?.learning_records_week || 0, note: `今日 ${stats?.learning_records_today || 0}`, icon: BarChart3, tone: 'bg-violet-50 text-violet-600' },
  ];

  return (
    <div className="min-h-screen text-slate-800">
      <nav className="bg-white/90 backdrop-blur"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600"><ShieldCheck className="h-5 w-5" /></div><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-indigo-500">Operations console</p><h1 className="truncate text-lg font-bold">系统管理后台</h1></div>{currentVersion && <span className={`hidden rounded-full px-2 py-1 text-[11px] font-semibold sm:inline-flex ${hasUpdate ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-500'}`}>v{currentVersion}</span>}</div>
        <div className="flex items-center gap-2">{hasUpdate && <button type="button" onClick={() => navigate('/admin/settings')} className="hidden items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-2 text-xs font-semibold text-white hover:bg-orange-600 sm:inline-flex"><Megaphone className="h-3.5 w-3.5" />有新版本</button>}<div className="hidden items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm sm:flex"><span className="h-2 w-2 rounded-full bg-indigo-500" /><span className="max-w-[10rem] truncate">{user?.full_name || '管理员'}</span></div><button type="button" onClick={() => navigate('/admin/settings')} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="系统设置" aria-label="系统设置"><Cog className="h-4 w-4" /></button><button type="button" onClick={logout} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="退出登录" aria-label="退出登录"><LogOut className="h-4 w-4" /></button></div>
      </div></nav>

      <main className="mx-auto max-w-7xl space-y-7 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <section className="staff-colorful-surface overflow-hidden rounded-2xl border border-indigo-100 p-5 shadow-md sm:p-7"><div className="flex flex-col justify-between gap-6 md:flex-row md:items-end"><div className="max-w-2xl"><div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/75 px-3 py-1 text-xs font-semibold text-indigo-700"><ShieldCheck className="h-3.5 w-3.5" /> 系统运行概览</div><h2 className="text-2xl font-bold tracking-tight sm:text-3xl">欢迎回来，{user?.full_name || '管理员'}</h2><p className="mt-2 text-sm leading-6 text-slate-600">平台服务运行正常。这里集中查看用户、内容、学习数据和系统配置。</p></div><button type="button" onClick={() => navigate('/admin/statistics')} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700">查看数据报告 <ArrowRight className="h-4 w-4" /></button></div></section>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">{summary.map(({ label, value, note, icon: Icon, tone }) => <div key={label} className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5"><div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-lg ${tone}`}><Icon className="h-5 w-5" /></div><p className="text-2xl font-bold tracking-tight">{loading ? '—' : value.toLocaleString()}</p><div className="mt-1 flex flex-wrap items-center justify-between gap-2"><p className="text-xs font-medium text-slate-500 sm:text-sm">{label}</p><span className="text-[11px] text-slate-400">{note}</span></div></div>)}</section>

        <section><div className="mb-3 flex items-end justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Control center</p><h3 className="mt-1 text-xl font-bold">管理工具</h3></div><span className="text-xs text-slate-400">{actions.length} 项系统入口</span></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{actions.map(({ title, description, path, icon: Icon, tone }) => <button key={path} type="button" onClick={() => navigate(path)} className="group rounded-xl border border-slate-200/80 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"><div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-lg ${tone}`}><Icon className="h-5 w-5" /></div><p className="text-sm font-bold">{title}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{description}</p><ArrowRight className="mt-3 h-4 w-4 text-slate-300 transition group-hover:translate-x-1 group-hover:text-slate-600" /></button>)}</div></section>

        <section className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6"><div className="mb-5 flex items-center justify-between"><div><h3 className="font-bold">最近注册用户</h3><p className="mt-1 text-xs text-slate-400">平台最新加入的账号</p></div><button type="button" onClick={() => navigate('/admin/users')} className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600">查看全部 <ChevronRight className="h-4 w-4" /></button></div>{recentUsers.length === 0 ? <div className="py-8 text-center text-sm text-slate-400">{loading ? '正在加载...' : '暂无用户数据'}</div> : <div className="grid gap-2 md:grid-cols-2">{recentUsers.map((item) => { const role = item.role === 'teacher' ? '教师' : item.role === 'admin' ? '管理员' : '学生'; const displayName = item.full_name || item.username; const date = item.created_at ? new Date(item.created_at).toLocaleDateString('zh-CN') : '—'; return <div key={item.id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-3"><div className="flex min-w-0 items-center gap-3"><div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${item.role === 'teacher' ? 'bg-cyan-100 text-cyan-700' : item.role === 'admin' ? 'bg-indigo-100 text-indigo-700' : 'bg-orange-100 text-orange-700'}`}><Users className="h-4 w-4" /></div><div className="min-w-0"><p className="truncate text-sm font-semibold">{displayName}</p><p className="mt-1 text-xs text-slate-400">{role} · 注册于 {date}</p></div></div><span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${item.is_active ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-500'}`}>{item.is_active ? '已激活' : '已停用'}</span></div>; })}</div>}</section>

        <section className="staff-colorful-surface flex flex-col gap-5 rounded-xl border border-indigo-100 p-5 sm:p-6 md:flex-row md:items-center md:justify-between"><div className="flex items-start gap-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-indigo-600 shadow-sm"><CircleDollarSign className="h-5 w-5" /></div><div><h3 className="font-bold">平台运营提醒</h3><p className="mt-1 text-sm text-slate-600">定期检查系统更新、AI 配置和订阅兑换码，保持服务稳定。</p></div></div><button type="button" onClick={() => navigate('/admin/settings')} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:shadow-md">打开系统设置 <ArrowRight className="h-4 w-4" /></button></section>
      </main>
    </div>
  );
};
export default AdminDashboard;
