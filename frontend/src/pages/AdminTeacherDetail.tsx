import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { admin } from '../api/admin';
import type { AdminTeacherDetail } from '../api/admin';
import { toast } from '../components/Toast';
import { GraduationCap } from 'lucide-react';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';

const AdminTeacherDetailPage = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [teacher, setTeacher] = useState<AdminTeacherDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    admin.getTeacher(Number(id))
      .then(setTeacher)
      .catch(() => toast.error('加载教师信息失败'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-orange-500 border-t-transparent"></div>
      </div>
    );
  }

  if (!teacher) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center">
        <div className="text-gray-500">教师不存在或加载失败</div>
      </div>
    );
  }

  return (
    <div className="admin-legacy-page min-h-screen">
      <StaffWorkspaceHeader role="admin" title="教师详情" subtitle="教师账号与名下班级" icon={GraduationCap} backTo="/admin/teachers" />

      <div className="mx-auto max-w-5xl space-y-6 px-4 py-5 sm:px-6 sm:py-8">
        {/* 教师信息卡片 */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 sm:p-6">
          <h2 className="text-lg font-bold text-gray-800 mb-4">基本信息</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-xs text-gray-500 mb-1">用户名</div>
              <div className="font-medium text-gray-800">{teacher.username}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">姓名</div>
              <div className="font-medium text-gray-800">{teacher.full_name || '-'}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">邮箱</div>
              <div className="break-all font-medium text-gray-800">{teacher.email}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">状态</div>
              <span className={`px-2 py-1 rounded text-xs ${teacher.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-[#536170]'}`}>
                {teacher.is_active ? '正常' : '禁用'}
              </span>
            </div>
          </div>
        </div>

        {/* 班级列表 */}
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-bold text-gray-800">管理的班级 ({teacher.classes.length})</h2>
          </div>
          {teacher.classes.length === 0 ? (
            <div className="px-6 py-10 text-center text-gray-400">该教师暂无班级</div>
          ) : (
            <>
            <div className="space-y-3 p-3 sm:hidden">
              {teacher.classes.map((cls) => (
                <button key={cls.id} type="button" onClick={() => navigate(`/admin/classes/${cls.id}`)} className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 p-3 text-left">
                  <span className="min-w-0"><span className="block truncate font-semibold text-slate-800">{cls.name}</span><span className="mt-1 block truncate text-xs text-slate-500">{cls.description || '暂无描述'} · {new Date(cls.created_at).toLocaleDateString('zh-CN')}</span></span><span className="shrink-0 text-sm font-semibold text-blue-600">查看</span>
                </button>
              ))}
            </div>
            <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[680px] whitespace-nowrap">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">班级名称</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">描述</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">创建时间</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {teacher.classes.map((cls) => (
                  <tr key={cls.id} className="hover:bg-slate-50/70">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{cls.name}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">{cls.description || '-'}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {new Date(cls.created_at).toLocaleDateString('zh-CN')}
                    </td>
                    <td className="px-6 py-4 text-sm text-right">
                      <button
                        onClick={() => navigate(`/admin/classes/${cls.id}`)}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        查看详情
                      </button>
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
    </div>
  );
};

export default AdminTeacherDetailPage;
