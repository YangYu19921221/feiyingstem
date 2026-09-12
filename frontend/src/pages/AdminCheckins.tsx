/** 管理端 - 签到与教学数据总览(2026-09-12)
 *
 * 回答两个问题:
 *   ①「今天谁没签到」—— 一天一张表看全所有班、所有学生,不用逐个老师点进去
 *   ②「哪个老师带得好」—— 全员横排,可按签到率/活跃/时长排序
 *
 * ⚠️ 通篇用「签到」不用「出勤/到课」: daily_checkins 记的是学生当天打开 App
 * 签了到,不是线下到课。机构会拿这些数考核老师,标错字就是让人拿错数据做决定。
 * 页面顶部固定显示后端下发的 checkin_note。
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarCheck, Search } from 'lucide-react';
import { admin } from '../api/admin';
import type { AdminCheckins as CheckinsData, AdminTeachersOverview } from '../api/admin';
import { toast } from '../components/Toast';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';

type Tab = 'checkins' | 'teachers';
type SortKey = 'checkin_rate' | 'active_rate' | 'study_minutes' | 'vocab' | 'student_count';

/** 今天的本地日期(YYYY-MM-DD)。不能用 toISOString —— 那是 UTC,
 *  北京时间早上 8 点前会取到前一天。 */
const todayLocal = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const rateColor = (r: number) =>
  r < 10 ? 'text-red-500' : r < 30 ? 'text-orange-500' : 'text-green-600';

export default function AdminCheckinsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('checkins');

  // ── 签到明细 ──
  const [day, setDay] = useState(todayLocal());
  const [checkins, setCheckins] = useState<CheckinsData | null>(null);
  const [loadingC, setLoadingC] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [onlyUnchecked, setOnlyUnchecked] = useState(false);

  // ── 教师横排 ──
  const [days, setDays] = useState(7);
  const [overview, setOverview] = useState<AdminTeachersOverview | null>(null);
  const [loadingT, setLoadingT] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>('student_count');

  useEffect(() => {
    // setState 放进异步函数里(不在 effect 同步阶段调),避免级联渲染
    let alive = true;
    (async () => {
      setLoadingC(true);
      try {
        const d = await admin.getCheckins({ day });
        if (alive) setCheckins(d);
      } catch {
        if (alive) toast.error('加载签到数据失败');
      } finally {
        if (alive) setLoadingC(false);
      }
    })();
    // 快速切日期时,旧请求返回后不该覆盖新结果
    return () => { alive = false; };
  }, [day]);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingT(true);
      try {
        const d = await admin.getTeachersOverview(days);
        if (alive) setOverview(d);
      } catch {
        if (alive) toast.error('加载教师数据失败');
      } finally {
        if (alive) setLoadingT(false);
      }
    })();
    return () => { alive = false; };
  }, [days]);

  /** 前端只做「搜名字 + 只看未签」的过滤,不改后端口径 ——
   *  顶部那个「已签/共」始终显示全班真实数,过滤只影响下面的表格。 */
  const filtered = useMemo(() => {
    const list = checkins?.students || [];
    const kw = keyword.trim().toLowerCase();
    return list.filter((s) => {
      if (onlyUnchecked && s.checked) return false;
      if (!kw) return true;
      return (s.name || '').toLowerCase().includes(kw)
        || (s.class_name || '').toLowerCase().includes(kw)
        || (s.teacher_name || '').toLowerCase().includes(kw);
    });
  }, [checkins, keyword, onlyUnchecked]);

  const sortedTeachers = useMemo(() => {
    const list = [...(overview?.teachers || [])];
    // 没带学生的老师恒排最后 —— 他们所有指标都是 0,混在中间会顶掉有效信息
    return list.sort((a, b) => {
      if (!a.student_count !== !b.student_count) return a.student_count ? -1 : 1;
      return (b[sortKey] as number) - (a[sortKey] as number);
    });
  }, [overview, sortKey]);

  const note = checkins?.checkin_note || overview?.checkin_note;

  return (
    <div className="admin-legacy-page min-h-screen">
      <StaffWorkspaceHeader role="admin" title="签到与教学数据"
        subtitle="全部班级的签到明细 · 教师横向对比" icon={CalendarCheck} backTo="/admin" />

      <main className="admin-workspace-main">
        {note && (
          <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">
            {note}
          </p>
        )}

        <div className="mb-5 flex gap-2">
          {([['checkins', '签到明细'], ['teachers', '教师对比']] as [Tab, string][]).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)}
              className={`min-h-9 rounded-xl px-4 text-sm font-semibold ${
                tab === k ? 'admin-primary text-white' : 'bg-white text-slate-600 border border-slate-300'}`}>
              {label}
            </button>
          ))}
        </div>

        {tab === 'checkins' ? (
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-4 flex flex-wrap items-end gap-3">
              <label className="text-sm text-slate-600">
                日期
                <input type="date" value={day} max={todayLocal()}
                  onChange={(e) => setDay(e.target.value)}
                  className="ml-2 min-h-9 rounded-lg border border-slate-300 px-2 text-sm" />
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input type="text" value={keyword} onChange={(e) => setKeyword(e.target.value)}
                  placeholder="搜学生/班级/老师" aria-label="搜索"
                  className="w-48 rounded-lg border border-slate-300 py-2 pl-8 pr-3 text-sm" />
              </div>
              <label className="inline-flex items-center gap-1.5 text-sm text-slate-600">
                <input type="checkbox" checked={onlyUnchecked}
                  onChange={(e) => setOnlyUnchecked(e.target.checked)}
                  className="h-4 w-4 accent-[#3976a9]" />
                只看未签到
              </label>
              {checkins && (
                <span className="ml-auto text-sm text-slate-600">
                  已签 <strong className={rateColor(checkins.checkin_rate)}>{checkins.checked}</strong>
                  {' '}/ {checkins.total} 人
                  <span className={`ml-2 font-semibold ${rateColor(checkins.checkin_rate)}`}>
                    {checkins.checkin_rate}%
                  </span>
                </span>
              )}
            </div>

            {loadingC ? (
              <div className="py-10 text-center text-sm text-slate-400">加载中…</div>
            ) : filtered.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-400">
                {checkins?.total ? '没有符合条件的学生' : '这一天没有在读学生记录'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] whitespace-nowrap text-sm">
                  <thead>
                    <tr className="border-b text-left text-slate-500">
                      <th className="py-2 pr-4">学生</th>
                      <th className="py-2 pr-4">班级</th>
                      <th className="py-2 pr-4">老师</th>
                      <th className="py-2 pr-4">签到</th>
                      <th className="py-2">时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((s) => (
                      <tr key={s.student_id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                        <td className="py-2.5 pr-4 font-medium text-slate-800">{s.name}</td>
                        <td className="py-2.5 pr-4 text-slate-600">{s.class_name}</td>
                        <td className="py-2.5 pr-4 text-slate-500">{s.teacher_name || '—'}</td>
                        <td className="py-2.5 pr-4">
                          {s.checked
                            ? <span className="text-green-600">✓ 已签</span>
                            : <span className="text-slate-400">✗ 未签</span>}
                        </td>
                        <td className="py-2.5 text-slate-500">{s.checked_at || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
              <div className="flex gap-1.5">
                {[7, 30].map((d) => (
                  <button key={d} type="button" onClick={() => setDays(d)}
                    className={`min-h-8 rounded-lg border px-3 text-sm font-medium ${
                      days === d ? 'border-[#3976a9] bg-[#3976a9] text-white'
                                 : 'border-slate-300 bg-white text-slate-600'}`}>
                    近 {d} 天
                  </button>
                ))}
              </div>
              <label className="text-sm text-slate-600">
                排序
                <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}
                  className="ml-2 min-h-9 rounded-lg border border-slate-300 bg-white px-2 text-sm">
                  <option value="student_count">学生数</option>
                  <option value="checkin_rate">签到率</option>
                  <option value="active_rate">活跃率</option>
                  <option value="study_minutes">学习时长</option>
                  <option value="vocab">词汇量</option>
                </select>
              </label>
            </div>

            {overview && (
              <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: '老师', value: overview.totals.teacher_count, unit: '人' },
                  { label: '在读学生', value: overview.totals.student_count, unit: '人' },
                  { label: '整体签到率', value: overview.totals.checkin_rate, unit: '%' },
                  { label: '活跃学生', value: overview.totals.active_students, unit: '人' },
                ].map((m) => (
                  <div key={m.label} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                    <div className="text-xs text-slate-500">{m.label}</div>
                    <div className="mt-1 text-xl font-bold text-slate-800">
                      {m.value}<span className="ml-0.5 text-xs font-normal text-slate-400">{m.unit}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {loadingT ? (
              <div className="py-10 text-center text-sm text-slate-400">加载中…</div>
            ) : sortedTeachers.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-400">暂无老师</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[820px] whitespace-nowrap text-sm">
                  <thead>
                    <tr className="border-b text-left text-slate-500">
                      <th className="py-2 pr-4">老师</th>
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
                    {sortedTeachers.map((t) => (
                      <tr key={t.teacher_id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                        <td className="py-2.5 pr-4">
                          <span className="font-medium text-slate-800">{t.full_name || t.username}</span>
                          {!t.is_active && <span className="ml-1.5 text-xs text-red-500">已停用</span>}
                        </td>
                        <td className="py-2.5 pr-4 text-slate-600">{t.class_count}</td>
                        <td className="py-2.5 pr-4 text-slate-600">{t.student_count}</td>
                        <td className={`py-2.5 pr-4 font-semibold ${
                          t.student_count ? rateColor(t.checkin_rate) : 'text-slate-300'}`}>
                          {t.student_count ? `${t.checkin_rate}%` : '—'}
                        </td>
                        <td className="py-2.5 pr-4 text-slate-600">
                          {t.student_count
                            ? <>{t.active_students}<span className="ml-1 text-xs text-slate-400">({t.active_rate}%)</span></>
                            : '—'}
                        </td>
                        <td className="py-2.5 pr-4 text-slate-600">{t.study_minutes} 分</td>
                        <td className="py-2.5 pr-4 text-slate-600">{t.vocab}</td>
                        <td className="py-2.5">
                          <button onClick={() => navigate(`/admin/teachers/${t.teacher_id}`)}
                            className="text-[#3976a9] hover:underline">查看详情</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
