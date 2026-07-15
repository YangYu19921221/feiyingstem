/** 平台管理端 - 机构(加盟商)管理 */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { adminOrgApi, Organization } from '../api/organizations';

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
    <div className="min-h-screen bg-[#FFF8F0] p-6">
      <div className="max-w-6xl mx-auto">
        {/* 顶栏 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/')} className="text-2xl">←</button>
            <h1 className="text-2xl font-bold text-gray-800">🏢 机构管理</h1>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 rounded-xl text-white font-bold bg-gradient-to-r from-[#FF6B35] to-[#FFD23F] shadow hover:opacity-90"
          >
            ➕ 开通新机构
          </button>
        </div>

        {/* 初始密码弹窗(仅展示一次) */}
        {issued && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setIssued(null)}>
            <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-2">✅ 机构管理员账号已开通</h3>
              <p className="text-sm text-gray-500 mb-4">「{issued.orgName}」— 请立即复制发给加盟商,密码仅显示这一次!</p>
              <div className="bg-orange-50 rounded-xl p-4 font-mono text-sm space-y-1">
                <div>账号: <b>{issued.username}</b></div>
                <div>初始密码: <b className="text-[#FF6B35]">{issued.password}</b></div>
              </div>
              <button
                className="mt-4 w-full py-2 rounded-xl bg-[#FF6B35] text-white font-bold"
                onClick={() => { navigator.clipboard?.writeText(`账号:${issued.username} 密码:${issued.password}`); setIssued(null); }}
              >
                复制并关闭
              </button>
            </div>
          </div>
        )}

        {/* 开通表单 */}
        {showCreate && (
          <div className="bg-white rounded-2xl p-5 mb-6 shadow">
            <h3 className="font-bold mb-3">开通新机构</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              <input className="border rounded-xl px-3 py-2" placeholder="机构名称 *" value={form.name}
                     onChange={e => setForm({ ...form, name: e.target.value })} />
              <input className="border rounded-xl px-3 py-2" placeholder="机构码(留空自动生成)" value={form.code}
                     onChange={e => setForm({ ...form, code: e.target.value.toUpperCase() })} />
              <select className="border rounded-xl px-3 py-2" value={form.plan}
                      onChange={e => setForm({ ...form, plan: e.target.value })}>
                <option value="trial">体验档</option>
                <option value="standard">标准档</option>
                <option value="county">县级独家</option>
                <option value="city">市级独家</option>
              </select>
              <input className="border rounded-xl px-3 py-2" type="number" placeholder="学生配额" value={form.student_quota}
                     onChange={e => setForm({ ...form, student_quota: parseInt(e.target.value || '0', 10) })} />
              <input className="border rounded-xl px-3 py-2" placeholder="联系人" value={form.contact_name}
                     onChange={e => setForm({ ...form, contact_name: e.target.value })} />
              <input className="border rounded-xl px-3 py-2" placeholder="联系电话" value={form.contact_phone}
                     onChange={e => setForm({ ...form, contact_phone: e.target.value })} />
            </div>
            <div className="mt-3 flex gap-2">
              <button
                disabled={!form.name || createMut.isPending}
                onClick={() => createMut.mutate()}
                className="px-4 py-2 rounded-xl bg-[#5FD35F] text-white font-bold disabled:opacity-50"
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
          <div className="bg-white rounded-2xl shadow overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-orange-50 text-left text-gray-600">
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
                {(orgs || []).map(org => {
                  const pct = Math.min(100, Math.round(org.active_students / Math.max(1, org.student_quota) * 100));
                  return (
                    <tr key={org.id} className="border-t">
                      <td className="px-4 py-3 font-bold">{org.name}{org.id === 1 && <span className="ml-1 text-xs text-orange-400">(直营)</span>}</td>
                      <td className="px-4 py-3 font-mono">{org.code}</td>
                      <td className="px-4 py-3">{PLAN_LABELS[org.plan] || org.plan}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span>{org.active_students}/{org.student_quota >= 999999 ? '∞' : org.student_quota}</span>
                          {org.student_quota < 999999 && (
                            <div className="w-16 h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div className={`h-full ${pct >= 90 ? 'bg-red-400' : 'bg-[#5FD35F]'}`} style={{ width: `${pct}%` }} />
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">{org.teacher_count}</td>
                      <td className="px-4 py-3">
                        {org.status === 'active'
                          ? <span className="text-green-600">✅ 正常</span>
                          : <span className="text-red-500">⛔ 已停用</span>}
                      </td>
                      <td className="px-4 py-3 space-x-2 whitespace-nowrap">
                        <button className="text-blue-500 hover:underline" onClick={() => issueAdmin(org)}>开管理员</button>
                        <button className="text-orange-500 hover:underline" onClick={() => changeQuota(org)}>改配额</button>
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
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
