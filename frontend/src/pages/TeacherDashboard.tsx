import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  BookOpenText,
  CalendarCheck2,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  ClipboardList,
  Clock3,
  GraduationCap,
  LibraryBig,
  PencilLine,
  Radio,
  Video,
  FileText,
  Settings2,
  Sparkles,
  Swords,
  Trophy,
  Users,
  Volume2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { API_BASE_URL } from '../config/env';
import ChangePasswordModal from '../components/ChangePasswordModal';
import ChangeUsernameModal from '../components/ChangeUsernameModal';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';

interface UserData { username: string; full_name: string }
interface DashboardStats {
  total_words: number;
  total_books: number;
  total_students: number;
  weekly_passages: number;
  recent_words: Array<{ word: string; status: string; date: string }>;
  today_active_students: number;
  pending_assignments: number;
  completion_rate: number;
  weekly_new_assignments: number;
}
interface RecentActivity { type: 'homework' | 'unit'; student_name: string; title: string; score: number | null; time: string }
interface ActionItem { title: string; description: string; route: string; icon: LucideIcon; tone: 'orange' | 'blue' | 'green' | 'teal' | 'amber' | 'violet' }

const toolGroups: Array<{ title: string; description: string; items: ActionItem[] }> = [
  {
    title: '内容准备',
    description: '把今天要教的内容放到学生面前',
    items: [
      { title: '单词本管理', description: '管理单元和词汇', route: '/teacher/books', icon: BookOpenText, tone: 'orange' },
      { title: '阅读理解', description: '文章和题目', route: '/teacher/reading', icon: LibraryBig, tone: 'blue' },
      { title: '句子背诵', description: '句子集和导入', route: '/teacher/sentences', icon: PencilLine, tone: 'green' },
      { title: '音标视频', description: '上传与管理音标课', route: '/teacher/phonetics', icon: Volume2, tone: 'teal' },
    ],
  },
  {
    title: '课堂推进',
    description: '布置任务、跟进学习进度',
    items: [
      { title: '作业管理', description: '布置与追踪作业', route: '/teacher/homework', icon: CheckCircle2, tone: 'green' },
      { title: '分配单词本', description: '规划学习范围', route: '/teacher/assignments', icon: ClipboardList, tone: 'orange' },
      { title: '实时课堂', description: '查看课堂状态', route: '/teacher/live', icon: Radio, tone: 'teal' },
      { title: '线上授课', description: '网页开播、上传课件', route: '/teacher/livestream', icon: Video, tone: 'violet' },
      { title: '课件资料', description: '带水印,学生只能看', route: '/teacher/materials', icon: FileText, tone: 'blue' },
      { title: '签到记录', description: '每日签到与历史', route: '/teacher/checkins', icon: CalendarCheck2, tone: 'blue' },
    ],
  },
  {
    title: '激励与复盘',
    description: '让反馈变成下一次行动',
    items: [
      { title: '竞赛管理', description: '生成和管理题目', route: '/teacher/competition', icon: Trophy, tone: 'amber' },
      { title: 'PK 晋级赛', description: '分组与淘汰赛', route: '/teacher/tournaments', icon: GraduationCap, tone: 'violet' },
      { title: 'PK 对战房间', description: '组织个人或分组对战', route: '/pk/lobby', icon: Swords, tone: 'orange' },
      { title: '金币管理', description: '奖励与兑换记录', route: '/teacher/coins', icon: CircleDollarSign, tone: 'amber' },
    ],
  },
];

const statItems: Array<{ label: string; key: keyof DashboardStats; icon: LucideIcon; hint: string }> = [
  { label: '学生人数', key: 'total_students', icon: Users, hint: '当前负责的学生' },
  { label: '词汇总量', key: 'total_words', icon: BookOpenText, hint: '内容库可用词汇' },
  { label: '单词本', key: 'total_books', icon: BookOpen, hint: '已建立的学习内容' },
  { label: '本周文章', key: 'weekly_passages', icon: ClipboardList, hint: '本周新增阅读内容' },
];

const formatNumber = (value: number | undefined) => (value ?? 0).toLocaleString('zh-CN');

const TeacherDashboard = () => {
  const navigate = useNavigate();
  const [user] = useState<UserData | null>(() => {
    try { return JSON.parse(localStorage.getItem('user') || 'null') as UserData | null; } catch { return null; }
  });
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

  const displayName = user?.full_name || user?.username || '老师';
  const activityPreview = useMemo(() => activities.slice(0, 5), [activities]);
  return (
    <div className="teacher-dashboard min-h-screen text-slate-900">
      <StaffWorkspaceHeader role="teacher" title="教师工作台" subtitle="今日教学、学生进度与内容管理" action={<div className="flex items-center gap-1"><button type="button" onClick={() => setShowChangeUsername(true)} className="teacher-focus-ring rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800" title="修改用户名" aria-label="修改用户名"><PencilLine className="h-4 w-4" /></button><button type="button" onClick={() => setShowChangePassword(true)} className="teacher-focus-ring rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800" title="修改密码" aria-label="修改密码"><Settings2 className="h-4 w-4" /></button></div>} />

      <main className="teacher-workspace-main space-y-5 sm:space-y-6">
        <section className="teacher-hero overflow-hidden rounded-2xl border p-5 sm:p-6 lg:p-7">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
            <div className="max-w-2xl">
              <div className="teacher-pill mb-3 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold"><Sparkles className="h-3.5 w-3.5" /> 今日教学概览</div>
              <h2 className="max-w-xl text-2xl font-bold text-[#352d29] sm:text-3xl">欢迎回来，{displayName}</h2>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-600">今天已有 <span className="font-numeric font-bold text-[#bd5d31]">{formatNumber(stats?.today_active_students)}</span> 位学生开始学习。优先处理作业和学习进度，再准备课堂内容。</p>
              <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
                <button type="button" onClick={() => navigate('/teacher/homework')} className="teacher-primary teacher-focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold transition">布置今日作业 <ArrowRight className="h-4 w-4" /></button>
                <button type="button" onClick={() => navigate('/teacher/analytics')} className="teacher-secondary teacher-focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition">看班级数据 <BarChart3 className="h-4 w-4" /></button>
              </div>
            </div>
            <div className="grid w-full grid-cols-2 gap-2 sm:max-w-sm sm:gap-3 md:w-[19rem]">
              <div className="rounded-xl border border-[#edd8c8] bg-white p-3.5 sm:p-4"><p className="text-xs text-slate-500">今日活跃</p><p className="mt-2 text-2xl font-bold text-[#352d29] font-numeric sm:text-3xl">{formatNumber(stats?.today_active_students)}</p><p className="mt-1 text-[11px] text-slate-500 sm:text-xs">位学生已开始学习</p></div>
              <div className="rounded-xl border border-[#edd8c8] bg-white p-3.5 sm:p-4"><p className="text-xs text-slate-500">待处理作业</p><p className="mt-2 text-2xl font-bold text-[#352d29] font-numeric sm:text-3xl">{formatNumber(stats?.pending_assignments)}</p><p className="mt-1 text-[11px] text-slate-500 sm:text-xs">份任务等待跟进</p></div>
            </div>
          </div>
        </section>

        <section className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4" aria-label="教学内容概览">
          {statItems.map(({ label, key, icon: Icon, hint }) => (
            <div key={key} className="teacher-stat-strip rounded-2xl p-4 transition sm:p-5">
              <div className="flex items-start justify-between gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#eaf5fa] text-[#397b9b]"><Icon className="h-[18px] w-[18px]" /></span><span className="hidden text-[11px] text-slate-400 sm:block">{hint}</span></div>
              <p className="mt-5 text-2xl font-bold tracking-tight text-[#173047] font-numeric sm:text-3xl">{loading ? '—' : formatNumber(stats?.[key] as number)}</p>
              <p className="mt-1 text-xs font-semibold text-slate-500 sm:text-sm">{label}</p>
            </div>
          ))}
        </section>

        <section className="grid gap-6 xl:grid-cols-[minmax(0,1.12fr)_minmax(20rem,0.88fr)]">
          <div className="teacher-panel rounded-2xl p-5 sm:p-6">
            <div className="mb-5 flex items-end justify-between gap-4"><div><h3 className="text-xl font-bold tracking-tight text-[#173047]">今天先做这几件事</h3><p className="mt-1 text-xs text-slate-500">按优先级排列的教学动作</p></div><span className="text-xs text-slate-400">快速处理</span></div>
            <div className="divide-y divide-slate-100">
              <button type="button" onClick={() => navigate('/teacher/homework')} className="teacher-focus-ring group flex w-full items-center gap-4 py-4 text-left transition first:pt-0 last:pb-0">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#fce9dc] text-[#c76333]"><ClipboardList className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><span className="font-semibold text-[#173047]">布置一次针对性作业</span><span className="rounded-full bg-[#fff0e3] px-2 py-0.5 text-[10px] font-semibold text-[#b55b30]">推荐</span></span><span className="mt-1 block text-xs leading-5 text-slate-500">根据学生最近的学习情况，给一个清晰、可完成的下一步。</span></span><ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-1 group-hover:text-[#c76333]" /></button>
              <button type="button" onClick={() => navigate('/teacher/analytics')} className="teacher-focus-ring group flex w-full items-center gap-4 py-4 text-left transition">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#e4f3f5] text-[#2f8791]"><BarChart3 className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="font-semibold text-[#173047]">查看班级学习信号</span><span className="mt-1 block text-xs leading-5 text-slate-500">关注完成率和准确率的变化，及时调整课堂节奏。</span></span><ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-1 group-hover:text-[#2f8791]" /></button>
              <button type="button" onClick={() => navigate('/teacher/live')} className="teacher-focus-ring group flex w-full items-center gap-4 py-4 text-left transition">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#e8edf8] text-[#4f6ea7]"><Radio className="h-5 w-5" /></span><span className="min-w-0 flex-1"><span className="font-semibold text-[#173047]">进入实时课堂</span><span className="mt-1 block text-xs leading-5 text-slate-500">看看谁已经进入状态，给需要帮助的学生一个提醒。</span></span><ArrowRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-1 group-hover:text-[#4f6ea7]" /></button>
            </div>
          </div>

          <div className="teacher-panel rounded-2xl p-5 sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-4"><div><h3 className="text-xl font-bold tracking-tight text-[#173047]">最近学习动态</h3><p className="mt-1 text-xs text-slate-500">最近 3 天学生的完成情况</p></div><button type="button" onClick={() => navigate('/teacher/activities')} className="teacher-focus-ring inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-[#397b9b] transition hover:bg-[#eaf5fa]">全部动态 <ChevronRight className="h-4 w-4" /></button></div>
            <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
              {loading ? <div className="space-y-3 py-3"><div className="teacher-skeleton h-12 rounded-xl" /><div className="teacher-skeleton h-12 rounded-xl" /><div className="teacher-skeleton h-12 rounded-xl" /></div> : activityPreview.length ? activityPreview.map((activity, index) => <div key={`${activity.student_name}-${activity.time}-${index}`} className="flex items-start gap-3 rounded-xl px-2 py-3 transition hover:bg-[#f3f8fb]"><span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#e8f6ef] text-[#3b9a70]"><CheckCircle2 className="h-4 w-4" /></span><div className="min-w-0 flex-1"><p className="text-sm leading-5 text-slate-700"><span className="font-semibold text-[#173047]">{activity.student_name}</span>{activity.type === 'homework' ? ' 完成了作业 ' : ' 学完了 '}<span className="font-medium">{activity.title}</span></p><p className="mt-1 flex items-center gap-1 text-xs text-slate-400"><Clock3 className="h-3 w-3" />{activity.time}</p></div>{activity.score !== null && <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold font-numeric ${activity.score >= 80 ? 'bg-[#e8f6ef] text-[#32815f]' : activity.score >= 60 ? 'bg-[#fff3d9] text-[#9a6a1f]' : 'bg-[#fde9e5] text-[#b95747]'}`}>{activity.score}分</span>}</div>) : <div className="rounded-xl bg-[#f4f8fa] py-12 text-center text-sm text-slate-500">最近还没有学习动态</div>}
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <div className="teacher-panel rounded-2xl p-5 sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-4"><div><h3 className="text-xl font-bold tracking-tight text-[#173047]">最近录入的单词</h3><p className="mt-1 text-xs text-slate-500">内容库最近的变化</p></div><button type="button" onClick={() => navigate('/teacher/books')} className="teacher-focus-ring inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-[#397b9b] transition hover:bg-[#eaf5fa]">打开内容库 <ChevronRight className="h-4 w-4" /></button></div>
            <div className="space-y-2">
              {loading ? <div className="space-y-2"><div className="teacher-skeleton h-14 rounded-xl" /><div className="teacher-skeleton h-14 rounded-xl" /></div> : stats?.recent_words?.length ? stats.recent_words.slice(0, 5).map((item, index) => <div key={`${item.word}-${index}`} className="flex items-center justify-between gap-3 rounded-xl bg-[#f5f8fa] px-3.5 py-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-[#173047]">{item.word}</p><p className="mt-1 text-xs text-slate-400">{item.date}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[11px] font-semibold ${item.status === 'published' ? 'bg-[#e8f6ef] text-[#32815f]' : 'bg-[#fff3d9] text-[#9a6a1f]'}`}>{item.status === 'published' ? '已发布' : '草稿'}</span></div>) : <div className="rounded-xl bg-[#f4f8fa] py-12 text-center text-sm text-slate-500">暂无单词记录</div>}
            </div>
          </div>
          <div className="teacher-panel rounded-2xl p-5 sm:p-6">
            <div className="mb-5 flex items-start justify-between gap-4"><div><h3 className="text-xl font-bold tracking-tight text-[#173047]">单词本分配进度</h3><p className="mt-1 text-xs text-slate-500">把学习范围分配给正确的学生</p></div><button type="button" onClick={() => navigate('/teacher/assignments')} className="teacher-primary teacher-focus-ring inline-flex items-center gap-1 rounded-lg px-3 py-2 text-xs font-bold transition">开始分配 <ArrowRight className="h-3.5 w-3.5" /></button></div>
            <div className="grid grid-cols-3 gap-2 sm:gap-3"><div className="rounded-xl bg-[#f5f8fa] p-3.5"><p className="text-xs text-slate-500">待分配</p><p className="mt-2 text-2xl font-bold font-numeric text-[#c76333]">{formatNumber(stats?.pending_assignments)}</p><p className="mt-1 text-[11px] text-slate-400">需要关注</p></div><div className="rounded-xl bg-[#f5f8fa] p-3.5"><p className="text-xs text-slate-500">完成率</p><p className="mt-2 text-2xl font-bold font-numeric text-[#32815f]">{stats?.completion_rate || 0}%</p><p className="mt-1 text-[11px] text-slate-400">当前任务</p></div><div className="rounded-xl bg-[#f5f8fa] p-3.5"><p className="text-xs text-slate-500">本周新增</p><p className="mt-2 text-2xl font-bold font-numeric text-[#397b9b]">{formatNumber(stats?.weekly_new_assignments)}</p><p className="mt-1 text-[11px] text-slate-400">持续推进</p></div></div>
            <div className="mt-5 flex items-start gap-3 rounded-xl border border-[#dcebf0] bg-[#f2f9fa] p-3.5"><span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white text-[#2f8791]"><Sparkles className="h-4 w-4" /></span><p className="text-xs leading-5 text-[#466b76]">小建议：先处理待分配任务，再回到数据页检查完成率，今天的课堂闭环会更顺。</p></div>
          </div>
        </section>

        <section className="teacher-tool-list rounded-2xl p-5 sm:p-6">
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h3 className="text-xl font-bold tracking-tight text-[#173047]">教学工具箱</h3><p className="mt-1 text-xs text-slate-500">按教学场景整理的常用入口</p></div><span className="text-xs text-slate-400">{toolGroups.reduce((sum, group) => sum + group.items.length, 0)} 项工具</span></div>
          <div className="grid gap-6 md:grid-cols-3">
            {toolGroups.map((group) => <div key={group.title}><div className="mb-2 px-1"><p className="text-sm font-semibold text-[#173047]">{group.title}</p><p className="mt-1 text-xs text-slate-500">{group.description}</p></div><div className="teacher-tool-row-group overflow-hidden rounded-xl border border-slate-100">{group.items.map(({ title, description, route, icon: Icon, tone }) => <button key={route} type="button" onClick={() => navigate(route)} className="teacher-tool-row group flex w-full items-center gap-3 px-3 py-3 text-left transition"><span className={`teacher-tool-icon teacher-tool-icon-${tone} flex h-9 w-9 shrink-0 items-center justify-center rounded-lg`}><Icon className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-[#173047]">{title}</span><span className="mt-0.5 block truncate text-[11px] text-slate-500">{description}</span></span><ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-600" /></button>)}</div></div>)}
          </div>
        </section>
      </main>

      <ChangePasswordModal isOpen={showChangePassword} onClose={() => setShowChangePassword(false)} />
      <ChangeUsernameModal isOpen={showChangeUsername} onClose={() => setShowChangeUsername(false)} currentUsername={user?.username} />
    </div>
  );
};

export default TeacherDashboard;
