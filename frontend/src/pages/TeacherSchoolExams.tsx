/**
 * 教师端「学校考试 · 丢分分析」(2026-11-26,/teacher/school-exams)。规则见后端 services/school_exam.py 文件头。
 *
 * 建一次考试: 哪个班、叫什么、哪天考的、这次考试的卷子(试卷库里拆好的那份;没传也能建,只是只能录分)、有哪几道大题和满分。
 * 建好进去: 录各大题得分 / 孩子拍批改过的卷子 → 每个孩子丢分在哪 + 全班汇总。
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileStack, GraduationCap, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import { toast } from '../components/Toast';
import { createExam, getExamMeta, listExams, type ExamMeta, type ExamSection, type SchoolExam } from '../api/schoolExam';
import { getErrorMessage } from '../utils/errorMessage';

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function TeacherSchoolExams() {
  const navigate = useNavigate();
  const [meta, setMeta] = useState<ExamMeta | null>(null);
  const [exams, setExams] = useState<SchoolExam[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [classId, setClassId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [date, setDate] = useState(today());
  const [docId, setDocId] = useState<number | null>(null);
  const [paperTitle, setPaperTitle] = useState('');
  const [sections, setSections] = useState<ExamSection[]>([]);
  const [openUpload, setOpenUpload] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getExamMeta().then((m) => {
      setMeta(m);
      setSections(m.default_sections);
      if (m.classes.length) setClassId(m.classes[0].id);
      if (m.enabled) listExams().then((r) => setExams(r.items)).catch((e) => toast.error(getErrorMessage(e, '没加载出来')));
    }).catch((e) => toast.error(getErrorMessage(e, '没加载出来')));
  }, []);

  const doc = useMemo(() => meta?.docs.find((d) => d.id === docId) || null, [meta, docId]);
  const papers = doc?.papers.filter((p) => p.title) ?? [];
  const totalFull = sections.reduce((a, s) => a + (Number(s.full) || 0), 0);

  const setSec = (i: number, patch: Partial<ExamSection>) =>
    setSections((old) => old.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const submit = async () => {
    if (!classId) return toast.error('先选一个班');
    if (!name.trim()) return toast.error('给这次考试起个名字,比如「七上期中考试」');
    const secs = sections.filter((s) => s.name.trim());
    if (!secs.length) return toast.error('至少写一道大题');
    setSaving(true);
    try {
      const e = await createExam({
        class_id: classId, name: name.trim(), exam_date: date || null, doc_id: docId,
        paper_title: papers.length > 1 ? (paperTitle || null) : (papers[0]?.title || null),
        sections: secs.map((s) => ({ name: s.name.trim(), full: s.full === null || s.full === undefined || String(s.full) === '' ? null : Number(s.full) })),
        open_upload: openUpload,
      });
      toast.success('建好了');
      navigate(`/teacher/school-exams/${e.id}`);
    } catch (err) {
      toast.error(getErrorMessage(err, '没建成'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#f5f8fc] text-slate-800">
      <StaffWorkspaceHeader role="teacher" title="学校考试 · 丢分分析" subtitle="孩子在学校考完,看他丢分丢在哪个知识点"
        icon={GraduationCap} backTo="/teacher/dashboard"
        action={<button type="button" onClick={() => navigate('/teacher/paper-bank')}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50">
          <FileStack className="h-4 w-4" /> 试卷库</button>} />
      <main className="teacher-workspace-main mx-auto max-w-4xl space-y-4">
        {!meta && <div className="flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" /> 加载中…</div>}
        {meta && !meta.enabled && <section className="rounded-xl border border-slate-200 bg-white px-4 py-4 text-sm">{meta.reason}</section>}
        {meta?.enabled && (
          <>
            <section className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm leading-6">
              <p><b>怎么用:</b> ① 先把这次考试的卷子(空白的、或者随便一个孩子的)传进<button type="button" className="mx-1 font-semibold text-[#d9541e] underline" onClick={() => navigate('/teacher/paper-bank')}>试卷库</button>拆好;
                ② 在这里建一次考试、选上那份卷子;③ 孩子回家把老师批改过的卷子拍下来传上来(也可以你替他传),或者你直接录各大题的分。</p>
              <p className="text-slate-500">读出来的每道题对上知识点,每个孩子得到一份「这次考试丢分在哪」,第二天起他的每日小卷先补这些点。照片不存,只存读出来的字。</p>
            </section>

            {!showForm && (
              <button type="button" onClick={() => setShowForm(true)} disabled={!meta.classes.length}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#FF6B35] px-5 font-semibold text-white disabled:bg-slate-300">
                <Plus className="h-4 w-4" /> 建一次考试
              </button>
            )}
            {!meta.classes.length && <p className="text-sm text-slate-500">你还没有班级,先去班级管理建一个班。</p>}

            {showForm && (
              <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="text-sm">班级
                    <select value={classId ?? ''} onChange={(e) => setClassId(Number(e.target.value))}
                      className="mt-1 block min-h-10 w-full rounded-lg border border-slate-300 px-2">
                      {meta.classes.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </label>
                  <label className="text-sm">考试名字
                    <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="七上期中考试"
                      className="mt-1 block min-h-10 w-full rounded-lg border border-slate-300 px-3" />
                  </label>
                  <label className="text-sm">哪天考的
                    <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                      className="mt-1 block min-h-10 w-full rounded-lg border border-slate-300 px-3" />
                  </label>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="text-sm">这次考试的卷子(试卷库里拆好的)
                    <select value={docId ?? ''} onChange={(e) => { setDocId(e.target.value ? Number(e.target.value) : null); setPaperTitle(''); }}
                      className="mt-1 block min-h-10 w-full rounded-lg border border-slate-300 px-2">
                      <option value="">还没传(先只录分)</option>
                      {meta.docs.map((d) => <option key={d.id} value={d.id}>{d.title}{d.grade ? ` · ${d.grade}` : ''}{d.status === 'parsing' || d.status === 'queued' ? '(还在拆)' : ''}</option>)}
                    </select>
                  </label>
                  {papers.length > 1 && (
                    <label className="text-sm">这份文件里有好几套卷,是哪一套
                      <select value={paperTitle} onChange={(e) => setPaperTitle(e.target.value)}
                        className="mt-1 block min-h-10 w-full rounded-lg border border-slate-300 px-2">
                        <option value="">整份文件</option>
                        {papers.map((p) => <option key={p.title} value={p.title}>{p.title}({p.items} 道)</option>)}
                      </select>
                    </label>
                  )}
                </div>
                <div>
                  <p className="text-sm">大题和满分(照卷子上的写;合计 {totalFull} 分)</p>
                  <div className="mt-2 space-y-2">
                    {sections.map((s, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <input value={s.name} onChange={(e) => setSec(i, { name: e.target.value })} maxLength={20} aria-label={`第 ${i + 1} 道大题名`}
                          className="min-h-10 flex-1 rounded-lg border border-slate-300 px-3 text-sm" />
                        <input value={s.full ?? ''} onChange={(e) => setSec(i, { full: e.target.value === '' ? null : Number(e.target.value) })}
                          inputMode="decimal" aria-label={`${s.name} 满分`} placeholder="满分"
                          className="min-h-10 w-20 rounded-lg border border-slate-300 px-2 text-sm" />
                        <button type="button" aria-label={`删掉${s.name}`} onClick={() => setSections((o) => o.filter((_, j) => j !== i))}
                          className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-rose-600">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                    <button type="button" onClick={() => setSections((o) => [...o, { name: '', full: null }])}
                      className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-sm text-slate-600 hover:bg-slate-100">
                      <Plus className="h-4 w-4" /> 加一道大题
                    </button>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={openUpload} onChange={(e) => setOpenUpload(e.target.checked)} className="h-4 w-4" />
                  孩子可以自己拍卷子传(不勾就只能你替他传)
                </label>
                <div className="flex gap-2">
                  <button type="button" onClick={submit} disabled={saving}
                    className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-slate-800 px-4 text-sm font-semibold text-white disabled:bg-slate-300">
                    {saving && <LoaderCircle className="h-4 w-4 animate-spin" />} 建好了,进去
                  </button>
                  <button type="button" onClick={() => setShowForm(false)} className="min-h-10 rounded-lg px-4 text-sm text-slate-600 hover:bg-slate-100">取消</button>
                </div>
              </section>
            )}

            <section className="space-y-2">
              <h2 className="text-sm font-semibold text-slate-600">建过的考试</h2>
              {exams === null && <LoaderCircle className="h-4 w-4 animate-spin text-slate-400" />}
              {exams?.length === 0 && <p className="rounded-xl border border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">还没有。孩子在学校考完一次,就建一次。</p>}
              {exams?.map((e) => (
                <button key={e.id} type="button" onClick={() => navigate(`/teacher/school-exams/${e.id}`)}
                  className="flex w-full flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm hover:border-slate-300">
                  <span>
                    <b className="text-slate-900">{e.name}</b>
                    <span className="ml-2 text-sm text-slate-500">{e.class_name} · {e.exam_date || '没写日期'}</span>
                  </span>
                  <span className="text-sm text-slate-500">{e.doc_id ? `卷子: ${e.paper_title || e.doc_title || ''}` : '没挂卷子(只能录分)'}</span>
                </button>
              ))}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
