/**
 * 老师端「每日陪跑」—— 谁好几天没来、谁今天没做完,复制提醒发家长,给每个孩子留一句话
 *
 * 规则真源 backend/app/services/coach.py。为什么做这页(2026-10-21 生产实情): 近 28 天学过的孩子
 * 55% 只学了 1–2 天,在家作业完成率 55%;孩子回来练时隔几天的词九成多还记得 —— 缺的是有人盯着回来。
 *
 * 点评一个孩子一天一条,孩子首页和家长端都看得到;系统按今天的数据起草,老师改几个字再发。
 * 「复制提醒」= 发给家长的微信话术(生产没配短信也没接服务号,只能老师自己发)。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Copy, LoaderCircle, MessageSquareHeart, PencilLine, RefreshCw, Search, Send, Trash2, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import { coachApi, type CoachBoard, type CoachRow } from '../api/coach';
import { toast } from '../components/Toast';
import { getErrorMessage } from '../utils/errorMessage';
import { copyText } from '../utils/copyText';

type Tab = 'follow' | 'done' | 'gone' | 'all';

const needsFollow = (r: CoachRow) => r.status === 'absent' || r.status === 'not_started' || r.status === 'in_progress' || r.struggling;

const fmtDay = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

function StatusBadge({ r }: { r: CoachRow }) {
  const base = 'rounded px-1.5 py-0.5 text-xs font-semibold';
  switch (r.status) {
    case 'absent':
      return <span className={`${base} bg-red-50 text-red-700`}>{r.days_since} 天没来</span>;
    case 'not_started':
      return <span className={`${base} bg-amber-50 text-amber-700`}>今天还没学</span>;
    case 'in_progress':
      return <span className={`${base} bg-blue-50 text-blue-700`}>任务 {r.tasks_done}/{r.tasks_total}</span>;
    case 'done':
      return <span className={`${base} bg-emerald-50 text-emerald-700`}>{r.tasks_total ? '任务全做完' : '今天学了'}</span>;
    default:
      return <span className={`${base} bg-slate-100 text-slate-500`}>{r.days_since === null ? '从没学过' : `${r.days_since} 天没来`}</span>;
  }
}

function facts(r: CoachRow): string {
  const out: string[] = [];
  if (r.status === 'absent' || r.status === 'gone') {
    if (r.last_study_day) out.push(`上次学习 ${fmtDay(r.last_study_day)}`);
  } else if (r.words_today || r.minutes_today) {
    out.push(`今天 ${r.words_today} 词 · ${r.minutes_today} 分钟`);
  }
  if (r.accuracy_today !== null && r.scored_today >= 5) out.push(`拼写 ${r.accuracy_today}%`);
  out.push(`近 7 天学了 ${r.week_days} 天`);
  if (r.review_due) out.push(`待复习 ${r.review_due} 词`);
  return out.join(' · ');
}

export default function TeacherCoach() {
  const [board, setBoard] = useState<CoachBoard | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('follow');
  const [cls, setCls] = useState('');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setBoard(await coachApi.board());
    } catch (e) {
      toast.error(getErrorMessage(e, '加载失败'));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const items = useMemo(() => board?.items ?? [], [board]);
  const classes = useMemo(() => Array.from(new Set(items.map((r) => r.class_name).filter(Boolean))), [items]);
  const inClass = useMemo(() => items.filter((r) => !cls || r.class_name === cls), [items, cls]);
  const tabCount = useMemo(() => ({
    follow: inClass.filter(needsFollow).length,
    done: inClass.filter((r) => r.status === 'done' && !r.struggling).length,
    gone: inClass.filter((r) => r.status === 'gone').length,
    all: inClass.length,
  }), [inClass]);
  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return inClass.filter((r) => {
      if (tab === 'follow' && !needsFollow(r)) return false;
      if (tab === 'done' && !(r.status === 'done' && !r.struggling)) return false;
      if (tab === 'gone' && r.status !== 'gone') return false;
      return !kw || r.name.toLowerCase().includes(kw) || r.username.toLowerCase().includes(kw);
    });
  }, [inClass, tab, q]);
  const unnoted = shown.filter((r) => !r.note);
  const notedInClass = inClass.filter((r) => r.note).length;

  const patch = (id: number, note: CoachRow['note']) =>
    setBoard((b) => (b ? { ...b, items: b.items.map((r) => (r.id === id ? { ...r, note } : r)) } : b));

  const send = async (r: CoachRow, text: string) => {
    const content = text.trim();
    if (!content) { toast.warning('点评不能是空的'); return; }
    setBusy(`send-${r.id}`);
    try {
      const res = await coachApi.save(r.id, content);
      patch(r.id, { content: res.content, author_name: res.author_name, read_by_student: false, read_by_parent: false });
      setEditing(null);
      toast.success(r.parent_bound ? '已发送,孩子和家长都能看到' : '已发送,孩子首页能看到(家长还没绑定)');
    } catch (e) {
      toast.error(getErrorMessage(e, '发送失败'));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (r: CoachRow) => {
    if (!window.confirm(`删掉今天给「${r.name}」的点评?`)) return;
    setBusy(`del-${r.id}`);
    try {
      await coachApi.remove(r.id);
      patch(r.id, null);
    } catch (e) {
      toast.error(getErrorMessage(e, '删除失败'));
    } finally {
      setBusy(null);
    }
  };

  const sendAllDrafts = async () => {
    if (unnoted.length === 0) return;
    if (!window.confirm(`把下面 ${unnoted.length} 个还没点评的孩子的草稿原样发出去?\n\n发之前可以先扫一眼草稿,不合适的先单独改。`)) return;
    setBusy('batch');
    try {
      const res = await coachApi.saveBatch(unnoted.map((r) => ({ student_id: r.id, content: r.draft })));
      toast.success(`已发送 ${res.saved} 条`);
      await load();
    } catch (e) {
      toast.error(getErrorMessage(e, '发送失败'));
    } finally {
      setBusy(null);
    }
  };

  const copyRemind = (r: CoachRow) => {
    const text = r.note ? `${r.remind}\n老师的点评:${r.note.content}` : r.remind;
    copyText(text, '已复制,去微信发给这位家长');
  };

  return (
    <div className="min-h-screen bg-[#f5f8fc] text-slate-800">
      <StaffWorkspaceHeader role="teacher" title="每日陪跑" subtitle="谁没来、谁没做完,复制提醒发家长,给每个孩子留一句话" icon={MessageSquareHeart} backTo="/teacher/dashboard" />

      <main className="teacher-workspace-main mx-auto max-w-5xl space-y-4">
        <section className="rounded-xl border border-orange-200 bg-orange-50/60 px-4 py-3 text-sm leading-6 text-orange-900">
          <p>每个孩子下面已经按今天的数据写好一句点评,看一眼,合适就点「发送」,不合适点「改一改」。发出去孩子首页、家长端都看得到。</p>
          <p>「复制提醒」是发给家长的微信话术。先管<b>刚断两三天的</b>:他们最拉得回来。</p>
        </section>

        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 shadow-sm">
          {([['follow', '要跟进'], ['done', '今天做完'], ['gone', '很久没来'], ['all', '全部']] as const).map(([k, label]) => (
            <button key={k} type="button" onClick={() => setTab(k)} aria-pressed={tab === k}
              className={`min-h-9 rounded-lg px-3 text-sm ${tab === k ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
              {label} {tabCount[k]}
            </button>
          ))}
          {classes.length > 1 && (
            <select value={cls} onChange={(e) => setCls(e.target.value)} aria-label="按班级筛选"
              className="min-h-9 rounded-lg border border-slate-200 px-2 text-sm">
              <option value="">全部班级</option>
              {classes.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          )}
          <div className="relative ml-auto">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜姓名" aria-label="搜索学生"
              className="w-36 rounded-lg border border-slate-200 py-1.5 pl-8 pr-2 text-sm outline-none focus:border-orange-400" />
          </div>
          <button type="button" onClick={load} disabled={loading} aria-label="刷新"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
          <span>今天已点评 <b className="text-emerald-600">{notedInClass}</b> / {inClass.length} 人</span>
          {unnoted.length > 0 && (
            <button type="button" onClick={sendAllDrafts} disabled={busy !== null}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-orange-300 bg-white px-3 text-sm font-semibold text-orange-700 hover:bg-orange-50 disabled:opacity-50">
              {busy === 'batch' ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
              下面 {unnoted.length} 个未点评的,草稿一起发
            </button>
          )}
        </div>

        {loading && !board ? (
          <div className="flex justify-center py-16"><LoaderCircle className="h-6 w-6 animate-spin text-orange-500" aria-label="加载中" /></div>
        ) : shown.length === 0 ? (
          <div className="rounded-xl bg-white py-14 text-center text-sm text-slate-500 shadow-sm">
            {items.length === 0 ? '你的班里还没有学生' : q ? '没找到这个学生' : tab === 'follow' ? '今天没有要跟进的孩子' : '这里没有孩子'}
          </div>
        ) : (
          <ul className="space-y-2">
            {shown.map((r) => {
              const isEditing = editing?.id === r.id;
              return (
                <li key={r.id} className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-slate-800">{r.name === '孩子' ? r.username : r.name}</span>
                    {r.class_name && <span className="text-xs text-slate-400">{r.class_name}</span>}
                    <StatusBadge r={r} />
                    {r.struggling && <span className="rounded bg-rose-50 px-1.5 py-0.5 text-xs font-semibold text-rose-700">错得多 {r.accuracy_today}%</span>}
                    <div className="ml-auto flex items-center gap-1.5">
                      {!r.parent_bound && (
                        <Link to="/teacher/parent-binding" className="text-xs text-slate-400 underline-offset-2 hover:underline">家长没绑定</Link>
                      )}
                      <button type="button" onClick={() => copyRemind(r)}
                        className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                        <Copy className="h-3.5 w-3.5" aria-hidden /> 复制提醒
                      </button>
                    </div>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{facts(r)}</p>
                  {r.weak_today.length > 0 && (
                    <p className="mt-1 text-xs text-slate-500">今天错过: {r.weak_today.join('、')}</p>
                  )}

                  {isEditing ? (
                    <div className="mt-2">
                      <textarea value={editing.text} maxLength={300} rows={3} autoFocus
                        onChange={(e) => setEditing({ id: r.id, text: e.target.value })}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setEditing(null);
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.nativeEvent.isComposing) send(r, editing.text);
                        }}
                        aria-label={`给${r.name}的点评`}
                        className="w-full rounded-lg border border-orange-300 px-3 py-2 text-sm leading-relaxed outline-none focus:ring-2 focus:ring-orange-200" />
                      <div className="mt-1.5 flex items-center gap-2">
                        <button type="button" onClick={() => send(r, editing.text)} disabled={busy !== null}
                          className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-[#FF6B35] px-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                          {busy === `send-${r.id}` ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />} 发送
                        </button>
                        <button type="button" onClick={() => setEditing(null)}
                          className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-sm text-slate-500 hover:bg-slate-100">
                          <X className="h-4 w-4" aria-hidden /> 取消
                        </button>
                        <span className="ml-auto text-xs text-slate-400">{editing.text.length}/300 · Ctrl+回车发送</span>
                      </div>
                    </div>
                  ) : r.note ? (
                    <div className="mt-2 rounded-lg bg-emerald-50 px-3 py-2">
                      <p className="whitespace-pre-wrap break-words text-sm text-emerald-900">{r.note.content}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-emerald-700">
                        <span>{r.note.read_by_student ? '孩子已看' : '孩子还没看'}</span>
                        {r.parent_bound && <span>{r.note.read_by_parent ? '家长已看' : '家长还没看'}</span>}
                        <button type="button" onClick={() => setEditing({ id: r.id, text: r.note!.content })}
                          className="inline-flex min-h-8 items-center gap-0.5 rounded px-1 hover:bg-emerald-100">
                          <PencilLine className="h-3.5 w-3.5" aria-hidden /> 改
                        </button>
                        <button type="button" onClick={() => remove(r)} disabled={busy !== null}
                          className="inline-flex min-h-8 items-center gap-0.5 rounded px-1 text-slate-500 hover:bg-white disabled:opacity-50">
                          <Trash2 className="h-3.5 w-3.5" aria-hidden /> 删除
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap items-start gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2">
                      <p className="min-w-0 flex-1 text-sm text-slate-600">{r.draft}</p>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <button type="button" onClick={() => send(r, r.draft)} disabled={busy !== null}
                          className="inline-flex min-h-9 items-center gap-1 rounded-lg bg-[#FF6B35] px-3 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50">
                          {busy === `send-${r.id}` ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />} 发送
                        </button>
                        <button type="button" onClick={() => setEditing({ id: r.id, text: r.draft })}
                          className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-sm text-slate-700 hover:bg-slate-50">
                          <PencilLine className="h-4 w-4" aria-hidden /> 改一改
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
