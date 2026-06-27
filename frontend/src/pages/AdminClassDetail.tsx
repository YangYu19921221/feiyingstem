import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { admin } from '../api/admin';
import type {
  AdminClassOverview,
  AdminClassStudent,
  AdminClassStatsSummary,
  AdminStudentDetail,
  AdminStudentExam,
} from '../api/admin';
import { toast } from '../components/Toast';
import TransferStudentDialog from '../components/admin/TransferStudentDialog';
import StudentBooksDialog from '../components/admin/StudentBooksDialog';

// 三个指标 × 三个时间维度
type MetricKey = 'training' | 'vocab' | 'time';
type RangeKey = 'today' | 'yesterday' | 'last7days';

const METRICS: { key: MetricKey; label: string; color: string; unit: string }[] = [
  { key: 'training', label: '训练量', color: '#FF6B35', unit: '题' },
  { key: 'vocab', label: '词汇量', color: '#00B8D4', unit: '词' },
  { key: 'time', label: '学习时间', color: '#5FD35F', unit: '分钟' },
];
const RANGES: { key: RangeKey; label: string }[] = [
  { key: 'today', label: '今日' },
  { key: 'yesterday', label: '昨日' },
  { key: 'last7days', label: '最近7天' },
];

// 学习时间后端存秒,展示转分钟;其余指标原样
const fmtValue = (metric: MetricKey, raw: number): number =>
  metric === 'time' ? Math.round(raw / 60) : raw;

const AdminClassDetail = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const classId = Number(id);

  const [overview, setOverview] = useState<AdminClassOverview | null>(null);
  const [students, setStudents] = useState<AdminClassStudent[]>([]);
  const [stats, setStats] = useState<AdminClassStatsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [transferTarget, setTransferTarget] = useState<AdminClassStudent | null>(null);

  // 统计图选择器
  const [metric, setMetric] = useState<MetricKey>('training');
  const [range, setRange] = useState<RangeKey>('last7days');

  // 学生详情弹窗
  const [detail, setDetail] = useState<AdminStudentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [exams, setExams] = useState<AdminStudentExam[]>([]);
  // 管理书本弹窗
  const [booksTarget, setBooksTarget] = useState<AdminClassStudent | null>(null);

  const loadData = async () => {
    if (!classId) return;
    try {
      setLoading(true);
      const [ov, sts, st] = await Promise.all([
        admin.classOverview(classId),
        admin.classStudents(classId),
        admin.classStatsSummary(classId).catch(() => null),
      ]);
      setOverview(ov);
      setStudents(sts);
      setStats(st);
    } catch {
      toast.error('加载班级数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadData(); }, [classId]);

  const openStudent = async (sid: number) => {
    setDetailLoading(true);
    setExams([]);
    try {
      const [d, ex] = await Promise.all([
        admin.studentDetail(sid),
        admin.studentExams(sid).catch(() => []),
      ]);
      setDetail(d);
      setExams(ex);
    } catch {
      toast.error('加载学生详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-orange-500 border-t-transparent"></div>
      </div>
    );
  }

  const meta = METRICS.find((m) => m.key === metric)!;

  // 当前选择对应的展示数据
  const chartData: { date: string; value: number }[] =
    range === 'last7days'
      ? (stats?.last7days[metric] || []).map((p) => ({ date: p.date, value: fmtValue(metric, p.value) }))
      : [];
  const singleValue =
    range === 'last7days' ? 0 : fmtValue(metric, stats?.[range]?.[metric] ?? 0);
  const maxVal = Math.max(...chartData.map((d) => d.value), 1);

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

        {/* 班级学习统计 */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
            <h2 className="text-lg font-bold text-gray-800">📊 班级学习统计</h2>
            <div className="flex items-center gap-2">
              <select
                value={metric}
                onChange={(e) => setMetric(e.target.value as MetricKey)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              >
                {METRICS.map((m) => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
              <select
                value={range}
                onChange={(e) => setRange(e.target.value as RangeKey)}
                className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
              >
                {RANGES.map((r) => (
                  <option key={r.key} value={r.key}>{r.label}</option>
                ))}
              </select>
            </div>
          </div>

          {!stats ? (
            <div className="py-10 text-center text-gray-400">暂无统计数据</div>
          ) : range === 'last7days' ? (
            // 近7天柱状图(纯 div 高度,无需图表库)
            <div className="flex items-end justify-between gap-2 h-48 px-2">
              {chartData.map((d) => (
                <div key={d.date} className="flex-1 flex flex-col items-center justify-end h-full">
                  <span className="text-xs font-semibold mb-1" style={{ color: meta.color }}>
                    {d.value}
                  </span>
                  <div
                    className="w-full rounded-t-md transition-all"
                    style={{
                      height: `${(d.value / maxVal) * 100}%`,
                      minHeight: d.value > 0 ? '4px' : '0',
                      backgroundColor: meta.color,
                      opacity: 0.85,
                    }}
                  />
                  <span className="text-[10px] text-gray-400 mt-1">{d.date}</span>
                </div>
              ))}
            </div>
          ) : (
            // 今日/昨日单值
            <div className="py-8 text-center">
              <div className="text-5xl font-bold" style={{ color: meta.color }}>{singleValue}</div>
              <div className="text-sm text-gray-500 mt-2">
                {RANGES.find((r) => r.key === range)!.label}{meta.label}（{meta.unit}）
              </div>
            </div>
          )}

          <div className="mt-4 pt-4 border-t text-sm text-gray-500 text-center">
            词汇总量：<span className="font-semibold text-gray-800">{stats?.total_vocab ?? 0}</span> 个
          </div>
        </div>

        {/* 学生列表 */}
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b">
            <h2 className="text-lg font-bold text-gray-800">学生名册 ({students.length})</h2>
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
                      {s.joined_at ? new Date(s.joined_at).toLocaleDateString('zh-CN') : '-'}
                    </td>
                    <td className="px-6 py-4 text-sm text-right space-x-3">
                      <button
                        onClick={() => openStudent(s.id)}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        学习详情
                      </button>
                      <button
                        onClick={() => setBooksTarget(s)}
                        className="text-green-600 hover:text-green-800"
                      >
                        管理书本
                      </button>
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

      {/* 学生学习详情弹窗 */}
      {(detail || detailLoading) && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4"
          onClick={() => { setDetail(null); }}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {detailLoading ? (
              <div className="p-10 text-center text-gray-400">加载中…</div>
            ) : detail ? (
              <div className="p-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-bold text-gray-800">
                    {detail.full_name} 的学习详情
                  </h3>
                  <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-600 text-xl">✕</button>
                </div>

                {/* 当日 */}
                <div className="grid grid-cols-3 gap-3 mb-4">
                  <div className="bg-orange-50 rounded-lg p-3 text-center">
                    <div className="text-xl font-bold text-orange-600">{detail.today_words}</div>
                    <div className="text-xs text-gray-500 mt-0.5">今日学词</div>
                  </div>
                  <div className="bg-blue-50 rounded-lg p-3 text-center">
                    <div className="text-xl font-bold text-blue-600">{Math.round(detail.today_duration / 60)}</div>
                    <div className="text-xs text-gray-500 mt-0.5">今日时长(分)</div>
                  </div>
                  <div className="bg-green-50 rounded-lg p-3 text-center">
                    <div className="text-xl font-bold text-green-600">{detail.today_accuracy}%</div>
                    <div className="text-xs text-gray-500 mt-0.5">今日正确率</div>
                  </div>
                </div>

                {/* 累计 */}
                <div className="grid grid-cols-2 gap-3 mb-4 text-sm">
                  <div className="flex justify-between px-3 py-2 bg-gray-50 rounded-lg">
                    <span className="text-gray-500">累计学词</span>
                    <span className="font-semibold text-gray-800">{detail.total_words_learned}</span>
                  </div>
                  <div className="flex justify-between px-3 py-2 bg-gray-50 rounded-lg">
                    <span className="text-gray-500">已掌握</span>
                    <span className="font-semibold text-gray-800">{detail.total_mastered}</span>
                  </div>
                  <div className="flex justify-between px-3 py-2 bg-gray-50 rounded-lg">
                    <span className="text-gray-500">薄弱词</span>
                    <span className="font-semibold text-gray-800">{detail.weak_words_count}</span>
                  </div>
                  <div className="flex justify-between px-3 py-2 bg-gray-50 rounded-lg">
                    <span className="text-gray-500">累计正确率</span>
                    <span className="font-semibold text-gray-800">{detail.overall_accuracy}%</span>
                  </div>
                  <div className="flex justify-between px-3 py-2 bg-gray-50 rounded-lg">
                    <span className="text-gray-500">学习天数</span>
                    <span className="font-semibold text-gray-800">{detail.total_study_days}</span>
                  </div>
                  <div className="flex justify-between px-3 py-2 bg-gray-50 rounded-lg">
                    <span className="text-gray-500">累计时长(分)</span>
                    <span className="font-semibold text-gray-800">{Math.round(detail.total_study_time / 60)}</span>
                  </div>
                </div>

                {/* 近7天学词趋势 */}
                <div>
                  <div className="text-sm font-medium text-gray-600 mb-2">最近7天学词</div>
                  <div className="flex items-end justify-between gap-1.5 h-24">
                    {(() => {
                      const mx = Math.max(...detail.recent_daily_words, 1);
                      return detail.recent_daily_words.map((v, i) => (
                        <div key={i} className="flex-1 flex flex-col items-center justify-end h-full">
                          <div
                            className="w-full rounded-t bg-orange-400"
                            style={{ height: `${(v / mx) * 100}%`, minHeight: v > 0 ? '3px' : '0' }}
                          />
                          <span className="text-[9px] text-gray-400 mt-1">{detail.recent_daily_dates[i]}</span>
                        </div>
                      ));
                    })()}
                  </div>
                </div>

                {/* 考试成绩(单元 + 小组,按时间倒序) */}
                <div className="mt-4">
                  <div className="text-sm font-medium text-gray-600 mb-2">考试成绩</div>
                  {exams.length === 0 ? (
                    <p className="text-sm text-gray-400 py-3 text-center bg-gray-50 rounded-lg">暂无考试记录</p>
                  ) : (
                    <div className="space-y-1.5 max-h-52 overflow-y-auto">
                      {exams.map((e, i) => (
                        <div key={i} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                                e.type === 'unit' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                              }`}>
                                {e.type === 'unit' ? '单元' : '小组'}
                              </span>
                              <span className="text-sm text-gray-800 truncate">{e.label}</span>
                            </div>
                            {e.at && <div className="text-[10px] text-gray-400 mt-0.5">{new Date(e.at).toLocaleString('zh-CN')}</div>}
                          </div>
                          <div className="text-right shrink-0 ml-3">
                            <div className="text-sm font-semibold text-gray-800">{e.accuracy}%</div>
                            {e.type === 'group' && e.total_questions
                              ? <div className="text-[10px] text-gray-400">{e.correct_count}/{e.total_questions}</div>
                              : <div className="text-[10px] text-gray-400">{e.score}/{e.total_score}</div>}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}

      {booksTarget && (
        <StudentBooksDialog
          studentId={booksTarget.id}
          studentName={booksTarget.full_name || booksTarget.username}
          open={true}
          onClose={() => setBooksTarget(null)}
        />
      )}
    </div>
  );
};

export default AdminClassDetail;
