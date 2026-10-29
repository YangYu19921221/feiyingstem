/**
 * 教师端「小鹰老师」(2026-10-29,用户「教师端也需要一个月 1000 的额度,需要同样的功能」)。规则见后端 services/teacher_tutor.py
 *
 * 和学生端同一套聊天(流式、停下、新对话、以前的对话、拍照、发文件、说一句、快速 / 深度思考),换的是:
 * - 老师要答案直接给;出题走「练习卷」卡片(WorksheetCard,带答案,能下载学生版 / 教师版 PDF)
 * - 能查本班: 全班情况、谁卡在某个点上、某个孩子的学情、全班常错词
 * - 次数: 每位老师每月 monthly 次(北京时间每月 1 号恢复);直营免费,加盟机构每问一次从机构次数池扣
 * - 学生名字不发给模型: 回答里学生是代号 S+id,页面拿本班名单(/teacher/tutor/me/roster)换回名字
 * 入口: 教师工作台「课堂推进 → 问小鹰老师(备课 / 出卷)」,顶部「更多 → 问小鹰老师」
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Brain, Camera, History, Loader2, Paperclip, Plus, RotateCcw, Send, Sparkles, Square, X, Zap } from 'lucide-react';
import StaffWorkspaceHeader from '../components/staff/StaffWorkspaceHeader';
import {
  askTutor, getTeacherConversation, getTeacherTutorRoster, getTeacherTutorStatus, getTeacherVoice, stopTeacherTutor,
  TEACHER_ASK_PATH, TutorAskError, TUTOR_FILE_ACCEPT, TUTOR_FILE_MAX_MB, uploadTeacherVoice,
  type RosterItem, type TeacherTutorStatus, type TutorCard, type TutorMode,
} from '../api/tutor';
import { TEACHER_HISTORY } from '../api/tutorHistory';
import TutorHistoryDrawer from '../components/tutor/TutorHistoryDrawer';
import TutorWaiting, { TutorAvatar } from '../components/tutor/TutorWaiting';
import WorksheetCard from '../components/tutor/WorksheetCard';
import FileChip from '../components/tutor/FileChip';
import VoiceInputButton from '../components/tutor/VoiceInputButton';
import { compressImage } from '../utils/compressImage';
import { DOC_HINT, fileKindOf } from '../utils/tutorFile';
import { getErrorMessage } from '../utils/errorMessage';
import { toast } from '../components/Toast';

type Img = { blob: Blob; url: string };
interface ChatMsg {
  key: string;
  role: 'user' | 'assistant';
  text: string;
  mode: TutorMode;
  imageUrl?: string | null;
  hasImage?: boolean;
  file?: { name: string; kind: string; size?: number; pages?: number | null } | null;
  cards: TutorCard[];
  failed?: boolean;
  stopped?: boolean;
  retry?: { text: string; image: Img | null; file: File | null; mode: TutorMode; userKey: string };
}

const SUGGESTIONS = [
  '我班上这周谁没学?大家卡在哪?',
  '谁卡在一般现在时第三人称上?给他们出 5 道题',
  '帮我备一节 15 分钟的 be 动词复习课',
  '全班最近常错哪些词?出一份单词小测',
];

const clean = (s: string) => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#{1,6}\s*/gm, '').replace(/^\s*[-*]\s+/gm, '· ');
let seq = 0;
const nextKey = () => `t${Date.now()}_${seq++}`;
const modeKey = () => {
  try { return `teacher_tutor_mode_${JSON.parse(localStorage.getItem('user') || 'null')?.id ?? ''}`; } catch { return 'teacher_tutor_mode_'; }
};

export default function TeacherTutor() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<TeacherTutorStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [roster, setRoster] = useState<RosterItem[]>([]);
  const [convId, setConvId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [image, setImage] = useState<Img | null>(null);
  const [doc, setDoc] = useState<File | null>(null);
  const [mode, setMode] = useState<TutorMode>(() => {
    try { return localStorage.getItem(modeKey()) === 'deep' ? 'deep' : 'fast'; } catch { return 'fast'; }
  });
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [toolStatus, setToolStatus] = useState('');
  const [thinkStart, setThinkStart] = useState<number | null>(null);
  const [sendStart, setSendStart] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [historyOpen, setHistoryOpen] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const imgRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);
  const userMsgIdRef = useRef<number | null>(null);
  const stopWantedRef = useRef(false);
  const sessionRef = useRef(0);
  const blobUrls = useRef<string[]>([]);

  const refreshStatus = useCallback(() => {
    getTeacherTutorStatus().then(setStatus).catch((e) => setStatusError(getErrorMessage(e, '小鹰老师打不开')));
  }, []);
  useEffect(() => { refreshStatus(); }, [refreshStatus]);
  useEffect(() => { getTeacherTutorRoster().then((r) => setRoster(r.items)).catch(() => setRoster([])); }, []);
  useEffect(() => () => {
    abortRef.current?.abort();
    blobUrls.current.forEach((u) => URL.revokeObjectURL(u));
  }, []);
  useEffect(() => {
    if (!sending) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [sending]);
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 192)}px`;
  }, [input]);

  // 回答里的学生代号(S1042)换成名字: 名字不发给模型,只在页面上换
  const nameByCode = useMemo(() => new Map(roster.map((r) => [r.code, r.name])), [roster]);
  const nameOf = useCallback((code: string) => nameByCode.get(code) ?? code, [nameByCode]);
  const withNames = useCallback((s: string) => s.replace(/\bS(\d{1,7})\b/g, (m) => nameByCode.get(m) ?? m), [nameByCode]);

  const scrollToEnd = () => requestAnimationFrame(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  const deepCost = status?.deep_cost ?? 2;
  const deepUsable = !!status?.deep_enabled && (status?.left ?? 0) >= deepCost;
  const effMode: TutorMode = mode === 'deep' && deepUsable ? 'deep' : 'fast';
  const disabled = !status?.enabled || (status?.left ?? 0) <= 0;

  const pickMode = (m: TutorMode) => {
    setMode(m);
    try { localStorage.setItem(modeKey(), m); } catch { /* 隐私模式 */ }
  };

  const send = async (opts?: { text: string; image?: Img | null; file?: File | null; mode?: TutorMode; replace?: string[] }) => {
    const fromInput = !opts;
    const text = (fromInput ? input : opts.text).trim();
    const img = fromInput ? image : opts.image ?? null;
    const fileToSend = fromInput ? doc : opts.file ?? null;
    const useMode = opts?.mode ?? effMode;
    if (sending || sendingRef.current || (!text && !img && !fileToSend) || !status?.enabled) return;
    sendingRef.current = true;
    const userMsg: ChatMsg = {
      key: nextKey(), role: 'user', text, mode: useMode, imageUrl: img?.url ?? null, hasImage: !!img,
      file: fileToSend ? { name: fileToSend.name, kind: fileKindOf(fileToSend.name), size: fileToSend.size } : null, cards: [],
    };
    const botKey = nextKey();
    setMessages((m) => [...m.filter((x) => !opts?.replace?.includes(x.key)), userMsg,
      { key: botKey, role: 'assistant', text: '', mode: useMode, cards: [] }]);
    if (fromInput) { setInput(''); setImage(null); setDoc(null); }
    setSending(true); setStopping(false); setToolStatus(''); setThinkStart(null);
    setSendStart(Date.now()); setNow(Date.now());
    userMsgIdRef.current = null; stopWantedRef.current = false;
    scrollToEnd();
    const patchBot = (fn: (m: ChatMsg) => ChatMsg) => setMessages((all) => all.map((m) => (m.key === botKey ? fn(m) : m)));
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const session = sessionRef.current;
    const live = () => sessionRef.current === session;
    try {
      await askTutor({ text, conversationId: convId, image: img?.blob, file: fileToSend, mode: useMode }, (ev) => {
        if (!live()) {
          if (ev.type === 'meta') stopTeacherTutor(ev.user_message_id).catch(() => ctrl.abort());
          if (ev.type === 'done' || ev.type === 'error') refreshStatus();
          return;
        }
        if (ev.type === 'meta') {
          setConvId(ev.conversation_id);
          userMsgIdRef.current = ev.user_message_id;
          setStatus((s) => (s ? { ...s, left: ev.left } : s));
          if (stopWantedRef.current) stopTeacherTutor(ev.user_message_id).catch(() => ctrl.abort());
        } else if (ev.type === 'delta') {
          setToolStatus('');
          patchBot((m) => ({ ...m, text: m.text + ev.text }));
          scrollToEnd();
        } else if (ev.type === 'thinking') {
          setThinkStart((t) => t ?? Date.now());
        } else if (ev.type === 'status') {
          setToolStatus(ev.text);
        } else if (ev.type === 'card') {
          patchBot((m) => ({ ...m, cards: [...m.cards, ev.card] }));
          scrollToEnd();
        } else if (ev.type === 'done') {
          if (ev.stopped) patchBot((m) => ({ ...m, stopped: true }));
          refreshStatus();
        } else if (ev.type === 'error') {
          patchBot((m) => ({ ...m, failed: !m.text, text: m.text || ev.message,
            retry: !m.text ? { text, image: img, file: fileToSend, mode: useMode, userKey: userMsg.key } : undefined }));
          refreshStatus();
        }
      }, ctrl.signal, TEACHER_ASK_PATH);
    } catch (e) {
      if (!live()) return;
      if ((e as Error)?.name === 'AbortError') { patchBot((m) => ({ ...m, stopped: true })); return; }
      setMessages((all) => all.filter((m) => m.key !== botKey && m.key !== userMsg.key));
      if (fromInput) { setInput(text); if (img) setImage(img); if (fileToSend) setDoc(fileToSend); }
      toast.error(e instanceof TutorAskError ? e.message : '网络断了,这次没问出去,再发一次吧');
      if (e instanceof TutorAskError && e.status === 429) refreshStatus();
    } finally {
      if (live()) {
        setSending(false); setStopping(false); setToolStatus(''); setThinkStart(null); setSendStart(null);
        abortRef.current = null; sendingRef.current = false;
      }
    }
  };

  const onStop = () => {
    if (!sending || stopping) return;
    setStopping(true);
    if (userMsgIdRef.current) stopTeacherTutor(userMsgIdRef.current).catch(() => abortRef.current?.abort());
    else stopWantedRef.current = true;
  };

  const detachAnswer = () => {
    if (!sendingRef.current) return;
    const id = userMsgIdRef.current;
    const old = abortRef.current;
    if (id) stopTeacherTutor(id).catch(() => old?.abort());
    sessionRef.current += 1;
    sendingRef.current = false; abortRef.current = null; userMsgIdRef.current = null; stopWantedRef.current = false;
    setSending(false); setStopping(false); setToolStatus(''); setThinkStart(null); setSendStart(null);
  };

  const newConversation = () => {
    setHistoryOpen(false);
    if (!sendingRef.current && messages.length === 0 && convId === null) {
      toast.info('现在就是新对话,直接问吧');
      textRef.current?.focus();
      return;
    }
    detachAnswer();
    setConvId(null);
    setMessages([]);
    textRef.current?.focus();
  };

  const loadConversation = async (id: number) => {
    try {
      const c = await getTeacherConversation(id);
      detachAnswer();
      setConvId(c.id);
      setMessages(c.messages.map((m) => ({
        key: `s${m.id}`, role: m.role, mode: m.mode, text: m.failed ? '这次没有回答上来' : m.text, hasImage: m.has_image,
        cards: m.role === 'user' ? [] : (m.cards || []), failed: m.failed, stopped: m.stopped,
        file: (() => {
          const f = (m.cards || []).find((x) => x.type === 'file');
          return f && f.type === 'file' ? { name: f.name, kind: f.kind, pages: f.pages } : null;
        })(),
      })));
      setHistoryOpen(false);
      scrollToEnd();
    } catch (e) {
      toast.error(getErrorMessage(e, '加载失败'));
    }
  };

  const onPickImage = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { onPickDoc(file); return; }
    setDoc(null);
    try {
      const blob = await compressImage(file, 1280, 0.85);
      const url = URL.createObjectURL(blob);
      blobUrls.current.push(url);
      setImage({ blob, url });
    } catch {
      toast.error('这张照片打不开,换一张试试');
    }
  };
  const onPickDoc = (file: File | undefined) => {
    if (!file) return;
    if (file.type.startsWith('image/')) { void onPickImage(file); return; }
    const kind = fileKindOf(file.name);
    if (!kind) { toast.error('只能发 PDF、Word(.docx)或 txt 文件'); return; }
    if (kind === 'doc') { toast.error(DOC_HINT); return; }
    if (file.size > TUTOR_FILE_MAX_MB * 1024 * 1024) { toast.error(`文件太大了(最大 ${TUTOR_FILE_MAX_MB}MB)`); return; }
    setImage(null);
    setDoc(file);
    textRef.current?.focus();
  };

  const lastBot = messages.length > 0 ? messages[messages.length - 1] : null;
  const liveKey = sending && lastBot?.role === 'assistant' ? lastBot.key : null;
  const thinkSecs = thinkStart ? Math.max(1, Math.round((now - thinkStart) / 1000)) : 0;
  const waitSecs = sendStart ? Math.max(0, Math.round((now - sendStart) / 1000)) : 0;

  const quota = status && (
    <p className={`text-xs ${status.left <= 20 ? 'font-semibold text-orange-600' : 'text-slate-500'}`}>
      本月还能问 {status.month_left} 次(共 {status.monthly} 次,每月 1 号恢复)
      {status.uses_pool && status.pool_left !== null && ` · 机构次数池还剩 ${status.pool_left} 次`}
    </p>
  );

  return (
    <div className="flex h-[100dvh] flex-col bg-[#f5f8fc] text-slate-800">
      <StaffWorkspaceHeader role="teacher" title="问小鹰老师" subtitle="备课、出卷、看全班卡在哪" icon={Sparkles}
        backTo="/teacher/dashboard"
        action={(
          <div className="flex items-center">
            <button type="button" onClick={newConversation} className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="新对话" title="新对话">
              <Plus className="h-5 w-5" aria-hidden="true" />
            </button>
            <button type="button" onClick={() => setHistoryOpen(true)} className="flex h-10 w-10 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100" aria-label="以前的对话" title="以前的对话">
              <History className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        )} />

      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-3xl space-y-4 px-3 py-4 sm:px-5">
          {statusError && <p className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{statusError}</p>}
          {status && !status.enabled && (
            <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
              <p className="text-base font-semibold text-slate-900">小鹰老师暂时用不了</p>
              <p className="mt-1 text-sm text-slate-500">{status.reason}</p>
            </div>
          )}
          {status?.enabled && messages.length === 0 && (
            <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-black/[0.04]">
              <div className="flex items-center gap-3">
                <TutorAvatar size="lg" />
                <div>
                  <p className="text-base font-semibold text-slate-900">老师好,我是 AI 助教小鹰老师</p>
                  {quota}
                </div>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-slate-600">
                我能看到你班上孩子的学习情况: 这周谁没学、大家卡在哪、哪个孩子总错哪类题。可以让我出练习卷(带答案,能直接下载 PDF 打印)、
                备一节课、给卡住的孩子想个讲法,也可以拍一张卷子或发一份作文让我批改讲评。
                {status.uses_pool && ` 你们学校每问一次从机构的学习助手次数里扣 1 次(深度思考 ${deepCost} 次)。`}
              </p>
              <p className="mt-2 text-xs text-slate-400">学生的名字不会发给 AI,回答里的名字是页面上换回来的。</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" disabled={disabled || sending} onClick={() => void send({ text: s, mode: 'fast' })}
                    className="min-h-11 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-left text-sm text-orange-800 hover:bg-orange-100 disabled:opacity-50">
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => {
            if (m.role === 'user') {
              return (
                <div key={m.key} className="flex justify-end">
                  <div className="w-fit max-w-[80%] rounded-2xl rounded-tr-md bg-slate-800 px-4 py-2.5 text-white shadow-sm">
                    {m.imageUrl && <img src={m.imageUrl} alt="我发的照片" className="mb-2 max-h-48 rounded-xl object-contain" />}
                    {m.hasImage && !m.imageUrl && <p className="mb-1 text-xs text-white/80">[发了一张照片]</p>}
                    {m.file && <div className={m.text ? 'mb-2' : ''}><FileChip name={m.file.name} kind={m.file.kind} pages={m.file.pages} size={m.file.size} tone="onWarm" /></div>}
                    {m.text && <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{m.text}</p>}
                  </div>
                </div>
              );
            }
            const isLive = m.key === liveKey;
            const waiting = !m.text && !m.stopped && !m.failed;
            const wide = m.cards.some((c) => c.type === 'worksheet');
            return (
              <div key={m.key} className="flex items-start gap-2">
                <TutorAvatar busy={isLive && waiting} deep={m.mode === 'deep'} />
                <div className={`min-w-0 ${wide ? 'w-full flex-1' : 'max-w-[min(100%,40rem)]'}`}>
                  <div className={`rounded-2xl rounded-tl-md px-4 py-3 shadow-sm ring-1 ${wide ? 'w-full' : 'w-fit max-w-full'} ${m.failed ? 'bg-rose-50 text-rose-700 ring-rose-100' : 'bg-white ring-black/[0.04]'}`}>
                    {m.mode === 'deep' && !m.failed && !waiting && (
                      <p className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                        <Brain className="h-3 w-3" aria-hidden="true" /> 深度思考
                      </p>
                    )}
                    {m.text ? (
                      <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
                        {m.failed ? m.text : withNames(clean(m.text))}
                        {isLive && !toolStatus && !stopping && <span className="tutor-caret" aria-hidden="true" />}
                      </p>
                    ) : m.stopped ? (
                      <p className="text-sm text-slate-400">停下了,这次不算次数</p>
                    ) : isLive ? (
                      <TutorWaiting kind={stopping ? 'stopping' : m.mode === 'deep' ? 'deep' : toolStatus ? 'tool' : 'think'}
                        label={stopping ? '正在停下…' : toolStatus || (m.mode === 'deep' ? '在深度思考' : '小鹰老师在想')}
                        secs={thinkSecs} waited={waitSecs} />
                    ) : null}
                    {isLive && m.text && toolStatus && <TutorWaiting kind="tool" label={toolStatus} compact />}
                    {m.cards.map((c, i) => (c.type === 'worksheet' ? (
                      <WorksheetCard key={i} title={c.title} topic={c.topic} items={c.items} students={c.students} nameOf={nameOf} />
                    ) : null))}
                    {m.stopped && m.text && <p className="mt-1.5 text-xs text-slate-400">(停下了)</p>}
                    {m.failed && m.retry && !sending && !disabled && (
                      <button type="button" onClick={() => { const r = m.retry!; void send({ text: r.text, image: r.image, file: r.file, mode: r.mode, replace: [m.key, r.userKey] }); }}
                        className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-white px-3 text-sm font-medium text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100">
                        <RotateCcw className="h-4 w-4" aria-hidden="true" /> 再问一次
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t border-black/[0.06] bg-white pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-3xl px-3 pt-2 sm:px-5">
          {status?.enabled && status.left <= 0 ? (
            <div className="mb-1 rounded-2xl bg-orange-50 p-4 text-center text-sm text-orange-900">
              {status.limit_by === 'pool'
                ? '本机构的学习助手次数用完了,请机构管理员向平台购买次数(¥0.3 / 次,1,000 次起)'
                : `这个月的 ${status.monthly} 次用完了,下个月 1 号恢复`}
            </div>
          ) : (
            <>
              {messages.length > 0 && quota && <div className="mb-1.5">{quota}</div>}
              {image && (
                <div className="mb-2 flex items-end gap-2">
                  <span className="relative">
                    <img src={image.url} alt="要发的照片" className="h-20 rounded-xl border border-black/10 object-cover" />
                    <button type="button" onClick={() => setImage(null)} aria-label="不发这张照片"
                      className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-slate-700 text-white ring-2 ring-white">
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </span>
                </div>
              )}
              {doc && <div className="mb-2"><FileChip name={doc.name} kind={fileKindOf(doc.name)} size={doc.size} onRemove={() => setDoc(null)} /></div>}
              {status?.enabled && status.deep_enabled && (
                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <div role="radiogroup" aria-label="回答方式" className="inline-flex rounded-xl bg-slate-100 p-1">
                    <button type="button" role="radio" aria-checked={effMode === 'fast'} disabled={sending} onClick={() => pickMode('fast')}
                      className={`inline-flex min-h-9 items-center gap-1 rounded-lg px-3 text-sm ${effMode === 'fast' ? 'bg-white font-semibold text-orange-700 shadow-sm' : 'text-slate-500'}`}>
                      <Zap className="h-4 w-4" aria-hidden="true" /> 快速
                    </button>
                    <button type="button" role="radio" aria-checked={effMode === 'deep'} disabled={sending || !deepUsable} onClick={() => pickMode('deep')}
                      className={`inline-flex min-h-9 items-center gap-1 rounded-lg px-3 text-sm disabled:opacity-40 ${effMode === 'deep' ? 'bg-white font-semibold text-sky-700 shadow-sm' : 'text-slate-500'}`}>
                      <Brain className="h-4 w-4" aria-hidden="true" /> 深度思考
                    </button>
                  </div>
                  <span className="text-xs text-slate-400">{effMode === 'deep' ? `想得更透,一次算 ${deepCost} 次` : '几秒就回答,一次算 1 次'}</span>
                </div>
              )}
              <div className={`flex items-end gap-1 rounded-3xl border border-black/10 bg-slate-50 p-1 focus-within:border-orange-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-orange-100 ${disabled ? 'opacity-60' : ''}`}>
                <input ref={imgRef} type="file" accept="image/*" className="hidden" onChange={(e) => { void onPickImage(e.target.files?.[0]); e.target.value = ''; }} />
                <button type="button" onClick={() => imgRef.current?.click()} disabled={disabled || sending} aria-label="拍照 / 发图片" title="拍照 / 发图片"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-orange-600 hover:bg-orange-100 disabled:opacity-40">
                  <Camera className="h-5 w-5" aria-hidden="true" />
                </button>
                <input ref={docRef} type="file" accept={TUTOR_FILE_ACCEPT} className="hidden" onChange={(e) => { onPickDoc(e.target.files?.[0]); e.target.value = ''; }} />
                <button type="button" onClick={() => docRef.current?.click()} disabled={disabled || sending} aria-label="发一份文件(PDF、Word、txt)" title="发一份文件(PDF、Word、txt)"
                  className="-ml-1 flex h-11 w-9 shrink-0 items-center justify-center rounded-full text-orange-600 hover:bg-orange-100 disabled:opacity-40">
                  <Paperclip className="h-5 w-5" aria-hidden="true" />
                </button>
                {status?.voice_enabled && (
                  <VoiceInputButton disabled={disabled || sending} upload={uploadTeacherVoice} poll={getTeacherVoice}
                    onText={(t) => { setInput((v) => (v.trim() ? `${v.trim()} ${t}` : t).slice(0, status?.max_text ?? 2000)); textRef.current?.focus(); }} />
                )}
                <textarea ref={textRef} value={input} rows={1} disabled={disabled}
                  onChange={(e) => setInput(e.target.value.slice(0, status?.max_text ?? 2000))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
                  }}
                  placeholder={disabled ? '' : '想让我帮什么就写下来(Shift + 回车换行)'} aria-label="你的问题"
                  className="tutor-composer-input max-h-48 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-1 py-2.5 text-base leading-6 text-slate-900 placeholder:text-slate-400 focus:outline-none" />
                {sending ? (
                  <button type="button" onClick={onStop} disabled={stopping} aria-label="停下" title="停下(还没出字就停,不算次数)"
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-60">
                    {stopping ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Square className="h-4 w-4 fill-current" aria-hidden="true" />}
                  </button>
                ) : (
                  <button type="button" onClick={() => { void send(); }} disabled={disabled || (!input.trim() && !image && !doc)}
                    aria-label={effMode === 'deep' ? '深度思考,发送' : '发送'}
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white disabled:bg-slate-300 ${effMode === 'deep' ? 'bg-sky-600 hover:bg-sky-700' : 'bg-orange-500 hover:bg-orange-600'}`}>
                    <Send className="h-5 w-5" aria-hidden="true" />
                  </button>
                )}
              </div>
              <p className="mt-1 text-center text-[11px] text-slate-400">
                AI 生成的内容可能有错,出的题和答案用之前看一眼。
                <button type="button" onClick={() => navigate('/teacher/tutor-class')} className="ml-1 underline-offset-2 hover:underline">看本班情况 →</button>
              </p>
            </>
          )}
        </div>
      </div>

      <TutorHistoryDrawer open={historyOpen} currentId={convId} onClose={() => setHistoryOpen(false)}
        onPick={(id) => { void loadConversation(id); }} onNew={newConversation}
        onDeletedCurrent={() => { detachAnswer(); setConvId(null); setMessages([]); }} base={TEACHER_HISTORY} />
    </div>
  );
}
