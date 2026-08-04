/** 机构管理端 - 加盟商老板的控制台(org_admin 角色登录后的主页) */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BarChart3, BookOpen, Building2, Edit3, GraduationCap, Plus, Ticket, Trophy, TrendingUp, Users } from 'lucide-react';
import { orgAdminApi } from '../api/organizations';
import { InitialPasswordModal, QuotaBar, quotaPercent } from '../components/OrgWidgets';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';

type ApiError = { response?: { data?: { detail?: string } } };
const errorDetail = (error: unknown, fallback: string) => (error as ApiError)?.response?.data?.detail || fallback;

export default function OrgAdminDashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ username: '', full_name: '', phone: '' });
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);

  const { data: info } = useQuery({ queryKey: ['org-info'], queryFn: orgAdminApi.info });
  const { data: teachers } = useQuery({ queryKey: ['org-teachers'], queryFn: orgAdminApi.teachers });

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
  });

  const quotaPct = info ? quotaPercent(info.active_students, info.student_quota) : 0;

  const managementLinks = [
    { icon: Users, title: '用户管理', desc: '本机构师生账号', path: '/admin/users', tone: 'blue' },
    { icon: GraduationCap, title: '教师管理', desc: '老师与名下班级', path: '/admin/teachers', tone: 'teal' },
    { icon: BarChart3, title: '班级数据', desc: '学习统计与名册', path: '/admin/classes', tone: 'indigo' },
    { icon: TrendingUp, title: '数据统计', desc: '本机构使用情况', path: '/admin/statistics', tone: 'green' },
    { icon: Trophy, title: '单词比赛', desc: '赛事排行与概览', path: '/admin/competition', tone: 'orange' },
    { icon: Ticket, title: '兑换码', desc: '发码上限=学生名额', path: '/admin/subscriptions', tone: 'amber' },
    { icon: BookOpen, title: '词库浏览', desc: '平台词库（只读）', path: '/admin/content', tone: 'violet' },
  ];

  return (
    <div className="admin-org-page min-h-screen px-4 py-5 sm:px-6 lg:px-10 lg:py-8">
      <div className="mx-auto max-w-[1280px]">
        <StaffWorkspaceHeader role="org" title={info?.name || '机构管理'} subtitle="本机构教师、学生与学习数据" icon={Building2} action={<div className="flex items-center gap-2"><label className="staff-org-logo-pick" title="更换机构 Logo">{info?.logo_url ? <img src={info.logo_url} alt="机构 Logo" /> : <Building2 className="h-4 w-4" />}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={onLogoPick} /></label><button type="button" className="admin-secondary-light admin-focus-ring inline-flex min-h-10 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold" onClick={() => setInfoForm({ name: info?.name || '', contact_name: info?.contact_name || '', contact_phone: info?.contact_phone || '' })}><Edit3 className="h-3.5 w-3.5" />编辑机构</button></div>} />

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

        {/* 概况卡片 */}
        <div className="grid grid-cols-1 gap-4 mb-6 md:grid-cols-3">
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
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="admin-primary admin-focus-ring inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition"
            ><Plus className="h-4 w-4" />新建老师</button>
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

          <div className="overflow-x-auto"><table className="w-full min-w-[620px] whitespace-nowrap text-sm">
            <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="py-2">用户名</th>
                <th className="py-2">姓名</th>
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
                  <td className="py-2 text-gray-400">{t.last_login ? String(t.last_login).slice(0, 16).replace('T', ' ') : '从未登录'}</td>
                  <td className="py-2">{t.is_active ? <span className="text-green-600">✅ 正常</span> : <span className="text-red-500">⛔ 停用</span>}</td>
                  <td className="py-2">
                    <button
                      className={t.is_active ? 'text-red-500 hover:underline' : 'text-green-600 hover:underline'}
                      onClick={() => toggleMut.mutate(t.id)}
                    >{t.is_active ? '停用' : '恢复'}</button>
                  </td>
                </tr>
              ))}
              {(teachers || []).length === 0 && (
                <tr><td colSpan={5} className="py-8 text-center text-gray-400">还没有老师,点右上角「新建老师」开始</td></tr>
              )}
            </tbody>
          </table></div>
        </div>
      </div>
    </div>
  );
}
