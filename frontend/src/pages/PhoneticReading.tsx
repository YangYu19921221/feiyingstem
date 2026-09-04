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
  fetchReadingLesson, judgeReading, type ReadingLesson, type JudgeResult,
} from '../api/phoneticReading';
import { API_BASE_URL } from '../config/env';

type RowStatus = 'todo' | 'done' | 'retry';

/**
 * 变色口径:**绿色 = 判定认可**,不再是「只要出声就绿」。
 *
 * ## 为什么改
 * 上一版绿色只看 VAD(有人声且 ≥250ms),于是哼一声、说中文、咳嗽都变绿 ——
 * 页面对读得对不对完全没有约束力,孩子乱读一遍也能全绿通关。
 *
 * 当时那么写有理由:whisper 把标准音 fee 听成 See、cab 听成 Cap,用它变色
 * 会给读对的孩子标红。但后端已换成**闭集打分**(在本节 20 个词里问「更像哪个」,
 * 不在 392 个音素里自由猜),实测 80% → 95%,而且它自带 MARGIN_UNCERTAIN
 * 把声学上真分不开的(bee/fee、bad/bed)主动吐成 pass。
 *
 * ## 现在的口径(方向仍是宁可漏放)
 *   pass / uncertain / off / 请求失败 → 变绿。判不准、服务没起、网络断,
 *     全都放过 —— 判定不可用绝不能挡住孩子读下一个。
 *   confused(念成了本节另一个词,且分差 ≥ 0.6)→ 不变绿,琥珀色「再读一次」,
 *     并明确说念成了哪个词。**只有这一种情况**拦。
 *
 * 仍然不打分、不拦路:格子可以点「我读对了」自评通过(判定误判时的出口)。
 */
const STD_HINT_AFTER_TRIES = 2;   // 同一个词读这么多次还没绿,主动提示听标准音

/** 标准音走现有 edge-tts 端点(英式女声,与全 App 单词发音同一个声音) */
const stdUrl = (word: string) =>
  `${API_BASE_URL}/pronunciation/edge-tts?word=${encodeURIComponent(word)}`;

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
  const doneCount = status.filter(s => s === 'done').length;

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
      })
      .catch(() => { if (alive) setError('加载失败,请检查网络后重试'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [lessonId]);

  /** 跳到下一个还没读的 */
  const gotoNextTodo = useCallback((from: number, st: RowStatus[]) => {
    for (let i = from + 1; i < st.length; i++) if (st[i] !== 'done') return i;
    for (let i = 0; i <= from; i++) if (st[i] !== 'done') return i;
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
      // 没听到人声:不算完成,但说的是「没听到」而不是「你读错了」
      setStatus(prev => { const n = [...prev]; n[active] = 'retry'; return n; });
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

    // ⚠️ 2026-09-03:**confused 暂时不拦人**,只当提示。
    // 原因是现用模型(espeak 多语言 wav2vec2)会把中国孩子的英语发音归到
    // **中文音素**那一侧 —— 实测 7 条真人录音全被转成 `pei5tə1` 这类带声调的
    // 拼音音素(标准音则干净解出 bæd),于是与纯英语候选集对不上,一律判 confused。
    // 拿它拦人等于把所有认真读的孩子挡在门外(实测 0/7 通过)。
    // 削静音、限英语音素、按段切分三种补救都试过,无效 —— 这不是调参能解决的,
    // 要根治得换成针对中国学生英语发音训练的引擎。
    // 在那之前:confused 只显示「听起来像 X」当参考,格子照常变绿。
    // silent / not_speech 仍然拦 —— 那两种是「确实没在读」,与口音无关。
    if (r.verdict === 'not_speech' || r.verdict === 'silent') {
      setStatus(prev => { const n = [...prev]; n[idx] = 'retry'; return n; });
      setFeedback(r);
      return;
    }
    // pass / uncertain / off / confused → 变绿跳下一个
    // 但反馈要留着显示:
    //   有 error_hint → 「读对了。词尾多带了一个音…」(读对≠读得好,这条值得说)
    //   只有 confused → 兜底的「机器听着更像 X」
    const hasFeedback = !!(r.error_hint || r.verdict === 'confused');
    if (hasFeedback) setFeedback(r);
    // 有话要说就多停一会儿,否则提示一闪而过等于没给
    markDone(idx, hasFeedback ? 3200 : 700);
  };

  /** 标记这一格读对了:放庆祝特效 → 自动跳下一个
   *
   * 录音成功和「我读对了」自评都走这里,保证两条路径的表现完全一致。
   *
   * `holdMs` 是停留时间:有具体错误提示时给到 3.2 秒,让孩子**来得及读完**
   * 那句话再跳走。700ms 只够看到一闪 —— 提示等于没给。
   */
  const markDone = useCallback((idx: number, holdMs = 700) => {
    setJustDone(idx);
    setTimeout(() => setJustDone(null), 900);
    setStatus(prev => {
      const next = [...prev];
      next[idx] = 'done';
      const to = gotoNextTodo(idx, next);
      if (to >= 0) setTimeout(() => {
        setActive(to); setFeedback(null); setMyUrl(null);
      }, holdMs);
      return next;
    });
  }, [gotoNextTodo]);

  const markSelfDone = () => markDone(active);

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
            读对 {doneCount} / {lesson?.items.length}
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
              {feedback.verdict === 'not_speech' && (
                // 没听出在读这一节的词。不说「你读错了」—— 更可能是没读、
                // 声音太小、或者麦克风收到的全是环境噪音
                <p className="text-slate-500">
                  没听清你在读哪个词,大声一点、对着麦克风再读一次
                </p>
              )}
              {/* 有具体错误类型就说具体的 —— 「词尾多带了个音」孩子能照着改,
                  而「更像 daff」他根本没想读 daff,听了也不知道改什么。
                  已经变绿时口吻要变成「读对了,不过…」,否则绿灯配一句错误提示
                  会让孩子以为自己到底对没对都搞不清。 */}
              {feedback.error_hint ? (
                <p className="text-amber-700">
                  {status[active] === 'done' && (
                    <span className="text-emerald-600">读对了。</span>
                  )}
                  {feedback.error_hint}
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
          {tries[active] >= STD_HINT_AFTER_TRIES && status[active] !== 'done' && (
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

          {/* 「我读对了」自评按钮 —— 判定会拦人之后,这颗按钮更重要了。
              三个用处:①录音不可用的设备(老 iOS、非 https 入口)也能推进
              ②判定判错时孩子有出口,不至于卡在一格上反复读
              ③判定服务没起时照旧能上课。
              自评不准但无害,而**没有出口**的机器误判会让孩子不敢开口。 */}
          {status[active] !== 'done' && (
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

      <audio ref={stdRef} src={item ? stdUrl(item.word_reveal) : undefined} preload="auto" hidden />
      <audio ref={mineRef} src={myUrl ?? undefined} preload="auto" hidden />
    </div>
  );
}
