/**
 * AI 学习助手「小鹰老师」(2026-10-26)。规则见后端 services/tutor.py
 *
 * - 回答流式显示(收到一段显示一段);助手查学情/出练习时显示「在看你今天的任务…」
 * - 可以拍一道题问思路: 照片压缩后只发给模型看,不存;作业/考试题只给提示不给答案
 * - 每天有次数上限(顶部写着还剩几次),没调通的那次退回
 * - 从错题本等地方点「问小鹰老师」进来会把问题填好(location.state.q),孩子自己点发送 —— 不自动发,省次数
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Camera, History, Loader2, Plus, Send, X } from 'lucide-react';
import useGoBack from '../hooks/useGoBack';
import {
  askTutor, getConversation, getTutorStatus, listConversations, TutorAskError,
  type TutorCard, type TutorConversationItem, type TutorStatus,
} from '../api/tutor';
import PracticeCard from '../components/tutor/PracticeCard';
import { compressImage } from '../utils/compressImage';
import { getErrorMessage } from '../utils/errorMessage';
import { toast } from '../components/Toast';

interface ChatMsg {
  key: string;
  role: 'user' | 'assistant';
  text: string;
  hasImage?: boolean;
  imageUrl?: string | null;
  cards: TutorCard[];
  failed?: boolean;
}

const SUGGESTIONS = [
  '今天老师布置了什么,我做完了吗?',
  '我哪些单词最容易错?',
  '用我常错的词考考我',
  '一般现在时什么时候加 s?',
];

/** 提示词要求不用 markdown,模型偶尔还是会带,显示前去掉 */
const clean = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,6}\s*/gm, '').replace(/^\s*[-*]\s+/gm, '· ');

let seq = 0;
const nextKey = () => `m${Date.now()}_${seq++}`;

export default function StudentTutor() {
  const goBack = useGoBack('/student/dashboard');
  const navigate = useNavigate();
  const location = useLocation();

  const [status, setStatus] = useState<TutorStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [convId, setConvId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [toolStatus, setToolStatus] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<TutorConversationItem[] | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    getTutorStatus().then(setStatus).catch((e) => setStatusError(getErrorMessage(e, '学习助手打不开')));
  }, []);

  // 从别的页面带着问题进来: 只填好,不自动发
  useEffect(() => {
    const q = (location.state as { q?: string } | null)?.q;
    if (q) {
      setInput(q.slice(0, 500));
      navigate(location.pathname, { replace: true, state: null });
      setTimeout(() => textRef.current?.focus(), 50);
    }
  }, [location.state, location.pathname, navigate]);

  // 照片的 blob 地址: 发出去后气泡里的缩略图还要用,所以不在换图时回收,页面关掉时一起回收
  const blobUrls = useRef<string[]>([]);
  useEffect(() => () => {
    abortRef.current?.abort();
    blobUrls.current.forEach((u) => URL.revokeObjectURL(u));
  }, []);

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  const send = async (raw?: string) => {
    const text = (raw ?? input).trim();
    if (sending || (!text && !image) || !status?.enabled) return;
    const img = image;
    const userMsg: ChatMsg = { key: nextKey(), role: 'user', text, hasImage: !!img, imageUrl: img?.url ?? null, cards: [] };
    const botKey = nextKey();
    setMessages((m) => [...m, userMsg, { key: botKey, role: 'assistant', text: '', cards: [] }]);
    setInput('');
    setImage(null);
    setSending(true);
    setToolStatus('');
    scrollToEnd();

    const patchBot = (fn: (m: ChatMsg) => ChatMsg) =>
      setMessages((all) => all.map((m) => (m.key === botKey ? fn(m) : m)));

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await askTutor({ text, conversationId: convId, image: img?.blob }, (ev) => {
        if (ev.type === 'meta') {
          setConvId(ev.conversation_id);
          setStatus((s) => (s ? { ...s, left: ev.left, used: s.daily_limit - ev.left } : s));
        } else if (ev.type === 'delta') {
          setToolStatus('');
          patchBot((m) => ({ ...m, text: m.text + ev.text }));
          scrollToEnd();
        } else if (ev.type === 'status') {
          setToolStatus(ev.text);
        } else if (ev.type === 'card') {
          patchBot((m) => ({ ...m, cards: [...m.cards, ev.card] }));
          scrollToEnd();
        } else if (ev.type === 'error') {
          patchBot((m) => ({ ...m, failed: !m.text, text: m.text || ev.message }));
          if (ev.refunded) setStatus((s) => (s ? { ...s, left: s.left + 1, used: Math.max(0, s.used - 1) } : s));
        }
      }, ctrl.signal);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      const msg = e instanceof TutorAskError ? e.message : '网络断了,这次没问出去,再发一次吧';
      // 请求被拒(次数用完/限速/没开放): 撤回刚才那两个气泡,把字放回输入框
      setMessages((all) => all.filter((m) => m.key !== botKey && m.key !== userMsg.key));
      setInput(text);
      if (img) setImage(img);
      toast.error(msg);
      if (e instanceof TutorAskError && e.status === 429) {
        setStatus((s) => (s ? { ...s, left: 0 } : s));
      }
    } finally {
      setSending(false);
      setToolStatus('');
      abortRef.current = null;
    }
  };

  const onPickImage = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('只能选照片');
      return;
    }
    try {
      const blob = await compressImage(file, 1280, 0.85);
      const url = URL.createObjectURL(blob);
      blobUrls.current.push(url);
      setImage({ blob, url });
    } catch {
      toast.error('这张照片打不开,换一张试试');
    }
  };

  const openHistory = async () => {
    setHistoryOpen(true);
    try {
      setHistory((await listConversations()).items);
    } catch (e) {
      toast.error(getErrorMessage(e, '加载记录失败'));
      setHistory([]);
    }
  };

  const loadConversation = async (id: number) => {
    if (sending) return;
    try {
      const c = await getConversation(id);
      setConvId(c.id);
      setMessages(c.messages.map((m) => ({
        key: `s${m.id}`, role: m.role, text: m.failed ? '这次没有回答上来' : m.text,
        hasImage: m.has_image, cards: m.cards || [], failed: m.failed,
      })));
      setHistoryOpen(false);
      scrollToEnd();
    } catch (e) {
      toast.error(getErrorMessage(e, '加载失败'));
    }
  };

  const newConversation = () => {
    if (sending) return;
    setConvId(null);
    setMessages([]);
    setHistoryOpen(false);
  };

  const disabled = !status?.enabled || status.left <= 0;

  return (
    <div className="flex h-[100dvh] flex-col bg-paper">
      <nav className="sticky top-0 z-20 border-b border-black/[0.06] bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-2 px-3 py-2 sm:px-5">
          <button type="button" onClick={() => goBack()} className="flex min-h-11 items-center gap-1.5 px-1 text-sm text-ink-soft hover:text-ink">
            <ArrowLeft className="h-4 w-4" aria-hidden="true" /> 返回
          </button>
          <div className="text-center">
            <h1 className="font-display text-base font-semibold text-ink">小鹰老师</h1>
            {status?.enabled && (
              <p className="text-xs text-ink-mute">今天还能问 {status.left} 次</p>
            )}
          </div>
          <div className="flex items-center">
            <button type="button" onClick={newConversation} className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-soft hover:bg-black/5" aria-label="新对话" title="新对话">
              <Plus className="h-5 w-5" aria-hidden="true" />
            </button>
            <button type="button" onClick={openHistory} className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-soft hover:bg-black/5" aria-label="以前的对话" title="以前的对话">
              <History className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </nav>

      <div ref={listRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-4 px-3 py-4 sm:px-5">
          {statusError && <p className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{statusError}</p>}
          {status && !status.enabled && (
            <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
              <p className="text-base font-semibold text-ink">学习助手暂时用不了</p>
              <p className="mt-1 text-sm text-ink-soft">{status.reason}</p>
            </div>
          )}

          {status?.enabled && messages.length === 0 && (
            <div className="rounded-2xl bg-white p-5 shadow-sm">
              <p className="text-base font-semibold text-ink">你好,我是小鹰老师</p>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                单词怎么记、哪里拼错了、语法不懂、题目没思路,都可以问我。也可以点左下角的相机拍一道题。
                作业和考试题我只给提示,答案要你自己想出来哦。
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={disabled || sending}
                    onClick={() => send(s)}
                    className="min-h-11 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-left text-sm text-orange-800 hover:bg-orange-100 disabled:opacity-50"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            m.role === 'user' ? (
              <div key={m.key} className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md bg-orange-500 px-4 py-2.5 text-white shadow-sm">
                  {m.imageUrl && <img src={m.imageUrl} alt="我发的题目照片" className="mb-2 max-h-48 rounded-lg" />}
                  {m.hasImage && !m.imageUrl && <p className="mb-1 text-xs text-white/80">[发了一张题目照片]</p>}
                  {m.text && <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{m.text}</p>}
                </div>
              </div>
            ) : (
              <div key={m.key} className="flex justify-start">
                <div className={`w-full max-w-[92%] rounded-2xl rounded-bl-md px-4 py-3 shadow-sm ${m.failed ? 'bg-rose-50 text-rose-700' : 'bg-white text-ink'}`}>
                  {m.text ? (
                    <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{clean(m.text)}</p>
                  ) : (
                    <p className="flex items-center gap-2 text-sm text-ink-mute" aria-live="polite">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      {toolStatus || '小鹰老师在想…'}
                    </p>
                  )}
                  {m.cards.map((c, i) => (
                    c.type === 'practice' ? (
                      <PracticeCard key={i} mode={c.mode} items={c.items} />
                    ) : (
                      <button
                        key={i}
                        type="button"
                        onClick={() => navigate(c.route)}
                        className="mt-3 min-h-11 rounded-xl bg-orange-500 px-4 text-sm font-semibold text-white hover:bg-orange-600"
                      >
                        {c.label}
                      </button>
                    )
                  ))}
                </div>
              </div>
            )
          ))}
        </div>
      </div>

      <div className="border-t border-black/[0.06] bg-white pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-3xl px-3 pt-2 sm:px-5">
          {image && (
            <div className="mb-2 flex items-center gap-2">
              <img src={image.url} alt="要发的题目照片" className="h-16 rounded-lg border border-black/10" />
              <button type="button" onClick={() => setImage(null)} className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft hover:bg-black/5" aria-label="不发这张照片">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          )}
          {status?.enabled && status.left <= 0 && (
            <p className="mb-2 text-center text-sm text-ink-soft">今天的 {status.daily_limit} 次用完了,明天再来问吧</p>
          )}
          <div className="flex items-end gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => { onPickImage(e.target.files?.[0]); e.target.value = ''; }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={disabled || sending}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600 hover:bg-orange-100 disabled:opacity-40"
              aria-label="拍一道题"
              title="拍一道题"
            >
              <Camera className="h-5 w-5" aria-hidden="true" />
            </button>
            <textarea
              ref={textRef}
              value={input}
              onChange={(e) => setInput(e.target.value.slice(0, status?.max_text ?? 500))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              disabled={disabled}
              placeholder={disabled ? '' : '想问什么就写下来'}
              aria-label="你的问题"
              className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-black/10 bg-paper px-3 py-2.5 text-base text-ink placeholder:text-ink-mute focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => send()}
              disabled={disabled || sending || (!input.trim() && !image)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-40"
              aria-label="发送"
            >
              {sending ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Send className="h-5 w-5" aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>

      {historyOpen && (
        <div className="fixed inset-0 z-[70] flex justify-end bg-black/30" onClick={() => setHistoryOpen(false)}>
          <div className="h-full w-full max-w-sm overflow-y-auto bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="以前的对话">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-ink">以前的对话</h2>
              <button type="button" onClick={() => setHistoryOpen(false)} className="flex h-10 w-10 items-center justify-center rounded-lg text-ink-soft hover:bg-black/5" aria-label="关闭">
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <button type="button" onClick={newConversation} className="mb-3 flex min-h-11 w-full items-center justify-center gap-1 rounded-xl bg-orange-500 text-sm font-semibold text-white hover:bg-orange-600">
              <Plus className="h-4 w-4" aria-hidden="true" /> 新对话
            </button>
            {history === null ? (
              <p className="text-sm text-ink-mute">加载中…</p>
            ) : history.length === 0 ? (
              <p className="text-sm text-ink-mute">还没有问过问题</p>
            ) : (
              <ul className="space-y-1">
                {history.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => loadConversation(c.id)}
                      className={`w-full rounded-xl px-3 py-2.5 text-left hover:bg-orange-50 ${c.id === convId ? 'bg-orange-50' : ''}`}
                    >
                      <p className="truncate text-sm text-ink">{c.title}</p>
                      <p className="text-xs text-ink-mute">
                        {c.updated_at ? new Date(c.updated_at + 'Z').toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                      </p>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
