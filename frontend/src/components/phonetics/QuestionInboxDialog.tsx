/**
 * 学生提问 — 老师端收件箱
 *
 * 默认只列**待回答**的:老师点红点过来就是为了处理它们,
 * 一进来先看到已回答的历史等于把要做的事埋起来。
 *
 * 三件事在界面上必须分清:
 * 1. **公开是老师的动作,不是学生的**。学生问的时候只有师生可见(孩子不敢问"傻问题"
 *    的主要原因就是怕被同学看见),老师判断"这个问题别人也会问"再一键公开成常见问答
 * 2. **隐藏是软删**。不合适的内容点隐藏后学生和同学都看不到,但行还在
 *    (未成年人 UGC 出纠纷要留痕),所以文案写「隐藏」不写「删除」
 * 3. **正文一律不可编辑**。那是学生写的话,老师改了它就再也不知道孩子原本问的是什么
 */
import { useCallback, useEffect, useState } from 'react';
import { EyeOff, Globe2, Loader2, Lock, MessageCircleQuestion, Send, X } from 'lucide-react';
import {
  phoneticsApi, MAX_ANSWER_LEN, type TeacherQuestion,
} from '../../api/phonetics';
import { toast } from '../Toast';
import { getErrorMessage } from '../../utils/errorMessage';

interface Props {
  /** 只看某个视频下的提问(从列表行的红点点进来时传) */
  videoId?: number;
  /** 待回答数变了要告诉列表页,让行上/工具栏的红点跟着变 */
  onPendingChange?: (pending: number) => void;
  onClose: () => void;
}

type Status = 'pending' | 'answered' | 'all';

const TABS: [Status, string][] = [
  ['pending', '待回答'],
  ['answered', '已回答'],
  ['all', '全部'],
];

/** 秒 → 3:20。老师要照着这个时间点回去听那一段 */
function fmtPos(sec?: number | null): string {
  if (sec == null) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** ISO → 「9-24 15:30」 */
function fmtTime(iso?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T'));
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function QuestionInboxDialog({ videoId, onPendingChange, onClose }: Props) {
  const [rows, setRows] = useState<TeacherQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<Status>('pending');
  /** 正在回答哪一条 → 那条下面展开输入框 */
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  /** 回答的同时公开。默认不公开 —— 公开要老师主动决定 */
  const [alsoPublic, setAlsoPublic] = useState(false);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await phoneticsApi.teacherQuestions({ status, video_id: videoId });
      setRows(data.items || []);
      onPendingChange?.(data.pending || 0);
    } catch (e) {
      toast.error(getErrorMessage(e, '提问列表加载失败'));
    } finally {
      setLoading(false);
    }
  }, [status, videoId, onPendingChange]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Esc 先收回答框再关弹层:老师写了一半按 Esc 想取消输入,
      // 一次按键把整个弹层也关掉就是把草稿一起扔了(同封面改名那处的教训)
      if (replyTo !== null) { setReplyTo(null); setDraft(''); return; }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, replyTo]);

  const openReply = (q: TeacherQuestion) => {
    setReplyTo(q.id);
    setDraft(q.answer || '');
    setAlsoPublic(q.is_public);
  };

  const submit = async (q: TeacherQuestion) => {
    const answer = draft.trim();
    if (!answer || sending) return;
    setSending(true);
    try {
      const r = await phoneticsApi.answerQuestion(q.id, answer, alsoPublic);
      setRows((prev) => prev.map((x) => (x.id === q.id
        ? { ...x, answer: r.answer, answered_at: r.answered_at, is_public: r.is_public }
        : x)));
      onPendingChange?.(r.pending);
      setReplyTo(null);
      setDraft('');
      toast.success(r.is_public ? '已回答,并公开给同学' : '已回答');
      // 在「待回答」页签下答完那条就不属于这个筛选集了,重取一次免得它留在屏幕上
      if (status === 'pending') void load();
    } catch (e) {
      toast.error(getErrorMessage(e, '回答失败'));
    } finally {
      setSending(false);
    }
  };

  const flag = async (q: TeacherQuestion, body: { is_public?: boolean; is_hidden?: boolean }) => {
    try {
      const r = await phoneticsApi.flagQuestion(q.id, body);
      setRows((prev) => prev.map((x) => (x.id === q.id
        ? { ...x, is_public: r.is_public, is_hidden: r.is_hidden }
        : x)));
      onPendingChange?.(r.pending);
      if (body.is_hidden !== undefined) {
        toast.success(r.is_hidden ? '已隐藏,学生看不到了' : '已取消隐藏');
        // 隐藏后它会从「待回答」里消失(那个筛选集排除 hidden)
        if (status === 'pending') void load();
      } else {
        toast.success(r.is_public ? '已公开给同学' : '已取消公开');
      }
    } catch (e) {
      toast.error(getErrorMessage(e, '操作失败'));
    }
  };

  const left = MAX_ANSWER_LEN - draft.length;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
      role="dialog" aria-modal="true" aria-label="学生提问"
      onClick={onClose}
    >
      <div
        className="flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 font-display text-lg font-bold text-ink">
              <MessageCircleQuestion className="h-5 w-5 text-[#2f8791] flex-shrink-0" />
              学生提问
            </h2>
            <p className="mt-0.5 text-xs text-ink-mute">
              学生在视频下提的问题。默认只有你和他本人看得到,回答后可一键公开给全班
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="shrink-0 rounded-lg p-1.5 text-ink-mute transition hover:bg-gray-100 hover:text-ink"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="shrink-0 border-b border-gray-100 px-5">
          <div className="flex gap-1.5">
            {TABS.map(([k, label]) => (
              <button
                key={k}
                onClick={() => { setStatus(k); setReplyTo(null); setDraft(''); }}
                className={`-mb-px border-b-2 px-3 py-2 text-sm transition ${
                  status === k
                    ? 'border-[#2f8791] font-semibold text-[#173047]'
                    : 'border-transparent text-ink-mute hover:text-ink'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading && (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-ink-mute">
              <Loader2 className="h-4 w-4 animate-spin" /> 加载中…
            </p>
          )}

          {!loading && rows.length === 0 && (
            <p className="rounded-xl bg-gray-50 px-3 py-2.5 text-sm text-ink-mute">
              {/* 空状态要说清是哪个页签筛空的,否则老师会以为提问功能没人用 */}
              {status === 'pending'
                ? '没有待回答的提问 👍'
                : status === 'answered' ? '还没有回答过的提问' : '学生还没有提过问题'}
            </p>
          )}

          {!loading && rows.length > 0 && (
            <ul className="space-y-3">
              {rows.map((q) => (
                <li
                  key={q.id}
                  className={`rounded-2xl border p-3 ${
                    q.is_hidden ? 'border-gray-200 bg-gray-50' : 'border-gray-100 bg-white'}`}
                >
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-mute">
                    <span className="font-semibold text-ink">{q.student_name}</span>
                    <span className="truncate" title={q.video_title}>{q.video_title}</span>
                    {q.position_seconds != null && (
                      <span className="rounded bg-orange-50 px-1.5 py-0.5 font-numeric text-orange-600">
                        {fmtPos(q.position_seconds)} 处
                      </span>
                    )}
                    <span className="font-numeric">{fmtTime(q.created_at)}</span>
                    {q.is_public && (
                      <span className="flex items-center gap-1 rounded bg-sky-50 px-1.5 py-0.5 text-sky-600">
                        <Globe2 className="h-3 w-3" />已公开
                      </span>
                    )}
                    {q.is_hidden && (
                      <span className="flex items-center gap-1 rounded bg-gray-200 px-1.5 py-0.5 text-ink-soft">
                        <EyeOff className="h-3 w-3" />已隐藏
                      </span>
                    )}
                  </div>

                  {/* 学生的原话。**不可编辑** */}
                  <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-ink">{q.content}</p>

                  {q.answer && replyTo !== q.id && (
                    <div className="mt-2 rounded-lg border-l-2 border-emerald-400 bg-emerald-50 px-2.5 py-1.5">
                      <p className="text-[11px] text-emerald-700">
                        {q.answered_by_name || '老师'} 回答 · {fmtTime(q.answered_at)}
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-emerald-900">
                        {q.answer}
                      </p>
                    </div>
                  )}

                  {replyTo === q.id ? (
                    <div className="mt-2">
                      <textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value.slice(0, MAX_ANSWER_LEN))}
                        // 回车换行、Ctrl/Cmd+回车发送:老师的回答常有几行(讲口型/举例)
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                            e.preventDefault();
                            void submit(q);
                          }
                        }}
                        rows={3}
                        autoFocus
                        placeholder="怎么发这个音?可以写口型、举个同音的词"
                        aria-label="回答学生提问"
                        className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm
                                   focus:border-[#2f8791] focus:outline-none focus:ring-1 focus:ring-[#2f8791]/30"
                      />
                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-soft">
                          <input
                            type="checkbox"
                            checked={alsoPublic}
                            onChange={(e) => setAlsoPublic(e.target.checked)}
                            className="h-3.5 w-3.5 accent-[#2f8791]"
                          />
                          同时公开给同学看(别人也会问这个)
                        </label>
                        <div className="flex items-center gap-2">
                          {left <= 200 && <span className="text-[11px] text-ink-mute">还能写 {left} 字</span>}
                          <button
                            onClick={() => { setReplyTo(null); setDraft(''); }}
                            className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs text-ink-soft transition hover:bg-gray-200"
                          >
                            取消
                          </button>
                          <button
                            onClick={() => void submit(q)}
                            disabled={!draft.trim() || sending}
                            className="flex items-center gap-1.5 rounded-lg bg-[#2f8791] px-3 py-1.5 text-xs
                                       font-semibold text-white transition hover:bg-[#276f78]
                                       disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Send className="h-3.5 w-3.5" />
                            {sending ? '发送中' : q.answer ? '更新回答' : '回答'}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <button
                        onClick={() => openReply(q)}
                        className="rounded-lg bg-[#2f8791] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#276f78]"
                      >
                        {q.answer ? '改回答' : '回答'}
                      </button>
                      {/* 公开只对已回答的给:公开一个没答案的问题对同学没有任何用 */}
                      {q.answer && (
                        <button
                          onClick={() => void flag(q, { is_public: !q.is_public })}
                          className="flex items-center gap-1 rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs text-ink-soft transition hover:bg-sky-100"
                        >
                          {q.is_public
                            ? <><Lock className="h-3.5 w-3.5" />取消公开</>
                            : <><Globe2 className="h-3.5 w-3.5" />公开给同学</>}
                        </button>
                      )}
                      <button
                        onClick={() => {
                          if (!q.is_hidden
                            && !window.confirm(`隐藏「${q.student_name}」这条提问?他和同学都将看不到,记录会保留。`)) return;
                          void flag(q, { is_hidden: !q.is_hidden });
                        }}
                        className="flex items-center gap-1 rounded-lg bg-gray-100 px-2.5 py-1.5 text-xs text-ink-soft transition hover:bg-amber-100"
                      >
                        <EyeOff className="h-3.5 w-3.5" />
                        {q.is_hidden ? '取消隐藏' : '隐藏'}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
