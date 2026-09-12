/** 机构管理端 - 加盟商老板的控制台(org_admin 角色登录后的主页) */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BarChart3, BookOpen, Building2, CalendarCheck, Edit3, GraduationCap, KeyRound, Plus, Search, Ticket, Trophy, TrendingUp, Users } from 'lucide-react';
import { orgAdminApi } from '../api/organizations';
import { InitialPasswordModal, QuotaBar, quotaPercent } from '../components/OrgWidgets';
import ChangeMyPasswordModal from '../components/org/ChangeMyPasswordModal';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';

type ApiError = { response?: { data?: { detail?: string } } };
const errorDetail = (error: unknown, fallback: string) => (error as ApiError)?.response?.data?.detail || fallback;

export default function OrgAdminDashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ username: '', full_name: '', phone: '' });
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);

  // 老师搜索: 输入框即时回显 search,防抖后的 debounced 才发请求
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: info } = useQuery({ queryKey: ['org-info'], queryFn: orgAdminApi.info });
  const { data: teachers } = useQuery({
    queryKey: ['org-teachers', debouncedSearch],
    queryFn: () => orgAdminApi.teachers(debouncedSearch || undefined),
  });

  // 改老师资料: null=没在编辑。phone 允许改成空串(=清空),所以不能用真值判断
  const [editTeacher, setEditTeacher] = useState<
    { id: number; username: string; full_name: string; phone: string } | null>(null);
  // 删除确认: 先拿预检结果再决定能不能删
  const [delTarget, setDelTarget] = useState<
    { id: number; label: string; deletable: boolean;
      dependents: { classes: number; students: number; book_assignments: number; homework: number } } | null>(null);
  const [showMyPassword, setShowMyPassword] = useState(false);
  // 离职交接: 选一位接手老师。to=0 表示还没选
  const [handover, setHandover] = useState<
    { id: number; label: string; to: number } | null>(null);

  // 机构信息编辑: null=未在编辑,非null=表单内容(一个状态表达一个概念)
  const [infoForm, setInfoForm] = useState<{ name: string; contact_name: string; contact_phone: string } | null>(null);
  const saveInfo = async () => {
    if (!infoForm) return;
    try {
      await orgAdminApi.updateInfo({
        name: infoForm.name.trim() || undefined,
        contact_name: infoForm.contact_name.trim() || undefined,
        contact_phone: infoForm.contact_phone.trim() || undefined,
      });
      qc.invalidateQueries({ queryKey: ['org-info'] });
      setInfoForm(null);
    } catch (e: unknown) {
      alert(errorDetail(e, '保存失败'));
    }
  };
  const onLogoPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const r = await orgAdminApi.uploadLogo(f);
      // 响应已带新URL,本地写缓存即可,不必重拉 /org/info(3条SQL)
      qc.setQueryData(['org-info'], (old: unknown) => old && typeof old === 'object' ? { ...old, logo_url: r.logo_url } : old);
    } catch (err: unknown) {
      alert(errorDetail(err, 'Logo 上传失败'));
    }
  };

  const createMut = useMutation({
    mutationFn: () => orgAdminApi.createTeacher({
      username: form.username, full_name: form.full_name || undefined, phone: form.phone || undefined,
    }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['org-teachers'] });
      qc.invalidateQueries({ queryKey: ['org-info'] });
      setShowCreate(false);
      setForm({ username: '', full_name: '', phone: '' });
      setIssued({ username: r.username, password: r.initial_password });
    },
    onError: (e: unknown) => alert(errorDetail(e, '创建失败')),
  });

  const toggleMut = useMutation({
    mutationFn: (id: number) => orgAdminApi.toggleTeacher(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-teachers'] }),
    onError: (e: unknown) => alert(errorDetail(e, '操作失败')),
  });

  const updateMut = useMutation({
    mutationFn: () => orgAdminApi.updateTeacher(editTeacher!.id, {
      full_name: editTeacher!.full_name.trim(),
      // 传空串表示清空(后端显式区分 undefined=不改 / ''=清空)
      phone: editTeacher!.phone.trim(),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-teachers'] });
      setEditTeacher(null);
    },
    onError: (e: unknown) => alert(errorDetail(e, '保存失败')),
  });

  const resetPwdMut = useMutation({
    mutationFn: (t: { id: number; username: string }) =>
      orgAdminApi.resetTeacherPassword(t.id).then(r => ({ ...r, username: t.username })),
    onSuccess: (r) => {
      // 复用初始密码弹窗:重置出来的新密码同样只显示这一次
      if (r.new_password) setIssued({ username: r.username, password: r.new_password });
      qc.invalidateQueries({ queryKey: ['org-teachers'] });
    },
    onError: (e: unknown) => alert(errorDetail(e, '重置密码失败')),
  });

  /** 点删除先走预检:有依赖时弹窗只显示原因和「去停用」,不给删除按钮 */
  const askDelete = async (t: { id: number; username: string; full_name?: string | null }) => {
    try {
      const r = await orgAdminApi.teacherDependents(t.id);
      setDelTarget({
        id: t.id,
        label: r.full_name || r.username,
        deletable: r.deletable,
        dependents: r.dependents,
      });
    } catch (e: unknown) {
      alert(errorDetail(e, '读取老师信息失败'));
    }
  };

  const handoverMut = useMutation({
    mutationFn: () => orgAdminApi.handoverTeacher(handover!.id, handover!.to),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['org-teachers'] });
      setHandover(null);
      const m = r.moved;
      // 逐项报清转了什么 —— 交接是不可逆的批量改动,只说"成功"没法核对
      const parts = [
        m.classes ? `${m.classes} 个班级` : '',
        m.book_assignments ? `${m.book_assignments} 条书本授权` : '',
        m.homework ? `${m.homework} 份作业` : '',
        m.invite_codes ? `${m.invite_codes} 个入班码` : '',
      ].filter(Boolean);
      let msg = `已交接给${r.to.name}：${parts.join('、') || '没有需要转交的内容'}`;
      if (m.dropped_duplicate_assignments) {
        msg += `\n\n其中 ${m.dropped_duplicate_assignments} 条书本授权因为${r.to.name}已经给同一个学生开过同一本书，`
          + '已合并为一条（学生能学的书没有变化）。';
      }
      msg += `\n\n现在可以删除「${r.from.name}」这个账号了。`;
      alert(msg);
    },
    onError: (e: unknown) => alert(errorDetail(e, '交接失败')),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => orgAdminApi.deleteTeacher(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['org-teachers'] });
      qc.invalidateQueries({ queryKey: ['org-info'] });
      setDelTarget(null);
    },
    // 409 的 detail 是对象(带 code/message/dependents),errorDetail 只认字符串
    onError: (e: unknown) => {
      const d = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
      const msg = typeof d === 'string' ? d
        : (d as { message?: string })?.message || '删除失败';
      alert(msg);
      setDelTarget(null);
      qc.invalidateQueries({ queryKey: ['org-teachers'] });
    },
  });

  const quotaPct = info ? quotaPercent(info.active_students, info.student_quota) : 0;
  // 学习卡余量: 后端已算好 cards_left(与发码闸门同源),这里不要自己减 ——
  // 两处各算一遍就会漂移成「首页说还剩 3 张、发码页说 0 张」
  const cardsLeft = info?.cards_left ?? 0;

  const managementLinks = [
    { icon: Users, title: '用户管理', desc: '本机构师生账号', path: '/admin/users', tone: 'blue' },
    { icon: GraduationCap, title: '教师管理', desc: '老师与名下班级', path: '/admin/teachers', tone: 'teal' },
    { icon: BarChart3, title: '班级数据', desc: '学习统计与名册', path: '/admin/classes', tone: 'indigo' },
    { icon: CalendarCheck, title: '签到与教学数据', desc: '全部班级签到 · 教师对比', path: '/admin/checkins', tone: 'green' },
    { icon: TrendingUp, title: '数据统计', desc: '本机构使用情况', path: '/admin/statistics', tone: 'green' },
    { icon: Trophy, title: '单词比赛', desc: '赛事排行与概览', path: '/admin/competition', tone: 'orange' },
    // 「发码上限=学生名额」已不成立(2026-09-11 卡额度与学生名额分账),别改回去
    { icon: Ticket, title: '兑换码', desc: '按学习卡额度发卡', path: '/admin/subscriptions', tone: 'amber' },
    { icon: BookOpen, title: '词库浏览', desc: '平台词库（只读）', path: '/admin/content', tone: 'violet' },
  ];

  return (
    <div className="admin-org-page min-h-screen px-4 py-5 sm:px-6 lg:px-10 lg:py-8">
      <div className="mx-auto max-w-[1280px]">
        <StaffWorkspaceHeader role="org" title={info?.name || '机构管理'} subtitle="本机构教师、学生与学习数据" icon={Building2} action={<div className="flex items-center gap-2"><label className="staff-org-logo-pick" title="更换机构 Logo">{info?.logo_url ? <img src={info.logo_url} alt="机构 Logo" /> : <Building2 className="h-4 w-4" />}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={onLogoPick} /></label><button type="button" className="admin-secondary-light admin-focus-ring inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold" onClick={() => setShowMyPassword(true)}><KeyRound className="h-3.5 w-3.5" />修改密码</button><button type="button" className="admin-secondary-light admin-focus-ring inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold" onClick={() => setInfoForm({ name: info?.name || '', contact_name: info?.contact_name || '', contact_phone: info?.contact_phone || '' })}><Edit3 className="h-3.5 w-3.5" />编辑机构</button></div>} />

        {/* 机构信息编辑表单 */}
        {infoForm && (
          <div className="bg-white rounded-xl border border-slate-200 p-4 mb-6 shadow-sm grid grid-cols-1 md:grid-cols-4 gap-3">
            <input className="border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30" placeholder="机构名称" value={infoForm.name}
                   onChange={e => setInfoForm({ ...infoForm, name: e.target.value })} />
            <input className="border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30" placeholder="联系人" value={infoForm.contact_name}
                   onChange={e => setInfoForm({ ...infoForm, contact_name: e.target.value })} />
            <input className="border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30" placeholder="联系电话" value={infoForm.contact_phone}
                   onChange={e => setInfoForm({ ...infoForm, contact_phone: e.target.value })} />
            <div className="flex gap-2">
              <button className="flex-1 py-2 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700" onClick={saveInfo}>保存</button>
              <button className="flex-1 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200" onClick={() => setInfoForm(null)}>取消</button>
            </div>
          </div>
        )}

        {/* 停用/到期提示 */}
        {info && info.status !== 'active' && (
          <div className="mb-6 flex items-start gap-3 rounded-2xl border border-[#f0cfc5] bg-[#fff2ed] p-4 font-semibold text-[#a64c35]">
            <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[#d96e50]" />机构服务已{info.status === 'suspended' ? '停用' : '到期'}，师生已无法登录使用，请联系平台续费恢复。
          </div>
        )}

        {/* 概况卡片。四张: md 两列(2+2)、lg 四列 —— 保持 md:grid-cols-3 会让
            第四张卡单独掉到第二行占满整宽,比学生名额那张还显眼 */}
        <div className="grid grid-cols-1 gap-4 mb-6 sm:grid-cols-2 lg:grid-cols-4">
          <div className="admin-org-card rounded-2xl border p-5">
            <div className="mb-1 flex items-center gap-2 text-sm text-slate-500"><Building2 className="h-4 w-4 text-[#397b9b]" />机构码（招生/测评链接用）</div>
            <div className="text-2xl font-mono font-bold text-[#FF6B35]">{info?.code || '—'}</div>
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              <button
                className="text-blue-500 hover:underline"
                onClick={() => info && navigator.clipboard?.writeText(info.code)}
              >复制机构码</button>
              <button
                className="text-blue-500 hover:underline"
                onClick={() => info && navigator.clipboard?.writeText(`${window.location.origin}/register?org=${info.code}`)}
              >复制注册链接</button>
              <button
                className="text-blue-500 hover:underline"
                onClick={() => info && navigator.clipboard?.writeText(`${window.location.origin}/assessment?org=${info.code}`)}
              >复制测评链接</button>
            </div>
            <div className="mt-1 text-[11px] text-gray-400">学生用注册链接注册即归属本机构;测评链接的线索进本机构线索池</div>
          </div>
          <div className="admin-org-card rounded-2xl border p-5">
            <div className="mb-1 flex items-center gap-2 text-sm text-slate-500"><Users className="h-4 w-4 text-[#397b9b]" />学生名额</div>
            <div className="text-2xl font-bold">{info?.active_students ?? '—'} <span className="text-base text-gray-400">/ {info?.student_quota ?? '—'}</span></div>
            <div className="mt-2">
              <QuotaBar active={info?.active_students ?? 0} quota={info?.student_quota ?? 1} />
            </div>
            {quotaPct >= 90 && <div className="mt-1 text-xs text-red-500">名额将满,联系平台扩容</div>}
            {/* 与学习卡分列两张卡还不够 —— 必须点明「名额不等于卡」,
                否则机构看到这里没满、发卡却被拦,只会以为系统坏了 */}
            <div className="mt-1 text-[11px] text-gray-400">同时在读人数;学生离班可腾出名额</div>
          </div>
          {/* 学习卡额度: 与学生名额是两笔账,所以单独一张卡而不是塞进上面那张。
              card_quota 恒有值(后端 NULL 时回退成 student_quota),判空只为首屏加载态 */}
          <div className="admin-org-card rounded-2xl border p-5">
            <div className="mb-1 flex items-center gap-2 text-sm text-slate-500">
              <Ticket className="h-4 w-4 text-[#397b9b]" />学习卡额度
            </div>
            <div className="text-2xl font-bold">
              {info?.cards_used ?? '—'}
              <span className="text-base text-gray-400"> / {info?.card_quota ?? '—'} 张</span>
            </div>
            <div className="mt-2">
              <QuotaBar active={info?.cards_used ?? 0} quota={info?.card_quota || 1} />
            </div>
            {info && (
              cardsLeft === 0 ? (
                <div className="mt-1 text-xs font-semibold text-red-500">
                  额度已用完,发不出新卡;已发出的不受影响
                </div>
              ) : cardsLeft <= 10 ? (
                <div className="mt-1 text-xs text-orange-500">
                  只剩 {cardsLeft} 张,建议联系平台续卡
                </div>
              ) : (
                <div className="mt-1 text-xs text-gray-400">还剩 {cardsLeft} 张</div>
              )
            )}
            <button
              className="mt-1 text-[11px] text-blue-500 hover:underline"
              onClick={() => navigate('/admin/subscriptions')}
            >去发卡 / 看明细</button>
          </div>
          <div className="admin-org-card rounded-2xl border p-5">
            <div className="mb-1 flex items-center gap-2 text-sm text-slate-500"><GraduationCap className="h-4 w-4 text-[#397b9b]" />老师</div>
            <div className="text-2xl font-bold">{info?.teacher_count ?? '—'} 人</div>
            {info?.expires_at && <div className="mt-2 text-xs text-gray-400">服务到期: {String(info.expires_at).slice(0, 10)}</div>}
          </div>
        </div>

        {/* 初始密码弹窗 */}
        {issued && (
          <InitialPasswordModal
            title="✅ 老师账号已创建"
            subtitle="请立即发给老师,初始密码仅显示这一次!"
            username={issued.username}
            password={issued.password}
            onClose={() => setIssued(null)}
          />
        )}

        {/* 管理功能导航: 复用平台管理端页面,数据由租户过滤自动限定在本机构 */}
        <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3">
          {managementLinks.map(({ icon: Icon, title, desc, path, tone }) => (
            <button
              key={path}
              onClick={() => navigate(path)}
              className="admin-org-card admin-focus-ring group rounded-2xl border p-4 text-left transition hover:-translate-y-0.5"
            >
              <span className={`admin-tool-icon admin-tool-icon-${tone} flex h-9 w-9 items-center justify-center rounded-lg`}><Icon className="h-4 w-4" /></span>
              <div className="mt-3 font-bold text-[#173047]">{title}</div>
              <div className="mt-1 text-xs text-slate-500">{desc}</div>
            </button>
          ))}
        </div>

        {/* 老师管理 */}
        <div className="admin-org-card rounded-2xl border p-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="flex items-center gap-2 text-lg font-bold text-[#173047]"><GraduationCap className="h-5 w-5 text-[#397b9b]" />老师账号</h2>
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="搜用户名/姓名/手机"
                  aria-label="搜索老师"
                  className="w-44 rounded-xl border border-slate-300 py-2 pl-8 pr-3 text-sm focus:border-[#3976a9] focus:outline-none focus:ring-2 focus:ring-[#3976a9]/15"
                />
              </div>
              <button
                onClick={() => setShowCreate(!showCreate)}
                className="admin-primary admin-focus-ring inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition"
              ><Plus className="h-4 w-4" />新建老师</button>
            </div>
          </div>

          {showCreate && (
            <div className="bg-[#f4f8fb] border border-[#dceaf3] rounded-lg p-4 mb-4 grid grid-cols-1 md:grid-cols-4 gap-3">
              <input className="border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30" placeholder="登录用户名 *" value={form.username}
                     onChange={e => setForm({ ...form, username: e.target.value })} />
              <input className="border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30" placeholder="姓名" value={form.full_name}
                     onChange={e => setForm({ ...form, full_name: e.target.value })} />
              <input className="border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30" placeholder="手机号" value={form.phone}
                     onChange={e => setForm({ ...form, phone: e.target.value })} />
              <button
                disabled={form.username.length < 3 || createMut.isPending}
                onClick={() => createMut.mutate()}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50"
              >{createMut.isPending ? '创建中…' : '确认创建'}</button>
            </div>
          )}

          <div className="overflow-x-auto"><table className="w-full min-w-[820px] whitespace-nowrap text-sm">
            <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-2">用户名</th>
                <th className="py-2">姓名</th>
                <th className="py-2">手机号</th>
                {/* 班级/学生数: 停用或删除前的影响面,不看这一列会误删带着学生的账号 */}
                <th className="py-2">名下</th>
                <th className="py-2">最近登录</th>
                <th className="py-2">状态</th>
                <th className="py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {(teachers || []).map(t => (
                <tr key={t.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                  <td className="py-2 font-mono">{t.username}</td>
                  <td className="py-2">{t.full_name || '—'}</td>
                  <td className="py-2 text-slate-500">{t.phone || '—'}</td>
                  <td className="py-2 text-slate-500">
                    {(t.class_count ?? 0) === 0 && (t.student_count ?? 0) === 0
                      ? <span className="text-slate-400">—</span>
                      : <span>{t.class_count ?? 0} 班 · {t.student_count ?? 0} 生</span>}
                  </td>
                  <td className="py-2 text-gray-400">{t.last_login ? String(t.last_login).slice(0, 16).replace('T', ' ') : '从未登录'}</td>
                  <td className="py-2">{t.is_active ? <span className="text-green-600">✅ 正常</span> : <span className="text-red-500">⛔ 停用</span>}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <button
                        className="text-[#3976a9] hover:underline"
                        onClick={() => setEditTeacher({
                          id: t.id, username: t.username,
                          full_name: t.full_name || '', phone: t.phone || '',
                        })}
                      >改资料</button>
                      <button
                        className="text-amber-600 hover:underline disabled:opacity-40"
                        disabled={resetPwdMut.isPending}
                        title="生成新密码,旧密码与已登录的设备立即失效"
                        onClick={() => {
                          if (!confirm(`给「${t.full_name || t.username}」重置密码?\n\n会生成一个新密码(只显示一次),他当前登录的设备会被强制退出。`)) return;
                          resetPwdMut.mutate({ id: t.id, username: t.username });
                        }}
                      >重置密码</button>
                      <button
                        className={t.is_active ? 'text-orange-500 hover:underline' : 'text-green-600 hover:underline'}
                        title={t.is_active ? '停用后他立刻登录不了,班级与学生不受影响' : undefined}
                        onClick={() => toggleMut.mutate(t.id)}
                      >{t.is_active ? '停用' : '恢复'}</button>
                      {/* 有班级的才给「转交」入口:零依赖的账号转交没有意义 */}
                      {((t.class_count ?? 0) > 0 || (t.student_count ?? 0) > 0) && (
                        <button
                          className="text-teal-600 hover:underline"
                          title="老师离职:把名下班级、授权、作业转交给另一位老师"
                          onClick={() => setHandover({
                            id: t.id, label: t.full_name || t.username, to: 0,
                          })}
                        >转交</button>
                      )}
                      <button
                        className="text-red-600 hover:underline"
                        title="仅能删除名下没有班级/学生/授权的账号"
                        onClick={() => askDelete(t)}
                      >删除</button>
                    </div>
                  </td>
                </tr>
              ))}
              {(teachers || []).length === 0 && (
                /* 列数改了 colSpan 必须跟着,否则空态文字不居中、右侧留白 */
                <tr><td colSpan={7} className="py-8 text-center text-gray-400">
                  {debouncedSearch ? `没有匹配「${debouncedSearch}」的老师` : '还没有老师,点右上角「新建老师」开始'}
                </td></tr>
              )}
            </tbody>
          </table></div>
        </div>

        {/* 改老师资料 */}
        {editTeacher && (
          <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/45 p-4" role="dialog" aria-modal="true"
               onMouseDown={e => { if (e.target === e.currentTarget) setEditTeacher(null); }}>
            <form className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6"
                  onSubmit={e => { e.preventDefault(); updateMut.mutate(); }}>
              <h3 className="text-lg font-bold text-slate-900">修改老师资料</h3>
              <p className="mt-1 font-mono text-sm text-slate-500">{editTeacher.username}</p>
              <label className="mt-4 block text-sm font-medium text-slate-700">
                姓名
                <input autoFocus type="text" value={editTeacher.full_name}
                       onChange={e => setEditTeacher({ ...editTeacher, full_name: e.target.value })}
                       className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-[#3976a9] focus:ring-4 focus:ring-[#3976a9]/10" />
              </label>
              <label className="mt-3 block text-sm font-medium text-slate-700">
                手机号（留空表示清除）
                <input type="text" value={editTeacher.phone}
                       onChange={e => setEditTeacher({ ...editTeacher, phone: e.target.value })}
                       className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm outline-none focus:border-[#3976a9] focus:ring-4 focus:ring-[#3976a9]/10" />
              </label>
              <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
                登录用户名不能改（它是老师的登录凭据）。要换登录名请停用这个账号、另建一个。
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" className="min-h-10 rounded-xl bg-slate-100 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-200"
                        onClick={() => setEditTeacher(null)}>取消</button>
                <button type="submit" disabled={!editTeacher.full_name.trim() || updateMut.isPending}
                        className="admin-primary admin-focus-ring inline-flex min-h-10 items-center rounded-xl px-4 text-sm font-semibold disabled:opacity-50">
                  {updateMut.isPending ? '保存中…' : '保存'}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* 删除确认: 有依赖时**不给**删除按钮,只给「去停用」——
            后端也会拒(409),但让按钮根本不出现比点了才报错好 */}
        {delTarget && (
          <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/45 p-4" role="dialog" aria-modal="true"
               onMouseDown={e => { if (e.target === e.currentTarget) setDelTarget(null); }}>
            <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6">
              <h3 className="text-lg font-bold text-slate-900">
                {delTarget.deletable ? '删除老师账号' : '这个账号不能删除'}
              </h3>
              <p className="mt-1 text-sm text-slate-500">{delTarget.label}</p>

              {delTarget.deletable ? (
                <p className="mt-4 rounded-xl bg-red-50 px-3 py-2 text-sm leading-6 text-red-700">
                  该账号名下没有班级、学生、书本授权和作业，可以安全删除。
                  <br />删除后不可恢复。
                </p>
              ) : (
                <>
                  <p className="mt-4 text-sm leading-6 text-slate-600">
                    他名下还挂着这些内容，删掉会让班级失去归属、学生的学习记录对不上人：
                  </p>
                  <ul className="mt-2 space-y-1 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                    {delTarget.dependents.classes > 0 && <li>· {delTarget.dependents.classes} 个班级</li>}
                    {delTarget.dependents.students > 0 && <li>· {delTarget.dependents.students} 名在读学生</li>}
                    {delTarget.dependents.book_assignments > 0 && <li>· {delTarget.dependents.book_assignments} 条学生书本授权（含已付费开通的）</li>}
                    {delTarget.dependents.homework > 0 && <li>· {delTarget.dependents.homework} 份作业</li>}
                  </ul>
                  <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                    <strong>多数情况用「停用」</strong>：他立刻登录不了，但班级、学生和已开通的书本都完整保留（老师离职、临时停权都够用）。
                    <br />
                    确实要删掉这个账号，就先<strong>转交</strong>给另一位老师，交接完再回来删。
                  </p>
                </>
              )}

              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button type="button" className="min-h-10 rounded-xl bg-slate-100 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-200"
                        onClick={() => setDelTarget(null)}>取消</button>
                {delTarget.deletable ? (
                  <button type="button" disabled={deleteMut.isPending}
                          className="min-h-10 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                          onClick={() => deleteMut.mutate(delTarget.id)}>
                    {deleteMut.isPending ? '删除中…' : '确认删除'}
                  </button>
                ) : (
                  <>
                    <button type="button"
                            className="min-h-10 rounded-xl bg-[#3976a9] px-4 text-sm font-semibold text-white hover:bg-[#2e628f]"
                            onClick={() => { setHandover({ id: delTarget.id, label: delTarget.label, to: 0 }); setDelTarget(null); }}>
                      先转交
                    </button>
                    <button type="button"
                            className="min-h-10 rounded-xl bg-orange-500 px-4 text-sm font-semibold text-white hover:bg-orange-600"
                            onClick={() => { toggleMut.mutate(delTarget.id); setDelTarget(null); }}>
                      改为停用
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 离职交接: 选接手人。候选只列**本机构在职的其他**老师 —— 交给停用的账号
            等于换个地方悬挂,后端也会拒 */}
        {handover && (
          <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/45 p-4" role="dialog" aria-modal="true"
               onMouseDown={e => { if (e.target === e.currentTarget) setHandover(null); }}>
            <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6">
              <h3 className="text-lg font-bold text-slate-900">转交给其他老师</h3>
              <p className="mt-1 text-sm text-slate-500">交出方：{handover.label}</p>

              {(() => {
                const candidates = (teachers || []).filter(x => x.id !== handover.id && x.is_active);
                if (candidates.length === 0) {
                  return (
                    <p className="mt-4 rounded-xl bg-amber-50 px-3 py-3 text-sm leading-6 text-amber-900">
                      本机构没有其他在职老师可以接手。请先新建一位老师（或恢复一个被停用的账号），再来转交。
                    </p>
                  );
                }
                return (
                  <>
                    <label className="mt-4 block text-sm font-medium text-slate-700">
                      接手老师
                      <select value={handover.to || ''}
                              onChange={e => setHandover({ ...handover, to: Number(e.target.value) })}
                              className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm outline-none focus:border-[#3976a9] focus:ring-4 focus:ring-[#3976a9]/10">
                        <option value="">请选择…</option>
                        {candidates.map(x => (
                          <option key={x.id} value={x.id}>
                            {x.full_name || x.username}（现有 {x.class_count ?? 0} 班 · {x.student_count ?? 0} 生）
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                      会转交：<strong>班级</strong>（学生跟着班一起过去，学习记录和进度都不变）、
                      <strong>书本授权</strong>、<strong>作业</strong>、<strong>入班码</strong>。
                      <br />
                      不转交历史直播记录（那是一次性的，改归属会让回放对不上人）。
                      <br />
                      如果接手老师已经给同一个学生开过同一本书，两条授权会合并成一条，学生能学的书不变。
                      <br />
                      <strong>交接不可撤销</strong>，做完之后交出方就能删除了。
                    </div>
                  </>
                );
              })()}

              <div className="mt-5 flex justify-end gap-2">
                <button type="button" className="min-h-10 rounded-xl bg-slate-100 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-200"
                        onClick={() => setHandover(null)}>取消</button>
                <button type="button" disabled={!handover.to || handoverMut.isPending}
                        className="min-h-10 rounded-xl bg-[#3976a9] px-4 text-sm font-semibold text-white hover:bg-[#2e628f] disabled:opacity-50"
                        onClick={() => handoverMut.mutate()}>
                  {handoverMut.isPending ? '交接中…' : '确认交接'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 机构管理员改自己的密码 */}
        <ChangeMyPasswordModal isOpen={showMyPassword} onClose={() => setShowMyPassword(false)} />
      </div>
    </div>
  );
}
