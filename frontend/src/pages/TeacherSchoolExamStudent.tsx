/**
 * 教师端看一个孩子这次学校考试(2026-11-26,/teacher/school-exams/:id/students/:sid)。规则见后端 services/school_exam.py。
 *
 * 上面「要你确认的题」: 阅卷 AI 看不清的、老师的记号和题库答案对不上的、老师没批而答案又没核对过的 —— 点「对」或「错」就记下
 * (第一次记的时候记进孩子的把握度)。下面是和孩子看到的同一份「这次考试丢分在哪」,最下面能替他传卷子照片、看每道题读成了什么。
 * 照片不存: 想看原卷请孩子拿给你。
 */
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Check, GraduationCap, LoaderCircle, X } from 'lucide-react';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import ExamReportView from '../components/schoolExam/ExamReportView';
import SheetBadge from '../components/schoolExam/SheetBadge';
import SheetPhotoPicker from '../components/schoolExam/SheetPhotoPicker';
import { toast } from '../components/Toast';
import { getStudentReport, resolveItem, teacherUploadSheet, type SheetItem, type StudentReport } from '../api/schoolExam';
import { getErrorMessage } from '../utils/errorMessage';

const MARK: Record<SheetItem['mark'], string> = { right: '老师打了勾', wrong: '老师打了叉', half: '扣了一部分分', none: '看不出老师的记号' };

function ItemRow({ it, onResolve, busy }: { it: SheetItem; onResolve: (ok: boolean) => void; busy: boolean }) {
  return (
    <li className="rounded-lg border border-slate-200 px-3 py-2.5">
      <p className="text-[15px] leading-7 text-slate-900"><b className="mr-1">{it.no}.</b>{it.stem}</p>
      {it.options.length > 0 && <p className="text-sm text-slate-500">{it.options.map((o, i) => `${'ABCDEF'[i]}. ${o}`).join('   ')}</p>}
      <p className="mt-1 text-sm">
        <span>读出来他写的: <b>{it.given || '(没写)'}</b></span>
        <span className="ml-3 text-slate-500">{MARK[it.mark]}{it.lost !== null ? `,扣 ${it.lost} 分` : ''}</span>
        <span className="ml-3 text-emerald-700">题库答案: {it.answer}</span>
      </p>
      {it.note && <p className="mt-0.5 text-sm text-amber-800">{it.note}</p>}
      <div className="mt-2 flex items-center gap-2">
        {it.state === 'recorded' && it.recorded !== null && (
          <span className={`text-sm ${it.recorded ? 'text-emerald-700' : 'text-rose-600'}`}>记的是: {it.recorded ? '对' : '错'}</span>
        )}
        <button type="button" disabled={busy} onClick={() => onResolve(true)}
          className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-emerald-50 px-3 text-sm text-emerald-800 ring-1 ring-emerald-200 disabled:opacity-50">
          <Check className="h-4 w-4" /> 算对
        </button>
        <button type="button" disabled={busy} onClick={() => onResolve(false)}
          className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-rose-50 px-3 text-sm text-rose-800 ring-1 ring-rose-200 disabled:opacity-50">
          <X className="h-4 w-4" /> 算错
        </button>
      </div>
    </li>
  );
}

export default function TeacherSchoolExamStudent() {
  const { id: idStr, sid: sidStr } = useParams();
  const id = Number(idStr);
  const sid = Number(sidStr);
  const [rep, setRep] = useState<StudentReport | null>(null);
  const [sending, setSending] = useState(false);
  const [busyItem, setBusyItem] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      setRep(await getStudentReport(id, sid));
    } catch (e) {
      toast.error(getErrorMessage(e, '没加载出来'));
    }
  }, [id, sid]);
  useEffect(() => { void load(); }, [load]);
  const pending = rep?.sheet?.status === 'pending';
  useEffect(() => {
    if (!pending) return undefined;
    const t = window.setInterval(() => { void load(); }, 4000);
    return () => window.clearInterval(t);
  }, [pending, load]);

  const upload = async (photos: Blob[]) => {
    setSending(true);
    try {
      await teacherUploadSheet(id, sid, photos);
      toast.success('传上去了,一般一两分钟读好');
      await load();
      return true;
    } catch (e) {
      toast.error(getErrorMessage(e, '没传上去'));
      return false;
    } finally {
      setSending(false);
    }
  };

  const resolve = async (itemId: number, ok: boolean) => {
    setBusyItem(itemId);
    try {
      await resolveItem(id, sid, itemId, ok);
      await load();
    } catch (e) {
      toast.error(getErrorMessage(e, '没改成'));
    } finally {
      setBusyItem(null);
    }
  };

  const confirm = rep?.sheet_items?.filter((x) => x.state === 'confirm') ?? [];
  const others = rep?.sheet_items?.filter((x) => x.state !== 'confirm') ?? [];

  return (
    <div className="min-h-screen bg-[#f5f8fc] text-slate-800">
      <StaffWorkspaceHeader role="teacher" title={rep?.student ? `${rep.student.name} · ${rep.exam.name}` : '学校考试'}
        subtitle="这次考试丢分在哪" icon={GraduationCap} backTo={`/teacher/school-exams/${id}`} />
      <main className="teacher-workspace-main mx-auto max-w-3xl space-y-4">
        {!rep && <div className="flex items-center gap-2 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" /> 加载中…</div>}
        {rep && (
          <>
            <section className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm">
              <span>卷子: <SheetBadge sheet={rep.sheet} /></span>
              {rep.sheet?.status === 'failed' && rep.sheet.reason && <span className="text-rose-600">{rep.sheet.reason}</span>}
              {rep.sheet?.status === 'done' && <span className="text-slate-500">读出 {rep.sheet.recorded + rep.sheet.confirm} 道,记下 {rep.recorded} 道{rep.sheet.missing ? `,${rep.sheet.missing} 道照片里没找到` : ''}</span>}
            </section>

            {confirm.length > 0 && (
              <section className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
                <h2 className="mb-1 text-base font-semibold text-slate-900">要你确认的题({confirm.length})</h2>
                <p className="mb-3 text-sm text-slate-600">阅卷 AI 拿不准的。看孩子的卷子(或者问他)点一下,记下来才算进他的报告和把握度。</p>
                <ul className="space-y-2">
                  {confirm.map((it) => <ItemRow key={it.item_id} it={it} busy={busyItem === it.item_id} onResolve={(ok) => void resolve(it.item_id, ok)} />)}
                </ul>
              </section>
            )}

            <ExamReportView report={rep} audience="teacher" />

            <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <h2 className="mb-1 text-base font-semibold text-slate-900">替他传卷子</h2>
              {rep.exam.doc_id ? (
                <>
                  <p className="mb-3 text-sm text-slate-500">拍老师批改过的那份,一页一张(最多 8 页)。照片读完就丢,不存。</p>
                  <SheetPhotoPicker maxPages={8} sending={sending || pending} onSend={upload} tone="teacher" />
                </>
              ) : (
                <p className="text-sm text-slate-500">这次考试还没挂卷子,先回上一页挂上试卷库里拆好的那份。</p>
              )}
            </section>

            {others.length > 0 && (
              <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <button type="button" onClick={() => setShowAll((v) => !v)} className="text-sm font-semibold text-slate-700 underline-offset-2 hover:underline">
                  {showAll ? '收起' : `看每道题读成了什么(${others.length} 道,读错了可以改判)`}
                </button>
                {showAll && (
                  <ul className="mt-3 space-y-2">
                    {others.map((it) => <ItemRow key={it.item_id} it={it} busy={busyItem === it.item_id} onResolve={(ok) => void resolve(it.item_id, ok)} />)}
                  </ul>
                )}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
