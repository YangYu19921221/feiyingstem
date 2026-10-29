/**
 * AI 学习助手「小鹰老师」(2026-10-26)。规则见后端 services/tutor.py
 *
 * - 两种回答方式: 快速(几秒出字,算 1 次)/ 深度思考(更强的模型先想再答,算 deep_cost 次)。
 *   选择按账号记在本地;深度思考的思考内容不下发(里面常直接写着答案),这里只显示「在深度思考… N 秒」
 * - 回答流式显示;出字过程中发送键变成「停止」,一个字没出就停下的不算次数
 * - 次数是每个学生**一共**几次(不按天清零),用完了点「请老师加次数」,老师在「学习助手次数」页加
 * - 回答里的英文点一下就能听(同一个 Edge TTS 声音)
 * - 可以拍一道题问思路: 照片压缩后只发给模型看,不存;作业/考试题先提示,试过两次还不会再讲答案和理由
 * - 说一句(10-27 晚,components/tutor/VoiceInputButton): 服务器转成字填进输入框,孩子改好再发;回答下面「听全部英文」连着读
 * - 次数用完了也能「说说心里话」(care=1,不扣次数,services/tutor_safety)
 * - 可以发一份文件(10-27,PDF / Word .docx / txt,20MB 内;.doc 选到了当场提示另存,不上传;后端 services/tutor_files 取文字,扫描版 PDF 取前几页图):
 *   和照片一次只能发一样;内容不存,气泡里只留文件名卡片(FileChip);带文件的那问不算免费追问
 * - 从错题本等地方点「问小鹰老师」进来会把问题填好(location.state.q),孩子自己点发送 —— 不自动发,省次数
 * - 记忆图(10-27): 助手调 draw_word_picture 后回答下面出一张图片卡(PictureCard 自己轮询到画好)
 * - 同一道题的追问不另算(10-26 晚,用户「不给答案孩子一直答不上来怎么办」): 付过次数的那问之后 15 分钟内、
 *   快速回答、不带新照片,最多 3 次不扣(后端 services/tutor.followup_state,回答完的 done 事件带 followup)。
 *   回答下面给三个快捷回复「给我一点提示 / 还是不会,讲给我听 / 再出一道类似的」—— 孩子卡住时不用自己组织语言,
 *   助手按规则先提示、试过两次还不会就讲答案和理由并出同类题。次数用完了也能接着追问这道题
 * - 首页「考考你」(10-29,后端 services/tutor_notes): 首页卡片点了带 location.state.review 进来,这里自动发
 *   (孩子自己点的,而且一天第一次不扣次数);考哪个点由服务器从笔记里拼,前端只传 note_id
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowDown, ArrowLeft, Brain, Camera, History, Loader2, Paperclip, Plus, RotateCcw, Send, Square, Volume2, X, Zap } from 'lucide-react';
import useGoBack from '../hooks/useGoBack';
import { useAudio } from '../hooks/useAudio';
import {
  askTutor, getConversation, getTutorStatus, requestMoreTutor, stopTutor, TutorAskError,
  TUTOR_FILE_ACCEPT, TUTOR_FILE_MAX_MB,
  type TutorCard, type TutorFollowup, type TutorMode, type TutorStatus,
} from '../api/tutor';
import PictureCard from '../components/tutor/PictureCard';
import PracticeCard, { type QuizSubmitted } from '../components/tutor/PracticeCard';
import QuizCard from '../components/tutor/QuizCard';
import SpeakableText from '../components/tutor/SpeakableText';
import TutorWaiting, { TutorAvatar, type WaitKind } from '../components/tutor/TutorWaiting';
import TutorHistoryDrawer from '../components/tutor/TutorHistoryDrawer';
import FileChip from '../components/tutor/FileChip';
import { DOC_HINT, fileKindOf } from '../utils/tutorFile';
import { englishToRead } from '../utils/speakable';
import VoiceInputButton from '../components/tutor/VoiceInputButton';
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
  /** 孩子这条发了文件(刚发的从本地拿,翻出来的历史从 cards 里的 file 卡拿) */
  file?: { name: string; kind: string; size?: number; pages?: number | null } | null;
  cards: TutorCard[];
  failed?: boolean;
  stopped?: boolean;
  /** 这次刚发 / 刚收到的(从下面浮上来);翻出来的历史记录不做动画,不然一屏一起动 */
  fresh?: boolean;
  /** 没调通时「再问一次」要用的原话 */
  retry?: { text: string; image: Img | null; file?: File | null; mode: TutorMode; userKey: string; quizId?: number; care?: boolean; reviewNoteId?: number };
}

/** 回答下面的快捷回复: 孩子卡住时点一下就行,不用自己想怎么说(追问不另算) */
const QUICK_REPLIES = ['给我一点提示', '还是不会,讲给我听', '讲简单一点', '再出一道类似的题'];

const SUGGESTIONS = [
  '今天老师布置了什么,我做完了吗?',
  '我这周学得怎么样,进步了吗?',
  '用我常错的词考考我',
];
// 第四条: 能画记忆图时换成画图那条(画图没开就别让孩子点了落空)
const SUGGESTION_PICTURE = 'elephant 好难记,给我画张记忆图';
const SUGGESTION_GRAMMAR = '一般现在时什么时候加 s?';

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
  const { playAudio, stopAudio } = useAudio();

  const [status, setStatus] = useState<TutorStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [convId, setConvId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState('');
  const [image, setImage] = useState<Img | null>(null);
  // 要发的文件(PDF / Word / txt,后端 services/tutor_files):和照片一次只能发一样
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
  const [levelOpen, setLevelOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  // 次数用完了也能「说说心里话」(后端 services/tutor_safety,care=1,不扣次数、不讲题)
  const [careOpen, setCareOpen] = useState(false);
  const [careText, setCareText] = useState('');
  const [followup, setFollowup] = useState<TutorFollowup>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const nearBottom = useRef(true);
  // 做完练习时小鹰老师还在说话: 先排着,说完再自动请它讲(onQuizSubmitted)
  const [pendingFeedback, setPendingFeedback] = useState<{ r: QuizSubmitted; conv: number | null } | null>(null);
  const sendingRef = useRef(false);
  // 往上翻着看的时候不跟着滚;这时有新字就在底部给个「看新回答」按钮
  const [awayFromEnd, setAwayFromEnd] = useState(false);
  // 停止: 提问的 id 要等 meta 事件才知道,点得早就先记下来,拿到 id 再发
  const userMsgIdRef = useRef<number | null>(null);
  const stopWantedRef = useRef(false);
  const frozenRef = useRef(false);
  // 回答写到一半就开新对话 / 翻出旧对话时加一: 那次回答后面的事件不再往界面上写(见 detachAnswer)
  const sessionRef = useRef(0);

  const refreshStatus = useCallback(() => {
    getTutorStatus().then(setStatus).catch((e) => setStatusError(getErrorMessage(e, '学习助手打不开')));
  }, []);
  useEffect(() => { refreshStatus(); }, [refreshStatus]);

  // 首页「考考你」: 等状态到了再发(send 要看 status.enabled);state 用完马上清掉,刷新不会再发一遍
  const [pendingReview, setPendingReview] = useState<{ id: number; topic: string } | null>(null);
  useEffect(() => {
    const rv = (location.state as { review?: { id: number; topic: string } } | null)?.review;
    if (rv) {
      setPendingReview(rv);
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.state, location.pathname, navigate]);

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

  // 免费追问有时间限制: 不在出字的时候也半分钟看一下,过了时间提示语自己消失(后端照样按时间判)
  useEffect(() => {
    if (!followup || sending) return;
    const t = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(t);
  }, [followup, sending]);

  // 输入框跟着字数长高(最多 4 行左右)
  useEffect(() => {
    const el = textRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [input]);

  const followLeft = followup && new Date(followup.until + 'Z').getTime() > now ? followup.left : 0;
  const deepCost = status?.deep_cost ?? 2;
  const deepUsable = !!status?.deep_enabled && (status?.left ?? 0) >= deepCost;
  const effMode: TutorMode = mode === 'deep' && deepUsable ? 'deep' : 'fast';
  // 下一问是不是免费追问(快速回答、没有新照片)
  const freeNext = followLeft > 0 && effMode === 'fast' && !image && !doc;

  const pickMode = (m: TutorMode) => {
    setMode(m);
    try { localStorage.setItem(modeKey(), m); } catch { /* 隐私模式 */ }
  };

  /** 只有孩子本来就在底部时才跟着滚,往上翻着看的时候不打断。smooth 只给「看新回答」按钮用 */
  const quietScrollUntil = useRef(0);
  const scrollToEnd = useCallback((force = false, smooth = false) => {
    requestAnimationFrame(() => {
      const el = listRef.current;
      if (!el) return;
      if (force || nearBottom.current) {
        nearBottom.current = true;
        setAwayFromEnd(false);
        // 平滑滚动途中的 scroll 事件位置还没到底,别拿它判「孩子往上翻了」
        if (smooth) quietScrollUntil.current = Date.now() + 700;
        el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
      }
    });
  }, []);

  // 跟着内容长高滚: 字是一段段来的,练习卡、记忆图、照片的高度要等它们画出来才知道,
  // 只在收到字的那一下滚会停在卡片半截。看内容区高度变了就跟(孩子在底部时)
  const contentRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = contentRef.current;
    const el = listRef.current;
    if (!box || !el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      if (nearBottom.current) el.scrollTop = el.scrollHeight;
    });
    ro.observe(box);
    return () => ro.disconnect();
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

  const send = async (opts?: { text?: string; image?: Img | null; file?: File | null; mode?: TutorMode; replace?: string[]; quizId?: number; care?: boolean; reviewNoteId?: number }) => {
    // 没传 opts = 从输入框发的;传了 = 点建议 / 再问一次(不动输入框里正在写的字)
    const fromInput = !opts;
    const text = (fromInput ? input : opts.text ?? '').trim();
    const img = fromInput ? image : opts.image ?? null;
    const fileToSend = fromInput ? doc : opts.file ?? null;
    const useMode = opts?.mode ?? effMode;
    // sending 是 state,同一帧里连按两下回车 / 发送键时它还没变,靠 ref 挡第二下
    if (sending || sendingRef.current || (!text && !img && !fileToSend) || !status?.enabled) return;
    sendingRef.current = true;
    const userMsg: ChatMsg = {
      key: nextKey(), role: 'user', text, mode: useMode, hasImage: !!img, imageUrl: img?.url ?? null,
      file: fileToSend ? { name: fileToSend.name, kind: fileKindOf(fileToSend.name), size: fileToSend.size } : null,
      cards: [], fresh: true,
    };
    const botKey = nextKey();
    setMessages((m) => [
      ...m.filter((x) => !opts?.replace?.includes(x.key)),
      userMsg,
      { key: botKey, role: 'assistant', text: '', mode: useMode, cards: [], fresh: true },
    ]);
    if (fromInput) {
      setInput('');
      setImage(null);
      setDoc(null);
    }
    setSending(true);
    setStopping(false);
    setFollowup(null);
    setToolStatus('');
    setThinkStart(null);
    setSendStart(Date.now());
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
    const session = sessionRef.current;
    const live = () => sessionRef.current === session;
    try {
      await askTutor({ text, conversationId: convId, image: img?.blob, file: fileToSend, mode: useMode, quizId: opts?.quizId, care: opts?.care, reviewNoteId: opts?.reviewNoteId }, (ev) => {
        if (!live()) {
          // 已经开了新对话: 这次回答不要了,拿到提问 id 就让服务端停下(一个字没出的退回次数)
          if (ev.type === 'meta') stopTutor(ev.user_message_id).catch(() => ctrl.abort());
          // 旧回答结束了(可能退回了次数): 重新取一下剩余次数
          if (ev.type === 'done' || ev.type === 'error') refreshStatus();
          return;
        }
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
          setFollowup(ev.followup ?? null);
          setNow(Date.now());
          if (ev.stopped) patchBot((m) => ({ ...m, stopped: true }));
          if (ev.refunded) setStatus((s) => (s ? { ...s, left: s.left + cost, used: Math.max(0, s.used - cost) } : s));
          if (opts?.reviewNoteId) refreshStatus();
        } else if (ev.type === 'error') {
          patchBot((m) => ({
            ...m, failed: !m.text, text: m.text || ev.message,
            retry: !m.text ? { text, image: img, file: fileToSend, mode: useMode, userKey: userMsg.key, quizId: opts?.quizId, care: opts?.care, reviewNoteId: opts?.reviewNoteId } : undefined,
          }));
          if (ev.refunded) setStatus((s) => (s ? { ...s, left: s.left + cost, used: Math.max(0, s.used - cost) } : s));
        }
      }, ctrl.signal);
    } catch (e) {
      // 已经换到别的对话: 旧提问出错不提示、也不把字塞回新对话的输入框
      if (!live()) return;
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
        if (fileToSend) setDoc(fileToSend);
      }
      toast.error(msg);
      if (e instanceof TutorAskError && e.status === 429) refreshStatus();
    } finally {
      // 换过对话的话这些已经在 detachAnswer 里清了,而且新对话可能正在发,别把它的状态清掉
      if (live()) {
        setSending(false);
        setStopping(false);
        setToolStatus('');
        setThinkStart(null);
        setSendStart(null);
        abortRef.current = null;
        sendingRef.current = false;
      }
    }
  };

  /** 孩子交了聊天里的练习: 服务器已经判完分,接着请小鹰老师点评。
   * 点评不扣次数(或还在免费追问时间里)才自动发;要扣次数的不替孩子花,他想听再自己问 */
  const onQuizSubmitted = (r: QuizSubmitted) => {
    if (!r.feedback) return;
    if (!r.free && followLeft <= 0) {
      toast.success(`对了 ${r.score} / ${r.total}。想听小鹰老师讲讲,就在下面问一句`);
      return;
    }
    if (sendingRef.current) {
      // 小鹰老师还在说上一段: 排着,说完自动讲(换了对话就不讲了,见下面的 effect)
      setPendingFeedback({ r, conv: convId });
      return;
    }
    void send({ text: `我做完了,对了 ${r.score}/${r.total}`, image: null, mode: 'fast', quizId: r.quizId });
  };
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    if (!pendingReview || !status?.enabled || sending) return;
    const rv = pendingReview;
    setPendingReview(null);
    void sendRef.current({ text: `考考我: ${rv.topic}`, image: null, mode: 'fast', reviewNoteId: rv.id });
  }, [pendingReview, status, sending]);
  useEffect(() => {
    if (sending || !pendingFeedback) return;
    const { r, conv } = pendingFeedback;
    setPendingFeedback(null);
    if (conv !== convId) return;
    void sendRef.current({ text: `我做完了,对了 ${r.score}/${r.total}`, image: null, mode: 'fast', quizId: r.quizId });
  }, [sending, pendingFeedback, convId]);

  /** 选了文件: 图片走照片(压缩),PDF / Word / txt 走文件;两样一次只能发一样 */
  const onPickDoc = (file: File | undefined) => {
    if (!file) return;
    if (file.type.startsWith('image/')) { void onPickImage(file); return; }
    const kind = fileKindOf(file.name);
    if (!kind) {
      toast.error('只能发 PDF、Word(.docx)或 txt 文件');
      return;
    }
    if (kind === 'doc') {
      toast.error(DOC_HINT);
      return;
    }
    if (file.size > TUTOR_FILE_MAX_MB * 1024 * 1024) {
      toast.error(`文件太大了(最大 ${TUTOR_FILE_MAX_MB}MB),拆开发或者只发要问的那几页`);
      return;
    }
    setImage(null);
    setDoc(file);
    textRef.current?.focus();
  };

  const onPickImage = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      onPickDoc(file);
      return;
    }
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
  const docRef = useRef<HTMLInputElement>(null);

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

  const openHistory = () => { setLevelOpen(false); setHistoryOpen(true); };
  // 欢迎卡「按你的年级讲」: 打开抽屉并直接展开讲解方式(services/tutor_level)
  const openLevel = () => { setLevelOpen(true); setHistoryOpen(true); };
  const closeHistory = useCallback(() => setHistoryOpen(false), []);

  /** 回答还在写就要换对话: 让这次回答停下,界面上的「正在回答」状态全部清掉。
   * 以前这两个按钮在回答时是灰的、点了没反应(用户 10-27「右上角的加号点击没有反应」) */
  const detachAnswer = () => {
    if (!sendingRef.current) return;
    const id = userMsgIdRef.current;
    const old = abortRef.current;
    // 还没拿到提问 id 的: send() 里收到 meta 时再发停止
    if (id) stopTutor(id).catch(() => old?.abort());
    sessionRef.current += 1;
    sendingRef.current = false;
    abortRef.current = null;
    userMsgIdRef.current = null;
    stopWantedRef.current = false;
    frozenRef.current = false;
    setSending(false);
    setStopping(false);
    setToolStatus('');
    setThinkStart(null);
    setSendStart(null);
  };

  const loadConversation = async (id: number) => {
    try {
      const c = await getConversation(id);
      detachAnswer();
      setConvId(c.id);
      setFollowup(c.followup);
      setNow(Date.now());
      setMessages(c.messages.map((m) => ({
        key: `s${m.id}`, role: m.role, mode: m.mode, text: m.failed ? '这次没有回答上来' : m.text,
        hasImage: m.has_image, cards: m.role === 'user' ? [] : (m.cards || []), failed: m.failed, stopped: m.stopped,
        file: (() => {
          const f = (m.cards || []).find((c) => c.type === 'file');
          return f && f.type === 'file' ? { name: f.name, kind: f.kind, pages: f.pages } : null;
        })(),
      })));
      setHistoryOpen(false);
      scrollToEnd(true);
    } catch (e) {
      toast.error(getErrorMessage(e, '加载失败'));
    }
  };

  const resetToEmpty = () => {
    detachAnswer();
    setConvId(null);
    setMessages([]);
    setFollowup(null);
    setAwayFromEnd(false);
    nearBottom.current = true;
  };

  const newConversation = () => {
    setHistoryOpen(false);
    if (!sendingRef.current && messages.length === 0 && convId === null) {
      // 本来就是一段空的新对话: 点了也要有反应,不然孩子以为按钮坏了
      toast.info('现在就是新对话,直接问吧');
      textRef.current?.focus();
      return;
    }
    detachAnswer();
    setConvId(null);
    setMessages([]);
    setFollowup(null);
    setAwayFromEnd(false);
    nearBottom.current = true;
    textRef.current?.focus();
  };

  // 次数用完了,但这道题还能免费追问: 输入框照常能用(只是不能换照片 / 深度思考)
  const outOfQuota = !!status?.enabled && status.left <= 0 && followLeft <= 0;
  const onlyFollowup = !!status?.enabled && status.left <= 0 && followLeft > 0;
  const disabled = !status?.enabled || outOfQuota;
  const lastBot = messages.length > 0 ? messages[messages.length - 1] : null;
  const showQuick = !sending && !disabled && followLeft > 0 && !!lastBot && lastBot.role === 'assistant'
    && !lastBot.failed && !!lastBot.text;
  const thinkSecs = thinkStart ? Math.max(1, Math.round((now - thinkStart) / 1000)) : 0;
  const waitSecs = sendStart ? Math.max(0, Math.round((now - sendStart) / 1000)) : 0;
  const liveKey = sending && lastBot?.role === 'assistant' ? lastBot.key : null;

  /** 还没出字(或出到一半去查东西)时显示什么 */
  const waitView = (m: ChatMsg): { kind: WaitKind; label: string } => {
    if (stopping) return { kind: 'stopping', label: '正在停下…' };
    if (toolStatus) return { kind: m.mode === 'deep' ? 'deep' : 'tool', label: toolStatus };
    if (m.mode === 'deep') return { kind: 'deep', label: '在深度思考' };
    return { kind: 'think', label: '小鹰老师在想' };
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
            <button type="button" onClick={newConversation} className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-soft hover:bg-black/5 disabled:opacity-40" aria-label="新对话" title="新对话">
              <Plus className="h-5 w-5" aria-hidden="true" />
            </button>
            <button type="button" onClick={openHistory} className="flex h-11 w-11 items-center justify-center rounded-xl text-ink-soft hover:bg-black/5" aria-label="以前的对话" title="以前的对话">
              <History className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </nav>

      <div className="relative min-h-0 flex-1">
      <div
        ref={listRef}
        className="h-full overflow-y-auto overscroll-contain"
        onScroll={(e) => {
          if (Date.now() < quietScrollUntil.current) return;
          const el = e.currentTarget;
          const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          nearBottom.current = near;
          setAwayFromEnd((v) => (v === !near ? v : !near));
        }}
      >
        <div ref={contentRef} className="mx-auto max-w-3xl space-y-4 px-3 py-4 sm:px-5">
          {statusError && <p className="rounded-xl bg-rose-50 p-4 text-sm text-rose-700">{statusError}</p>}
          {status && !status.enabled && (
            <div className="rounded-2xl bg-white p-6 text-center shadow-sm">
              <p className="text-base font-semibold text-ink">学习助手暂时用不了</p>
              <p className="mt-1 text-sm text-ink-soft">{status.reason}</p>
            </div>
          )}

          {status?.enabled && messages.length === 0 && (
            <div className="tutor-in rounded-3xl bg-white p-5 shadow-sm ring-1 ring-black/[0.04]">
              <div className="flex items-center gap-3">
                <TutorAvatar size="lg" />
                <div>
                  <p className="text-base font-semibold text-ink">你好,我是小鹰老师</p>
                  <p className="text-xs text-ink-mute">英语学习上的事都可以问我</p>
                </div>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                单词怎么记、哪里拼错了、语法不懂、题目没思路,都可以问我。也可以点左下角的相机拍一道题,或者点回形针发一份 PDF / Word 文件{status?.voice_enabled ? ',懒得打字就点麦克风说一句' : ''}。
                作业和考试题我先给提示,你自己再想想;试过两次还不会,我就把答案和理由讲给你听,再出一道类似的让你练。回答里的英文点一下就能听发音。
              </p>
              <p className="mt-2 text-xs text-ink-mute">
                你一共可以问 {status.total} 次,现在还剩 {status.left} 次;同一道题接着追问,{status.followup_minutes} 分钟内最多 {status.followup_free} 次不另算。
                {status.deep_enabled && ` 难的题可以选「深度思考」,想得更透,一次算 ${deepCost} 次。`}
              </p>
              <button
                type="button"
                onClick={openLevel}
                className="mt-2 inline-flex min-h-10 items-center text-left text-sm font-medium text-sky-700 underline-offset-2 hover:underline"
              >
                我会按你的年级讲,觉得太难或太简单都能改 →
              </button>
              {status.review && (
                <button
                  type="button"
                  disabled={disabled || sending}
                  onClick={() => send({ text: `考考我: ${status.review!.topic}`, image: null, mode: 'fast', reviewNoteId: status.review!.note_id })}
                  className="mt-4 flex min-h-12 w-full items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-left text-sm text-sky-900 hover:bg-sky-100 disabled:opacity-50"
                >
                  <span className="min-w-0 flex-1">
                    {status.review.since}讲过的「{status.review.topic}」,10 秒考考你
                    <span className="block text-xs text-sky-700/80">这一次不算次数</span>
                  </span>
                  <Zap className="h-4 w-4 shrink-0" aria-hidden="true" />
                </button>
              )}
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {[...SUGGESTIONS, status.picture_enabled ? SUGGESTION_PICTURE : SUGGESTION_GRAMMAR].map((s) => (
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

          {messages.map((m) => {
            if (m.role === 'user') {
              const onlyImage = !!m.imageUrl && !m.text && !m.file;
              return (
                <div key={m.key} className={`flex justify-end ${m.fresh ? 'tutor-in tutor-in-right' : ''}`}>
                  {/* 气泡跟着字数走: 一两个字就是小气泡,长了最多占到 80%(电脑上 70%) */}
                  {/* 只发照片: 不套橙色气泡,直接一张圆角图(套了像个粗边相框) */}
                  <div className={`w-fit max-w-[80%] sm:max-w-[70%] ${onlyImage ? '' : 'rounded-2xl rounded-tr-md bg-accent-warm px-4 py-2.5 text-white shadow-sm'}`}>
                    {m.imageUrl && (
                      <img
                        src={m.imageUrl}
                        alt="我发的题目照片"
                        className={`max-h-48 rounded-2xl object-contain sm:max-h-56 ${m.text ? 'mb-2 rounded-xl' : 'shadow-sm ring-1 ring-black/10'}`}
                      />
                    )}
                    {m.hasImage && !m.imageUrl && <p className="mb-1 text-xs text-white/85">[发了一张题目照片]</p>}
                    {m.file && (
                      <div className={m.text ? 'mb-2' : ''}>
                        <FileChip name={m.file.name} kind={m.file.kind} pages={m.file.pages} size={m.file.size} tone="onWarm" />
                      </div>
                    )}
                    {m.text && <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{m.text}</p>}
                  </div>
                </div>
              );
            }
            const live = m.key === liveKey;
            const wide = m.cards.some((c) => c.type === 'practice' || c.type === 'quiz'); // 练习卡要地方放输入框,撑满
            const waiting = !m.text && !m.stopped && !m.failed;
            const w = waitView(m);
            return (
              <div key={m.key} className={`flex items-start gap-2 ${m.fresh ? 'tutor-in' : ''}`}>
                <TutorAvatar busy={live && waiting} deep={m.mode === 'deep'} />
                <div className={`min-w-0 ${wide ? 'w-full max-w-xl flex-1' : 'max-w-[min(100%,36rem)]'}`}>
                  <div className={`rounded-2xl rounded-tl-md px-4 py-3 shadow-sm ring-1 ${wide ? 'w-full' : 'w-fit max-w-full'} ${
                    m.failed ? 'bg-rose-50 text-rose-700 ring-rose-100' : 'bg-white text-ink ring-black/[0.04]'
                  }`}>
                    {m.mode === 'deep' && !m.failed && !waiting && (
                      <p className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                        <Brain className="h-3 w-3" aria-hidden="true" /> 深度思考
                      </p>
                    )}
                    {m.text ? (
                      <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
                        {m.failed ? m.text : <SpeakableText text={clean(m.text)} onSpeak={(s) => { void playAudio(s); }} hint={m.key === lastBot?.key && !live} />}
                        {live && !toolStatus && !stopping && <span className="tutor-caret" aria-hidden="true" />}
                      </p>
                    ) : m.stopped ? (
                      <p className="text-sm text-ink-mute">停下了,这次不算次数</p>
                    ) : live ? (
                      <TutorWaiting kind={w.kind} label={w.label} secs={thinkSecs} waited={waitSecs} />
                    ) : null}
                    {/* 说了半句又去查东西(比如「好,来给你画一张」→ 在准备画图): 字下面挂一小行 */}
                    {live && m.text && (toolStatus || stopping) && <TutorWaiting kind={w.kind} label={w.label} compact />}
                    {m.cards.map((c, i) => (
                      c.type === 'practice' ? (
                        <PracticeCard key={`q${c.quiz_id ?? i}`} mode={c.mode} items={c.items} quizId={c.quiz_id}
                          result={c.result} onSubmitted={onQuizSubmitted} />
                      ) : c.type === 'quiz' ? (
                        <QuizCard key={`q${c.quiz_id}`} quizId={c.quiz_id} topic={c.topic} items={c.items}
                          result={c.result} onSubmitted={onQuizSubmitted} />
                      ) : c.type === 'picture' ? (
                        <PictureCard key={`p${c.pic_id}`} picId={c.pic_id} word={c.word} wordId={c.word_id} status={c.status} url={c.url} />
                      ) : c.type === 'link' ? (
                        <button
                          key={i}
                          type="button"
                          onClick={() => navigate(c.route)}
                          className="mt-3 flex min-h-11 items-center rounded-xl bg-orange-500 px-4 text-sm font-semibold text-white hover:bg-orange-600"
                        >
                          {c.label}
                        </button>
                      ) : null
                    ))}
                    {m.stopped && m.text && <p className="mt-1.5 text-xs text-ink-mute">(停下了)</p>}
                    {/* 最新一条回答里英文有两段以上: 一键连着听(同一个 Edge TTS 声音) */}
                    {!live && !m.failed && m.key === lastBot?.key && englishToRead(clean(m.text)).length >= 2 && (
                      <button type="button" onClick={() => { void playAudio(englishToRead(clean(m.text)).join('. ')); }}
                        className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs font-medium text-sky-700 hover:bg-sky-50"
                        aria-label="把这条回答里的英文连着读一遍">
                        <Volume2 className="h-4 w-4" aria-hidden="true" /> 听全部英文
                      </button>
                    )}
                    {m.failed && m.retry && !sending && !disabled && (
                      <button
                        type="button"
                        onClick={() => {
                          const r = m.retry!;
                          void send({ text: r.text, image: r.image, file: r.file, mode: r.mode, replace: [m.key, r.userKey], quizId: r.quizId, care: r.care, reviewNoteId: r.reviewNoteId });
                        }}
                        className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-white px-3 text-sm font-medium text-rose-700 ring-1 ring-rose-200 hover:bg-rose-100"
                      >
                        <RotateCcw className="h-4 w-4" aria-hidden="true" /> 再问一次
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
          {showQuick && (
            <div className="tutor-in flex flex-wrap gap-2 pl-11" aria-label="快捷回复">
              {QUICK_REPLIES.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => send({ text: q, image: null, mode: 'fast' })}
                  className="min-h-10 rounded-full border border-orange-200 bg-white px-3.5 text-sm text-orange-800 hover:bg-orange-50"
                >
                  {q}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      {awayFromEnd && messages.length > 0 && (
        <button
          type="button"
          onClick={() => scrollToEnd(true, true)}
          className="tutor-in absolute bottom-3 left-1/2 flex min-h-10 -translate-x-1/2 items-center gap-1.5 rounded-full bg-white px-4 text-sm font-medium text-orange-700 shadow-md ring-1 ring-orange-100 hover:bg-orange-50"
        >
          <ArrowDown className="h-4 w-4" aria-hidden="true" /> {sending ? '看新回答' : '回到最新'}
        </button>
      )}
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
              {!careOpen ? (
                <button type="button" onClick={() => setCareOpen(true)}
                  className="mt-2 block w-full text-xs text-orange-800/80 underline-offset-2 hover:underline">
                  心里不开心、被人欺负了?想说说心里话,不用次数
                </button>
              ) : (
                <div className="mt-3 flex items-end gap-2 text-left">
                  <textarea value={careText} onChange={(e) => setCareText(e.target.value.slice(0, 300))} rows={2} autoFocus
                    placeholder="想说什么就写下来,小鹰老师在听" aria-label="想说的话"
                    className="min-h-11 flex-1 resize-none rounded-xl border border-orange-200 bg-white px-3 py-2 text-sm outline-none focus:border-orange-400" />
                  <button type="button" disabled={!careText.trim() || sending}
                    onClick={() => { const t = careText; setCareText(''); void send({ text: t, mode: 'fast', care: true }); }}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-orange-500 text-white disabled:bg-slate-300"
                    aria-label="发送">
                    <Send className="h-5 w-5" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>
          ) : (
            <>
              {image && (
                <div className="tutor-in mb-2 flex items-end gap-2">
                  <span className="relative">
                    <img src={image.url} alt="要发的题目照片" className="h-20 rounded-xl border border-black/10 object-cover shadow-sm" />
                    <button
                      type="button"
                      onClick={() => setImage(null)}
                      className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-slate-700 text-white shadow ring-2 ring-white hover:bg-slate-800"
                      aria-label="不发这张照片"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </span>
                  <span className="pb-1 text-xs text-ink-mute">写一句想问什么,或者直接发</span>
                </div>
              )}
              {doc && (
                <div className="tutor-in mb-2 flex items-end gap-2">
                  <FileChip name={doc.name} kind={fileKindOf(doc.name)} size={doc.size} onRemove={() => setDoc(null)} />
                  <span className="pb-1 text-xs text-ink-mute">写一句想问哪里,或者直接发</span>
                </div>
              )}
              {freeNext && (
                <p className="mb-1.5 text-xs text-emerald-700">
                  接着问这道题不算次数(还能免费问 {followLeft} 次){onlyFollowup ? ',次数用完了也能问' : ''}
                </p>
              )}
              {status?.enabled && status.deep_enabled && !onlyFollowup && (
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
                        : freeNext ? '几秒就回答' : '几秒就回答,一次算 1 次'}
                  </span>
                </div>
              )}
              {/* 输入条: 相机 / 文字 / 发送 放在同一个圆角框里,点到框里哪都能打字 */}
              <div
                className={`flex items-end gap-1 rounded-3xl border bg-paper p-1 transition focus-within:bg-white focus-within:ring-2 ${
                  effMode === 'deep' ? 'border-sky-200 focus-within:border-sky-300 focus-within:ring-sky-100' : 'border-black/10 focus-within:border-orange-300 focus-within:ring-orange-100'
                } ${disabled ? 'opacity-60' : ''}`}
              >
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
                  disabled={disabled || sending || onlyFollowup}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-orange-600 hover:bg-orange-100 disabled:opacity-40"
                  aria-label="拍一道题"
                  title="拍一道题"
                >
                  <Camera className="h-5 w-5" aria-hidden="true" />
                </button>
                <input
                  ref={docRef}
                  type="file"
                  accept={TUTOR_FILE_ACCEPT}
                  className="hidden"
                  onChange={(e) => { onPickDoc(e.target.files?.[0]); e.target.value = ''; }}
                />
                <button
                  type="button"
                  onClick={() => docRef.current?.click()}
                  disabled={disabled || sending || onlyFollowup}
                  className="-ml-1 flex h-11 w-9 shrink-0 items-center justify-center rounded-full text-orange-600 hover:bg-orange-100 disabled:opacity-40"
                  aria-label="发一份文件(PDF、Word、txt)"
                  title="发一份文件(PDF、Word、txt)"
                >
                  <Paperclip className="h-5 w-5" aria-hidden="true" />
                </button>
                {status?.voice_enabled && (
                  <VoiceInputButton
                    disabled={disabled || sending}
                    beforeRecord={stopAudio}
                    onText={(t) => {
                      setInput((v) => (v.trim() ? `${v.trim()} ${t}` : t).slice(0, status?.max_text ?? 500));
                      textRef.current?.focus();
                    }}
                  />
                )}
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
                  className="tutor-composer-input max-h-32 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-1 py-2.5 text-base leading-6 text-ink placeholder:text-ink-mute focus:outline-none"
                />
                {sending ? (
                  <button
                    type="button"
                    onClick={onStop}
                    disabled={stopping}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-slate-700 text-white hover:bg-slate-800 disabled:opacity-60"
                    aria-label="停下"
                    title="停下(还没出字就停,不算次数)"
                  >
                    {stopping ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Square className="h-4 w-4 fill-current" aria-hidden="true" />}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => { void send(); }}
                    disabled={disabled || (!input.trim() && !image && !doc)}
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white transition active:scale-95 disabled:bg-slate-300 ${effMode === 'deep' ? 'bg-sky-600 hover:bg-sky-700' : 'bg-orange-500 hover:bg-orange-600'}`}
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

      <TutorHistoryDrawer
        open={historyOpen}
        currentId={convId}
        onClose={closeHistory}
        onPick={(id) => { void loadConversation(id); }}
        onNew={newConversation}
        onDeletedCurrent={resetToEmpty}
        levelOpen={levelOpen}
      />
    </div>
  );
}
