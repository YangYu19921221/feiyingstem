/**
 * 音标跟读 — 一页全部音标,读对变绿自动跳下一个
 *
 * 版面照纸质教材:一页 20 个音标并排。孩子照着音标读,读对了那一格变绿、
 * 自动跳到下一个;读错了留在原地,可以听标准音、对比自己的录音、再读。
 *
 * ## 判定为什么可信(而旧的不可信)
 * 判定走 phonetic_reading_judge:**按音标比对**,不按拼写。
 * 旧实现拿 bad 的音频去验 bed 判 66 分通过(拼写只差一个字母),
 * 而 æ/e 正是本教材 1—1 要教的对立 —— 放过等于没教。
 *
 * ## 判不准的时候
 * 一律当「没听清,再读一遍」,不说「你读错了」,也不拦路(可以跳过)。
 * 判错的代价是孩子不敢开口,和漏纠一次不对称。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowLeft, LoaderCircle, Mic, Square, Volume2, RotateCcw, Check, SkipForward,
} from 'lucide-react';
import useGoBack from '../hooks/useGoBack';
import { useSpeechRecorder, getRecorderBlocker } from '../hooks/useSpeechRecorder';
import PhonemeCell from '../components/phonetics/PhonemeCell';
import {
  fetchReadingLesson, judgeReading, markSelfPass, type ReadingLesson, type JudgeResult,
} from '../api/phoneticReading';
import { API_BASE_URL } from '../config/env';
import { rawTtsUrl } from '../hooks/useAudio';

/**
 * 格子状态 = 颜色(2026-10-31,用户「完全不对的差别大的标红 接近标黄 完全正确就绿」)。
 * 颜色来自后端 JudgeResult.grade(真源 services/phoneme_closed_set.grade),过不过关仍看 verdict:
 *   green  过了,没挑出毛病
 *   yellow 过了,但接近: 词尾多带了一个音 / 自己点的「我读对了」(机器没确认)—— 揭示单词、算读过,再读一次能变绿
 *   near   没过,但差一点(黄色,不揭示单词)
 *   red    没过,差得多(红色)
 * 没声音 / 没判出来不改颜色: 那不是对读音的判断
 */
type RowStatus = 'todo' | 'green' | 'yellow' | 'near' | 'red';
const isPassed = (s: RowStatus | undefined) => s === 'green' || s === 'yellow';

/**
 * 变色口径:**绿色 = 判定认可**(真源 backend/app/services/phoneme_closed_set.judge)。
 *
 * ## 2026-10-30 起乱读不能过(用户「现在我乱读都能过」「乱读不要过 还是要有一定的正确率」)
 * 以前只拦没声音:判定只看「本节 20 个词里更像哪个」,乱读也总有个最像的词,于是整页都绿。
 * 现在后端先过两道门(像不像这个音标 + 是不是明显在读别的词),门槛按真孩子录音标定:
 * 10-03 认真读的 9 条全过,10-30 乱读 / 说中文 / 说一句话的 5 条全拦。
 *
 *   not_close / wrong_word / not_speech / silent → 不变绿,琥珀色,说清楚再怎么读
 *   pass / confused / uncertain → 变绿
 *   off / 请求失败(判定服务没起、超时、网络断)→ **不变绿**,马上给「我读对了」,课照样能往下走。
 *     ⚠️ 10-31 以前 off 一律变绿: 判定服务空闲一夜后第一次要 65 秒,主应用 3 秒就超时 →
 *     用户「我怎么乱读都是绿色通过呢」。判定不可用 ≠ 读对了
 *
 * ## 「我读对了」
 * 以前一直摆着 = 乱读一遍点它就过,判定形同虚设。现在**被拦 3 次**才出现(录不了音的设备一直有),
 * 点了记到最后那条录音上(self_passed)—— 认真读的孩子大量自己放行,说明门槛太严,要重新标定。
 */
const STD_HINT_AFTER_TRIES = 2;   // 同一个词读这么多次还没绿,主动提示听标准音
const SELF_PASS_AFTER_MISSES = 3; // 被判定拦了这么多次,才给「我读对了」

/**
 * 标准音走现有 edge-tts 端点(英式女声,与全 App 单词发音同一个声音)。
 * 老师给这个词指定了发音(cede 读 seed)就逐字合成那段文字 —— 和后台「试听」同一个接口
 */
const stdUrl = (word: string, tts?: string | null) =>
  tts ? rawTtsUrl(tts)
    : `${API_BASE_URL}/pronunciation/edge-tts?word=${encodeURIComponent(word)}`;

export default function PhoneticReading() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const goBack = useGoBack('/student/phonetics/textbook');

  const [lesson, setLesson] = useState<ReadingLesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<RowStatus[]>([]);
  const [active, setActive] = useState(0);
  const [feedback, setFeedback] = useState<JudgeResult | null>(null);
  const [myUrl, setMyUrl] = useState<string | null>(null);
  const [tries, setTries] = useState<number[]>([]);
  // 被判定拦下的次数(没声音不算:那是麦克风 / 离得远,不是读得不对)
  const [misses, setMisses] = useState<number[]>([]);
  // 每一格最后那条录音的 id,「我读对了」记在它上面
  const lastReading = useRef<Record<number, number>>({});
  // 最近一次判定没判出来(off)的格子。这些格子马上给「我读对了」,不用等被拦 3 次
  const [judgeDown, setJudgeDown] = useState<Record<number, boolean>>({});
  // 只让**刚**变绿的那一格放庆祝特效;900ms 后清掉,否则重渲染会重复播
  const [justDone, setJustDone] = useState<number | null>(null);
  // 判定在路上(录完到出结果之间)。这段时间不给再录,避免两次判定串结果
  const [judging, setJudging] = useState(false);
  // 判定是异步的,回来时 active 可能已被手动切走 —— 用 ref 读**最新**值,
  // 闭包里的 active 是发起那一刻的旧值,拿它比对永远相等
  const activeRef = useRef(0);

  const blocker = getRecorderBlocker();
  const { isRecording, error: recError, level, record, stop } = useSpeechRecorder(5000);
  const stdRef = useRef<HTMLAudioElement | null>(null);
  const mineRef = useRef<HTMLAudioElement | null>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  const item = lesson?.items[active];
  const doneCount = status.filter(isPassed).length;
  const greenCount = status.filter(s => s === 'green').length;
  const yellowCount = status.filter(s => s === 'yellow' || s === 'near').length;
  const redCount = status.filter(s => s === 'red').length;

  useEffect(() => {
    if (!lessonId) { setError('没有找到这一节'); setLoading(false); return; }
    let alive = true;
    fetchReadingLesson(lessonId)
      .then(d => {
        if (!alive) return;
        if (!d.items?.length) { setError('这一节还没有题目'); return; }
        setLesson(d);
        setStatus(d.items.map(() => 'todo'));
        setTries(d.items.map(() => 0));
        setMisses(d.items.map(() => 0));
      })
      .catch(() => { if (alive) setError('加载失败,请检查网络后重试'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [lessonId]);

  /** 跳到下一个还没读的 */
  const gotoNextTodo = useCallback((from: number, st: RowStatus[]) => {
    for (let i = from + 1; i < st.length; i++) if (!isPassed(st[i])) return i;
    for (let i = 0; i <= from; i++) if (!isPassed(st[i])) return i;
    return -1;
  }, []);

  useEffect(() => {
    activeRef.current = active;
    rowRefs.current[active]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [active]);

  /**
   * 录一次 → 等判定 → 只有判定认可才变绿。
   *
   * 顺序很关键:**先等判定再变色**。上一版先 markDone 再异步取判定,
   * 于是格子早绿了、700ms 后已经跳走,判定回来时想拦也拦不住。
   * 现在录完先进 judging 态(格子转圈),拿到 verdict 再决定绿还是琥珀。
   *
   * 判定不可用一律放过(见文件头):uncertain/off/网络失败都当读对。
   */
  const doRecord = async () => {
    if (!item || isRecording || judging) return;
    setFeedback(null);

    // 开录前把标准音掐掉。孩子常常在标准音还在放的时候就点了「按这里读」,
    // 那段标准音会被麦克风收进去 —— 判定拿到「标准音 + 孩子的声音」两遍,
    // 比对单个词必然对不上。回声消除是第二道防线,这是第一道。
    for (const el of [stdRef.current, mineRef.current]) {
      if (el && !el.paused) { el.pause(); el.currentTime = 0; }
    }

    const res = await record();
    if (!res) return;                       // 权限/格式问题,error 已经设好

    const url = URL.createObjectURL(res.blob);
    setMyUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
    setTries(prev => { const n = [...prev]; n[active] += 1; return n; });

    if (!res.hadSpeech) {
      // 没听到人声:不算完成,也不上色 —— 说的是「没听到」而不是「你读错了」
      setFeedback({ verdict: 'silent' });
      return;
    }

    // 判定期间锁住当前格,防止孩子连点录音把两次判定的结果串到一起
    const idx = active;
    const itemId = item.id;
    setJudging(true);
    let r: JudgeResult;
    try {
      r = await judgeReading(itemId, res.blob, res.speechMs);
    } catch {
      // 判定/留档请求失败 —— 放过。网络问题不该变成「你读错了」
      r = { verdict: 'off' };
    } finally {
      setJudging(false);
    }

    // 判定期间孩子可能已经手动点了别的格子,那就别改现在这一格
    if (idx !== activeRef.current) return;

    if (r.reading_id) lastReading.current[idx] = r.reading_id;
    setJudgeDown(prev => ({ ...prev, [idx]: r.verdict === 'off' }));

    // 判定没判出来 / 没声音: 不改颜色(不能替孩子判过),也不算被拦(不是他读得不对)
    if (r.verdict === 'off' || r.verdict === 'silent') {
      setFeedback(r);
      return;
    }

    // 拦:读得不像这个音标 / 明显读成了别的词。旧值 not_speech 也拦(页面没刷新时后端可能已经是新的)
    // 差一点的标黄,差得多的标红(后端 grade;旧后端没有 grade 一律红)
    if (r.verdict === 'not_close' || r.verdict === 'wrong_word' || r.verdict === 'not_speech') {
      const tone: RowStatus = r.grade === 'yellow' ? 'near' : 'red';
      setStatus(prev => { const n = [...prev]; n[idx] = tone; return n; });
      setMisses(prev => { const n = [...prev]; n[idx] += 1; return n; });
      setFeedback(r);
      return;
    }
    // pass / uncertain / confused → 过了,跳下一个。颜色: 词尾多带了一个音的标黄,其余绿
    // 反馈要留着显示:
    //   有 error_hint → 「差一点就全对了。词尾多带了一个音…」(读对≠读得好,这条值得说)
    //   只有 confused → 兜底的「机器听着更像 X」
    const hasFeedback = !!(r.error_hint || r.verdict === 'confused' || r.grade === 'yellow');
    if (hasFeedback) setFeedback(r);
    // 有话要说就多停一会儿,否则提示一闪而过等于没给
    markDone(idx, hasFeedback ? 3200 : 700, r.grade === 'yellow' ? 'yellow' : 'green');
  };

  /** 标记这一格读对了:放庆祝特效 → 自动跳下一个
   *
   * 录音成功和「我读对了」自评都走这里,保证两条路径的表现完全一致。
   *
   * `holdMs` 是停留时间:有具体错误提示时给到 3.2 秒,让孩子**来得及读完**
   * 那句话再跳走。700ms 只够看到一闪 —— 提示等于没给。
   */
  const markDone = useCallback((idx: number, holdMs = 700, tone: 'green' | 'yellow' = 'green') => {
    // 庆祝特效只给绿的: 黄的是「接近」,放星星等于告诉他已经完美了
    if (tone === 'green') {
      setJustDone(idx);
      setTimeout(() => setJustDone(null), 900);
    }
    setStatus(prev => {
      const next = [...prev];
      next[idx] = tone;
      const to = gotoNextTodo(idx, next);
      if (to >= 0) setTimeout(() => {
        setActive(to); setFeedback(null); setMyUrl(null);
      }, holdMs);
      return next;
    });
  }, [gotoNextTodo]);

  const markSelfDone = () => {
    const rid = lastReading.current[active];
    // 记下来就行,失败不挡孩子
    if (rid) markSelfPass(rid).catch(() => { /* 忽略 */ });
    // 自己认的标黄: 机器没确认读对,绿色只留给机器认可的
    markDone(active, 700, 'yellow');
  };

  const play = (which: 'std' | 'mine') => {
    const el = which === 'std' ? stdRef.current : mineRef.current;
    if (!el) return;
    el.currentTime = 0;
    el.play().catch(() => { /* 自动播放被拦,忽略 */ });
  };

  /** 对比回放:标准 → 你的 → 标准。判定不可用时这就是唯一反馈 */
  const playCompare = async () => {
    for (const w of ['std', 'mine', 'std'] as const) {
      const el = w === 'std' ? stdRef.current : mineRef.current;
      if (!el?.src) continue;
      el.currentTime = 0;
      try {
        await el.play();
        await new Promise<void>(res => {
          const on = () => { el.removeEventListener('ended', on); res(); };
          el.addEventListener('ended', on);
          setTimeout(() => { el.removeEventListener('ended', on); res(); }, 4000);
        });
      } catch { /* 被拦就跳过 */ }
      await new Promise(r => setTimeout(r, 300));
    }
  };

  const skip = () => {
    const to = gotoNextTodo(active, status);
    if (to >= 0) { setActive(to); setFeedback(null); setMyUrl(null); }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoaderCircle className="h-8 w-8 animate-spin text-orange-400" />
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6">
        <p className="text-slate-600">{error}</p>
        <button onClick={goBack} className="rounded-lg bg-orange-500 px-5 py-2 text-white">返回</button>
      </div>
    );
  }

  const allDone = lesson && doneCount === lesson.items.length;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gradient-to-b from-orange-50/40 to-white">
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-100 bg-white/90 px-4 py-3">
        <button onClick={goBack} aria-label="返回" className="rounded-lg p-2 hover:bg-slate-100">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </button>
        <div className="flex-1">
          <p className="text-sm font-medium text-slate-700">{lesson?.title} · 看音标读出来</p>
          <p className="text-xs text-slate-400">
            读过 {doneCount} / {lesson?.items.length}
            {/* 三种颜色各几个: 一眼看出这一页读得怎么样 */}
            {(greenCount + yellowCount + redCount) > 0 && (
              <span className="ml-2">
                <span className="text-emerald-600">绿 {greenCount}</span>
                {' · '}<span className="text-amber-600">黄 {yellowCount}</span>
                {' · '}<span className="text-rose-600">红 {redCount}</span>
              </span>
            )}
          </p>
        </div>
        {allDone && (
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs text-emerald-600">
            全读完了
          </span>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {/* 左:一页全部音标 */}
        <main className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {/* 颜色说明: 第一次看到红黄格子的孩子要知道是什么意思 */}
          <div className="mx-auto mb-2 flex max-w-2xl flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs text-slate-500">
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-emerald-400" aria-hidden />读对了</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-amber-400" aria-hidden />接近,再读一次能变绿</span>
            <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-rose-400" aria-hidden />差得多,先听标准音</span>
          </div>
          <div className="mx-auto grid max-w-2xl grid-cols-2 gap-2 sm:grid-cols-3">
            {lesson?.items.map((it, i) => (
              <div key={it.id} ref={el => { rowRefs.current[i] = el; }}>
                <PhonemeCell
                  phonetic={it.phonetic}
                  word={it.word_reveal}
                  meaning={it.meaning}
                  status={status[i] ?? 'todo'}
                  active={i === active}
                  justDone={justDone === i}
                  onClick={() => { setActive(i); setFeedback(null); }}
                />
              </div>
            ))}
          </div>
        </main>

        {/* 右:当前这个词的操作区 */}
        <aside className="shrink-0 border-t border-slate-200 bg-white/95 p-4
                          lg:w-[22rem] lg:border-l lg:border-t-0">
          {(blocker || recError) && (
            <div className="mb-3 rounded-lg bg-amber-50 p-2.5 text-xs text-amber-800 ring-1 ring-amber-200">
              {blocker ?? recError}
            </div>
          )}

          <div className="text-center">
            <p className="font-mono text-4xl text-slate-800">{item?.phonetic}</p>
            <p className="mt-1 text-sm text-slate-500">{item?.meaning}</p>
          </div>

          <button
            onClick={() => play('std')}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-white
                       py-2.5 text-sm text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
          >
            <Volume2 className="h-4 w-4" /> 听标准音
          </button>

          <div className="mt-3">
            {!isRecording && (
              <button
                onClick={doRecord}
                disabled={!!blocker || judging}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500
                           py-3.5 text-white transition active:scale-[0.99]
                           disabled:bg-slate-200 disabled:text-slate-400"
              >
                <Mic className="h-5 w-5" /> {judging ? '正在听…' : '按这里读'}
              </button>
            )}
            {isRecording && (
              <button
                onClick={stop}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-rose-500
                           py-3.5 text-white transition active:scale-[0.99]"
              >
                <Square className="h-4 w-4" />
                {/* 说完会自动停(VAD),这个按钮是手动兜底 */}
                读完了
              </button>
            )}
          </div>

          {/* 音量条:让孩子看见「机器听到我了」。
              这比文字提示有效 —— 没声音时条不动,他自己就会靠近麦克风 */}
          {isRecording && (
            <div className="mt-3 flex items-center gap-1.5">
              {Array.from({ length: 14 }, (_, i) => {
                const on = level * 14 > i;
                return (
                  <motion.span
                    key={i}
                    animate={{
                      scaleY: on ? 1 : 0.25,
                      opacity: on ? 1 : 0.3,
                    }}
                    transition={{ duration: 0.09 }}
                    className={[
                      'h-6 flex-1 origin-bottom rounded-full',
                      i > 10 ? 'bg-rose-400' : i > 7 ? 'bg-amber-400' : 'bg-emerald-400',
                    ].join(' ')}
                  />
                );
              })}
            </div>
          )}

          {/* 判定在路上:明确说在听,别让孩子以为卡住了又去点一次 */}
          {judging && (
            <div className="mt-3 flex items-center justify-center gap-2 rounded-xl
                            bg-slate-50 p-3 text-sm text-slate-500">
              <LoaderCircle className="h-4 w-4 animate-spin" /> 正在听你读的…
            </div>
          )}

          {/* 反馈只有两种会露面:没听到、念成了别的词。判不准一律静默放过 */}
          {feedback && !judging && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-3 rounded-xl bg-slate-50 p-3 text-center text-sm"
            >
              {feedback.verdict === 'silent' && (
                <p className="text-slate-500">没听到声音,离麦克风近一点再读一次</p>
              )}
              {feedback.verdict === 'off' && (
                <p className="text-slate-500">
                  这次没判出来(网络慢或服务器忙),再读一次;读得有把握可以点下面「我读对了」
                </p>
              )}
              {(feedback.verdict === 'not_speech'
                || (feedback.verdict === 'not_close' && !feedback.error_hint)) && (
                // 读得不像这个音标。不说「你读错了」—— 也可能是声音太小、离麦克风远
                feedback.grade === 'yellow' ? (
                  <p className="text-amber-700">
                    差一点了!再听一遍标准音,跟着 <span className="font-mono">{item?.phonetic}</span> 一个音一个音读
                  </p>
                ) : (
                  <p className="text-rose-700">
                    听着不太像 <span className="font-mono">{item?.phonetic}</span>
                    ,先点上面「听标准音」,跟着一个音一个音读
                  </p>
                )
              )}
              {feedback.verdict === 'wrong_word' && (
                // 读成了本节另一个词:把那个词的音标摆出来对比,比只说单词有用(孩子看的是音标)
                <p className="text-rose-700">
                  听着像在读 <span className="font-mono">{
                    lesson?.items.find(x => x.word_reveal === feedback.heard)?.phonetic ?? feedback.heard
                  }</span>,这一个是 <span className="font-mono">{item?.phonetic}</span>
                  ,听一下标准音再读
                </p>
              )}
              {/* 有具体错误类型就说具体的 —— 「词尾多带了个音」孩子能照着改,
                  而「更像 daff」他根本没想读 daff,听了也不知道改什么。
                  已经变绿时口吻要变成「读对了,不过…」,否则绿灯配一句错误提示
                  会让孩子以为自己到底对没对都搞不清。 */}
              {feedback.error_hint ? (
                // 红的(元音都不对,比如读「ooo」)用红字;其余提示是「接近」,用黄字
                <p className={feedback.grade === 'red' ? 'text-rose-700' : 'text-amber-700'}>
                  {isPassed(status[active]) && (
                    <span className="font-medium">差一点就全对了。</span>
                  )}
                  {feedback.error_hint}
                  {isPassed(status[active]) && '。再读一次能变绿'}
                </p>
              ) : feedback.grade === 'yellow' && isPassed(status[active]) ? (
                // 靠口音放宽才过的(后端 phoneme_closed_set.ACCENT_FLOOR): 过了,但跟标准音比还有差距
                <p className="text-amber-700">
                  <span className="font-medium">过了!</span>跟标准音比还有点口音,
                  点下面「对比听」听听差在哪,再读一次能变绿
                </p>
              ) : feedback.verdict === 'confused' ? (
                // 说不出具体错在哪时的兜底。只是参考,格子已经绿了
                // (见 doRecord:现用模型对中国孩子判不准,不拿它拦人)
                <p className="text-slate-500">
                  机器听着更像 <span className="font-mono">{feedback.heard}</span>
                  ,可以点下面对比听一下(仅供参考,不影响过关)
                </p>
              ) : null}
            </motion.div>
          )}

          {myUrl && (
            <div className="mt-3 space-y-2">
              <button
                onClick={playCompare}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-50
                           py-2.5 text-sm text-orange-700 ring-1 ring-orange-200"
              >
                <Volume2 className="h-4 w-4" /> 对比听:标准 → 你的 → 标准
              </button>
              <button
                onClick={() => play('mine')}
                className="w-full rounded-xl bg-white py-2.5 text-sm text-slate-600 ring-1 ring-slate-200"
              >
                只听我读的
              </button>
            </div>
          )}

          {/* 同一个词读了两次还想再读,主动提示先听标准音 */}
          {tries[active] >= STD_HINT_AFTER_TRIES && !isPassed(status[active]) && (
            <p className="mt-2 text-center text-xs text-slate-400">
              先点上面「听标准音」听两遍,再跟着读
            </p>
          )}

          <div className="mt-3 flex gap-2">
            <button
              onClick={() => { setFeedback(null); setMyUrl(null); doRecord(); }}
              disabled={!!blocker || isRecording || judging}
              className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-white py-2.5
                         text-xs text-slate-600 ring-1 ring-slate-200 disabled:opacity-40"
            >
              <RotateCcw className="h-3.5 w-3.5" /> 重读
            </button>
            <button
              onClick={skip}
              className="flex flex-1 items-center justify-center gap-1 rounded-xl bg-white py-2.5
                         text-xs text-slate-500 ring-1 ring-slate-200"
            >
              <SkipForward className="h-3.5 w-3.5" /> 先跳过
            </button>
          </div>

          {/* 「我读对了」自评按钮。两个用处:①录音不可用的设备(老 iOS、非 https 入口)也能推进
              ②判定判错时孩子有出口,不至于卡在一格上反复读。
              但一直摆着就成了乱读的后门,所以**被拦 3 次**才出现(10-30),点了记到录音上 */}
          {!isPassed(status[active]) && misses[active] >= SELF_PASS_AFTER_MISSES && !blocker && !recError && (
            <p className="mt-3 text-center text-xs text-slate-400">
              读了 {misses[active]} 次还没过?实在读不过可以点下面「我读对了」
            </p>
          )}
          {!isPassed(status[active])
            && (misses[active] >= SELF_PASS_AFTER_MISSES || !!judgeDown[active] || !!blocker || !!recError) && (
            <button
              onClick={markSelfDone}
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl
                         bg-emerald-50 py-2.5 text-xs text-emerald-700 ring-1
                         ring-emerald-200 transition active:scale-[0.99]"
            >
              <Check className="h-3.5 w-3.5" /> 我读对了
            </button>
          )}

          {allDone && (
            <button
              onClick={goBack}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl
                         bg-slate-800 py-3 text-white"
            >
              <Check className="h-4 w-4" /> 完成
            </button>
          )}
        </aside>
      </div>

      <audio ref={stdRef} src={item ? stdUrl(item.word_reveal, item.tts_text) : undefined} preload="auto" hidden />
      <audio ref={mineRef} src={myUrl ?? undefined} preload="auto" hidden />
    </div>
  );
}
