/**
 * 教师端小鹰老师出的练习卷(2026-10-29,后端 services/teacher_tutor.make_worksheet)。
 *
 * 卷子带答案(给老师看的),页面上默认收起答案;可以下载两份 PDF:
 * - 学生版: 只有题目,填空留横线、连词成句给打乱的词,发下去做
 * - 教师版: 题目 + 答案 + 一句讲解
 * PDF 走 utils/downloadPdf(屏幕外克隆一份固定 A4 宽再截图,手机上导出的和电脑一样)。
 */
import { memo, useRef, useState } from 'react';
import { Download, Eye, EyeOff, FileText, Loader2 } from 'lucide-react';
import type { WorksheetItem } from '../../api/tutor';
import { downloadElementAsPdf } from '../../utils/downloadPdf';

const LETTERS = 'ABCD';

function Sheet({ title, topic, items, withKey }: { title: string; topic: string | null; items: WorksheetItem[]; withKey: boolean }) {
  return (
    <div className="bg-white p-8 text-[15px] leading-7 text-slate-900">
      <h1 className="text-center text-xl font-bold">{title}{withKey ? '(教师版 · 含答案)' : ''}</h1>
      {topic && <p className="mt-1 text-center text-sm text-slate-500">{topic}</p>}
      {!withKey && (
        <p className="mt-4 flex gap-8 text-sm">
          <span>姓名: ____________</span><span>班级: ________</span><span>得分: ______</span>
        </p>
      )}
      <ol className="mt-5 space-y-4">
        {items.map((it, i) => (
          <li key={i} style={{ breakInside: 'avoid' }}>
            <p><span className="font-semibold">{i + 1}.</span> {it.type === 'order' ? '连词成句: ' : ''}{it.question}</p>
            {it.type === 'choice' && (
              <p className="mt-1 flex flex-wrap gap-x-8 pl-5">
                {it.options.map((o, j) => <span key={j}>{LETTERS[j]}. {o}</span>)}
              </p>
            )}
            {it.type === 'order' && (
              <p className="mt-1 pl-5">{it.tokens.join(' / ')}</p>
            )}
            {it.type === 'order' && !withKey && <p className="mt-2 pl-5 text-slate-400">______________________________________</p>}
            {withKey && (
              <p className="mt-1 pl-5 text-[14px] text-emerald-800">
                答案: {it.type === 'choice' ? `${LETTERS[it.options.indexOf(it.answer)] ?? ''}. ${it.answer}` : it.answer}
                {it.type === 'fill' && it.also && it.also.length > 0 ? `(也算对: ${it.also.join(' / ')})` : ''}
                {it.explain ? ` —— ${it.explain}` : ''}
              </p>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function WorksheetCard({ title, topic, items, students, nameOf }: {
  title: string; topic: string | null; items: WorksheetItem[]; students: string[];
  /** 学生代号 → 名字(页面拿本班名单换的) */
  nameOf: (code: string) => string;
}) {
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState<'' | 'student' | 'teacher'>('');
  const studentRef = useRef<HTMLDivElement>(null);
  const teacherRef = useRef<HTMLDivElement>(null);

  const download = async (which: 'student' | 'teacher') => {
    const el = (which === 'student' ? studentRef : teacherRef).current;
    if (!el || busy) return;
    setBusy(which);
    try {
      await downloadElementAsPdf(el, { filename: `${title}${which === 'teacher' ? '_教师版' : ''}` });
    } catch {
      // downloadElementAsPdf 自己提示过了
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="mt-3 w-full rounded-xl border border-slate-200 bg-slate-50/60 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <FileText className="h-4 w-4 text-orange-600" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm font-semibold text-slate-900">{title} · {items.length} 题</p>
        <button type="button" onClick={() => setShowKey((v) => !v)}
          className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs text-slate-600 hover:bg-white">
          {showKey ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
          {showKey ? '收起答案' : '看答案'}
        </button>
      </div>
      {students.length > 0 && (
        <p className="mt-1 text-xs text-slate-500">给: {students.map(nameOf).join('、')}</p>
      )}
      <ol className="mt-2 space-y-2 text-sm text-slate-800">
        {items.map((it, i) => (
          <li key={i} className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-100">
            <p><span className="font-semibold">{i + 1}.</span> {it.type === 'order' ? '连词成句: ' : ''}{it.question}</p>
            {it.type === 'choice' && (
              <p className="mt-0.5 flex flex-wrap gap-x-4 text-slate-600">
                {it.options.map((o, j) => <span key={j}>{LETTERS[j]}. {o}</span>)}
              </p>
            )}
            {it.type === 'order' && <p className="mt-0.5 text-slate-600">{it.tokens.join(' / ')}</p>}
            {showKey && (
              <p className="mt-1 text-[13px] text-emerald-700">
                答案: {it.answer}{it.explain ? ` —— ${it.explain}` : ''}
              </p>
            )}
          </li>
        ))}
      </ol>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => void download('student')} disabled={!!busy}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-orange-500 px-3 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-60">
          {busy === 'student' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
          学生版 PDF
        </button>
        <button type="button" onClick={() => void download('teacher')} disabled={!!busy}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60">
          {busy === 'teacher' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
          教师版(含答案)
        </button>
      </div>
      {/* 导出用的两份(屏幕上不显示,downloadElementAsPdf 会克隆它们) */}
      <div className="hidden">
        <div ref={studentRef}><Sheet title={title} topic={topic} items={items} withKey={false} /></div>
        <div ref={teacherRef}><Sheet title={title} topic={topic} items={items} withKey /></div>
      </div>
    </div>
  );
}

export default memo(WorksheetCard);
