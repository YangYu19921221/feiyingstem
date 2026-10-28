/**
 * 「看不懂就问」—— 挂在音标视频下面的提问区。
 *
 * **刻意不做开放式论坛**(理由见后端 models/phonetic.PhoneticVideoQuestion):
 * 几十个学生的板子两周就会死掉,而未成年人 UGC 的审核是持续的人力成本。
 * 这里是**按视频提问**: 绑着课的上下文、自动带上播放位置,
 * 默认只有提问者和老师看得见,老师可一键公开成那节课的常见问答。
 *
 * 它能长成讨论区(把可见范围放开就是),反过来论坛缩不回这个形态。
 *
 * 10-28 看不清的根因: 学生端全站给 textarea 铺了白底(index.css `body.student-interface textarea`,
 * 优先级比 bg-white/10 高),而这里写的是白字 —— 白底白字。现在顺着全站口径用白底深字,
 * 字号 16px(iOS Safari 遇到小于 16px 的输入框,一聚焦就把整页放大)。
 * 深色播放器面板上的说明、时间、老师回答都提到 13–16px、对比度 ≥ 4.5:1。
 *
 * 「打音标」: 孩子要问的恰恰是 /æ/,而手机 / 电脑键盘打不出来。输入框下面一个按钮展开音标键
 * (IpaInsertPad,和写音标同一套键),点了插到光标处,连点拼成 /bæd/。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Clock3, Globe2, Lock, MapPin, MessageCircleQuestion, MessageSquareReply, Send } from 'lucide-react';
import {
  phoneticsApi, MAX_QUESTION_LEN, type VideoQuestion,
} from '../../api/phonetics';
import { insertIpaAt, backspaceIpaAt } from '../../utils/ipaPhonemes';
import IpaInsertPad from './IpaInsertPad';

interface Props {
  videoId: number;
  /** 读「现在播到第几秒」。由 LessonStage 交上来,只在提交那一刻调 */
  getPosition?: () => number;
}

/** 秒 → 3:20。位置是这个功能比论坛好用的关键,要显示成能对照的时间 */
function fmtPos(sec?: number | null): string {
  if (sec == null) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export default function VideoQuestionPanel({ videoId, getPosition }: Props) {
  const [rows, setRows] = useState<VideoQuestion[]>([]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pos, setPos] = useState(0);
  const [padOpen, setPadOpen] = useState(false);
  const getPosRef = useRef(getPosition);
  getPosRef.current = getPosition;
  const taRef = useRef<HTMLTextAreaElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  // 光标位置: 点音标键时文字框常常没有焦点(手机上故意不聚焦,免得系统键盘弹回来),
  // 所以每次打字 / 点选都记下来,插音标插在这里
  const caretRef = useRef(0);
  // 上一次插完音标时光标停在哪: 光标还在这儿 = 接着拼进同一对斜杠
  const joinAtRef = useRef(-1);
  const pendingCaret = useRef<number | null>(null);
  const padId = `vq-ipa-${videoId}`;

  const reload = () => {
    phoneticsApi.listQuestions(videoId)
      .then(setRows)
      .catch(() => { /* 列表拉不到不打断看视频,静默 */ });
  };

  useEffect(() => {
    setRows([]);
    setText('');
    setDone(false);
    setErr('');
    setPadOpen(false);
    caretRef.current = 0;
    joinAtRef.current = -1;
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  // 正在写问题时,每秒看一眼播到哪了,写在输入框下面「问的是 3:20 这里」——
  // 孩子知道老师会看到是哪一段,就不用在问题里再描述「刚才那个」。只在写的时候看,平时不跑
  const composing = focused || padOpen || text.trim().length > 0;
  useEffect(() => {
    if (!composing) return;
    const tick = () => setPos(Math.floor(getPosRef.current?.() ?? 0));
    tick();
    const t = window.setInterval(tick, 1000);
    return () => window.clearInterval(t);
  }, [composing]);

  const submit = async () => {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setErr('');
    try {
      // 位置在**提交这一刻**读,不是打字开始那一刻 —— 孩子边看边打,
      // 打完往往已经过去十几秒,而他问的是眼前这个音
      const p = getPosition?.();
      const created = await phoneticsApi.askQuestion(videoId, content, p || undefined);
      setRows((prev) => [created, ...prev]);
      setText('');
      setPadOpen(false);
      caretRef.current = 0;
      joinAtRef.current = -1;
      setDone(true);
    } catch (e) {
      const msg = (e as { message?: string })?.message;
      setErr(msg || '没发出去,检查一下网络再点一次');
    } finally {
      setSending(false);
    }
  };

  const left = MAX_QUESTION_LEN - text.length;

  // 程序改了文字之后把光标放回去(只在文字框有焦点时,也就是电脑上)
  useLayoutEffect(() => {
    const c = pendingCaret.current;
    const ta = taRef.current;
    if (c == null || !ta) return;
    pendingCaret.current = null;
    if (document.activeElement === ta) ta.setSelectionRange(c, c);
  }, [text]);

  const rememberCaret = () => {
    const ta = taRef.current;
    if (ta) caretRef.current = ta.selectionStart ?? ta.value.length;
  };

  const applyEdit = (next: { text: string; caret: number }) => {
    if (next.text.length > MAX_QUESTION_LEN) return;
    caretRef.current = next.caret;
    pendingCaret.current = next.caret;
    setText(next.text);
    setDone(false);
  };

  const insertIpa = (ph: string) => {
    const r = insertIpaAt(text, caretRef.current, joinAtRef.current, ph);
    if (r.text.length > MAX_QUESTION_LEN) return;
    joinAtRef.current = r.caret;
    applyEdit(r);
  };

  const backspaceIpa = () => {
    const r = backspaceIpaAt(text, caretRef.current, joinAtRef.current);
    joinAtRef.current = r.joined ? r.caret : -1;
    applyEdit(r);
  };

  // 展开音标键后把整个输入卡片(含「发给老师」)滚进屏幕: 视频面板比一屏高,
  // 键盘从输入框下面长出来,不滚的话下半截和发送键都在屏幕外,孩子以为键盘显示不全
  useEffect(() => {
    if (!padOpen) return;
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => composerRef.current?.scrollIntoView({
      block: 'nearest', behavior: reduce ? 'auto' : 'smooth',
    }));
  }, [padOpen]);

  const togglePad = () => {
    setPadOpen((o) => {
      // 手机上收起系统键盘,否则它盖住音标键;电脑上焦点留在文字框里
      if (!o && window.matchMedia?.('(pointer: coarse)').matches) taRef.current?.blur();
      return !o;
    });
  };

  return (
    <section className="border-t border-white/10 px-3 pb-5 pt-4 min-[360px]:px-4 sm:px-5" aria-labelledby={`vq-title-${videoId}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id={`vq-title-${videoId}`} className="flex items-center gap-2 text-base font-bold text-white">
          <MessageCircleQuestion className="h-5 w-5 text-orange-300" aria-hidden />
          听不懂就问老师
        </h3>
        <p className="flex items-center gap-1 text-[13px] text-slate-300">
          <Lock className="h-3.5 w-3.5" aria-hidden />只有你和老师看得到
        </p>
      </div>

      <div
        ref={composerRef}
        className="mt-3 scroll-my-3 rounded-2xl bg-white p-2 shadow-[0_2px_10px_rgba(0,0,0,0.25)] transition focus-within:ring-[3px] focus-within:ring-orange-300"
      >
        <textarea
          ref={taRef}
          value={text}
          onChange={(e) => {
            setText(e.target.value.slice(0, MAX_QUESTION_LEN));
            setDone(false);
            caretRef.current = e.target.selectionStart ?? e.target.value.length;
            joinAtRef.current = -1;     // 自己打了字,下一个音标另起一对斜杠
          }}
          onSelect={rememberCaret}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          // 回车换行、Ctrl/Cmd+回车提交:孩子写两三行是常事,
          // 拿单独的回车当提交会让人问到一半就发出去
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          // 音标键展开时输入框收成两行,省出地方让键盘和发送键一起放进一屏
          rows={padOpen ? 2 : 3}
          placeholder="哪里没听懂?比如: /æ/ 的嘴巴要张多大?"
          aria-label="向老师提问"
          aria-describedby={`vq-hint-${videoId}`}
          className="block w-full resize-none !rounded-xl !border-0 !bg-transparent px-2.5 py-2 text-base leading-7
                     text-slate-900 !shadow-none placeholder:text-slate-500 focus:outline-none"
        />
        {padOpen && (
          <IpaInsertPad id={padId} onKey={insertIpa} onBackspace={backspaceIpa} onClose={() => setPadOpen(false)} />
        )}
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-1 pt-2">
          <button
            type="button"
            onClick={togglePad}
            onMouseDown={(e) => e.preventDefault()}
            aria-expanded={padOpen}
            aria-controls={padId}
            className={[
              'flex h-11 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-bold ring-1 transition active:scale-[0.98]',
              padOpen
                ? 'bg-orange-100 text-accent-warm ring-orange-300'
                : 'bg-orange-50 text-accent-warm ring-orange-200 hover:bg-orange-100',
            ].join(' ')}
          >
            <span className="font-mono text-base leading-none">/æ/</span>
            {padOpen ? '收起音标' : '打音标'}
          </button>
          {/* 手机上: 打音标 / 发给老师 一行,位置提示单独一行;电脑上三样一行 */}
          <p id={`vq-hint-${videoId}`} className="order-last flex w-full min-w-0 items-center gap-1.5 text-[13px] text-slate-600
                                                  sm:order-none sm:w-auto sm:flex-1">
            <MapPin className="h-4 w-4 shrink-0 text-accent-warm" aria-hidden />
            {composing && pos > 0
              ? <span>老师会看到你问的是视频 <b className="font-numeric font-bold text-slate-900">{fmtPos(pos)}</b> 这里</span>
              : <span>会自动带上视频播到的位置</span>}
          </p>
          {left <= 60 && <span className="text-[13px] font-numeric text-slate-600">还能写 {left} 字</span>}
          <button
            type="button"
            onClick={submit}
            disabled={!text.trim() || sending}
            className="ml-auto flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-accent-warm px-4 text-base font-bold text-white
                       transition hover:bg-[#a9441c] active:scale-[0.98]
                       disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
          >
            <Send className="h-4 w-4" aria-hidden />
            {sending ? '发送中…' : '发给老师'}
          </button>
        </div>
      </div>

      <div className="mt-2 min-h-[1.25rem] text-sm" aria-live="polite">
        {err && <p className="text-rose-300">{err}</p>}
        {done && !err && <p className="text-emerald-300">已经发给老师了,老师回答后会显示在下面</p>}
      </div>

      {rows.length > 0 && (
        <>
          <h4 className="mt-3 text-sm font-semibold text-slate-200">这节课的问题</h4>
          <ul className="mt-2 space-y-2.5">
            {rows.map((q) => (
              <li key={q.id} className="rounded-2xl bg-white/[0.07] px-3.5 py-3 ring-1 ring-white/10">
                <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-slate-300">
                  {/* 自己那条写「我」,公开的写提问者姓名 —— 别人的私有提问
                      根本不会出现在这个列表里,所以不存在"猜是谁"的情况 */}
                  <span className="font-semibold text-white">
                    {q.is_mine ? '我问的' : q.asker_name || '同学'}
                  </span>
                  {q.position_seconds != null && (
                    <span className="flex items-center gap-1 rounded-md bg-orange-400/15 px-1.5 py-0.5 font-numeric text-orange-200">
                      <MapPin className="h-3 w-3" aria-hidden />视频 {fmtPos(q.position_seconds)}
                    </span>
                  )}
                  {q.is_public ? (
                    <span className="flex items-center gap-1 text-sky-200">
                      <Globe2 className="h-3.5 w-3.5" aria-hidden />大家都能看
                    </span>
                  ) : q.is_mine ? (
                    <span className="flex items-center gap-1">
                      <Lock className="h-3.5 w-3.5" aria-hidden />只有老师能看
                    </span>
                  ) : null}
                </div>
                <p className="mt-1.5 whitespace-pre-wrap break-words text-base leading-7 text-white">{q.content}</p>
                {q.answer ? (
                  <div className="mt-2.5 rounded-xl bg-emerald-400/[0.14] px-3 py-2.5 ring-1 ring-emerald-300/25">
                    <p className="flex items-center gap-1.5 text-[13px] font-semibold text-emerald-200">
                      <MessageSquareReply className="h-4 w-4" aria-hidden />
                      {q.answered_by_name || '老师'}回答
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-base leading-7 text-emerald-50">
                      {q.answer}
                    </p>
                  </div>
                ) : (
                  // 「等老师回答」必须写出来:不写的话孩子看到自己的问题静静躺着,
                  // 会以为没发出去,于是再问一遍
                  <p className="mt-2 flex items-center gap-1.5 text-sm text-amber-200">
                    <Clock3 className="h-4 w-4" aria-hidden />已经发给老师,等老师回答
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
