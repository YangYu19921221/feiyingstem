/**
 * 教师端 - 班级摸底总览页
 *
 * 显示：完成率漏斗、起点分布、待处理学生清单
 * 点击学生卡片 → 查看该学生的个人规划
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronRight, LoaderCircle, Users } from 'lucide-react';
import { placementApi } from '../api/placement';
import type { ClassOverview, NeedsActionItem } from '../api/placement';
import { getErrorMessage } from '../utils/errorMessage';

const BAND_COLOR: Record<string, string> = {
  '小学低段': 'bg-green-100 text-green-700',
  '小学高段': 'bg-teal-100 text-teal-700',
  '初中入门': 'bg-blue-100 text-blue-700',
  '初中进阶': 'bg-violet-100 text-violet-700',
  '高中':     'bg-rose-100 text-rose-700',
};

const PRIORITY_COLOR: Record<number, string> = {
  1: 'bg-rose-50 border-rose-200',
  2: 'bg-amber-50 border-amber-200',
  3: 'bg-blue-50 border-blue-200',
};

const PRIORITY_DOT: Record<number, string> = {
  1: 'bg-rose-400',
  2: 'bg-amber-400',
  3: 'bg-blue-400',
};

export default function TeacherPlacementOverview() {
  const navigate = useNavigate();
  const [data, setData] = useState<ClassOverview | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    placementApi.classOverview()
      .then(setData)
      .catch(e => setErr(getErrorMessage(e, '加载失败，请刷新重试')));
  }, []);

  if (err) return (
    <div className="min-h-screen bg-paper flex items-center justify-center px-4">
      <div className="rounded-2xl bg-white p-8 text-center shadow-sm max-w-sm w-full">
        <p className="text-sm text-rose-600 mb-3">{err}</p>
        <button onClick={() => window.location.reload()}
          className="text-sm font-semibold text-orange-500">刷新</button>
      </div>
    </div>
  );

  if (!data) return (
    <div className="flex min-h-screen items-center justify-center bg-paper">
      <LoaderCircle className="h-6 w-6 animate-spin text-orange-400" />
    </div>
  );

  const done = data.completed + data.skipped;
  const pct = data.total_students ? Math.round((done / data.total_students) * 100) : 0;

  return (
    <div className="min-h-screen bg-paper">
      {/* 顶栏 */}
      <nav className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <button onClick={() => navigate('/teacher/dashboard')} aria-label="返回"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-orange-50 hover:text-orange-600">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-base font-bold text-ink">入学摸底总览</h1>
          <div className="ml-auto flex items-center gap-1 text-sm text-ink-soft">
            <Users className="h-4 w-4" />
            <span>{data.total_students} 人</span>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-3xl px-4 py-6 space-y-5">

        {/* 测评规则说明 */}
        <section className="rounded-2xl border border-orange-200 bg-orange-50 p-5">
          <p className="mb-2 text-sm font-semibold text-orange-800">📋 测评规则</p>
          <div className="space-y-1.5 text-xs text-orange-700 leading-relaxed">
            <p>✦ <b>12 道题，约 3 分钟</b>：10 道认知题（看英文选中文，4选1）+ 2 道拼写题（看中文写英文）</p>
            <p>✦ <b>5 个难度档</b>：小学低段（三四年级）→ 小学高段（五六年级）→ 初中入门（七年级）→ 初中进阶（八九年级）→ 高中</p>
            <p>✦ <b>推荐起点</b>：由「连续全对的最高档 + 1」决定；拼写失败时下调一档，确保学生不会跳过弱项</p>
            <p>✦ <b>查缺补漏</b>：测评中答错的档位会标注漏洞，小鹰老师每天任务里的 30% 会自动安排补漏</p>
            <p>✦ <b>你需要做的</b>：测评完成后按「推荐起点」给学生分配对应年级教材，然后小鹰老师自动接手每日安排</p>
          </div>
        </section>
        {/* 完成率漏斗 */}
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-end justify-between">
            <h2 className="text-sm font-semibold text-ink">测评完成率</h2>
            <span className="text-2xl font-bold text-ink">{pct}%</span>
          </div>
          {/* 进度条 */}
          <div className="mb-4 h-3 overflow-hidden rounded-full bg-slate-100">
            <div className="h-3 rounded-full bg-orange-400 transition-all duration-500"
              style={{ width: `${pct}%` }} />
          </div>
          {/* 四格数字 */}
          <div className="grid grid-cols-4 gap-2 text-center">
            {[
              { label: '已完成', value: data.completed, color: 'text-green-600' },
              { label: '已跳过', value: data.skipped,   color: 'text-teal-600'  },
              { label: '未提交', value: data.pending,   color: 'text-amber-600' },
              { label: '未开始', value: data.not_started, color: 'text-rose-500' },
            ].map(({ label, value, color }) => (
              <div key={label} className="rounded-xl bg-slate-50 py-3">
                <p className={`text-xl font-bold ${color}`}>{value}</p>
                <p className="mt-0.5 text-xs text-ink-soft">{label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 起点分布 */}
        {Object.keys(data.distribution).length > 0 && (
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold text-ink">推荐起点分布</h2>
            {Object.entries(data.distribution)
              .sort((a, b) => b[1] - a[1])
              .map(([label, count]) => {
                const barPct = Math.round((count / done) * 100);
                return (
                  <div key={label} className="mb-3 flex items-center gap-3">
                    <span className={`w-20 shrink-0 rounded-full px-2.5 py-0.5 text-center text-xs font-medium
                      ${BAND_COLOR[label] ?? 'bg-slate-100 text-slate-600'}`}>
                      {label}
                    </span>
                    <div className="flex-1 overflow-hidden rounded-full bg-slate-100 h-2.5">
                      <div className="h-2.5 rounded-full bg-orange-400 transition-all duration-500"
                        style={{ width: `${barPct}%` }} />
                    </div>
                    <span className="w-10 text-right text-sm font-semibold text-ink">{count} 人</span>
                  </div>
                );
              })}
          </section>
        )}

        {/* 待处理清单 */}
        {data.needs_action.length > 0 && (
          <section className="rounded-2xl bg-white p-5 shadow-sm">
            <h2 className="mb-1 text-sm font-semibold text-ink">需要你处理</h2>
            <p className="mb-4 text-xs text-ink-mute">按优先级排序，点击查看个人学习规划</p>
            <div className="space-y-2">
              {data.needs_action.map((item) => (
                <ActionCard
                  key={item.student_id}
                  item={item}
                  onClick={() => navigate(`/teacher/placement/student/${item.student_id}`)}
                />
              ))}
            </div>
          </section>
        )}

        {data.needs_action.length === 0 && done === data.total_students && (
          <div className="rounded-2xl bg-green-50 p-5 text-center">
            <p className="text-sm font-semibold text-green-700">全班测评已完成，所有学生均已分配教材 ✓</p>
          </div>
        )}
      </main>
    </div>
  );
}

function ActionCard({ item, onClick }: { item: NeedsActionItem; onClick: () => void }) {
  const bgBorder = PRIORITY_COLOR[item.priority] ?? 'bg-slate-50 border-slate-200';
  const dot      = PRIORITY_DOT[item.priority]   ?? 'bg-slate-400';
  return (
    <button onClick={onClick}
      className={`w-full rounded-xl border px-4 py-3 text-left flex items-center gap-3 hover:brightness-95 transition ${bgBorder}`}>
      <span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink truncate">{item.name}</p>
        <p className="mt-0.5 text-xs text-ink-soft leading-relaxed">{item.reason}</p>
      </div>
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-mute" />
    </button>
  );
}
