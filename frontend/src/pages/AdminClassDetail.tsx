import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { admin } from '../api/admin';
import type { AdminClassOverview } from '../api/admin';
import { teacherMonitor } from '../api/teacherMonitor';
import type { ClassStudent } from '../api/teacherMonitor';
import { toast } from '../components/Toast';
import TransferStudentDialog from '../components/admin/TransferStudentDialog';

const AdminClassDetail = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const classId = Number(id);

  const [overview, setOverview] = useState<AdminClassOverview | null>(null);
  const [students, setStudents] = useState<ClassStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [transferTarget, setTransferTarget] = useState<ClassStudent | null>(null);

  const loadData = async () => {
    if (!classId) return;
    try {
      setLoading(true);
      const [ov, sts] = await Promise.all([
        admin.classOverview(classId),
        teacherMonitor.classStudents(classId),
      ]);
      setOverview(ov);
      setStudents(sts);
    } catch {
      toast.error('加载班级数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [classId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-orange-500 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm border-b">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="text-gray-600 hover:text-gray-800">← 返回</button>
          <h1 className="text-xl font-bold text-gray-800">
            班级详情{overview ? ` — ${overview.name}` : ''}
          </h1>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* 概览卡片 */}
        {overview && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg p-4 shadow-sm text-center">
              <div className="text-2xl font-bold text-blue-600">{overview.student_count}</div>
              <div className="text-sm text-gray-500 mt-1">学生人数</div>
            </div>
            <div className="bg-white rounded-lg p-4 shadow-sm text-center">
              <div className="text-2xl font-bold text-green-600">{(overview.avg_accuracy * 100).toFixed(1)}%</div>
              <div className="text-sm text-gray-500 mt-1">平均正确率</div>
            </div>
            <div className="bg-white rounded-lg p-4 shadow-sm text-center">
              <div className="text-2xl font-bold text-orange-500">{overview.total_words_studied}</div>
              <div className="text-sm text-gray-500 mt-1">累计学习单词</div>
            </div>
            <div className="bg-white rounded-lg p-4 shadow-sm text-center">
              <div className="text-2xl font-bold text-purple-600">{overview.mastered_words}</div>
              <div className="text-sm text-gray-500 mt-1">已掌握单词</div>
            </div>
          </div>
        )}

        {/* 学生列表 */}
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-bold text-gray-800">学生列表 ({students.length})</h2>
          </div>
          {students.length === 0 ? (
            <div className="px-6 py-10 text-center text-gray-400">该班级暂无学生</div>
          ) : (
            <table className="w-full">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">用户名</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">姓名</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">加入时间</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {students.map((s) => (
                  <tr key={s.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{s.username}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">{s.full_name || '-'}</td>
                    <td className="px-6 py-4 text-sm text-gray-500">
                      {new Date(s.joined_at).toLocaleDateString('zh-CN')}
                    </td>
                    <td className="px-6 py-4 text-sm text-right">
                      <button
                        onClick={() => setTransferTarget(s)}
                        className="text-orange-600 hover:text-orange-800"
                      >
                        转班
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {transferTarget && (
        <TransferStudentDialog
          studentId={transferTarget.id}
          currentClassId={classId}
          open={true}
          onClose={() => setTransferTarget(null)}
          onSuccess={() => { setTransferTarget(null); loadData(); }}
        />
      )}
    </div>
  );
};

export default AdminClassDetail;
