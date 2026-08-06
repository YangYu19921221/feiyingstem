/** 平台管理端 - 机构(加盟商)管理 */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminOrgApi, Organization, OrgManager, TrialProvisionResult } from '../api/organizations';
import { InitialPasswordModal, QuotaBar } from '../components/OrgWidgets';
import TrialAccountsModal from '../components/TrialAccountsModal';
import { Building2, Gift, Plus, X, Check } from 'lucide-react';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import { toast } from '../components/Toast';

const PLAN_LABELS: Record<string, string> = {
  trial: '体验', standard: '标准', county: '县级独家', city: '市级独家', headquarters: '总部直营',
};

export default function AdminOrganizations() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', plan: 'standard', student_quota: 100, contact_name: '', contact_phone: '' });
  // 新开管理员账号的初始密码(仅展示一次)
  const [issued, setIssued] = useState<{ username: string; password: string; orgName: string } | null>(null);
  // 管理员面板: 查看某机构的管理员账号列表
  const [managerPanel, setManagerPanel] = useState<{ org: Organization; managers: OrgManager[] } | null>(null);
  // 一键开体验账号
  const [showTrial, setShowTrial] = useState(false);
  const [trialForm, setTrialForm] = useState({ name: '', prefix: '', days: 14, student_quota: 20, contact_name: '' });
  const [trialResult, setTrialResult] = useState<TrialProvisionResult | null>(null);
  const [orgDialog, setOrgDialog] = useState<
    | { kind: 'quota' | 'expiry' | 'admin'; org: Organization; value: string }
    | null
  >(null);

  const errorText = (e: unknown, fallback: string) => {
    const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
    return typeof detail === 'string' ? detail : fallback;
  };

  const trialMut = useMutation({
    mutationFn: () => adminOrgApi.provisionTrial({
      name: trialForm.name || undefined,
      prefix: trialForm.prefix || undefined,
      days: trialForm.days,
      student_quota: trialForm.student_quota,
      contact_name: trialForm.contact_name || undefined,
    }),
    onSuccess: (r) => {
      setTrialResult(r);
      setShowTrial(false);
      setTrialForm({ name: '', prefix: '', days: 14, student_quota: 20, contact_name: '' });
      qc.invalidateQueries({ queryKey: ['admin-orgs'] });
    },
    onError: (e: unknown) => toast.error(errorText(e, '开通失败')),
  });

  const openManagerPanel = async (org: Organization) => {
    try {
      const managers = await adminOrgApi.listOrgAdmins(org.id);
      setManagerPanel({ org, managers });
    } catch (e: unknown) {
      toast.error(errorText(e, '获取管理员列表失败'));
    }
  };

  const resetManagerPwd = async (m: OrgManager, orgName: string) => {
    if (!window.confirm(`重置「${m.username}」的密码?旧密码将立即失效`)) return;
    try {
      // 不传密码=服务端生成(密码策略单点在后端,防混淆字符)
      const r = await adminOrgApi.resetUserPassword(m.id);
      if (r.new_password) setIssued({ username: m.username, password: r.new_password, orgName });
    } catch (e: unknown) {
      toast.error(errorText(e, '重置失败'));
    }
  };

  const toggleManager = async (m: OrgManager) => {
    try {
      const r = await adminOrgApi.toggleUserStatus(m.id);
      // 响应已带新状态,本地更新即可,不必整表重拉
      setManagerPanel(p => p && {
        ...p,
        managers: p.managers.map(x => x.id === m.id ? { ...x, is_active: r.is_active } : x),
      });
      toast.success(r.is_active ? '管理员已恢复' : '管理员已停用');
    } catch (e: unknown) {
      toast.error(errorText(e, '操作失败'));
    }
  };

  const { data: orgs, isLoading } = useQuery({ queryKey: ['admin-orgs'], queryFn: adminOrgApi.list });

  const orgSummary = useMemo(() => {
    const items = orgs || [];
    return {
      total: items.length,
      active: items.filter((org) => org.status === 'active').length,
      teachers: items.reduce((sum, org) => sum + (org.teacher_count || 0), 0),
      students: items.reduce((sum, org) => sum + (org.active_students || 0), 0),
    };
  }, [orgs]);

  const createMut = useMutation({
    mutationFn: () => adminOrgApi.create({
      name: form.name, code: form.code || undefined, plan: form.plan,
      student_quota: form.student_quota,
      contact_name: form.contact_name || undefined, contact_phone: form.contact_phone || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-orgs'] });
      setShowCreate(false);
      setForm({ name: '', code: '', plan: 'standard', student_quota: 100, contact_name: '', contact_phone: '' });
    },
    onError: (e: unknown) => toast.error(errorText(e, '创建失败')),
  });

  const toggleStatus = useMutation({
    mutationFn: (org: Organization) => adminOrgApi.update(org.id, {
      status: org.status === 'active' ? 'suspended' : 'active',
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-orgs'] }),
    onError: (e: unknown) => toast.error(errorText(e, '操作失败')),
  });

  const changeQuota = async (org: Organization) => {
    setOrgDialog({ kind: 'quota', org, value: String(org.student_quota) });
  };

  const submitOrgDialog = async () => {
    if (!orgDialog) return;
    const { kind, org, value } = orgDialog;
    const trimmed = value.trim();
    if (kind === 'quota') {
      const n = Number(trimmed);
      if (!Number.isInteger(n) || n < 1) {
        toast.warning('请输入大于 0 的整数配额');
        return;
      }
      try {
        await adminOrgApi.update(org.id, { student_quota: n });
        await qc.invalidateQueries({ queryKey: ['admin-orgs'] });
        toast.success('学生配额已更新');
        setOrgDialog(null);
      } catch (e: unknown) {
        toast.error(errorText(e, '配额更新失败'));
      }
      return;
    }
    if (kind === 'expiry') {
      if (trimmed && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        toast.warning('日期格式应为 YYYY-MM-DD');
        return;
      }
      try {
        await adminOrgApi.update(org.id, trimmed ? { expires_at: `${trimmed}T23:59:59` } : { clear_expires: true });
        await qc.invalidateQueries({ queryKey: ['admin-orgs'] });
        toast.success(trimmed ? '有效期已更新' : '已设为永不过期');
        setOrgDialog(null);
      } catch (e: unknown) {
        toast.error(errorText(e, '设置有效期失败'));
      }
      return;
    }
    if (!trimmed || !/^[a-zA-Z0-9_]{3,32}$/.test(trimmed)) {
      toast.warning('用户名需为 3-32 位英文、数字或下划线');
      return;
    }
    try {
      const r = await adminOrgApi.createOrgAdmin(org.id, { username: trimmed });
      setIssued({ username: r.username, password: r.initial_password, orgName: org.name });
      setOrgDialog(null);
      toast.success('机构管理员账号已创建');
    } catch (e: unknown) {
      toast.error(errorText(e, '开户失败'));
    }
  };

  /** 硬删机构: 输机构码确认(防点错行);正式机构须先停用,后端还有同样的闸 */
  const deleteOrg = async (org: Organization) => {
    if (org.status === 'active' && org.plan !== 'trial') {
      toast.warning('正式机构请先“停用”再删除；体验机构可直接删除');
      return;
    }
    const typed = window.prompt(
      `⚠️ 永久删除「${org.name}」!\n将连带删除该机构全部账号、班级和学习数据,不可恢复。\n\n确认请输入机构码: ${org.code}`,
    );
    if (typed === null) return;
    if (typed.trim().toUpperCase() !== org.code) return toast.warning('机构码不一致，已取消');
    try {
      const r = await adminOrgApi.deleteOrg(org.id, org.code);
      toast.success(`已删除「${r.org_name}」（含 ${r.users_removed} 个账号）`);
      qc.invalidateQueries({ queryKey: ['admin-orgs'] });
    } catch (e: unknown) {
      toast.error(errorText(e, '删除失败'));
    }
  };

  const changeExpiry = async (org: Organization) => {
    const cur = org.expires_at ? String(org.expires_at).slice(0, 10) : '';
    setOrgDialog({ kind: 'expiry', org, value: cur });
  };

  /** 内容授权模式切换: assigned(逐本分配) ⇄ all_books(全托,书本全开放) */
  const toggleAccessMode = async (org: Organization) => {
    const next = org.access_mode === 'all_books' ? 'assigned' : 'all_books';
    const msg = next === 'all_books'
      ? `切换「${org.name}」为全托模式?\n\n按服务有效期 + 学生名额计费,该机构学生无需逐本分配,全部单词本立即开放。\n老师已做的单元级分配仍然生效(可作教学管控)。`
      : `切换「${org.name}」回逐本分配模式?\n\n学生将只能学老师分配过/兑换过的单词本,未分配的书立即锁定。`;
    if (!window.confirm(msg)) return;
    try {
      await adminOrgApi.update(org.id, { access_mode: next });
      await qc.invalidateQueries({ queryKey: ['admin-orgs'] });
      toast.success(next === 'all_books' ? '已切换为全托模式(书本全开放)' : '已切换回逐本分配模式');
    } catch (e: unknown) {
      toast.error(errorText(e, '切换授权模式失败'));
    }
  };

  /** 到期状态: null=有效 */
  const expiryBadge = (org: Organization) => {
    if (!org.expires_at) return null;
    const days = Math.floor((new Date(String(org.expires_at)).getTime() - Date.now()) / 86400000);
    if (days < 0) return <span className="ml-1 text-xs text-red-500">已到期</span>;
    if (days <= 14) return <span className="ml-1 text-xs text-orange-500">剩{days + 1}天</span>;
    return null;
  };

  const issueAdmin = async (org: Organization) => {
    setOrgDialog({ kind: 'admin', org, value: '' });
  };

  return (
    <div className="admin-legacy-page admin-org-page min-h-screen">
      <StaffWorkspaceHeader
        role="admin"
        title="机构管理"
        subtitle="管理机构服务、账号与学生配额"
        icon={Building2}
      />

      <div className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6 lg:px-10 lg:py-8">

        <section className="admin-org-toolbar" aria-label="机构操作">
          <div className="admin-org-toolbar-copy">
            <strong>机构工作区</strong>
            <span>新增机构或快速生成一套体验账号，其他运营动作在机构目录中完成。</span>
          </div>
          <div className="admin-org-toolbar-actions">
            <button type="button" onClick={() => { setShowTrial(true); setShowCreate(false); }} className="admin-primary admin-focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition"><Gift className="h-4 w-4" />一键开体验账号</button>
            <button type="button" onClick={() => { setShowCreate(true); setShowTrial(false); }} className="admin-secondary-light admin-focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition"><Plus className="h-4 w-4" />开通新机构</button>
          </div>
        </section>

        <section className="admin-org-overview" aria-labelledby="admin-org-overview-title">
          <div className="admin-org-overview-main">
            <span className="admin-org-overview-icon" aria-hidden="true"><Building2 className="h-6 w-6" /></span>
            <div>
              <h2 id="admin-org-overview-title">机构运营</h2>
              <p>集中查看机构状态、师生规模与服务配额，优先处理需要跟进的机构。</p>
            </div>
          </div>
          <div className="admin-org-overview-stats" aria-label="机构概览">
            <div><strong>{orgSummary.total}</strong><span>机构</span></div>
            <div><strong>{orgSummary.active}</strong><span>正常运行</span></div>
            <div><strong>{orgSummary.teachers}</strong><span>教师</span></div>
            <div><strong>{orgSummary.students}</strong><span>活跃学生</span></div>
          </div>
        </section>

        {orgDialog && (
          <div className="fixed inset-0 z-[70] grid place-items-center bg-slate-950/45 p-4" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) setOrgDialog(null); }}>
            <form className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl sm:p-6" onSubmit={(e) => { e.preventDefault(); void submitOrgDialog(); }}>
              <div className="mb-5 flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-slate-400">机构操作</p>
                  <h2 className="mt-1 text-lg font-bold text-slate-900">{orgDialog.kind === 'quota' ? '调整学生配额' : orgDialog.kind === 'expiry' ? '设置服务有效期' : '开通机构管理员'}</h2>
                  <p className="mt-1 text-sm text-slate-500">{orgDialog.org.name}</p>
                </div>
                <button type="button" className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => setOrgDialog(null)} aria-label="关闭"><X className="h-4 w-4" /></button>
              </div>
              <label className="block text-sm font-medium text-slate-700">
                {orgDialog.kind === 'quota' ? '学生名额' : orgDialog.kind === 'expiry' ? '有效期（留空表示永不过期）' : '登录用户名'}
                <input autoFocus type={orgDialog.kind === 'quota' ? 'number' : orgDialog.kind === 'expiry' ? 'date' : 'text'} min={orgDialog.kind === 'quota' ? 1 : undefined} value={orgDialog.value} onChange={(e) => setOrgDialog({ ...orgDialog, value: e.target.value })} placeholder={orgDialog.kind === 'admin' ? '例如：hangzhou_admin' : undefined} className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm text-slate-900 outline-none transition focus:border-[#3976a9] focus:ring-4 focus:ring-[#3976a9]/10" />
              </label>
              <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">{orgDialog.kind === 'quota' ? '配额立即影响该机构可用的学生账号数量。' : orgDialog.kind === 'expiry' ? '到期后机构会自动停用，账号无法继续登录。' : '初始密码只展示一次，请在弹窗中复制并安全转交。'}</p>
              <div className="mt-5 flex justify-end gap-2">
                <button type="button" className="min-h-10 rounded-xl bg-slate-100 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-200" onClick={() => setOrgDialog(null)}>取消</button>
                <button type="submit" className="admin-primary admin-focus-ring inline-flex min-h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold"><Check className="h-4 w-4" />确认</button>
              </div>
            </form>
          </div>
        )}

        {/* 初始密码弹窗(仅展示一次) */}
        {issued && (
          <InitialPasswordModal
            title="✅ 账号密码已就绪"
            subtitle={`「${issued.orgName}」— 请立即复制发给对方,密码仅显示这一次!`}
            username={issued.username}
            password={issued.password}
            onClose={() => setIssued(null)}
          />
        )}

        {/* 机构管理员面板(密码弹窗 z-50 天然盖在面板 z-40 之上,无需状态耦合) */}
        {managerPanel && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40" onClick={() => setManagerPanel(null)}>
            <div className="bg-white rounded-xl border border-slate-200 p-5 sm:p-6 max-w-lg w-full mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-1">👤 「{managerPanel.org.name}」的管理员</h3>
              <p className="text-xs text-gray-400 mb-4">密码加密存储无法查看,可一键重置生成新密码(改用户名去"用户管理"页)</p>
              {managerPanel.managers.length === 0 ? (
                <div className="py-6 text-center text-gray-400 text-sm">还没有管理员,先在机构列表点「开管理员」</div>
              ) : (
                <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="py-2">账号</th><th className="py-2">姓名</th>
                      <th className="py-2">最近登录</th><th className="py-2">状态</th><th className="py-2">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {managerPanel.managers.map(m => (
                      <tr key={m.id} className="border-b last:border-0">
                        <td className="py-2 font-mono">{m.username}</td>
                        <td className="py-2">{m.full_name || '—'}</td>
                        <td className="py-2 text-gray-400 text-xs">{m.last_login ? String(m.last_login).slice(0, 16).replace('T', ' ') : '从未登录'}</td>
                        <td className="py-2">{m.is_active ? '✅' : '⛔'}</td>
                        <td className="py-2 space-x-2 whitespace-nowrap">
                          <button className="text-orange-500 hover:underline" onClick={() => resetManagerPwd(m, managerPanel.org.name)}>重置密码</button>
                          <button className={m.is_active ? 'text-red-500 hover:underline' : 'text-green-600 hover:underline'} onClick={() => toggleManager(m)}>
                            {m.is_active ? '停用' : '恢复'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              )}
              <button className="mt-4 w-full py-2 rounded-xl bg-gray-100" onClick={() => setManagerPanel(null)}>关闭</button>
            </div>
          </div>
        )}

        {/* 体验账号结果(纯文本,可整段复制转发) */}
        {trialResult && (
          <TrialAccountsModal
            result={trialResult}
            siteUrl={window.location.origin}
            onClose={() => setTrialResult(null)}
          />
        )}

        {/* 一键开体验账号 */}
        {showTrial && (
          <div className="mb-6 rounded-xl border border-orange-200 bg-orange-50/40 p-5 shadow-sm">
            <h3 className="font-bold text-slate-800">🎁 一键开体验账号</h3>
            <p className="mt-1 mb-3 text-xs text-slate-500">
              自动建独立体验机构 + 机构管理端/教师端/学生端三个账号 + 体验班级，
              学生默认开通全部平台词书。到期自动停服，三个账号共用一个密码（仅显示一次）。
              <b className="text-orange-600">每谈一家开一套</b>，账号前缀区分，谁在用一查就知道。
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              <label className="text-xs font-medium text-slate-500">
                机构名称
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#FF6B35]/30"
                  placeholder="留空自动生成" value={trialForm.name}
                  onChange={e => setTrialForm({ ...trialForm, name: e.target.value })}
                />
              </label>
              <label className="text-xs font-medium text-slate-500">
                账号前缀（英文）
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#FF6B35]/30"
                  placeholder="如 hangzhou → hangzhou_admin" value={trialForm.prefix}
                  onChange={e => setTrialForm({ ...trialForm, prefix: e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() })}
                />
              </label>
              <label className="text-xs font-medium text-slate-500">
                体验天数
                <select
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#FF6B35]/30"
                  value={trialForm.days}
                  onChange={e => setTrialForm({ ...trialForm, days: parseInt(e.target.value, 10) })}
                >
                  {[3, 7, 14, 30, 60, 90].map(d => <option key={d} value={d}>{d} 天</option>)}
                </select>
              </label>
              <label className="text-xs font-medium text-slate-500">
                学生名额
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#FF6B35]/30"
                  type="number" min={1} max={500} value={trialForm.student_quota}
                  onChange={e => setTrialForm({ ...trialForm, student_quota: parseInt(e.target.value || '0', 10) })}
                />
              </label>
              <label className="text-xs font-medium text-slate-500">
                对接人（备注用）
                <input
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-[#FF6B35]/30"
                  placeholder="如 杭州张老板" value={trialForm.contact_name}
                  onChange={e => setTrialForm({ ...trialForm, contact_name: e.target.value })}
                />
              </label>
            </div>
            <div className="mt-3 flex gap-2">
              <button
                disabled={trialMut.isPending || trialForm.student_quota < 1}
                onClick={() => trialMut.mutate()}
                className="rounded-lg bg-[#FF6B35] px-4 py-2 font-semibold text-white transition hover:bg-[#e95d2c] disabled:opacity-50"
              >
                {trialMut.isPending ? '开通中…' : '确认开通'}
              </button>
              <button onClick={() => setShowTrial(false)} className="rounded-lg bg-gray-200 px-4 py-2 font-semibold text-slate-600">取消</button>
            </div>
          </div>
        )}

        {/* 开通表单 */}
        {showCreate && (
          <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6 shadow-sm">
            <h3 className="font-bold mb-3">开通新机构</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              <input className="border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30" placeholder="机构名称 *" value={form.name}
                     onChange={e => setForm({ ...form, name: e.target.value })} />
              <input className="border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30" placeholder="机构码(留空自动生成)" value={form.code}
                     onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} />
              <select className="border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30" value={form.plan}
                      onChange={e => setForm({ ...form, plan: e.target.value })}>
                <option value="trial">体验档</option>
                <option value="standard">标准档</option>
                <option value="county">县级独家</option>
                <option value="city">市级独家</option>
              </select>
              <input className="border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30" type="number" placeholder="学生配额" value={form.student_quota}
                     onChange={e => setForm({ ...form, student_quota: parseInt(e.target.value || '0', 10) })} />
              <input className="border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30" placeholder="联系人" value={form.contact_name}
                     onChange={e => setForm({ ...form, contact_name: e.target.value })} />
              <input className="border border-slate-300 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30" placeholder="联系电话" value={form.contact_phone}
                     onChange={e => setForm({ ...form, contact_phone: e.target.value })} />
            </div>
            <div className="mt-3 flex gap-2">
              <button
                disabled={!form.name || createMut.isPending}
                onClick={() => createMut.mutate()}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white font-semibold hover:bg-emerald-700 disabled:opacity-50"
              >
                {createMut.isPending ? '开通中…' : '确认开通'}
              </button>
              <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-xl bg-gray-200">取消</button>
            </div>
          </div>
        )}

        {/* 机构列表 */}
        <section className="admin-org-list-shell" aria-labelledby="admin-org-list-title">
          <div className="admin-org-list-heading">
            <div>
              <h2 id="admin-org-list-title">机构目录</h2>
              <p>每家机构的服务档位、师生用量和可执行操作</p>
            </div>
            <span>{orgSummary.total} 家机构</span>
          </div>
          {isLoading ? (
            <div className="admin-org-list-loading" role="status">加载机构目录…</div>
          ) : (
            <div className="admin-org-list-content">
            {(orgs || []).length === 0 ? (
              <div className="admin-org-empty">
                <Building2 className="h-8 w-8" aria-hidden="true" />
                <strong>还没有机构</strong>
                <span>先开通一家机构，机构账号和配额会在这里集中管理。</span>
              </div>
            ) : <>
            <div className="admin-org-mobile-list sm:hidden">
              {(orgs || []).map(org => (
                <article key={org.id} className="admin-org-mobile-card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      {org.logo_url ? <img src={org.logo_url} alt="" className="h-7 w-7 shrink-0 rounded object-cover" /> : <span className="text-lg">🏫</span>}
                      <div className="min-w-0"><div className="truncate font-bold text-slate-800">{org.name}</div><div className="font-mono text-xs text-slate-500">{org.code}</div></div>
                    </div>
                    {org.status === 'active' ? <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">正常</span> : <span className="shrink-0 rounded-full bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-700">已停用</span>}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500">
                    <div>档位 <span className="font-medium text-slate-700">{PLAN_LABELS[org.plan] || org.plan}</span></div>
                    <div>老师 <span className="font-medium text-slate-700">{org.teacher_count} 人</span></div>
                    <div>授权 <span className={`font-medium ${org.access_mode === 'all_books' ? 'text-amber-600' : 'text-slate-700'}`}>{org.access_mode === 'all_books' ? '全托·书本全开放' : '逐本分配'}</span></div>
                    <div className="col-span-2 flex items-center gap-2">学生 <span className="font-medium text-slate-700">{org.active_students}/{org.student_quota >= 999999 ? '∞' : org.student_quota}</span>{org.student_quota < 999999 && <QuotaBar active={org.active_students} quota={org.student_quota} className="w-20" />}</div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2 border-t border-slate-100 pt-3 text-xs font-semibold">
                    <button className="text-blue-600" onClick={() => issueAdmin(org)}>开管理员</button>
                    <button className="text-teal-600" onClick={() => openManagerPanel(org)}>管理员</button>
                    <button className="text-orange-600" onClick={() => changeQuota(org)}>改配额</button>
                    <button className="text-amber-600" onClick={() => toggleAccessMode(org)}>{org.access_mode === 'all_books' ? '改逐本分配' : '改全托'}</button>
                    {org.id !== 1 && <button className="text-purple-600" onClick={() => changeExpiry(org)}>有效期</button>}
                    {org.id !== 1 && <button className={org.status === 'active' ? 'text-red-600' : 'text-emerald-600'} onClick={() => { if (org.status === 'active' && !window.confirm(`确认停用「${org.name}」?该机构师生将无法使用系统`)) return; toggleStatus.mutate(org); }}>{org.status === 'active' ? '停用' : '恢复'}</button>}
                    {org.id !== 1 && <button className="text-red-700" onClick={() => deleteOrg(org)}>删除</button>}
                  </div>
                </article>
              ))}
            </div>
            <div className="admin-org-table-scroll hidden overflow-x-auto sm:block">
            <table className="admin-org-table w-full min-w-[920px] whitespace-nowrap text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-slate-600">
                  <th className="px-4 py-3">机构</th>
                  <th className="px-4 py-3">机构码</th>
                  <th className="px-4 py-3">档位</th>
                  <th className="px-4 py-3">学生(用量/配额)</th>
                  <th className="px-4 py-3">老师</th>
                  <th className="px-4 py-3">状态</th>
                  <th className="px-4 py-3">操作</th>
                </tr>
              </thead>
              <tbody>
                {(orgs || []).map(org => (
                  <tr key={org.id} className="border-t border-slate-100 hover:bg-slate-50/70">
                      <td className="px-4 py-3 font-bold">
                        <span className="inline-flex items-center gap-2">
                          {org.logo_url
                            ? <img src={org.logo_url} alt="" className="w-6 h-6 rounded object-cover" />
                            : <span>🏫</span>}
                          {org.name}{org.id === 1 && <span className="ml-1 text-xs text-orange-400">(直营)</span>}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono">{org.code}</td>
                      <td className="px-4 py-3">
                        {PLAN_LABELS[org.plan] || org.plan}
                        {org.access_mode === 'all_books' && (
                          <span className="ml-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">全托</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span>{org.active_students}/{org.student_quota >= 999999 ? '∞' : org.student_quota}</span>
                          {org.student_quota < 999999 && (
                            <QuotaBar active={org.active_students} quota={org.student_quota} className="w-16" />
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">{org.teacher_count}</td>
                      <td className="px-4 py-3">
                        {org.status === 'active'
                          ? <span className="text-green-600">✅ 正常</span>
                          : <span className="text-red-500">⛔ 已停用</span>}
                        {expiryBadge(org)}
                        {org.expires_at && (
                          <div className="text-[10px] text-gray-400">至 {String(org.expires_at).slice(0, 10)}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        <div className="flex min-w-[18rem] flex-wrap items-center gap-x-3 gap-y-1.5 text-sm font-medium">
                          <button className="text-blue-500 hover:underline" onClick={() => issueAdmin(org)}>开管理员</button>
                          <button className="text-teal-600 hover:underline" onClick={() => openManagerPanel(org)}>管理员</button>
                          <button className="text-orange-500 hover:underline" onClick={() => changeQuota(org)}>改配额</button>
                          <button className="text-amber-600 hover:underline" onClick={() => toggleAccessMode(org)}>{org.access_mode === 'all_books' ? '改逐本分配' : '改全托'}</button>
                          {org.id !== 1 && (
                            <button className="text-purple-500 hover:underline" onClick={() => changeExpiry(org)}>有效期</button>
                          )}
                          {org.id !== 1 && (
                            <button
                              className={org.status === 'active' ? 'text-red-500 hover:underline' : 'text-green-600 hover:underline'}
                              onClick={() => {
                                if (org.status === 'active' && !window.confirm(`确认停用「${org.name}」?该机构师生将无法使用系统`)) return;
                                toggleStatus.mutate(org);
                              }}
                            >
                              {org.status === 'active' ? '停用' : '恢复'}
                            </button>
                          )}
                          {org.id !== 1 && (
                            <button className="text-red-700 hover:underline" onClick={() => deleteOrg(org)}>删除</button>
                          )}
                        </div>
                      </td>
                    </tr>
                ))}
              </tbody>
            </table>
            </div>
            </>}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
