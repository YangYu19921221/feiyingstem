import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { admin } from '../api/admin';
import type { AdminClassListItem } from '../api/admin';
import { toast } from '../components/Toast';

const AdminClassList = () => {
  const navigate = useNavigate();
  const [classes, setClasses] = useState<AdminClassListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => { loadClasses(); }, []);

  const loadClasses = async () => {
    try {
      setLoading(true);
      const data = await admin.listClasses();
      setClasses(data);
    } catch {
      toast.error('加载班级列表失败');
    } finally {
      setLoading(false);
    }
  };

  const filtered = q.trim()
    ? classes.filter((c) =>
        c.name.toLowerCase().includes(q.toLowerCase()) ||
        (c.teacher_username || '').toLowerCase().includes(q.toLowerCase()))
    : classes;

  return (
    <div className="min-h-screen bg-paper">
      <nav className="bg-white border-b border-slate-200">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-4">
          <button onClick={() => navigate('/admin')} className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-semibold text-gray-600 hover:bg-slate-50">← 返回管理中心</button>
          <h1 className="text-xl font-bold text-gray-800">📊 班级数据</h1>
        </div>
      </nav>

      <div className="max-w-5xl mx-auto px-4 py-8 space-y-4">
        <p className="text-sm text-gray-500">选择班级查看学习统计（训练量/词汇量/学习时间）和学生名册。</p>

        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索班级名或教师"
          className="w-full max-w-sm px-4 py-2 border border-slate-300 bg-white rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#3976a9]/30 focus:border-[#3976a9]"
        />

        {loading ? (
          <div className="py-16 flex justify-center">
            <div className="animate-spin rounded-full h-10 w-10 border-4 border-orange-500 border-t-transparent"></div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm px-6 py-12 text-center text-gray-400">
            {q.trim() ? '没有匹配的班级' : '暂无班级'}
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto">
            <table className="w-full min-w-[680px] whitespace-nowrap">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">班级</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">教师</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">学生数</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filtered.map((c) => (
                  <tr
                    key={c.id}
                    className="hover:bg-slate-50/70 cursor-pointer"
                    onClick={() => navigate(`/admin/classes/${c.id}`)}
                  >
                    <td className="px-6 py-4">
                      <div className="text-sm font-medium text-gray-900">{c.name}</div>
                      {c.description && <div className="text-xs text-gray-400">{c.description}</div>}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">{c.teacher_username || '-'}</td>
                    <td className="px-6 py-4 text-sm text-right text-gray-600">{c.student_count}</td>
                    <td className="px-6 py-4 text-sm text-right">
                      <span className="text-[#3976a9] font-semibold">查看统计 →</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default AdminClassList;
