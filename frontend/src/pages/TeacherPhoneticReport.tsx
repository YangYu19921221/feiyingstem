/**
 * 音标学习报告 —— 全班(2026-11-03)
 *
 * 老师先看这一页找人: 最上面「全班最多人弱的音」(该在课上统一讲的),下面每个学生一行,
 * **没练过的排最前**、其余按写音标第一遍正确率从低到高(要找的就是这些人)。点名字进那个孩子的完整报告。
 * 口径真源 backend/app/services/phonetic_report.py
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, LoaderCircle, Users } from 'lucide-react';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import { phonemeAudioUrl } from '../utils/ipaPhonemes';
import { classPhoneticReport, DAYS_OPTIONS, pct, type ClassReport, type ReportDays } from '../api/phoneticReport';
import { getErrorMessage } from '../utils/errorMessage';

export default function TeacherPhoneticReport() {
  const navigate = useNavigate();
  const [days, setDays] = useState<ReportDays>(30);
  const [r, setR] = useState<ClassReport | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    classPhoneticReport(days)
      .then(d => { if (alive) { setR(d); setErr(''); } })
      .catch(e => { if (alive) setErr(getErrorMessage(e, '加载失败')); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [days]);

  const list = (r?.students ?? []).filter(s => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <div className="min-h-screen bg-[#f6f7f9]">
      <StaffWorkspaceHeader role="teacher" title="音标学习报告" subtitle="全班谁差哪几个音,点名字看详细" icon={BookOpen} />
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="时间范围" className="flex rounded-lg bg-white p-0.5 shadow-sm">
            {DAYS_OPTIONS.map(o => (
              <button key={o.v} type="button" onClick={() => { if (o.v !== days) { setLoading(true); setDays(o.v); } }} aria-pressed={days === o.v}
                className={`rounded-md px-3 py-1.5 text-sm font-semibold ${days === o.v ? 'bg-[#2f8791] text-white' : 'text-slate-600'}`}>
                {o.label}
              </button>
            ))}
          </div>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜学生名字"
            className="ml-auto w-48 rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
        </div>

        {loading && !r ? (
          <div className="flex justify-center py-20"><LoaderCircle className="h-7 w-7 animate-spin text-[#2f8791]" /></div>
        ) : err ? (
          <p className="mt-4 rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{err}</p>
        ) : r && (
          <div className={loading ? 'opacity-60' : ''}>
            <section className="mt-4 rounded-2xl bg-white p-5 shadow-sm">
              <h2 className="text-lg font-bold text-[#173047]">全班最多人弱的音</h2>
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
              <h2 className="flex items-center gap-2 text-lg font-bold text-[#173047]">
                <Users className="h-5 w-5 text-[#2f8791]" aria-hidden /> 每个学生
                {r.not_started > 0 && <span className="text-sm font-normal text-rose-600">· {r.not_started} 人这段时间没练过</span>}
              </h2>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[46rem] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-slate-500">
                      <th className="py-2 pr-3">学生</th><th className="pr-3">练了</th><th className="pr-3">写音标(第一遍)</th>
                      <th className="pr-3">读音标(读到绿)</th><th className="pr-3">听力</th><th className="pr-3">视频看完</th><th>最弱的音</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map(s => (
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
                {!list.length && <p className="py-6 text-center text-sm text-slate-500">{q ? '搜不到这个名字(只能搜你班上的学生)' : '你还没有班级学生'}</p>}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
