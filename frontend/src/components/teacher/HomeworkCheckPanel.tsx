/**
 * 教师端学生详情:「作业批改」记录(2026-10-30,只读)。规则见 backend/services/homework_check.py
 *
 * 孩子拍一页做完的英语作业,小鹰老师逐题批改。老师这里看得到每题的正确答案、孩子改了几次、
 * 孩子点过「批错了?」的题(排在前面提醒老师复核)。照片不保存,只有小鹰老师读出来的文字。
 */
import { useEffect, useState } from 'react';
import { ChevronDown, ClipboardCheck, Flag } from 'lucide-react';
import { homeworkCheckApi, type HomeworkCheck } from '../../api/homeworkCheck';

const fmt = (iso: string | null) =>
  iso ? new Date(iso + (iso.endsWith('Z') ? '' : 'Z')).toLocaleString('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
  }) : '';

const LABEL = { right: '对', wrong: '错', unclear: '没看清', blank: '没写' } as const;

export default function HomeworkCheckPanel({ studentId }: { studentId: number }) {
  const [items, setItems] = useState<HomeworkCheck[] | null>(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    homeworkCheckApi.ofStudent(studentId)
      .then((r) => alive && setItems(r))
      .catch(() => alive && setError('作业批改记录加载失败'));
    return () => { alive = false; };
  }, [studentId]);

  // 没批过就不占地方
  if (!error && (!items || items.length === 0)) return null;
  const disputed = (items || []).reduce((s, c) => s + c.disputed, 0);

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xl font-bold text-gray-800">
          <ClipboardCheck className="h-5 w-5 text-orange-500" aria-hidden="true" />
          作业批改
        </h2>
        {items && <p className="text-xs text-slate-500">批过 {items.filter((c) => c.status === 'done').length} 页</p>}
      </div>
      <p className="mb-4 text-xs leading-5 text-slate-500">
        孩子拍一页做完的英语作业,小鹰老师逐题批改:错题先给提示让孩子自己改,改 2 次还不对才给答案,没写的题不给答案。
        照片不保存;小鹰老师也可能看错,孩子觉得批错的题会标出来。
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {disputed > 0 && (
        <p className="mb-3 flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <Flag className="h-4 w-4" aria-hidden="true" />
          孩子觉得有 {disputed} 题批错了,展开看一下
        </p>
      )}
      <ul className="divide-y divide-slate-100">
        {(items || []).map((c) => (
          <li key={c.id} className="py-2">
            <button
              type="button"
              onClick={() => setOpen((o) => (o === c.id ? null : c.id))}
              aria-expanded={open === c.id}
              disabled={c.status !== 'done'}
              className="flex w-full items-center gap-2 py-1.5 text-left disabled:cursor-default"
            >
              <span className="min-w-0 flex-1 text-sm text-slate-800">
                {fmt(c.created_at)}
                <span className="ml-2 text-slate-500">
                  {c.status === 'done'
                    ? `${c.total} 题 · 对 ${c.right} · 错 ${c.wrong}${c.blank ? ` · 没写 ${c.blank}` : ''}${c.fixed ? ` · 改对 ${c.fixed}` : ''}`
                    : '没批出来(次数已退回)'}
                </span>
              </span>
              {c.disputed > 0 && <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">批错了? {c.disputed}</span>}
              {c.status === 'done' && (
                <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open === c.id ? 'rotate-180' : ''}`} aria-hidden="true" />
              )}
            </button>
            {open === c.id && (
              <ol className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3">
                {(c.items || []).map((it) => (
                  <li key={it.idx} className={`rounded-lg bg-white px-3 py-2 text-sm ${it.disputed ? 'ring-2 ring-amber-300' : ''}`}>
                    <div className="flex items-start gap-2">
                      <span className="shrink-0 text-xs text-slate-400">{it.no}</span>
                      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-slate-800">{it.question}</span>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${
                        it.fixed ? 'bg-green-100 text-green-700'
                          : it.result === 'right' ? 'bg-green-100 text-green-700'
                            : it.result === 'blank' ? 'bg-slate-100 text-slate-600' : 'bg-rose-100 text-rose-700'
                      }`}>{it.fixed ? '改对了' : LABEL[it.result]}</span>
                    </div>
                    <p className="mt-1 text-xs text-slate-600">
                      孩子写的: {it.answer || '(没写)'}
                      {it.tries > 0 && ` · 改了 ${it.tries} 次${it.last ? `,最后写 ${it.last}` : ''}`}
                    </p>
                    {it.correct.length > 0 && <p className="text-xs text-slate-600">正确答案: {it.correct.join(' / ')}</p>}
                    {it.result !== 'right' && it.hint && <p className="text-xs text-slate-500">给孩子的提示: {it.hint}</p>}
                    {it.disputed && <p className="text-xs font-semibold text-amber-800">孩子觉得这题批错了</p>}
                  </li>
                ))}
              </ol>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
