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
 */
import { useEffect, useRef, useState } from 'react';
import { Clock3, Globe2, Lock, MapPin, MessageCircleQuestion, MessageSquareReply, Send } from 'lucide-react';
import {
  phoneticsApi, MAX_QUESTION_LEN, type VideoQuestion,
} from '../../api/phonetics';

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
  const getPosRef = useRef(getPosition);
  getPosRef.current = getPosition;

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
    reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  // 正在写问题时,每秒看一眼播到哪了,写在输入框下面「问的是 3:20 这里」——
  // 孩子知道老师会看到是哪一段,就不用在问题里再描述「刚才那个」。只在写的时候看,平时不跑
  const composing = focused || text.trim().length > 0;
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
      setDone(true);
    } catch (e) {
      const msg = (e as { message?: string })?.message;
      setErr(msg || '没发出去,检查一下网络再点一次');
    } finally {
      setSending(false);
    }
  };

  const left = MAX_QUESTION_LEN - text.length;

  return (
    <section className="border-t border-white/10 px-4 pb-5 pt-4 sm:px-5" aria-labelledby={`vq-title-${videoId}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id={`vq-title-${videoId}`} className="flex items-center gap-2 text-base font-bold text-white">
          <MessageCircleQuestion className="h-5 w-5 text-orange-300" aria-hidden />
          听不懂就问老师
        </h3>
        <p className="flex items-center gap-1 text-[13px] text-slate-300">
          <Lock className="h-3.5 w-3.5" aria-hidden />只有你和老师看得到
        </p>
      </div>

      <div className="mt-3 rounded-2xl bg-white p-2 shadow-[0_2px_10px_rgba(0,0,0,0.25)] transition focus-within:ring-[3px] focus-within:ring-orange-300">
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value.slice(0, MAX_QUESTION_LEN)); setDone(false); }}
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
          rows={3}
          placeholder="哪里没听懂?比如:/æ/ 的嘴巴要张多大?"
          aria-label="向老师提问"
          aria-describedby={`vq-hint-${videoId}`}
          className="block w-full resize-none !rounded-xl !border-0 !bg-transparent px-2.5 py-2 text-base leading-7
                     text-slate-900 !shadow-none placeholder:text-slate-500 focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-1 pt-2">
          <p id={`vq-hint-${videoId}`} className="flex min-w-0 flex-1 items-center gap-1.5 text-[13px] text-slate-600">
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
            className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl bg-accent-warm px-4 text-base font-bold text-white
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
