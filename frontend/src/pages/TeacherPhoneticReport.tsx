/**
 * 音标学习报告 —— 全班(2026-11-03;11-04 加分页 / 搜名字 / 按班级 / 按状态)
 *
 * 老师先看这一页找人: 最上面「全班最多人弱的音」(该在课上统一讲的),下面每个学生一行,
 * **没练过的排最前**、其余按写音标第一遍正确率从低到高(要找的就是这些人)。点名字进那个孩子的完整报告。
 * 搜索、班级、状态、翻页都在后端做(一个老师名下能有几百个学生,一次全给页面会很长);
 * 「全班最多人弱的音」和各状态人数按当前班级算,不跟着搜索 / 翻页变。
 * 口径真源 backend/app/services/phonetic_report.py
 */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, ChevronLeft, ChevronRight, LoaderCircle, Search, Users } from 'lucide-react';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import { phonemeAudioUrl } from '../utils/ipaPhonemes';
import {
  classPhoneticReport, DAYS_OPTIONS, pct, type ClassReport, type ClassStatus, type ReportDays,
} from '../api/phoneticReport';
import { getErrorMessage } from '../utils/errorMessage';

const STATUS_LABEL: Record<ClassStatus, string> = {
  all: '全部', not_started: '没练过', weak: '有弱音', ok: '没有弱音',
};
const PAGE_SIZES = [20, 50, 100];

export default function TeacherPhoneticReport() {
  const navigate = useNavigate();
  const [days, setDays] = useState<ReportDays>(30);
  const [classId, setClassId] = useState<number | null>(null);
  const [status, setStatus] = useState<ClassStatus>('all');
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [r, setR] = useState<ClassReport | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);

  // 搜索框停手 300ms 再搜,每敲一个字发一次请求没必要
  useEffect(() => {
    const t = window.setTimeout(() => { setQ(qInput); setPage(1); }, 300);
    return () => window.clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    const my = ++seq.current;
    classPhoneticReport({ days, class_id: classId, q, status, page, page_size: pageSize })
      .then(d => { if (my === seq.current) { setR(d); setErr(''); } })
      .catch(e => { if (my === seq.current) setErr(getErrorMessage(e, '加载失败')); })
      .finally(() => { if (my === seq.current) setLoading(false); });
  }, [days, classId, q, status, page, pageSize]);

  /** 改了筛选条件: 回第 1 页,并显示正在加载 */
  const change = (fn: () => void) => { setLoading(true); setPage(1); fn(); };

  return (
    <div className="min-h-screen bg-[#f6f7f9]">
      <StaffWorkspaceHeader role="teacher" title="音标学习报告" subtitle="全班谁差哪几个音,点名字看详细" icon={BookOpen} />
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="时间范围" className="flex rounded-lg bg-white p-0.5 shadow-sm">
            {DAYS_OPTIONS.map(o => (
              <button key={o.v} type="button" onClick={() => { if (o.v !== days) change(() => setDays(o.v)); }} aria-pressed={days === o.v}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${days === o.v ? 'bg-[#2f8791] text-white' : 'text-slate-600'}`}>
                {o.label}
              </button>
            ))}
          </div>
          {r && r.classes.length > 1 && (
            <select value={classId ?? ''} onChange={e => change(() => setClassId(e.target.value ? Number(e.target.value) : null))}
              aria-label="班级" className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm">
              <option value="">全部班级</option>
              {r.classes.map(c => <option key={c.id} value={c.id}>{c.name}({c.students} 人)</option>)}
            </select>
          )}
          <label className="ml-auto flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5">
            <Search className="h-4 w-4 text-slate-400" aria-hidden />
            <input value={qInput} onChange={e => setQInput(e.target.value)} placeholder="搜学生名字" aria-label="搜学生名字"
              className="w-40 text-sm outline-none" />
          </label>
        </div>

        {loading && !r ? (
          <div className="flex justify-center py-20"><LoaderCircle className="h-7 w-7 animate-spin text-[#2f8791]" /></div>
        ) : err ? (
          <p className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{err}</p>
        ) : r && (
          <div className={loading ? 'opacity-60' : ''}>
            <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-[#173047]">
                {classId ? `${r.classes.find(c => c.id === classId)?.name ?? ''} ` : ''}最多人弱的音
              </h2>
              <p className="mt-0.5 text-xs text-slate-500">
                写对不到 75%、练了 4 次以上算弱。人多的适合课上统一讲。点 /音标/ 听这个音
              </p>
              {r.class_weak.length ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {r.class_weak.map(c => (
                    <div key={c.phoneme} className="rounded-xl bg-rose-50 p-3 ring-1 ring-rose-200">
                      <div className="flex items-center gap-2">
                        <button type="button" onClick={() => { const u = phonemeAudioUrl(c.phoneme); if (u) new Audio(u).play().catch(() => {}); }}
                          className="rounded-md bg-white px-2 font-mono text-xl ring-1 ring-slate-300">/{c.phoneme}/</button>
                        <span className="font-semibold text-rose-700">{c.students} 人</span>
                      </div>
                      <p className="mt-1.5 text-xs text-slate-600">{c.names.join('、')}{c.students > c.names.length ? ' 等' : ''}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-3 text-sm text-slate-500">还没有哪个音是很多人都弱的(或者练得还太少)。</p>
              )}
            </section>

            <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="flex items-center gap-2 text-lg font-bold text-[#173047]">
                  <Users className="h-5 w-5 text-[#2f8791]" aria-hidden /> 每个学生
                </h2>
                <div role="group" aria-label="按状态筛" className="ml-auto flex flex-wrap gap-1">
                  {(Object.keys(STATUS_LABEL) as ClassStatus[]).map(k => (
                    <button key={k} type="button" onClick={() => { if (k !== status) change(() => setStatus(k)); }} aria-pressed={status === k}
                      className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${status === k
                        ? (k === 'not_started' ? 'bg-rose-600 text-white ring-rose-600' : 'bg-[#2f8791] text-white ring-[#2f8791]')
                        : 'bg-white text-slate-600 ring-slate-300'}`}>
                      {STATUS_LABEL[k]} {r.counts[k]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[46rem] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-slate-500">
                      <th className="py-2 pr-3">学生</th><th className="pr-3">练了</th><th className="pr-3">写音标(第一遍)</th>
                      <th className="pr-3">读音标(读到绿)</th><th className="pr-3">听力</th><th className="pr-3">视频看完</th><th>最弱的音</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.students.map(s => (
                      <tr key={s.id} className="border-b last:border-0 hover:bg-slate-50">
                        <td className="py-2 pr-3">
                          <button type="button" onClick={() => navigate(`/teacher/students/${s.id}#phonetic-report`)}
                            className="font-medium text-[#2f8791] underline-offset-2 hover:underline">{s.name}</button>
                        </td>
                        {s.has_data ? (
                          <>
                            <td className="pr-3 text-slate-600">{s.active_days} 天 · {s.minutes} 分</td>
                            <td className="pr-3">{s.write_words ? <><b>{pct(s.write_first_right, s.write_words)}</b> <span className="text-xs text-slate-500">{s.write_first_right}/{s.write_words}</span></> : <span className="text-slate-400">—</span>}</td>
                            <td className="pr-3">{s.read_judged ? <><b>{pct(s.read_green, s.read_judged)}</b> <span className="text-xs text-slate-500">{s.read_words} 词</span></> : <span className="text-slate-400">—</span>}</td>
                            <td className="pr-3">{s.listen_items ? <><b>{pct(s.listen_first_right, s.listen_items)}</b> <span className="text-xs text-slate-500">{s.listen_items} 题</span></> : <span className="text-slate-400">—</span>}</td>
                            <td className="pr-3">{s.video_completed || <span className="text-slate-400">—</span>}</td>
                            <td>{s.weak.length ? s.weak.map(p => <span key={p} className="mr-1 rounded bg-rose-50 px-1.5 font-mono text-rose-700">/{p}/</span>) : <span className="text-xs text-slate-400">没有</span>}</td>
                          </>
                        ) : (
                          <td colSpan={6} className="text-sm text-rose-600">这段时间没练过音标</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!r.students.length && (
                  <p className="py-6 text-center text-sm text-slate-500">
                    {q ? `搜不到「${q}」(只能搜你班上的学生)` : status !== 'all' ? `没有「${STATUS_LABEL[status]}」的学生` : '你还没有班级学生'}
                  </p>
                )}
              </div>

              {r.total > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-600">
                  <span>共 {r.total} 人{(q || status !== 'all') && r.total !== r.class_total ? `(全部 ${r.class_total} 人)` : ''}</span>
                  <select value={pageSize} onChange={e => change(() => setPageSize(Number(e.target.value)))} aria-label="每页人数"
                    className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-xs">
                    {PAGE_SIZES.map(n => <option key={n} value={n}>每页 {n} 人</option>)}
                  </select>
                  {r.pages > 1 && (
                    <div className="ml-auto flex items-center gap-1">
                      <button type="button" disabled={r.page <= 1} onClick={() => { setLoading(true); setPage(r.page - 1); }}
                        aria-label="上一页" className="rounded-lg p-1.5 ring-1 ring-slate-300 disabled:opacity-40">
                        <ChevronLeft className="h-4 w-4" />
                      </button>
                      <span className="px-2">第 {r.page} / {r.pages} 页</span>
                      <button type="button" disabled={r.page >= r.pages} onClick={() => { setLoading(true); setPage(r.page + 1); }}
                        aria-label="下一页" className="rounded-lg p-1.5 ring-1 ring-slate-300 disabled:opacity-40">
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
