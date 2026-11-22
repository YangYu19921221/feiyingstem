/**
 * 教师端「专项小卷 · 全班薄弱点」(2026-11-22,/teacher/paper-bank/class)。规则见后端 services/paper_bank.py。
 *
 * 看一个班: 每个知识点多少孩子要补 / 还不稳 / 掌握得不错 / 还看不出;全班老犯的错(线下课就讲这个);
 * 每个孩子最该补的 3 个点和今天的小卷做到哪了。
 * 两个动作: 布置每日小卷(一天一份、当天截止,算进今天的任务)、打印全班今天的小卷(学生版 / 教师版)。
 * 孩子做了不到 4 道某个点的题,这个点写「还看不出」—— 刚开始大多数点都是这样,做几天就清楚了。
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ClipboardList, FileStack, LoaderCircle, Printer } from 'lucide-react';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import PaperPrintSheet from '../components/paper/PaperPrintSheet';
import { toast } from '../components/Toast';
import {
  assignPaperQuiz, getPaperClasses, getPaperClassView, getPaperStatus, printClassQuizzes,
  type ClassView, type PaperStatus, type PrintPaper,
} from '../api/paperBank';
import { getErrorMessage } from '../utils/errorMessage';

const DAY_OPTIONS = [1, 5, 7, 14];

export default function TeacherPaperClass() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<PaperStatus | null>(null);
  const [classes, setClasses] = useState<Array<{ id: number; name: string }>>([]);
  const [classId, setClassId] = useState<number | null>(null);
  const [view, setView] = useState<ClassView | null>(null);
  const [loading, setLoading] = useState(false);
  const [days, setDays] = useState(5);
  const [gradeTarget, setGradeTarget] = useState(0);
  const [busy, setBusy] = useState<'assign' | 'print' | null>(null);
  const [papers, setPapers] = useState<PrintPaper[] | null>(null);

  useEffect(() => {
    getPaperStatus().then(setStatus).catch(() => undefined);
    getPaperClasses().then((r) => {
      setClasses(r.items);
      if (r.items.length) setClassId(r.items[0].id);
    }).catch((e) => toast.error(getErrorMessage(e, '班级没加载出来')));
  }, []);

  const load = useCallback(async (cid: number) => {
    setLoading(true);
    try {
      setView(await getPaperClassView(cid));
    } catch (e) {
      toast.error(getErrorMessage(e, '加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { if (classId) void load(classId); }, [classId, load]);

  const assign = async () => {
    if (!view || !view.students.length) return;
    if (!window.confirm(`给「${view.class.name}」${view.students.length} 个孩子布置每日小卷,从今天起连续 ${days} 天?\n\n每天一份、当天做完,算进今天的任务;不发金币。`)) return;
    setBusy('assign');
    try {
      const r = await assignPaperQuiz(view.students.map((s) => s.id), days, gradeTarget);
      toast.success(`布置好了: ${r.homework_ids.length} 天,孩子在「我的作业」和首页「今日小卷」里看得到`);
    } catch (e) {
      toast.error(getErrorMessage(e, '没布置上'));
    } finally {
      setBusy(null);
    }
  };

  const print = async () => {
    if (!classId) return;
    setBusy('print');
    try {
      const r = await printClassQuizzes(classId);
      if (r.skipped.length) toast.error(`${r.skipped.length} 个孩子今天出不了小卷(比如${r.skipped[0].name}: ${r.skipped[0].reason})`);
      if (r.papers.length) setPapers(r.papers);
    } catch (e) {
      toast.error(getErrorMessage(e, '没出来'));
    } finally {
      setBusy(null);
    }
  };

  const closePrint = useCallback(() => setPapers(null), []);
  const bankEmpty = view && view.bank.total === 0;

  return (
    <div className="min-h-screen bg-[#f5f8fc] text-slate-800">
      <StaffWorkspaceHeader role="teacher" title="专项小卷 · 全班薄弱点" subtitle="谁哪个点不会、老犯哪种错;布置或打印每天的小卷"
        icon={ClipboardList} backTo="/teacher/paper-bank"
        action={<button type="button" onClick={() => navigate('/teacher/paper-bank')}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
          <FileStack className="h-4 w-4" /> 试卷库</button>} />
      <main className="teacher-workspace-main mx-auto max-w-5xl space-y-5">
        {status && !status.enabled && <section className="rounded-xl border border-slate-200 bg-white px-4 py-4 text-sm">{status.reason}</section>}
        {classes.length === 0 && status?.enabled && (
          <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">你还没有班级。</p>
        )}
        {classes.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            {classes.map((c) => (
              <button key={c.id} type="button" onClick={() => setClassId(c.id)} aria-pressed={classId === c.id}
                className={`min-h-9 rounded-lg px-3 text-sm ${classId === c.id ? 'bg-slate-800 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'}`}>{c.name}</button>
            ))}
            {loading && <LoaderCircle className="h-4 w-4 animate-spin text-slate-400" />}
          </div>
        )}

        {view && (
          <>
            {bankEmpty && (
              <section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                题库里还没有通过核对的题,孩子出不了小卷。先去<button type="button" className="mx-1 font-semibold underline" onClick={() => navigate('/teacher/paper-bank')}>试卷库</button>传一份卷子、核对一下。
              </section>
            )}
            <section className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:grid-cols-2">
              <div className="space-y-2">
                <h3 className="font-semibold text-slate-900">布置每日小卷</h3>
                <p className="text-xs leading-5 text-slate-500">每个孩子每天一份 {status?.quiz_size ?? 10} 道题,专挑他不会的点和没记牢的单词;同一道题不会出第二次。刚开始几天先摸底。</p>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-slate-600">连续</span>
                  {DAY_OPTIONS.map((d) => (
                    <button key={d} type="button" onClick={() => setDays(d)} aria-pressed={days === d}
                      className={`min-h-9 rounded-lg px-3 ${days === d ? 'bg-[#FF6B35] font-semibold text-white' : 'bg-white ring-1 ring-slate-200'}`}>{d} 天</button>
                  ))}
                </div>
                <label className="block text-sm">
                  <span className="text-slate-600">用哪个年级的卷子出题</span>
                  <select value={gradeTarget} onChange={(e) => setGradeTarget(Number(e.target.value))}
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-base sm:text-sm">
                    <option value={0}>按每个孩子自己的年级(推荐)</option>
                    {(status?.grades ?? []).map((g, i) => <option key={g} value={i + 1}>{g}及以下的卷子</option>)}
                  </select>
                </label>
                <button type="button" disabled={busy !== null || !!bankEmpty || !view.students.length} onClick={assign}
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-900 px-4 text-sm font-semibold text-white disabled:bg-slate-300">
                  {busy === 'assign' && <LoaderCircle className="h-4 w-4 animate-spin" />} 给全班 {view.students.length} 人布置
                </button>
              </div>
              <div className="space-y-2">
                <h3 className="font-semibold text-slate-900">打印今天的小卷</h3>
                <p className="text-xs leading-5 text-slate-500">每个孩子一份(和他网页上那份一样),学生版只有题,教师版带答案。纸上做完,孩子在网页上把答案点进去才记进学情。</p>
                <button type="button" disabled={busy !== null || !!bankEmpty || !view.students.length} onClick={print}
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-white px-4 text-sm font-semibold text-slate-800 ring-1 ring-slate-300 disabled:opacity-50">
                  {busy === 'print' ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />} 打印全班今天的小卷
                </button>
              </div>
            </section>

            {view.codes.length > 0 && (
              <section className="rounded-xl border border-rose-200 bg-rose-50/60 px-4 py-3 text-sm">
                <h3 className="mb-1 font-semibold text-rose-900">全班老犯的错(线下课可以讲这几个)</h3>
                <ul className="space-y-0.5 text-rose-900">
                  {view.codes.map((c) => <li key={c.code}>· {c.label} —— {c.students} 个孩子犯过两次以上</li>)}
                </ul>
              </section>
            )}

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="mb-2 font-semibold text-slate-900">每个知识点</h3>
              <p className="mb-2 text-xs text-slate-500">「还看不出」= 做的题还不到 4 道。题库数 = 题库里这个点有几道通过核对的题(太少的话孩子的小卷里这个点会不够)。</p>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] text-sm">
                  <thead><tr className="text-left text-xs text-slate-500">
                    <th className="py-1 pr-2 font-normal">知识点</th><th className="px-2 font-normal text-rose-700">要补</th>
                    <th className="px-2 font-normal text-amber-700">还不稳</th><th className="px-2 font-normal text-emerald-700">不错</th>
                    <th className="px-2 font-normal">还看不出</th><th className="px-2 font-normal">题库数</th>
                  </tr></thead>
                  <tbody>
                    {view.kps.map((k) => (
                      <tr key={k.kp} className="border-t border-slate-100">
                        <td className="py-1.5 pr-2">{k.name}</td>
                        <td className="px-2 font-semibold text-rose-700">{k.weak || ''}</td>
                        <td className="px-2 text-amber-700">{k.shaky || ''}</td>
                        <td className="px-2 text-emerald-700">{k.good || ''}</td>
                        <td className="px-2 text-slate-400">{k.unknown || ''}</td>
                        <td className={`px-2 ${k.bank < 5 ? 'text-amber-700' : 'text-slate-500'}`}>{k.bank}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="font-semibold text-slate-900">每个孩子</h3>
              {view.students.map((s) => (
                <div key={s.id} className="flex flex-wrap items-start gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
                  <div className="w-28 shrink-0">
                    <div className="font-medium text-slate-900">{s.name}</div>
                    <div className="text-xs text-slate-500">
                      {s.today ? (s.today.status === 'done' ? '今天的做完了' : `今天做了 ${s.today.answered}/${s.today.total}`) : '今天还没打开'}
                    </div>
                  </div>
                  <div className="min-w-[12rem] flex-1 text-sm">
                    {s.top.length === 0 ? (
                      <span className="text-slate-400">{s.answered === 0 ? '还没做过小卷' : '暂时没有明显要补的点'}</span>
                    ) : (
                      <ul className="space-y-0.5">
                        {s.top.map((t) => (
                          <li key={t.kp}>
                            <span className={t.label === '要补' ? 'font-semibold text-rose-700' : 'text-amber-700'}>{t.label}</span>
                            <span className="text-slate-800"> {t.name}</span>
                            {t.p != null && <span className="text-xs text-slate-400"> 大概能对 {Math.round(t.p * 100)}%</span>}
                            {t.misconceptions.length > 0 && <span className="block text-xs text-rose-600">老犯: {t.misconceptions.join(';')}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">近 7 天做了 {s.week.n} 道{s.week.n ? `,对 ${s.week.right}` : ''}</div>
                </div>
              ))}
            </section>
          </>
        )}
      </main>
      {papers && <PaperPrintSheet papers={papers} onClose={closePrint} />}
    </div>
  );
}
