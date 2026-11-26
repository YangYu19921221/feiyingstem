/**
 * 「这次考试丢分在哪」(学校考试 · 丢分分析,老师和孩子看同一份,口径在后端 services/school_exam.student_report)。
 * 先写分数和各大题丢了几分,再写丢分最多的知识点(错几题 / 考了几题、犯的哪种错),再列每道错题(写的、正确答案、讲解)。
 * 完形、阅读、听力、作文这些没拆题的大题,只能看分数,单独写一行。
 * 孩子版的话: 「接下来每天的小卷会先练这些」;不出现「弱」字。
 */
import type { StudentReport } from '../../api/schoolExam';

const LETTERS = 'ABCDEF';

function fmt(n: number | null | undefined) {
  if (n === null || n === undefined) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

export default function ExamReportView({ report, audience }: { report: StudentReport; audience: 'teacher' | 'student' }) {
  const s = report.score;
  const kid = audience === 'student';
  const ink = kid ? 'text-ink' : 'text-slate-900';
  const soft = kid ? 'text-ink-soft' : 'text-slate-500';
  const card = kid ? 'rounded-2xl bg-white p-5 shadow-sm' : 'rounded-xl border border-slate-200 bg-white p-4 shadow-sm';
  const hasScore = s.total !== null || s.sections.some((x) => x.score !== null);

  return (
    <div className="space-y-4">
      <section className={card}>
        <h2 className={`mb-2 text-base font-bold ${ink}`}>分数</h2>
        {!hasScore && <p className={`text-sm ${soft}`}>还没有分数。{kid ? '拍好卷子传上来,卷子上写了分的会自动读出来。' : '可以在「录分」里填,也可以等卷子照片读出来。'}</p>}
        {hasScore && (
          <>
            <p className={`text-2xl font-bold ${ink}`}>
              {fmt(s.total)}<span className={`ml-1 text-base font-normal ${soft}`}>/ {fmt(s.full)}</span>
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {s.sections.map((x) => (
                <div key={x.name} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm">
                  <span className={ink}>{x.name}</span>
                  <span className={soft}>
                    {fmt(x.score)} / {fmt(x.full)}
                    {x.lost !== null && x.lost > 0 && <b className="ml-2 font-semibold text-rose-600">丢 {fmt(x.lost)}</b>}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </section>

      {report.kps.length > 0 && (
        <section className={card}>
          <h2 className={`mb-1 text-base font-bold ${ink}`}>丢分最多的知识点</h2>
          <p className={`mb-3 text-sm ${soft}`}>
            {kid ? '接下来每天的「今日小卷」会先练这几个。' : '这些已经记进他的把握度,每日小卷会先补这几个点。'}
          </p>
          <ul className="space-y-2">
            {report.kps.map((k) => (
              <li key={k.kp} className="rounded-lg bg-rose-50/70 px-3 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className={`font-semibold ${ink}`}>{kid ? k.kid : k.name}</span>
                  <span className="text-sm text-rose-700">错 {k.wrong} 题 / 考了 {k.total} 题</span>
                </div>
                {k.codes.length > 0 && <p className={`mt-0.5 text-sm ${soft}`}>常犯: {k.codes.join(';')}</p>}
              </li>
            ))}
          </ul>
          {report.ok_kps.length > 0 && <p className={`mt-3 text-sm ${soft}`}>这些考到了都做对了: {report.ok_kps.join('、')}</p>}
        </section>
      )}

      {report.untracked.length > 0 && (
        <section className={card}>
          <h2 className={`mb-1 text-base font-bold ${ink}`}>只能看分数的大题</h2>
          <p className={`text-sm ${soft}`}>
            {report.untracked.map((u) => `${u.name}丢了 ${fmt(u.lost)} 分`).join(';')}。
            这几道大题没有拆成一道道题(听力、完形、阅读、作文这类),只能看出丢了多少分,看不出具体是哪个知识点。
          </p>
        </section>
      )}

      {report.wrong_items.length > 0 && (
        <section className={card}>
          <h2 className={`mb-3 text-base font-bold ${ink}`}>错了的题({report.wrong_items.length})</h2>
          <ol className="space-y-3">
            {report.wrong_items.map((w) => (
              <li key={w.item_id} className="rounded-lg border border-slate-100 px-3 py-2.5">
                <p className={`text-[15px] leading-7 ${ink}`}><b className="mr-1">{w.no}.</b>{w.stem}</p>
                {w.kind === 'mc' && w.options.length > 0 && (
                  <p className={`mt-1 text-sm ${soft}`}>{w.options.map((o, i) => `${LETTERS[i]}. ${o}`).join('   ')}</p>
                )}
                <p className="mt-1.5 text-sm">
                  <span className="text-rose-700">{kid ? '你写的' : '他写的'}: {w.given || '(没写)'}</span>
                  <span className="ml-3 text-emerald-700">正确答案: {w.answer}</span>
                </p>
                {w.why && <p className={`mt-1 text-sm ${soft}`}>选它错在: {w.why}</p>}
                {w.explain && <p className={`mt-1 text-sm ${soft}`}>讲解: {w.explain}</p>}
                {!kid && w.kps.length > 0 && <p className="mt-1 text-xs text-slate-400">知识点: {w.kps.join('、')}{w.source === 'teacher' ? ' · 老师确认过' : ''}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}

      {report.recorded > 0 && report.wrong_items.length === 0 && (
        <section className={card}><p className={`text-sm ${ink}`}>拆出来的 {report.recorded} 道题都做对了。</p></section>
      )}
    </div>
  );
}
