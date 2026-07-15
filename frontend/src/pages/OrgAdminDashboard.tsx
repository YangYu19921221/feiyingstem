/** 机构管理端 - 加盟商老板的控制台(org_admin 角色登录后的主页) */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { orgAdminApi } from '../api/organizations';
import { InitialPasswordModal, QuotaBar, quotaPercent } from '../components/OrgWidgets';

export default function OrgAdminDashboard() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ username: '', full_name: '', phone: '' });
  const [issued, setIssued] = useState<{ username: string; password: string } | null>(null);

  const { data: info } = useQuery({ queryKey: ['org-info'], queryFn: orgAdminApi.info });
  const { data: teachers } = useQuery({ queryKey: ['org-teachers'], queryFn: orgAdminApi.teachers });

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
    onError: (e: any) => alert(e?.response?.data?.detail || '创建失败'),
  });

  const toggleMut = useMutation({
    mutationFn: (id: number) => orgAdminApi.toggleTeacher(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['org-teachers'] }),
  });

  const logout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const quotaPct = info ? quotaPercent(info.active_students, info.student_quota) : 0;

  return (
    <div className="min-h-screen bg-[#FFF8F0] p-6">
      <div className="max-w-4xl mx-auto">
        {/* 顶栏 */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-800">🏫 {info?.name || '机构管理'}</h1>
          <button onClick={logout} className="text-sm text-gray-400 hover:text-gray-600">退出登录</button>
        </div>

        {/* 停用/到期提示 */}
        {info && info.status !== 'active' && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 mb-6 text-red-600 font-bold">
            ⛔ 机构服务已{info.status === 'suspended' ? '停用' : '到期'},师生已无法登录使用,请联系平台续费恢复。
          </div>
        )}

        {/* 概况卡片 */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-2xl p-5 shadow">
            <div className="text-sm text-gray-400 mb-1">📇 机构码(招生/测评链接用)</div>
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
          <div className="bg-white rounded-2xl p-5 shadow">
            <div className="text-sm text-gray-400 mb-1">👦 学生名额</div>
            <div className="text-2xl font-bold">{info?.active_students ?? '—'} <span className="text-base text-gray-400">/ {info?.student_quota ?? '—'}</span></div>
            <div className="mt-2">
              <QuotaBar active={info?.active_students ?? 0} quota={info?.student_quota ?? 1} />
            </div>
            {quotaPct >= 90 && <div className="mt-1 text-xs text-red-500">名额将满,联系平台扩容</div>}
          </div>
          <div className="bg-white rounded-2xl p-5 shadow">
            <div className="text-sm text-gray-400 mb-1">👨‍🏫 老师</div>
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
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
          {[
            { icon: '👥', title: '用户管理', desc: '本机构师生账号', path: '/admin/users' },
            { icon: '👨‍🏫', title: '教师管理', desc: '老师与名下班级', path: '/admin/teachers' },
            { icon: '📊', title: '班级数据', desc: '学习统计与名册', path: '/admin/classes' },
            { icon: '📈', title: '数据统计', desc: '本机构使用情况', path: '/admin/statistics' },
            { icon: '🏆', title: '单词比赛', desc: '赛事排行与概览', path: '/admin/competition' },
            { icon: '📚', title: '词库浏览', desc: '平台词库(只读)', path: '/admin/content' },
          ].map(card => (
            <button
              key={card.path}
              onClick={() => navigate(card.path)}
              className="bg-white rounded-2xl p-4 shadow text-left hover:shadow-md transition"
            >
              <div className="text-2xl">{card.icon}</div>
              <div className="font-bold mt-1">{card.title}</div>
              <div className="text-xs text-gray-400">{card.desc}</div>
            </button>
          ))}
        </div>

        {/* 老师管理 */}
        <div className="bg-white rounded-2xl shadow p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-lg">👨‍🏫 老师账号</h2>
            <button
              onClick={() => setShowCreate(!showCreate)}
              className="px-4 py-2 rounded-xl text-white font-bold bg-gradient-to-r from-[#FF6B35] to-[#FFD23F] shadow hover:opacity-90"
            >➕ 新建老师</button>
          </div>

          {showCreate && (
            <div className="bg-orange-50 rounded-xl p-4 mb-4 grid grid-cols-1 md:grid-cols-4 gap-3">
              <input className="border rounded-xl px-3 py-2" placeholder="登录用户名 *" value={form.username}
                     onChange={e => setForm({ ...form, username: e.target.value })} />
              <input className="border rounded-xl px-3 py-2" placeholder="姓名" value={form.full_name}
                     onChange={e => setForm({ ...form, full_name: e.target.value })} />
              <input className="border rounded-xl px-3 py-2" placeholder="手机号" value={form.phone}
                     onChange={e => setForm({ ...form, phone: e.target.value })} />
              <button
                disabled={form.username.length < 3 || createMut.isPending}
                onClick={() => createMut.mutate()}
                className="px-4 py-2 rounded-xl bg-[#5FD35F] text-white font-bold disabled:opacity-50"
              >{createMut.isPending ? '创建中…' : '确认创建'}</button>
            </div>
          )}

          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b">
                <th className="py-2">用户名</th>
                <th className="py-2">姓名</th>
                <th className="py-2">最近登录</th>
                <th className="py-2">状态</th>
                <th className="py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {(teachers || []).map(t => (
                <tr key={t.id} className="border-b last:border-0">
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
          </table>
        </div>
      </div>
    </div>
  );
}
