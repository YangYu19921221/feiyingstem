import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { ArrowRight, BarChart3, BookOpen, BookOpenText, CalendarCheck2, CheckCircle2, ChevronRight, CircleDollarSign, ClipboardList, Clock3, GraduationCap, LogOut, PencilLine, Radio, Settings2, Sparkles, Swords, Trophy, Users } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { API_BASE_URL } from '../config/env';
import ChangePasswordModal from '../components/ChangePasswordModal';
import ChangeUsernameModal from '../components/ChangeUsernameModal';

interface UserData { username: string; full_name: string }
interface DashboardStats {
  total_words: number; total_books: number; total_students: number; weekly_passages: number;
  recent_words: Array<{ word: string; status: string; date: string }>;
  today_active_students: number; pending_assignments: number; completion_rate: number; weekly_new_assignments: number;
}
interface RecentActivity { type: 'homework' | 'unit'; student_name: string; title: string; score: number | null; time: string }
interface ActionItem { title: string; description: string; route: string; icon: LucideIcon; tone: string }

const actions: ActionItem[] = [
  { title: '单词本管理', description: '管理单元和词汇', route: '/teacher/books', icon: BookOpenText, tone: 'bg-orange-50 text-orange-600' },
  { title: '班级管理', description: '班级分组和数据', route: '/teacher/classes', icon: Users, tone: 'bg-cyan-50 text-cyan-600' },
  { title: '阅读理解', description: '文章和题目', route: '/teacher/reading', icon: BookOpen, tone: 'bg-blue-50 text-blue-600' },
  { title: '句子背诵', description: '句子集和导入', route: '/teacher/sentences', icon: PencilLine, tone: 'bg-emerald-50 text-emerald-600' },
  { title: '竞赛管理', description: '生成和管理题目', route: '/teacher/competition', icon: Trophy, tone: 'bg-amber-50 text-amber-600' },
  { title: 'PK 晋级赛', description: '分组与淘汰赛', route: '/teacher/tournaments', icon: GraduationCap, tone: 'bg-violet-50 text-violet-600' },
  { title: 'PK 对战房间', description: '建房组织个人/分组对战', route: '/pk/lobby', icon: Swords, tone: 'bg-rose-50 text-rose-600' },
  { title: '实时课堂', description: '查看课堂状态', route: '/teacher/live', icon: Radio, tone: 'bg-rose-50 text-rose-600' },
  { title: '签到记录', description: '每日签到与历史', route: '/teacher/checkins', icon: CalendarCheck2, tone: 'bg-sky-50 text-sky-600' },
  { title: '分配单词本', description: '规划学生学习范围', route: '/teacher/assignments', icon: ClipboardList, tone: 'bg-indigo-50 text-indigo-600' },
  { title: '作业管理', description: '布置与追踪作业', route: '/teacher/homework', icon: CheckCircle2, tone: 'bg-green-50 text-green-600' },
  { title: '金币管理', description: '奖励与兑换记录', route: '/teacher/coins', icon: CircleDollarSign, tone: 'bg-yellow-50 text-yellow-600' },
  { title: '学生监控', description: '查看学习数据', route: '/teacher/students', icon: BarChart3, tone: 'bg-teal-50 text-teal-600' },
];
const statItems: Array<{ label: string; key: keyof DashboardStats; icon: LucideIcon; tone: string }> = [
  { label: '词汇总量', key: 'total_words', icon: BookOpenText, tone: 'bg-orange-50 text-orange-600' },
  { label: '单词本', key: 'total_books', icon: BookOpen, tone: 'bg-cyan-50 text-cyan-600' },
  { label: '学生人数', key: 'total_students', icon: Users, tone: 'bg-blue-50 text-blue-600' },
  { label: '本周文章', key: 'weekly_passages', icon: ClipboardList, tone: 'bg-emerald-50 text-emerald-600' },
];

const TeacherDashboard = () => {
  const navigate = useNavigate();
  const [user] = useState<UserData | null>(() => { try { return JSON.parse(localStorage.getItem('user') || 'null') as UserData | null; } catch { return null; } });
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activities, setActivities] = useState<RecentActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [showChangeUsername, setShowChangeUsername] = useState(false);

  useEffect(() => {
    const headers = { Authorization: `Bearer ${localStorage.getItem('access_token')}` };
    Promise.allSettled([
      axios.get(`${API_BASE_URL}/teacher/dashboard/stats`, { headers }),
      axios.get(`${API_BASE_URL}/teacher/recent-activities`, { headers }),
    ]).then(([statsResult, activitiesResult]) => {
      if (statsResult.status === 'fulfilled') setStats(statsResult.value.data);
      if (activitiesResult.status === 'fulfilled') setActivities(activitiesResult.value.data?.activities || []);
    }).catch((error) => console.error('加载教师工作台失败:', error)).finally(() => setLoading(false));
  }, []);

  const logout = () => { localStorage.removeItem('access_token'); localStorage.removeItem('user'); navigate('/login'); };

  return (
    <div className="min-h-screen text-slate-800">
      <nav className="bg-white/90 backdrop-blur"><div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3"><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-100 text-orange-600"><GraduationCap className="h-5 w-5" /></div><div className="min-w-0"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-orange-500">Teacher workspace</p><h1 className="truncate text-lg font-bold">教师工作台</h1></div></div>
        <div className="flex items-center gap-2"><div className="hidden items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm sm:flex"><span className="h-2 w-2 rounded-full bg-emerald-500" /><span className="max-w-[10rem] truncate">{user?.full_name || '教师'}</span></div><button type="button" onClick={() => setShowChangeUsername(true)} className="hidden rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 sm:block" title="修改用户名" aria-label="修改用户名"><PencilLine className="h-4 w-4" /></button><button type="button" onClick={() => setShowChangePassword(true)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="修改密码" aria-label="修改密码"><Settings2 className="h-4 w-4" /></button><button type="button" onClick={logout} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="退出登录" aria-label="退出登录"><LogOut className="h-4 w-4" /></button></div>
      </div></nav>

      <main className="mx-auto max-w-7xl space-y-7 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <section className="staff-colorful-surface overflow-hidden rounded-2xl border border-orange-100 p-5 shadow-md sm:p-7"><div className="flex flex-col justify-between gap-6 md:flex-row md:items-end"><div className="max-w-2xl"><div className="mb-3 inline-flex items-center gap-2 rounded-full bg-white/75 px-3 py-1 text-xs font-semibold text-orange-700"><Sparkles className="h-3.5 w-3.5" /> 今日教学概览</div><h2 className="text-2xl font-bold tracking-tight sm:text-3xl">欢迎回来，{user?.full_name || '老师'}</h2><p className="mt-2 text-sm leading-6 text-slate-600">今天有 <span className="font-bold text-orange-600">{stats?.today_active_students || 0}</span> 位学生完成学习，继续保持课堂节奏。</p></div><button type="button" onClick={() => navigate('/teacher/analytics')} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700">查看教学数据 <ArrowRight className="h-4 w-4" /></button></div></section>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">{statItems.map(({ label, key, icon: Icon, tone }) => <div key={label} className="rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm sm:p-5"><div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-lg ${tone}`}><Icon className="h-5 w-5" /></div><p className="text-2xl font-bold tracking-tight">{loading ? '—' : Number(stats?.[key] || 0).toLocaleString()}</p><p className="mt-1 text-xs font-medium text-slate-500 sm:text-sm">{label}</p></div>)}</section>

        <section><div className="mb-3 flex items-end justify-between"><div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Workspace tools</p><h3 className="mt-1 text-xl font-bold">常用工具</h3></div><span className="text-xs text-slate-400">{actions.length} 项教学工具</span></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">{actions.map(({ title, description, route, icon: Icon, tone }) => <button key={route} type="button" onClick={() => navigate(route)} className="group rounded-xl border border-slate-200/80 bg-white p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md"><div className={`mb-4 flex h-10 w-10 items-center justify-center rounded-lg ${tone}`}><Icon className="h-5 w-5" /></div><p className="text-sm font-bold">{title}</p><p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{description}</p><ArrowRight className="mt-3 h-4 w-4 text-slate-300 transition group-hover:translate-x-1 group-hover:text-slate-600" /></button>)}</div></section>

        <section className="grid gap-5 lg:grid-cols-[1fr_1.15fr]">
          <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6"><div className="mb-5 flex items-center justify-between"><div><h3 className="font-bold">最近录入的单词</h3><p className="mt-1 text-xs text-slate-400">追踪内容库最近的变化</p></div><button type="button" onClick={() => navigate('/teacher/books')} className="inline-flex items-center gap-1 text-xs font-semibold text-orange-600">全部内容 <ChevronRight className="h-4 w-4" /></button></div><div className="space-y-2">{loading ? <div className="py-8 text-center text-sm text-slate-400">正在加载...</div> : stats?.recent_words?.length ? stats.recent_words.map((item, index) => <div key={`${item.word}-${index}`} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{item.word}</p><p className="mt-1 text-xs text-slate-400">{item.date}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${item.status === 'published' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{item.status === 'published' ? '已发布' : '草稿'}</span></div>) : <div className="py-8 text-center text-sm text-slate-400">暂无单词记录</div>}</div></div>
          <div className="rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-6"><div className="mb-5 flex items-center justify-between"><div><h3 className="font-bold">最近学习动态</h3><p className="mt-1 text-xs text-slate-400">最近 3 天学生完成情况</p></div><button type="button" onClick={() => navigate('/teacher/activities')} className="inline-flex items-center gap-1 text-xs font-semibold text-orange-600">查看全部 <ChevronRight className="h-4 w-4" /></button></div><div className="max-h-72 space-y-2 overflow-y-auto">{loading ? <div className="py-8 text-center text-sm text-slate-400">正在加载...</div> : activities.length ? activities.map((activity, index) => <div key={`${activity.student_name}-${activity.time}-${index}`} className="flex items-start gap-3 rounded-lg bg-slate-50 px-3 py-3"><div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-orange-500"><CheckCircle2 className="h-4 w-4" /></div><div className="min-w-0 flex-1"><p className="text-sm leading-5"><span className="font-semibold">{activity.student_name}</span>{activity.type === 'homework' ? ' 完成了作业 ' : ' 学完了 '}<span className="font-medium">{activity.title}</span></p><p className="mt-1 flex items-center gap-1 text-xs text-slate-400"><Clock3 className="h-3 w-3" />{activity.time}</p></div>{activity.score !== null && <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${activity.score >= 80 ? 'bg-emerald-100 text-emerald-700' : activity.score >= 60 ? 'bg-amber-100 text-amber-700' : 'bg-rose-100 text-rose-700'}`}>{activity.score}分</span>}</div>) : <div className="py-8 text-center text-sm text-slate-400">最近还没有学习动态</div>}</div></div>
        </section>

        <section className="staff-colorful-surface flex flex-col gap-5 rounded-xl border border-cyan-100 p-5 sm:p-6 md:flex-row md:items-center md:justify-between"><div className="flex items-start gap-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white text-cyan-600 shadow-sm"><ClipboardList className="h-5 w-5" /></div><div><h3 className="font-bold">单词本分配管理</h3><p className="mt-1 text-sm text-slate-600">集中规划学生的学习范围，让个性化练习更有节奏。</p><div className="mt-4 flex flex-wrap gap-x-7 gap-y-2"><div><p className="text-xs text-slate-500">待分配</p><p className="text-xl font-bold text-indigo-600">{stats?.pending_assignments || 0}</p></div><div><p className="text-xs text-slate-500">完成率</p><p className="text-xl font-bold text-emerald-600">{stats?.completion_rate || 0}%</p></div><div><p className="text-xs text-slate-500">本周新增</p><p className="text-xl font-bold text-orange-600">{stats?.weekly_new_assignments || 0}</p></div></div></div></div><button type="button" onClick={() => navigate('/teacher/assignments')} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm transition hover:shadow-md">开始分配 <ArrowRight className="h-4 w-4" /></button></section>
      </main>
      <ChangePasswordModal isOpen={showChangePassword} onClose={() => setShowChangePassword(false)} />
      <ChangeUsernameModal isOpen={showChangeUsername} onClose={() => setShowChangeUsername(false)} currentUsername={user?.username} />
    </div>
  );
};
export default TeacherDashboard;
