/** 平台管理端 - 机构(加盟商)管理 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminOrgApi, Organization, OrgManager } from '../api/organizations';
import { InitialPasswordModal, QuotaBar } from '../components/OrgWidgets';

const PLAN_LABELS: Record<string, string> = {
  trial: '体验', standard: '标准', county: '县级独家', city: '市级独家', headquarters: '总部直营',
};

export default function AdminOrganizations() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', plan: 'standard', student_quota: 100, contact_name: '', contact_phone: '' });
  // 新开管理员账号的初始密码(仅展示一次)
  const [issued, setIssued] = useState<{ username: string; password: string; orgName: string } | null>(null);
  // 管理员面板: 查看某机构的管理员账号列表
  const [managerPanel, setManagerPanel] = useState<{ org: Organization; managers: OrgManager[] } | null>(null);

  const openManagerPanel = async (org: Organization) => {
    try {
      const managers = await adminOrgApi.listOrgAdmins(org.id);
      setManagerPanel({ org, managers });
    } catch (e: any) {
      alert(e?.response?.data?.detail || '获取管理员列表失败');
    }
  };

  const resetManagerPwd = async (m: OrgManager, orgName: string) => {
    if (!window.confirm(`重置「${m.username}」的密码?旧密码将立即失效`)) return;
    try {
      // 不传密码=服务端生成(密码策略单点在后端,防混淆字符)
      const r = await adminOrgApi.resetUserPassword(m.id);
      if (r.new_password) setIssued({ username: m.username, password: r.new_password, orgName });
    } catch (e: any) {
      alert(e?.response?.data?.detail || '重置失败');
    }
  };

  const toggleManager = async (m: OrgManager, org: Organization) => {
    try {
      const r = await adminOrgApi.toggleUserStatus(m.id);
      // 响应已带新状态,本地更新即可,不必整表重拉
      setManagerPanel(p => p && {
        ...p,
        managers: p.managers.map(x => x.id === m.id ? { ...x, is_active: r.is_active } : x),
      });
    } catch (e: any) {
      alert(e?.response?.data?.detail || '操作失败');
    }
  };

  const { data: orgs, isLoading } = useQuery({ queryKey: ['admin-orgs'], queryFn: adminOrgApi.list });

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
    onError: (e: any) => alert(e?.response?.data?.detail || '创建失败'),
  });

  const toggleStatus = useMutation({
    mutationFn: (org: Organization) => adminOrgApi.update(org.id, {
      status: org.status === 'active' ? 'suspended' : 'active',
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-orgs'] }),
    onError: (e: any) => alert(e?.response?.data?.detail || '操作失败'),
  });

  const changeQuota = async (org: Organization) => {
    const v = window.prompt(`「${org.name}」学生配额(当前 ${org.student_quota}):`, String(org.student_quota));
    if (!v) return;
    const n = parseInt(v, 10);
    if (!n || n < 1) return alert('请输入正整数');
    await adminOrgApi.update(org.id, { student_quota: n });
    qc.invalidateQueries({ queryKey: ['admin-orgs'] });
  };

  const changeExpiry = async (org: Organization) => {
    const cur = org.expires_at ? String(org.expires_at).slice(0, 10) : '';
    const v = window.prompt(
      `「${org.name}」服务有效期至(YYYY-MM-DD,当天仍可用,次日起自动停服;清空=永不过期):`,
      cur,
    );
    if (v === null) return;
    const trimmed = v.trim();
    if (trimmed && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return alert('日期格式应为 YYYY-MM-DD');
    try {
      // 后端 datetime 字段: 传当天末尾时刻;清空走 clear_expires(datetime的null=未传不动)
      await adminOrgApi.update(org.id, trimmed
        ? { expires_at: `${trimmed}T23:59:59` }
        : { clear_expires: true });
      qc.invalidateQueries({ queryKey: ['admin-orgs'] });
    } catch (e: any) {
      alert(e?.response?.data?.detail || '设置失败');
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
    const username = window.prompt(`给「${org.name}」开机构管理员账号,输入用户名:`);
    if (!username) return;
    try {
      const r = await adminOrgApi.createOrgAdmin(org.id, { username });
      setIssued({ username: r.username, password: r.initial_password, orgName: org.name });
    } catch (e: any) {
      alert(e?.response?.data?.detail || '开户失败');
    }
  };

  return (
    <div className="min-h-screen bg-paper p-4 sm:p-6">
      <div className="max-w-6xl mx-auto">
        {/* 顶栏 */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/')} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-50">← 返回</button>
            <div><h1 className="text-2xl font-bold text-slate-800">🏢 机构管理</h1><p className="mt-1 text-sm text-slate-500">管理机构服务、账号与学生配额</p></div>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 rounded-lg text-white font-semibold bg-[#3976a9] hover:bg-[#2e628f] transition-colors"
          >
            ➕ 开通新机构
          </button>
        </div>

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
                <table className="w-full text-sm">
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
                          <button className={m.is_active ? 'text-red-500 hover:underline' : 'text-green-600 hover:underline'} onClick={() => toggleManager(m, managerPanel.org)}>
                            {m.is_active ? '停用' : '恢复'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <button className="mt-4 w-full py-2 rounded-xl bg-gray-100" onClick={() => setManagerPanel(null)}>关闭</button>
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
        {isLoading ? (
          <div className="text-center py-12 text-gray-400">加载中…</div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
            <div className="sm:hidden space-y-3 p-3">
              {(orgs || []).map(org => (
                <article key={org.id} className="rounded-lg border border-slate-200 p-3">
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
                    <div className="col-span-2 flex items-center gap-2">学生 <span className="font-medium text-slate-700">{org.active_students}/{org.student_quota >= 999999 ? '∞' : org.student_quota}</span>{org.student_quota < 999999 && <QuotaBar active={org.active_students} quota={org.student_quota} className="w-20" />}</div>
                  </div>
                  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2 border-t border-slate-100 pt-3 text-xs font-semibold">
                    <button className="text-blue-600" onClick={() => issueAdmin(org)}>开管理员</button>
                    <button className="text-teal-600" onClick={() => openManagerPanel(org)}>管理员</button>
                    <button className="text-orange-600" onClick={() => changeQuota(org)}>改配额</button>
                    {org.id !== 1 && <button className="text-purple-600" onClick={() => changeExpiry(org)}>有效期</button>}
                    {org.id !== 1 && <button className={org.status === 'active' ? 'text-red-600' : 'text-emerald-600'} onClick={() => { if (org.status === 'active' && !window.confirm(`确认停用「${org.name}」?该机构师生将无法使用系统`)) return; toggleStatus.mutate(org); }}>{org.status === 'active' ? '停用' : '恢复'}</button>}
                  </div>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[880px] whitespace-nowrap text-sm">
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
                      <td className="px-4 py-3">{PLAN_LABELS[org.plan] || org.plan}</td>
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
                      <td className="px-4 py-3 space-x-2 whitespace-nowrap">
                        <button className="text-blue-500 hover:underline" onClick={() => issueAdmin(org)}>开管理员</button>
                        <button className="text-teal-600 hover:underline" onClick={() => openManagerPanel(org)}>管理员</button>
                        <button className="text-orange-500 hover:underline" onClick={() => changeQuota(org)}>改配额</button>
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
                      </td>
                    </tr>
                ))}
              </tbody>
            </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
