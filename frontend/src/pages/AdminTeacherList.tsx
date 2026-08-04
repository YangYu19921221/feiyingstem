import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { admin } from '../api/admin';
import { resetTeacherCoinPin } from '../api/coins';
import type { AdminTeacherListItem } from '../api/admin';
import { toast } from '../components/Toast';
import { getErrorMessage } from '../utils/errorMessage';
import { GraduationCap, Plus, School, Users } from 'lucide-react';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';

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

  // 老师忘了金币密码就无法加币/减币,这里给管理员一个重置出路
  const handleResetCoinPin = async (id: number) => {
    const pin = prompt('给该教师设置新的金币密码(至少 4 位):');
    if (pin === null) return;
    if (pin.trim().length < 4) { toast.warning('金币密码至少 4 位'); return; }
    try {
      await resetTeacherCoinPin(id, pin.trim());
      alert(`金币密码已重置为:${pin.trim()}\n\n请转告该教师,并提醒尽快自行修改。`);
    } catch (e: any) {
      toast.error(e?.response?.data?.detail || '重置金币密码失败');
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
    <div className="admin-legacy-page min-h-screen">
      <StaffWorkspaceHeader role="admin" title="教师管理" subtitle="教师账号、班级与教学权限" icon={GraduationCap} action={<button type="button" onClick={() => setShowCreateModal(true)} className="admin-primary admin-focus-ring inline-flex min-h-10 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold"><Plus className="h-4 w-4" />新建教师</button>} />

      <main className="mx-auto max-w-[1440px] px-4 py-5 sm:px-6 sm:py-8 lg:px-10 lg:py-8">
        <section className="admin-teacher-directory" aria-labelledby="admin-teacher-directory-title">
          <div className="admin-teacher-directory-heading">
            <div>
              <h2 id="admin-teacher-directory-title">教师目录</h2>
              <p>查看教师负责的班级与学生，并集中处理账号权限。</p>
            </div>
            <span>{loading ? '正在同步' : `${teachers.length} 位教师`}</span>
          </div>
          {loading ? (
            <div className="admin-teacher-loading" role="status" aria-label="正在加载教师目录">
              <span /><span /><span />
            </div>
          ) : teachers.length === 0 ? (
            <div className="admin-teacher-empty">
              <GraduationCap className="h-8 w-8" aria-hidden="true" />
              <strong>还没有教师账号</strong>
              <span>点击“新建教师”创建账号，随后可以为教师分配班级和学生。</span>
            </div>
          ) : (
            <>
            <div className="admin-teacher-mobile-list sm:hidden">
              {teachers.map((t) => (
                <article key={t.id} className="admin-teacher-mobile-card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="admin-teacher-avatar" aria-hidden="true"><GraduationCap className="h-5 w-5" /></span>
                      <div className="min-w-0"><div className="truncate font-bold text-[#173047]">{t.full_name || t.username}</div><div className="truncate text-xs text-[#6d8195]">{t.username}</div></div>
                    </div>
                    <span className={`admin-teacher-status ${t.is_active ? 'is-active' : 'is-disabled'}`}>{t.is_active ? '正常' : '已禁用'}</span>
                  </div>
                  <p className="mt-3 truncate text-xs text-[#5f7486]">{t.email}</p>
                  <div className="admin-teacher-mobile-meta"><span><School className="h-4 w-4" />{t.class_count} 个班级</span><span><Users className="h-4 w-4" />{t.student_count} 名学生</span></div>
                  <div className="admin-teacher-actions mt-4">
                    <button type="button" onClick={() => navigate(`/admin/teachers/${t.id}`)} className="admin-teacher-action is-primary">查看详情</button>
                    <button type="button" onClick={() => handleToggleActive(t)} className={`admin-teacher-action ${t.is_active ? 'is-state' : 'is-success'}`}>{t.is_active ? '禁用账号' : '恢复账号'}</button>
                    <button type="button" onClick={() => handleResetPassword(t.id)} className="admin-teacher-action">重置密码</button>
                    <button type="button" onClick={() => handleResetCoinPin(t.id)} className="admin-teacher-action">金币密码</button>
                    <button type="button" onClick={() => handleDelete(t)} className="admin-teacher-action is-danger">删除</button>
                  </div>
                </article>
              ))}
            </div>
            <div className="admin-teacher-table-scroll hidden overflow-x-auto sm:block">
            <table className="admin-teacher-table w-full min-w-[1080px] whitespace-nowrap">
              <thead>
                <tr>
                  <th>教师</th>
                  <th>联系方式</th>
                  <th>教学规模</th>
                  <th>账号状态</th>
                  <th className="text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {teachers.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <div className="flex items-center gap-3"><span className="admin-teacher-avatar" aria-hidden="true"><GraduationCap className="h-5 w-5" /></span><div className="min-w-0"><div className="max-w-[15rem] truncate font-bold text-[#173047]">{t.full_name || t.username}</div><div className="mt-0.5 max-w-[15rem] truncate text-xs text-[#6d8195]">{t.username}</div></div></div>
                    </td>
                    <td><span className="block max-w-[17rem] truncate text-sm text-[#526b7f]">{t.email}</span></td>
                    <td><div className="admin-teacher-scale"><span><School className="h-4 w-4" />{t.class_count} 个班级</span><span><Users className="h-4 w-4" />{t.student_count} 名学生</span></div></td>
                    <td><span className={`admin-teacher-status ${t.is_active ? 'is-active' : 'is-disabled'}`}>{t.is_active ? '正常' : '已禁用'}</span></td>
                    <td>
                      <div className="admin-teacher-actions justify-end">
                        <button type="button" onClick={() => navigate(`/admin/teachers/${t.id}`)} className="admin-teacher-action is-primary">详情</button>
                        <button type="button" onClick={() => handleToggleActive(t)} className={`admin-teacher-action ${t.is_active ? 'is-state' : 'is-success'}`}>{t.is_active ? '禁用' : '恢复'}</button>
                        <button type="button" onClick={() => handleResetPassword(t.id)} className="admin-teacher-action">重置密码</button>
                        <button type="button" onClick={() => handleResetCoinPin(t.id)} className="admin-teacher-action">金币密码</button>
                        <button type="button" onClick={() => handleDelete(t)} className="admin-teacher-action is-danger">删除</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            </>
          )}
        </section>
      </main>

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
