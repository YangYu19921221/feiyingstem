import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { admin } from '../api/admin';
import type { AdminTeacherListItem } from '../api/admin';
import { toast } from '../components/Toast';
import { getErrorMessage } from '../utils/errorMessage';

const AdminTeacherList = () => {
  const navigate = useNavigate();
  const [teachers, setTeachers] = useState<AdminTeacherListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTeacher, setNewTeacher] = useState({ username: '', email: '', full_name: '', password: '' });
  const [creating, setCreating] = useState(false);

  useEffect(() => { loadTeachers(); }, []);

  const loadTeachers = async () => {
    try {
      setLoading(true);
      const data = await admin.listTeachers();
      setTeachers(data);
    } catch {
      toast.error('加载教师列表失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!newTeacher.username || !newTeacher.email) {
      toast.warning('用户名和邮箱为必填项');
      return;
    }
    setCreating(true);
    try {
      const result = await admin.createTeacher(newTeacher);
      setShowCreateModal(false);
      setNewTeacher({ username: '', email: '', full_name: '', password: '' });
      await loadTeachers();
      alert(`教师创建成功！\n用户名: ${result.username}\n初始密码: ${result.initial_password}\n\n请妥善保存初始密码。`);
    } catch (err: any) {
      // 409 = 用户名/邮箱已存在；其他错误也按 detail 展示
      toast.error(getErrorMessage(err, '创建失败'));
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (t: AdminTeacherListItem) => {
    try {
      await admin.updateTeacher(t.id, { is_active: !t.is_active });
      await loadTeachers();
      toast.success(t.is_active ? '已禁用该教师' : '已启用该教师');
    } catch {
      toast.error('操作失败');
    }
  };

  const handleResetPassword = async (id: number) => {
    if (!confirm('确定要重置该教师的密码吗？')) return;
    try {
      const result = await admin.resetPassword(id);
      alert(`密码重置成功！\n新密码: ${result.new_password}\n\n请妥善保存新密码。`);
    } catch {
      toast.error('重置密码失败');
    }
  };

  const handleDelete = async (t: AdminTeacherListItem) => {
    if (!confirm(
      `确认删除教师「${t.username}${t.full_name ? ' / ' + t.full_name : ''}」？\n\n` +
      `仅当其名下没有班级和学生时才能删除；\n如有班级请先解散，有学生请先转移到其他教师。`
    )) return;
    try {
      await admin.deleteTeacher(t.id);
      toast.success('教师已删除');
      await loadTeachers();
    } catch (err: any) {
      toast.error(getErrorMessage(err, '删除失败'));
    }
  };

  return (
    <div className="min-h-screen bg-paper">
      <nav className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/dashboard')} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-slate-50">← 返回</button>
            <h1 className="text-xl font-bold text-gray-800">教师管理</h1>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="px-4 py-2 bg-[#3976a9] text-white rounded-lg hover:bg-[#2e628f] text-sm font-semibold"
          >
            + 新建教师
          </button>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm">
          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-orange-500 border-t-transparent"></div>
            </div>
          ) : (
            <>
            <div className="sm:hidden space-y-3 p-3">
              {teachers.length === 0 ? <div className="py-10 text-center text-sm text-slate-400">暂无教师数据</div> : teachers.map((t) => (
                <article key={t.id} className="rounded-lg border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate font-semibold text-slate-800">{t.full_name || t.username}</div><div className="truncate text-xs text-slate-500">{t.username} · {t.email}</div></div><span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${t.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{t.is_active ? '正常' : '禁用'}</span></div>
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500"><div>班级 <span className="font-semibold text-slate-700">{t.class_count}</span></div><div>学生 <span className="font-semibold text-slate-700">{t.student_count}</span></div></div>
                  <div className="mt-3 flex flex-wrap gap-x-3 gap-y-2 border-t border-slate-100 pt-3 text-xs font-semibold"><button onClick={() => navigate(`/admin/teachers/${t.id}`)} className="text-blue-600">详情</button><button onClick={() => handleToggleActive(t)} className="text-orange-600">{t.is_active ? '禁用' : '启用'}</button><button onClick={() => handleResetPassword(t.id)} className="text-purple-600">重置密码</button><button onClick={() => handleDelete(t)} className="text-red-600">删除</button></div>
                </article>
              ))}
            </div>
            <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[900px] whitespace-nowrap">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">用户名</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">姓名</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">邮箱</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">班级数</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">学生数</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">状态</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {teachers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-gray-400">暂无教师数据</td>
                  </tr>
                ) : teachers.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/70">
                    <td className="px-6 py-4 text-sm text-gray-900 font-medium">{t.username}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">{t.full_name || '-'}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{t.email}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">{t.class_count}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">{t.student_count}</td>
                    <td className="px-6 py-4 text-sm">
                      <span className={`px-2 py-1 rounded text-xs ${t.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {t.is_active ? '正常' : '禁用'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-sm text-right">
                      <div className="flex justify-end gap-3">
                        <button onClick={() => navigate(`/admin/teachers/${t.id}`)} className="text-blue-600 hover:text-blue-800">详情</button>
                        <button onClick={() => handleToggleActive(t)} className="text-orange-600 hover:text-orange-800">
                          {t.is_active ? '禁用' : '启用'}
                        </button>
                        <button onClick={() => handleResetPassword(t.id)} className="text-purple-600 hover:text-purple-800">重置密码</button>
                        <button onClick={() => handleDelete(t)} className="text-red-600 hover:text-red-800">删除</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            </>
          )}
        </div>
      </div>

      {showCreateModal && (
        <div className="fixed inset-0 bg-slate-950/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5 sm:p-6 w-full max-w-md shadow-xl">
            <h2 className="text-xl font-bold mb-4">新建教师</h2>
            <div className="space-y-4">
              <input
                type="text" placeholder="用户名 *"
                value={newTeacher.username}
                onChange={(e) => setNewTeacher({ ...newTeacher, username: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg"
              />
              <input
                type="email" placeholder="邮箱 *"
                value={newTeacher.email}
                onChange={(e) => setNewTeacher({ ...newTeacher, email: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg"
              />
              <input
                type="text" placeholder="姓名（可选）"
                value={newTeacher.full_name}
                onChange={(e) => setNewTeacher({ ...newTeacher, full_name: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg"
              />
              <input
                type="password" placeholder="密码（留空则自动生成）"
                value={newTeacher.password}
                onChange={(e) => setNewTeacher({ ...newTeacher, password: e.target.value })}
                className="w-full px-4 py-2 border rounded-lg"
              />
            </div>
            <div className="flex gap-4 mt-6">
              <button
                onClick={handleCreate}
                disabled={creating}
                className="flex-1 px-4 py-2 bg-[#3976a9] text-white rounded-lg hover:bg-[#2e628f] disabled:opacity-50"
              >
                {creating ? '创建中...' : '创建'}
              </button>
              <button
                onClick={() => { setShowCreateModal(false); setNewTeacher({ username: '', email: '', full_name: '', password: '' }); }}
                className="flex-1 px-4 py-2 border rounded-lg hover:bg-gray-50"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminTeacherList;
