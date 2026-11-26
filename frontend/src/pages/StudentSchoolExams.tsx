/**
 * 学生端「学校考卷」(2026-11-26,/student/school-exams)。规则见后端 services/school_exam.py。
 *
 * 老师建了一次学校考试 → 孩子把老师批改过的卷子拍下来传上来(一页一张)→ 一两分钟读好 →
 * 「这次考试丢分在哪」: 分数、丢分最多的知识点、每道错题的正确答案和讲解。接下来每天的小卷先练这几个点。
 * 照片读完就丢,不存。不出现「弱」字。
 */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ChevronRight, LoaderCircle } from 'lucide-react';
import ExamReportView from '../components/schoolExam/ExamReportView';
import SheetPhotoPicker from '../components/schoolExam/SheetPhotoPicker';
import { toast } from '../components/Toast';
import { getMyReport, listMyExams, uploadMySheet, type MyExam, type StudentReport } from '../api/schoolExam';
import { getErrorMessage } from '../utils/errorMessage';

function status(e: MyExam) {
  const s = e.sheet;
  if (!s) return e.can_upload ? '还没传卷子' : e.doc_id ? '老师来传卷子' : '老师还在准备题目';
  if (s.status === 'pending') return '正在读…';
  if (s.status === 'failed') return '没读出来,再拍一次';
  return '看看丢分在哪';
}

export default function StudentSchoolExams() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const examId = Number(params.get('exam')) || null;
  const [list, setList] = useState<{ enabled: boolean; reason: string; items: MyExam[] } | null>(null);
  // 报告带着是哪次考试的: 换了考试先不显示上一次的
  const [loaded, setLoaded] = useState<{ id: number; data: StudentReport } | null>(null);
  const rep = loaded && loaded.id === examId ? loaded.data : null;
  const [sending, setSending] = useState(false);

  useEffect(() => {
    listMyExams().then(setList).catch((e) => toast.error(getErrorMessage(e, '没加载出来')));
  }, []);

  const load = useCallback(async () => {
    if (!examId) return;
    try {
      const data = await getMyReport(examId);
      setLoaded({ id: examId, data });
    } catch (e) {
      toast.error(getErrorMessage(e, '没加载出来'));
    }
  }, [examId]);
  useEffect(() => { void load(); }, [load]);
  const pending = rep?.sheet?.status === 'pending';
  useEffect(() => {
    if (!pending) return undefined;
    const t = window.setInterval(() => { void load(); }, 4000);
    return () => window.clearInterval(t);
  }, [pending, load]);

  const upload = async (photos: Blob[]) => {
    if (!examId) return false;
    setSending(true);
    try {
      await uploadMySheet(examId, photos);
      toast.success('传上去了,一两分钟就读好');
      await load();
      return true;
    } catch (e) {
      toast.error(getErrorMessage(e, '没传上去'));
      return false;
    } finally {
      setSending(false);
    }
  };

  const back = () => (examId ? setParams({}) : navigate('/student/dashboard'));

  return (
    <div className="min-h-screen bg-paper page-warm-glow">
      <nav className="sticky top-0 z-10 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <button type="button" onClick={back} aria-label="返回"
            className="flex h-11 w-11 items-center justify-center rounded-lg text-slate-500 hover:bg-orange-50 hover:text-orange-600">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <h1 className="text-base font-bold text-ink">{rep ? rep.exam.name : '学校考卷'}</h1>
        </div>
      </nav>
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-5">
        {!list && <div className="flex items-center gap-2 text-sm text-ink-soft"><LoaderCircle className="h-4 w-4 animate-spin" /> 加载中…</div>}
        {list && !list.enabled && <p className="rounded-2xl bg-white p-6 text-center text-ink shadow-sm">{list.reason}</p>}

        {list?.enabled && !examId && (
          <>
            <p className="text-sm leading-6 text-ink-soft">在学校考完、老师把卷子批改好发回来以后,把卷子拍下来传上来,就能看到这次丢分丢在哪,接下来每天的小卷先练这几个点。</p>
            {list.items.length === 0 && <p className="rounded-2xl bg-white p-6 text-center text-ink-soft shadow-sm">老师还没建考试。考完以后老师建好了,这里就会出现。</p>}
            {list.items.map((e) => (
              <button key={e.id} type="button" onClick={() => setParams({ exam: String(e.id) })}
                className="flex w-full items-center justify-between gap-3 rounded-2xl bg-white px-5 py-4 text-left shadow-sm hover:ring-1 hover:ring-orange-200">
                <span>
                  <b className="text-ink">{e.name}</b>
                  <span className="ml-2 text-sm text-ink-soft">{e.exam_date || ''}</span>
                  <span className="mt-0.5 block text-sm text-[#d9541e]">{status(e)}</span>
                </span>
                <ChevronRight className="h-5 w-5 text-slate-400" />
              </button>
            ))}
          </>
        )}

        {examId && !rep && <div className="flex items-center gap-2 text-sm text-ink-soft"><LoaderCircle className="h-4 w-4 animate-spin" /> 加载中…</div>}
        {examId && rep && (
          <>
            {pending && (
              <section className="flex items-center gap-3 rounded-2xl bg-sky-50 p-5 text-ink">
                <LoaderCircle className="h-5 w-5 animate-spin text-sky-600" /> 正在读你的卷子,一两分钟就好,可以先去做别的。
              </section>
            )}
            {rep.sheet?.status === 'failed' && (
              <section className="rounded-2xl bg-rose-50 p-5 text-ink">{rep.sheet.reason || '这份没读出来,再拍一次'}</section>
            )}
            {rep.sheet?.status === 'done' && rep.sheet.confirm > 0 && (
              <section className="rounded-2xl bg-amber-50 p-4 text-sm text-ink">有 {rep.sheet.confirm} 道题看不太清,等老师确认以后再算进来。</section>
            )}
            {(rep.sheet?.status === 'done' || rep.score.total !== null) && <ExamReportView report={rep} audience="student" />}
            {!pending && (rep.can_upload ? (
              <section className="rounded-2xl bg-white p-5 shadow-sm">
                <h2 className="mb-1 text-base font-bold text-ink">{rep.sheet ? '再拍一次' : '拍你的卷子'}</h2>
                <p className="mb-3 text-sm text-ink-soft">拍老师批改过的那份,一页一张,整页摆平、开灯、离近一点。照片读完就删掉。</p>
                <SheetPhotoPicker maxPages={rep.max_pages || 8} sending={sending} onSend={upload} />
              </section>
            ) : (
              !rep.sheet && (
                <p className="rounded-2xl bg-white p-5 text-sm text-ink-soft shadow-sm">
                  {rep.exam.doc_id ? '这次考试由老师来传卷子。' : '老师还在准备这次考试的题目,准备好了就能拍卷子传上来。'}
                </p>
              )
            ))}
          </>
        )}
      </main>
    </div>
  );
}
