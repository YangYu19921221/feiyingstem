import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { admin } from '../api/admin';
import type { AdminTeacherDetail, AdminTeacherAnalytics } from '../api/admin';
import { toast } from '../components/Toast';
import { GraduationCap } from 'lucide-react';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';

const AdminTeacherDetailPage = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [teacher, setTeacher] = useState<AdminTeacherDetail | null>(null);
  const [loading, setLoading] = useState(true);
  // 教学数据: 7/30 天窗口可切
  const [days, setDays] = useState(7);
  const [stats, setStats] = useState<AdminTeacherAnalytics | null>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    admin.getTeacher(Number(id))
      .then(setTeacher)
      .catch(() => toast.error('加载教师信息失败'))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    (async () => {
      setStatsLoading(true);
      try {
        const d = await admin.getTeacherAnalytics(Number(id), days);
        if (alive) setStats(d);
      } catch {
        // 教学数据失败不挡基本信息(两个独立请求)
        if (alive) toast.error('加载教学数据失败');
      } finally {
        if (alive) setStatsLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id, days]);

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

        {/* 教学数据(2026-09-12)。
            ⚠️ 签到率不是到课率 —— 下方必须显示后端下发的 checkin_note,
            否则机构会拿它当到课率考核老师 */}
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5 sm:p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-gray-800">教学数据</h2>
            <div className="flex gap-1.5">
              {[7, 30].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setDays(d)}
                  className={`min-h-8 rounded-lg border px-3 text-sm font-medium ${
                    days === d
                      ? 'border-[#3976a9] bg-[#3976a9] text-white'
                      : 'border-slate-300 bg-white text-slate-600 hover:border-[#3976a9]'
                  }`}
                >近 {d} 天</button>
              ))}
            </div>
          </div>

          {statsLoading ? (
            <div className="py-8 text-center text-sm text-slate-400">加载中…</div>
          ) : !stats ? (
            <div className="py-8 text-center text-sm text-slate-400">暂无数据</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                {[
                  { label: '在读学生', value: stats.summary.student_count, unit: '人' },
                  { label: '签到率', value: stats.summary.checkin_rate, unit: '%',
                    tone: stats.summary.checkin_rate < 30 ? 'warn' : 'ok' },
                  { label: '活跃学生', value: stats.summary.active_students, unit: '人',
                    sub: `${stats.summary.active_rate}%` },
                  { label: '学习时长', value: stats.summary.study_minutes, unit: '分钟' },
                  { label: '词汇量', value: stats.summary.vocab, unit: '词' },
                  { label: '作业完成率', value: stats.summary.homework_completion_rate, unit: '%',
                    sub: `布置 ${stats.summary.homework_assigned} 份` },
                ].map((m) => (
                  <div key={m.label} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    <div className="text-xs text-slate-500">{m.label}</div>
                    <div className={`mt-1 text-xl font-bold ${
                      m.tone === 'warn' ? 'text-orange-600' : 'text-slate-800'}`}>
                      {m.value}<span className="ml-0.5 text-xs font-normal text-slate-400">{m.unit}</span>
                    </div>
                    {m.sub && <div className="mt-0.5 text-[11px] text-slate-400">{m.sub}</div>}
                  </div>
                ))}
              </div>

              <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
                {stats.checkin_note}
              </p>

              {/* 逐班明细: 哪个班在学、哪个班没动,一眼看出来 */}
              {stats.classes.length > 0 && (
                <div className="mt-5 overflow-x-auto">
                  <table className="w-full min-w-[720px] whitespace-nowrap text-sm">
                    <thead>
                      <tr className="border-b text-left text-slate-500">
                        <th className="py-2 pr-4">班级</th>
                        <th className="py-2 pr-4">学生</th>
                        <th className="py-2 pr-4">签到率</th>
                        <th className="py-2 pr-4">活跃</th>
                        <th className="py-2 pr-4">学习时长</th>
                        <th className="py-2 pr-4">词汇量</th>
                        <th className="py-2">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stats.classes.map((c) => (
                        <tr key={c.class_id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                          <td className="py-2.5 pr-4 font-medium text-slate-800">{c.name}</td>
                          <td className="py-2.5 pr-4 text-slate-600">{c.student_count}</td>
                          <td className={`py-2.5 pr-4 font-semibold ${
                            c.checkin_rate < 10 ? 'text-red-500'
                            : c.checkin_rate < 30 ? 'text-orange-500' : 'text-green-600'}`}>
                            {c.checkin_rate}%
                          </td>
                          <td className="py-2.5 pr-4 text-slate-600">
                            {c.active_students}
                            <span className="ml-1 text-xs text-slate-400">({c.active_rate}%)</span>
                          </td>
                          <td className="py-2.5 pr-4 text-slate-600">{c.study_minutes} 分</td>
                          <td className="py-2.5 pr-4 text-slate-600">{c.vocab}</td>
                          <td className="py-2.5">
                            <button
                              onClick={() => navigate(`/admin/classes/${c.class_id}`)}
                              className="text-[#3976a9] hover:underline"
                            >班级详情</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
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
