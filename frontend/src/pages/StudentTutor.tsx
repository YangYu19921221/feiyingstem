/**
 * AI 学习助手「小鹰老师」(2026-10-26)。规则见后端 services/tutor.py
 *
 * - 两种回答方式: 快速(几秒出字,算 1 次)/ 深度思考(更强的模型先想再答,算 deep_cost 次)。
 *   选择按账号记在本地;深度思考的思考内容不下发(里面常直接写着答案),这里只显示「在深度思考… N 秒」
 * - 回答流式显示;出字过程中发送键变成「停止」,一个字没出就停下的不算次数
 * - 次数是每个学生**一共**几次(不按天清零),用完了点「请老师加次数」,老师在「学习助手次数」页加
 * - 回答里的英文点一下就能听(同一个 Edge TTS 声音)
 * - 可以拍一道题问思路: 照片压缩后只发给模型看,不存;作业/考试题只给提示不给答案
 * - 从错题本等地方点「问小鹰老师」进来会把问题填好(location.state.q),孩子自己点发送 —— 不自动发,省次数
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, Brain, Camera, History, Loader2, Plus, RotateCcw, Send, Square, X, Zap } from 'lucide-react';
import useGoBack from '../hooks/useGoBack';
import { useAudio } from '../hooks/useAudio';
import {
  askTutor, getConversation, getTutorStatus, listConversations, requestMoreTutor, stopTutor, TutorAskError,
  type TutorCard, type TutorConversationItem, type TutorMode, type TutorStatus,
} from '../api/tutor';
import PracticeCard from '../components/tutor/PracticeCard';
import SpeakableText from '../components/tutor/SpeakableText';
import { compressImage } from '../utils/compressImage';
import { getErrorMessage } from '../utils/errorMessage';
import { toast } from '../components/Toast';

type Img = { blob: Blob; url: string };

interface ChatMsg {
  key: string;
  role: 'user' | 'assistant';
  text: string;
  mode: TutorMode;
  hasImage?: boolean;
  imageUrl?: string | null;
  cards: TutorCard[];
  failed?: boolean;
  stopped?: boolean;
  /** 没调通时「再问一次」要用的原话 */
  retry?: { text: string; image: Img | null; mode: TutorMode; userKey: string };
}

const SUGGESTIONS = [
  '今天老师布置了什么,我做完了吗?',
  '我哪些单词最容易错?',
  '用我常错的词考考我',
  '一般现在时什么时候加 s?',
];

/** 提示词要求不用 markdown,模型偶尔还是会带,显示前去掉(后端存库前做同样的事) */
const clean = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,6}\s*/gm, '').replace(/^\s*[-*]\s+/gm, '· ');

let seq = 0;
const nextKey = () => `m${Date.now()}_${seq++}`;

function currentUserId(): string {
  try {
    return String(JSON.parse(localStorage.getItem('user') || 'null')?.id ?? '');
  } catch {
    return '';
  }
}
const modeKey = () => `tutor_mode_${currentUserId()}`;

export default function StudentTutor() {
  const goBack = useGoBack('/student/dashboard');
  const navigate = useNavigate();
  const location = useLocation();
  const { playAudio } = useAudio();

  const [status, setStatus] = useState<TutorStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [convId, setConvId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [image, setImage] = useState<Img | null>(null);
  const [mode, setMode] = useState<TutorMode>(() => {
    try { return localStorage.getItem(modeKey()) === 'deep' ? 'deep' : 'fast'; } catch { return 'fast'; }
  });
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [toolStatus, setToolStatus] = useState('');
  const [thinkStart, setThinkStart] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<TutorConversationItem[] | null>(null);
  const [asking, setAsking] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const nearBottom = useRef(true);
  // 停止: 提问的 id 要等 meta 事件才知道,点得早就先记下来,拿到 id 再发
  const userMsgIdRef = useRef<number | null>(null);
  const stopWantedRef = useRef(false);
  const frozenRef = useRef(false);

  const refreshStatus = useCallback(() => {
    getTutorStatus().then(setStatus).catch((e) => setStatusError(getErrorMessage(e, '学习助手打不开')));
  }, []);
  useEffect(() => { refreshStatus(); }, [refreshStatus]);

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

  // 「在深度思考… N 秒」每秒走一下
  useEffect(() => {
    if (!sending) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [sending]);

  // 输入框跟着字数长高(最多 4 行左右)
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [input]);

  const deepCost = status?.deep_cost ?? 2;
  const deepUsable = !!status?.deep_enabled && (status?.left ?? 0) >= deepCost;
  const effMode: TutorMode = mode === 'deep' && deepUsable ? 'deep' : 'fast';

  const pickMode = (m: TutorMode) => {
    setMode(m);
    try { localStorage.setItem(modeKey(), m); } catch { /* 隐私模式 */ }
  };

  /** 只有孩子本来就在底部时才跟着滚,往上翻着看的时候不打断 */
  const scrollToEnd = useCallback((force = false) => {
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (el && (force || nearBottom.current)) el.scrollTop = el.scrollHeight;
    });
  }, []);

  const sendStop = (id: number) => {
    stopTutor(id).catch(() => {
      // 停不掉(网断了): 直接断开,服务端照样会把这次回答跑完、存下来
      abortRef.current?.abort();
    });
  };

  const onStop = () => {
    if (!sending || stopping) return;
    setStopping(true);
    frozenRef.current = true;
    if (userMsgIdRef.current) sendStop(userMsgIdRef.current);
    else stopWantedRef.current = true;
  };

  const send = async (opts?: { text?: string; image?: Img | null; mode?: TutorMode; replace?: string[] }) => {
    // 没传 opts = 从输入框发的;传了 = 点建议 / 再问一次(不动输入框里正在写的字)
    const fromInput = !opts;
    const text = (fromInput ? input : opts.text ?? '').trim();
    const img = fromInput ? image : opts.image ?? null;
    const useMode = opts?.mode ?? effMode;
    if (sending || (!text && !img) || !status?.enabled) return;
    const userMsg: ChatMsg = { key: nextKey(), role: 'user', text, mode: useMode, hasImage: !!img, imageUrl: img?.url ?? null, cards: [] };
    const botKey = nextKey();
    setMessages((m) => [
      ...m.filter((x) => !opts?.replace?.includes(x.key)),
      userMsg,
      { key: botKey, role: 'assistant', text: '', mode: useMode, cards: [] },
    ]);
    if (fromInput) {
      setInput('');
      setImage(null);
    }
    setSending(true);
    setStopping(false);
    setToolStatus('');
    setThinkStart(null);
    setNow(Date.now());
    userMsgIdRef.current = null;
    stopWantedRef.current = false;
    frozenRef.current = false;
    scrollToEnd(true);

    const patchBot = (fn: (m: ChatMsg) => ChatMsg) =>
      setMessages((all) => all.map((m) => (m.key === botKey ? fn(m) : m)));
    let cost = useMode === 'deep' ? deepCost : 1;

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await askTutor({ text, conversationId: convId, image: img?.blob, mode: useMode }, (ev) => {
        if (ev.type === 'meta') {
          setConvId(ev.conversation_id);
          userMsgIdRef.current = ev.user_message_id;
          cost = ev.cost;
          setStatus((s) => (s ? { ...s, left: ev.left, used: s.total - ev.left } : s));
          if (stopWantedRef.current) sendStop(ev.user_message_id);
        } else if (ev.type === 'delta') {
          if (frozenRef.current) return;
          setToolStatus('');
          patchBot((m) => ({ ...m, text: m.text + ev.text }));
          scrollToEnd();
        } else if (ev.type === 'thinking') {
          setThinkStart((t) => t ?? Date.now());
        } else if (ev.type === 'status') {
          setToolStatus(ev.text);
        } else if (ev.type === 'card') {
          if (frozenRef.current) return;
          patchBot((m) => ({ ...m, cards: [...m.cards, ev.card] }));
          scrollToEnd();
        } else if (ev.type === 'done') {
          if (ev.stopped) patchBot((m) => ({ ...m, stopped: true }));
          if (ev.refunded) setStatus((s) => (s ? { ...s, left: s.left + cost, used: Math.max(0, s.used - cost) } : s));
        } else if (ev.type === 'error') {
          patchBot((m) => ({
            ...m, failed: !m.text, text: m.text || ev.message,
            retry: !m.text ? { text, image: img, mode: useMode, userKey: userMsg.key } : undefined,
          }));
          if (ev.refunded) setStatus((s) => (s ? { ...s, left: s.left + cost, used: Math.max(0, s.used - cost) } : s));
        }
      }, ctrl.signal);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') {
        patchBot((m) => ({ ...m, stopped: true }));
        return;
      }
      const msg = e instanceof TutorAskError ? e.message : '网络断了,这次没问出去,再发一次吧';
      // 请求被拒(次数用完/限速/没开放): 撤回刚才那两个气泡,把字放回输入框
      setMessages((all) => all.filter((m) => m.key !== botKey && m.key !== userMsg.key));
      if (fromInput) {
        setInput(text);
        if (img) setImage(img);
      }
      toast.error(msg);
      if (e instanceof TutorAskError && e.status === 429) refreshStatus();
    } finally {
      setSending(false);
      setStopping(false);
      setToolStatus('');
      setThinkStart(null);
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

  const askTeacher = async () => {
    if (asking) return;
    setAsking(true);
    try {
      await requestMoreTutor();
      setStatus((s) => (s ? { ...s, requested: true } : s));
      toast.success('已经告诉老师了');
    } catch (e) {
      toast.error(getErrorMessage(e, '没发出去,再点一次'));
    } finally {
      setAsking(false);
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
        key: `s${m.id}`, role: m.role, mode: m.mode, text: m.failed ? '这次没有回答上来' : m.text,
        hasImage: m.has_image, cards: m.cards || [], failed: m.failed, stopped: m.stopped,
      })));
      setHistoryOpen(false);
      scrollToEnd(true);
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

  const outOfQuota = !!status?.enabled && status.left <= 0;
  const disabled = !status?.enabled || outOfQuota;
  const thinkSecs = thinkStart ? Math.max(1, Math.round((now - thinkStart) / 1000)) : 0;

  const waitingText = (m: ChatMsg) => {
    if (stopping) return '正在停下…';
    if (toolStatus) return toolStatus;
    if (m.mode === 'deep') return thinkSecs ? `在深度思考… ${thinkSecs} 秒` : '在深度思考…';
    return '小鹰老师在想…';
  };

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
              <p className={`text-xs ${status.left <= 3 ? 'font-semibold text-orange-600' : 'text-ink-mute'}`}>
                还能问 {status.left} 次
              </p>
            )}
          </div>
          <div className="flex items-center">
            <button type="button" onClick={newConversation} disabled={sending} className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-soft hover:bg-black/5 disabled:opacity-40" aria-label="新对话" title="新对话">
              <Plus className="h-5 w-5" aria-hidden="true" />
            </button>
            <button type="button" onClick={openHistory} className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-soft hover:bg-black/5" aria-label="以前的对话" title="以前的对话">
              <History className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </nav>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto"
        onScroll={(e) => {
          const el = e.currentTarget;
          nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
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
                作业和考试题我只给提示,答案要你自己想出来哦。回答里的英文点一下就能听发音。
              </p>
              <p className="mt-2 text-xs text-ink-mute">
                你一共可以问 {status.total} 次,现在还剩 {status.left} 次。
                {status.deep_enabled && ` 难的题可以选「深度思考」,想得更透,一次算 ${deepCost} 次。`}
              </p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    disabled={disabled || sending}
                    onClick={() => send({ text: s, image: null, mode: 'fast' })}
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
                  {m.mode === 'deep' && !m.failed && (
                    <p className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                      <Brain className="h-3 w-3" aria-hidden="true" /> 深度思考
                    </p>
                  )}
                  {m.text ? (
                    <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
                      {m.failed ? m.text : <SpeakableText text={clean(m.text)} onSpeak={(s) => { void playAudio(s); }} />}
                    </p>
                  ) : m.stopped ? (
                    <p className="text-sm text-ink-mute">停下了,这次不算次数</p>
                  ) : (
                    <p className="flex items-center gap-2 text-sm text-ink-mute" aria-live="polite">
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      {waitingText(m)}
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
                  {m.stopped && m.text && <p className="mt-1.5 text-xs text-ink-mute">(停下了)</p>}
                  {m.failed && m.retry && !sending && !disabled && (
                    <button
                      type="button"
                      onClick={() => {
                        const r = m.retry!;
                        void send({ text: r.text, image: r.image, mode: r.mode, replace: [m.key, r.userKey] });
                      }}
                      className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-white px-3 text-sm font-medium text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100"
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden="true" /> 再问一次
                    </button>
                  )}
                </div>
              </div>
            )
          ))}
        </div>
      </div>

      <div className="border-t border-black/[0.06] bg-white pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-3xl px-3 pt-2 sm:px-5">
          {outOfQuota ? (
            <div className="mb-1 rounded-2xl bg-orange-50 p-4 text-center">
              <p className="text-sm font-semibold text-orange-900">你的 {status!.total} 次都用完了</p>
              <p className="mt-1 text-xs text-orange-800/80">请老师给你加次数,加好了就能接着问。</p>
              <button
                type="button"
                onClick={askTeacher}
                disabled={status!.requested || asking}
                className="mt-3 min-h-11 rounded-xl bg-orange-500 px-5 text-sm font-semibold text-white hover:bg-orange-600 disabled:bg-orange-200 disabled:text-orange-800"
              >
                {status!.requested ? '已经告诉老师了,等老师加' : asking ? '正在告诉老师…' : '请老师加次数'}
              </button>
            </div>
          ) : (
            <>
              {image && (
                <div className="mb-2 flex items-center gap-2">
                  <img src={image.url} alt="要发的题目照片" className="h-16 rounded-lg border border-black/10" />
                  <button type="button" onClick={() => setImage(null)} className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft hover:bg-black/5" aria-label="不发这张照片">
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              )}
              {status?.enabled && status.deep_enabled && (
                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <div role="radiogroup" aria-label="回答方式" className="inline-flex rounded-xl bg-slate-100 p-1">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={effMode === 'fast'}
                      disabled={sending}
                      onClick={() => pickMode('fast')}
                      className={`inline-flex min-h-9 items-center gap-1 rounded-lg px-3 text-sm transition ${effMode === 'fast' ? 'bg-white font-semibold text-orange-700 shadow-sm' : 'text-ink-soft hover:text-ink'}`}
                    >
                      <Zap className="h-4 w-4" aria-hidden="true" /> 快速
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={effMode === 'deep'}
                      disabled={sending || !deepUsable}
                      onClick={() => pickMode('deep')}
                      className={`inline-flex min-h-9 items-center gap-1 rounded-lg px-3 text-sm transition disabled:opacity-40 ${effMode === 'deep' ? 'bg-white font-semibold text-sky-700 shadow-sm' : 'text-ink-soft hover:text-ink'}`}
                    >
                      <Brain className="h-4 w-4" aria-hidden="true" /> 深度思考
                    </button>
                  </div>
                  <span className="text-xs text-ink-mute">
                    {!deepUsable
                      ? `深度思考一次要 ${deepCost} 次,剩的不够了`
                      : effMode === 'deep'
                        ? `更强的模型先想再答,慢几秒,一次算 ${deepCost} 次`
                        : '几秒就回答,一次算 1 次'}
                  </span>
                </div>
              )}
              <div className="flex items-end gap-2">
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => { void onPickImage(e.target.files?.[0]); e.target.value = ''; }}
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
                      void send();
                    }
                  }}
                  rows={1}
                  disabled={disabled}
                  placeholder={disabled ? '' : '想问什么就写下来'}
                  aria-label="你的问题"
                  className="max-h-32 min-h-11 flex-1 resize-none rounded-xl border border-black/10 bg-paper px-3 py-2.5 text-base text-ink placeholder:text-ink-mute focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-100 disabled:opacity-50"
                />
                {sending ? (
                  <button
                    type="button"
                    onClick={onStop}
                    disabled={stopping}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-60"
                    aria-label="停下"
                    title="停下(还没出字就停,不算次数)"
                  >
                    {stopping ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Square className="h-4 w-4 fill-current" aria-hidden="true" />}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => { void send(); }}
                    disabled={disabled || (!input.trim() && !image)}
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white disabled:opacity-40 ${effMode === 'deep' ? 'bg-sky-600 hover:bg-sky-700' : 'bg-orange-500 hover:bg-orange-600'}`}
                    aria-label={effMode === 'deep' ? '深度思考,发送' : '发送'}
                  >
                    <Send className="h-5 w-5" aria-hidden="true" />
                  </button>
                )}
              </div>
            </>
          )}
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
            <button type="button" onClick={newConversation} disabled={sending} className="mb-3 flex min-h-11 w-full items-center justify-center gap-1 rounded-xl bg-orange-500 text-sm font-semibold text-white hover:bg-orange-600 disabled:opacity-50">
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
                      onClick={() => { void loadConversation(c.id); }}
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
