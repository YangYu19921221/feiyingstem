/**
 * 教师端学生详情:「问小鹰老师」对话记录(2026-10-26,只读)
 *
 * 学习助手的规则是作业/考试题先提示、试过两次还不会才讲答案(10-26 晚起),但机器做不到 100%,所以老师能看孩子问了什么、
 * (10-27 起顶上还能展开看助手参考的这个孩子的学情摘要 —— 助手知道什么,老师就知道什么)
 * 助手怎么答的。孩子拍的题目照片不保存,助手回答第一行会写「我看到的题目: …」。
 */
import { useEffect, useState } from 'react';
import { ChevronDown, MessageCircle } from 'lucide-react';
import { getStudentTutorLog, type TeacherTutorLog } from '../../api/tutor';

const fmt = (iso: string | null) =>
  iso ? new Date(iso + 'Z').toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '';

export default function TutorLogPanel({ studentId }: { studentId: number }) {
  const [data, setData] = useState<TeacherTutorLog | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    getStudentTutorLog(studentId)
      .then((r) => alive && setData(r))
      .catch(() => alive && setError('学习助手记录加载失败'));
    return () => { alive = false; };
  }, [studentId]);

  // 没问过就不占地方
  if (!error && (!data || data.items.length === 0)) return null;

  return (
    <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xl font-bold text-gray-800">
          <MessageCircle className="h-5 w-5 text-orange-500" aria-hidden="true" />
          问小鹰老师
        </h2>
        {data && <p className="text-xs text-slate-500">一共问过 {data.total_questions} 次</p>}
      </div>
      <p className="mb-4 text-xs leading-5 text-slate-500">
        孩子和 AI 学习助手的对话。助手对作业、考试题先给提示,孩子试过两次还不会才讲答案和理由并出同类题;孩子拍的照片不保存。
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {data?.profile && data.profile.length > 0 && (
        <details className="mb-3 rounded-lg bg-orange-50/60 px-3 py-2 text-xs leading-5 text-slate-600">
          <summary className="cursor-pointer select-none font-medium text-orange-800">小鹰老师眼里的这个孩子(它回答时参考这些)</summary>
          <ul className="mt-1.5 space-y-0.5">
            {data.profile.map((l, i) => <li key={i}>{l.replace(/^-\s*/, '· ')}</li>)}
          </ul>
        </details>
      )}
      <ul className="divide-y divide-slate-100">
        {(data?.items || []).map((c) => (
          <li key={c.id} className="py-2">
            <button
              type="button"
              onClick={() => setOpen((o) => (o === c.id ? null : c.id))}
              aria-expanded={open === c.id}
              className="flex w-full items-center gap-2 py-1.5 text-left"
            >
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{c.title}</span>
              <span className="shrink-0 text-xs text-slate-400">{fmt(c.updated_at)} · {c.messages.filter((m) => m.role === 'user').length} 问</span>
              <ChevronDown className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${open === c.id ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>
            {open === c.id && (
              <div className="mt-2 space-y-2 rounded-lg bg-slate-50 p-3">
                {c.messages.map((m) => (
                  <div key={m.id} className={m.role === 'user' ? 'text-right' : ''}>
                    <div className={`inline-block max-w-[90%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-left text-sm ${
                      m.role === 'user' ? 'bg-orange-100 text-orange-900' : m.failed ? 'bg-rose-50 text-rose-700' : 'bg-white text-slate-700'
                    }`}>
                      {m.role === 'user' && m.has_image && <span className="mr-1 text-xs text-orange-700">[照片]</span>}
                      {m.role === 'assistant' && m.mode === 'deep' && !m.failed && <span className="mr-1 text-xs text-sky-700">[深度思考]</span>}
                      {m.failed ? '(这次没调通,孩子没拿到回答)' : m.stopped && !m.text ? '(孩子停下了)' : m.text}
                      {m.cards.some((x) => x.type === 'picture') && (
                        <span className="mt-1 block text-xs text-slate-400">
                          [画了记忆图: {m.cards.flatMap((x) => (x.type === 'picture' ? [x.word] : [])).join('、')}]
                        </span>
                      )}
                      {m.cards.map((x, ci) => {
                        if (x.type !== 'practice' && x.type !== 'quiz') return null;
                        // 老师看的带答案(key);旧卡(10-27 之前)单词在 items 里
                        const words = x.key ?? (x.type === 'practice' ? x.items.flatMap((i) => (i.word ? [i.word] : [])) : []);
                        return (
                          <span key={ci} className="mt-1 block text-xs text-slate-400">
                            [{x.type === 'quiz' ? `出了 ${x.items.length} 道小题${x.topic ? `(${x.topic})` : ''}` : '出了单词练习'}
                            {words.length ? `: ${words.join('、')}` : ''}
                            {x.result ? ` · 孩子做对 ${x.result.score}/${x.result.total}` : ' · 还没做'}]
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
