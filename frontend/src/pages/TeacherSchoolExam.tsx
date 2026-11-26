/**
 * 教师端一次学校考试(2026-11-26,/teacher/school-exams/:id)。规则见后端 services/school_exam.py 文件头。
 *
 * 「全班」: 各大题平均丢几分、哪个知识点错的人最多、常犯的错、每个孩子的分数 / 最该补的点 / 卷子传了没有(点名字看他丢分在哪)。
 * 「录分」: 一个孩子一行、一道大题一列,能从 Excel 整块复制粘贴(从哪一格开始粘就从哪一格往右往下填)。
 * 有孩子的卷子还在读时每 5 秒刷新一次。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { GraduationCap, LoaderCircle, Save, Trash2 } from 'lucide-react';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import SheetBadge from '../components/schoolExam/SheetBadge';
import { toast } from '../components/Toast';
import {
  deleteExam, getExam, getExamMeta, patchExam, putScores, type ClassReport, type ExamMeta,
} from '../api/schoolExam';
import { getErrorMessage } from '../utils/errorMessage';

type Tab = 'class' | 'scores';

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export default function TeacherSchoolExam() {
  const { id: idStr } = useParams();
  const id = Number(idStr);
  const navigate = useNavigate();
  const [data, setData] = useState<ClassReport | null>(null);
  const [meta, setMeta] = useState<ExamMeta | null>(null);
  const [tab, setTab] = useState<Tab>('class');
  const [grid, setGrid] = useState<Record<number, Record<string, string>>>({});
  const [dirty, setDirty] = useState<Set<number>>(new Set());
  const [saving, setSaving] = useState(false);
  const loadedGrid = useRef(false);

  const load = useCallback(async () => {
    try {
      const d = await getExam(id);
      setData(d);
      if (!loadedGrid.current) {
        loadedGrid.current = true;
        const g: Record<number, Record<string, string>> = {};
        for (const s of d.students) {
          g[s.id] = { __total: s.total === null ? '' : String(s.total) };
          for (const sec of d.exam.sections) g[s.id][sec.name] = s.sections[sec.name] === null || s.sections[sec.name] === undefined ? '' : String(s.sections[sec.name]);
        }
        setGrid(g);
      }
    } catch (e) {
      toast.error(getErrorMessage(e, '没加载出来'));
    }
  }, [id]);

  useEffect(() => { void load(); getExamMeta().then(setMeta).catch(() => undefined); }, [load]);
  const pending = data?.students.some((s) => s.sheet?.status === 'pending');
  useEffect(() => {
    if (!pending) return undefined;
    const t = window.setInterval(() => { void load(); }, 5000);
    return () => window.clearInterval(t);
  }, [pending, load]);

  const cols = useMemo(() => (data ? [...data.exam.sections.map((s) => s.name), '__total'] : []), [data]);

  const setCell = (sid: number, col: string, v: string) => {
    setGrid((g) => ({ ...g, [sid]: { ...(g[sid] || {}), [col]: v } }));
    setDirty((d) => new Set(d).add(sid));
  };

  const onPaste = (e: React.ClipboardEvent, rowIdx: number, colIdx: number) => {
    const text = e.clipboardData.getData('text');
    if (!text.includes('\t') && !text.includes('\n')) return;
    e.preventDefault();
    const lines = text.replace(/\r/g, '').split('\n').filter((l, i, a) => l.length || i < a.length - 1);
    const students = data?.students ?? [];
    // 先算好再一次写进去(别在 setState 的更新函数里再改别的 state: 开发模式会跑两遍)
    const next = { ...grid };
    const touched = new Set(dirty);
    lines.forEach((line, i) => {
      const st = students[rowIdx + i];
      if (!st) return;
      next[st.id] = { ...(next[st.id] || {}) };
      line.split('\t').forEach((c, j) => {
        const col = cols[colIdx + j];
        if (col) next[st.id][col] = c.trim();
      });
      touched.add(st.id);
    });
    setGrid(next);
    setDirty(touched);
  };

  const save = async () => {
    if (!data || !dirty.size) return;
    const bad = Array.from(dirty).some((sid) => Object.values(grid[sid] || {}).some((v) => v !== '' && Number.isNaN(Number(v))));
    if (bad) return toast.error('有的格子不是数字,改一下再保存');
    setSaving(true);
    try {
      const rows = Array.from(dirty).map((sid) => {
        const g = grid[sid] || {};
        const sections: Record<string, string | null> = {};
        for (const s of data.exam.sections) sections[s.name] = g[s.name] === undefined ? null : g[s.name];
        return { student_id: sid, total: g.__total ?? '', sections };
      });
      const r = await putScores(id, rows);
      toast.success(`保存好了(${r.changed} 个孩子有改动)`);
      setDirty(new Set());
      await load();
    } catch (e) {
      toast.error(getErrorMessage(e, '没保存上'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!data || !window.confirm(`删掉「${data.exam.name}」?\n\n分数和读出来的结果都不再显示。已经记进孩子把握度的不会撤回。`)) return;
    try {
      await deleteExam(id);
      navigate('/teacher/school-exams');
    } catch (e) {
      toast.error(getErrorMessage(e, '没删掉'));
    }
  };

  const attachDoc = async (docId: number | null, paperTitle: string | null) => {
    try {
      await patchExam(id, { doc_id: docId, paper_title: paperTitle });
      toast.success('卷子换好了');
      await load();
    } catch (e) {
      toast.error(getErrorMessage(e, '没改成'));
    }
  };

  const toggleUpload = async () => {
    if (!data) return;
    try {
      await patchExam(id, { open_upload: !data.exam.open_upload });
      await load();
    } catch (e) {
      toast.error(getErrorMessage(e, '没改成'));
    }
  };

  const ex = data?.exam;

  return (
    <div className="min-h-screen bg-[#f5f8fc] text-slate-800">
      <StaffWorkspaceHeader role="teacher" title={ex ? ex.name : '学校考试'} icon={GraduationCap} backTo="/teacher/school-exams"
        subtitle={ex ? `${ex.class_name ?? ''} · ${ex.exam_date || '没写日期'}${ex.full_score ? ` · 满分 ${ex.full_score}` : ''}` : undefined} />
      <main className="teacher-workspace-main mx-auto max-w-5xl space-y-4">
        {!data && <div className="flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" /> 加载中…</div>}
        {data && ex && (
          <>
            <section className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
              <span>卷子: {ex.doc_id ? <b>{ex.paper_title || ex.doc_title}</b> : <b className="text-amber-700">还没挂(只能录分)</b>}
                {ex.doc_id && <span className="text-slate-500">(拆出 {data.items_total} 道题)</span>}</span>
              {meta && (
                <select aria-label="换卷子" value={ex.doc_id ?? ''} onChange={(e) => void attachDoc(e.target.value ? Number(e.target.value) : null, null)}
                  className="min-h-9 rounded-lg border border-slate-300 px-2">
                  <option value="">不挂卷子</option>
                  {meta.docs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
                </select>
              )}
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={ex.open_upload} onChange={() => void toggleUpload()} className="h-4 w-4" /> 孩子能自己拍卷子传
              </label>
              <span className="text-slate-500">卷子传了 {data.uploaded} / {data.students.length} 人</span>
              {data.confirm > 0 && <span className="font-semibold text-amber-700">要你确认 {data.confirm} 处(点名字进去看)</span>}
              <button type="button" onClick={() => void remove()} className="ml-auto inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-slate-500 hover:bg-rose-50 hover:text-rose-600">
                <Trash2 className="h-4 w-4" /> 删掉
              </button>
            </section>

            <div className="flex gap-2">
              {([['class', '全班'], ['scores', '录分']] as const).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k}
                  className={`min-h-9 rounded-lg px-4 text-sm ${tab === k ? 'bg-slate-800 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'}`}>{label}</button>
              ))}
            </div>

            {tab === 'class' && (
              <>
                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h2 className="mb-2 text-base font-semibold text-slate-900">各大题{data.avg_total !== null && <span className="ml-2 text-sm font-normal text-slate-500">平均总分 {fmt(data.avg_total)}({data.n_total} 人)</span>}</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[420px] text-sm">
                      <thead><tr className="text-left text-slate-500"><th className="py-1.5">大题</th><th>满分</th><th>平均得分</th><th>平均丢分</th><th>录了几人</th></tr></thead>
                      <tbody>
                        {data.sections.map((s) => (
                          <tr key={s.name} className="border-t border-slate-100">
                            <td className="py-2">{s.name}</td><td>{fmt(s.full)}</td><td>{fmt(s.avg)}</td>
                            <td className={s.lost_avg && s.full && s.lost_avg / s.full >= 0.3 ? 'font-semibold text-rose-600' : ''}>{fmt(s.lost_avg)}</td><td>{s.n}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {data.sections.every((s) => s.n === 0) && <p className="mt-2 text-sm text-slate-500">还没有分数: 去「录分」填,或者等孩子的卷子照片读出来。</p>}
                </section>

                <div className="grid gap-4 md:grid-cols-2">
                  <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <h2 className="mb-2 text-base font-semibold text-slate-900">错的人最多的知识点</h2>
                    {data.kps.length === 0 && <p className="text-sm text-slate-500">{ex.doc_id ? '还没有读好的卷子。' : '挂上卷子、孩子传了照片以后才有。'}</p>}
                    <ul className="space-y-1.5 text-sm">
                      {data.kps.map((k) => (
                        <li key={k.kp} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                          <span>{k.name}</span><span className="text-rose-700">{k.wrong} / {k.seen} 人错</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                    <h2 className="mb-2 text-base font-semibold text-slate-900">全班常犯的错(上课讲这个)</h2>
                    {data.codes.length === 0 && <p className="text-sm text-slate-500">还看不出。</p>}
                    <ul className="space-y-1.5 text-sm">
                      {data.codes.map((c) => (
                        <li key={c.code} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                          <span>{c.label}</span><span className="text-slate-500">{c.students} 人</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>

                <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <h2 className="mb-2 text-base font-semibold text-slate-900">每个孩子(点名字看他丢分在哪,也能替他传卷子)</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] text-sm">
                      <thead><tr className="text-left text-slate-500"><th className="py-1.5">名字</th><th>总分</th><th>丢分最多的大题</th><th>最该补的点</th><th>卷子</th></tr></thead>
                      <tbody>
                        {data.students.map((s) => (
                          <tr key={s.id} className="border-t border-slate-100">
                            <td className="py-2">
                              <button type="button" onClick={() => navigate(`/teacher/school-exams/${id}/students/${s.id}`)}
                                className="font-semibold text-[#d9541e] underline-offset-2 hover:underline">{s.name}</button>
                            </td>
                            <td>{fmt(s.total)}</td>
                            <td>{s.weakest || '—'}</td>
                            <td className="text-slate-600">{s.top.length ? s.top.join('、') : '—'}</td>
                            <td><SheetBadge sheet={s.sheet} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </>
            )}

            {tab === 'scores' && (
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm text-slate-600">一格一个分数,空着 = 没有。可以从 Excel 选一块复制,点第一格粘贴。照片上读出来的分不会盖掉你录的。</p>
                  <button type="button" onClick={() => void save()} disabled={!dirty.size || saving}
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-800 px-4 text-sm font-semibold text-white disabled:bg-slate-300">
                    {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} 保存{dirty.size ? `(${dirty.size} 人)` : ''}
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="text-sm">
                    <thead>
                      <tr className="text-left text-slate-500">
                        <th className="sticky left-0 bg-white py-1.5 pr-3">名字</th>
                        {ex.sections.map((s) => <th key={s.name} className="px-1 font-normal">{s.name}{s.full !== null ? `(${s.full})` : ''}</th>)}
                        <th className="px-1 font-normal">总分</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.students.map((s, ri) => (
                        <tr key={s.id}>
                          <td className="sticky left-0 whitespace-nowrap bg-white py-1 pr-3">{s.name}</td>
                          {cols.map((c, ci) => (
                            <td key={c} className="px-1 py-1">
                              <input value={grid[s.id]?.[c] ?? ''} inputMode="decimal" aria-label={`${s.name} ${c === '__total' ? '总分' : c}`}
                                onChange={(e) => setCell(s.id, c, e.target.value)} onPaste={(e) => onPaste(e, ri, ci)}
                                className={`h-9 w-16 rounded-md border px-2 ${grid[s.id]?.[c] && Number.isNaN(Number(grid[s.id][c])) ? 'border-rose-400 bg-rose-50' : 'border-slate-300'}`} />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
