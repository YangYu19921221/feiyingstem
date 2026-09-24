/**
 * 「看不懂就问」—— 挂在音标视频下面的提问区。
 *
 * **刻意不做开放式论坛**(理由见后端 models/phonetic.PhoneticVideoQuestion):
 * 几十个学生的板子两周就会死掉,而未成年人 UGC 的审核是持续的人力成本。
 * 这里是**按视频提问**: 绑着课的上下文、自动带上播放位置,
 * 默认只有提问者和老师看得见,老师可一键公开成那节课的常见问答。
 *
 * 它能长成讨论区(把可见范围放开就是),反过来论坛缩不回这个形态。
 */
import { useEffect, useState } from 'react';
import { MessageCircleQuestion, Send, Lock, Globe2 } from 'lucide-react';
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

  const submit = async () => {
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setErr('');
    try {
      // 位置在**提交这一刻**读,不是打字开始那一刻 —— 孩子边看边打,
      // 打完往往已经过去十几秒,而他问的是眼前这个音
      const pos = getPosition?.();
      const created = await phoneticsApi.askQuestion(videoId, content, pos || undefined);
      setRows((prev) => [created, ...prev]);
      setText('');
      setDone(true);
    } catch (e) {
      const msg = (e as { message?: string })?.message;
      setErr(msg || '没提交成功,过一会儿再试');
    } finally {
      setSending(false);
    }
  };

  const left = MAX_QUESTION_LEN - text.length;

  return (
    <div className="border-t border-white/10 px-4 py-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs text-slate-400">
        <MessageCircleQuestion className="h-3.5 w-3.5 text-orange-300" />
        听不懂就问老师 · 只有你和老师看得到
      </p>

      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_QUESTION_LEN))}
          // 回车换行、Ctrl/Cmd+回车提交:孩子写两三行是常事,
          // 拿单独的回车当提交会让人问到一半就发出去
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder="哪个音没听懂?比如「第二个词的 /æ/ 舌头放哪」"
          aria-label="向老师提问"
          className="min-w-0 flex-1 resize-none rounded-xl bg-white/10 px-3 py-2 text-sm text-white
                     placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-orange-400/60"
        />
        <button
          onClick={submit}
          disabled={!text.trim() || sending}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-orange-500 px-3 py-2 text-sm
                     font-semibold text-white transition hover:bg-orange-400
                     disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Send className="h-4 w-4" />
          {sending ? '发送中' : '问老师'}
        </button>
      </div>

      <div className="mt-1 flex items-center gap-3 text-[11px]">
        {/* 剩余字数只在快满时才出现,平时是噪音 */}
        {left <= 60 && <span className="text-slate-500">还能写 {left} 字</span>}
        {err && <span className="text-red-300">{err}</span>}
        {done && !err && (
          <span className="text-emerald-300">已发给老师,回答后这里会显示</span>
        )}
      </div>

      {rows.length > 0 && (
        <ul className="mt-3 space-y-2">
          {rows.map((q) => (
            <li key={q.id} className="rounded-xl bg-white/[0.06] px-3 py-2">
              <div className="flex items-center gap-2 text-[11px] text-slate-400">
                {/* 自己那条写「我」,公开的写提问者姓名 —— 别人的私有提问
                    根本不会出现在这个列表里,所以不存在"猜是谁"的情况 */}
                <span className="font-medium text-slate-300">
                  {q.is_mine ? '我' : q.asker_name || '同学'}
                </span>
                {q.position_seconds != null && (
                  <span className="rounded bg-white/10 px-1.5 py-0.5 text-orange-200">
                    {fmtPos(q.position_seconds)} 处
                  </span>
                )}
                {q.is_public ? (
                  <span className="flex items-center gap-1 text-sky-300">
                    <Globe2 className="h-3 w-3" />大家都能看
                  </span>
                ) : q.is_mine ? (
                  <span className="flex items-center gap-1">
                    <Lock className="h-3 w-3" />只有老师能看
                  </span>
                ) : null}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-white">{q.content}</p>
              {q.answer ? (
                <div className="mt-2 rounded-lg border-l-2 border-emerald-400/70 bg-emerald-500/10 px-2.5 py-1.5">
                  <p className="text-[11px] text-emerald-300">
                    {q.answered_by_name || '老师'} 回答
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-emerald-50">
                    {q.answer}
                  </p>
                </div>
              ) : (
                // 「等老师回答」必须写出来:不写的话孩子看到自己的问题静静躺着,
                // 会以为没发出去,于是再问一遍
                <p className="mt-1 text-[11px] text-slate-500">等老师回答</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
