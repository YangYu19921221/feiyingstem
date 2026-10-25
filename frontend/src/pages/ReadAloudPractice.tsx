/**
 * 例句跟读(2026-10-24): 单词单元「基础巩固 → 跟读」/ 老师布置的「例句跟读」作业
 *
 * 一轮 8 句: 看例句 → 自动放原声 → 按大圆钮跟读 → 说完放自己的录音、再放原声对比 → 下一句。
 * 当场只判「真的开口、说够时长」(useSpeechRecorder 的 VAD,与开口背同口径),孩子看不到对错 ——
 * 识别还没拿真人录音验证过(用户 10-24 定),对错先只给老师看。
 * 录音保留 14 天,本班老师能回放(页面上写明「老师会听」)。不发金币、不进掌握度。
 * 录不了音(没麦克风/拒绝权限/http 打开)时不卡人: 写明原因,改成「跟着念一遍」后继续,不上传。
 *
 * 版式(10-24 用户「UI 重新设计下 好看点」): 整屏三段 —— 顶部分段进度 + 三步提示,中间大号例句卡
 * (目标词高亮),底部大圆录音钮(手机拇指够得着)。录音时圆钮随音量起伏;读完能分别重听「我读的」和「原声」。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, Mic, RefreshCw, RotateCcw, Volume2 } from 'lucide-react';
import { getReadAloudRound, uploadReadAloud, type ReadAloudRound } from '../api/readAloud';
import { reportStudyTime } from '../api/learningRecords';
import { useAudio } from '../hooks/useAudio';
import { getRecorderBlocker, useSpeechRecorder } from '../hooks/useSpeechRecorder';
import useAccidentalTapGuard from '../hooks/useAccidentalTapGuard';
import useGoBack from '../hooks/useGoBack';
import useNetActiveTime from '../hooks/useNetActiveTime';
import { currentHomeworkAssignmentId } from '../utils/homeworkGroup';
import { findBlankRange } from '../utils/blankSentence';
import { minSpeechMs } from '../utils/sentenceCheck';
import { getErrorMessage } from '../utils/errorMessage';

type Phase = 'ready' | 'recording' | 'tooShort' | 'heard';

const STEPS = ['听原声', '大声读', '对比'] as const;

/** 例句里把这个单词标出来(变形也认得: helps / went),找不到就原样显示 */
function SentenceWithWord({ sentence, word }: { sentence: string; word: string }) {
  const r = findBlankRange(sentence, word);
  if (!r) return <>{sentence}</>;
  return (
    <>
      {sentence.slice(0, r.start)}
      <span className="rounded-lg bg-orange-100 px-1.5 font-semibold text-accent-warm">{sentence.slice(r.start, r.end)}</span>
      {sentence.slice(r.end)}
    </>
  );
}

/** 播放中的小波形(纯装饰) */
function Bars({ on }: { on: boolean }) {
  return (
    <span className="flex h-4 items-end gap-[3px]" aria-hidden="true">
      {[0.5, 1, 0.7].map((h, i) => (
        <span key={i}
          className={`w-[3px] rounded-full bg-current ${on ? 'animate-pulse motion-reduce:animate-none' : ''}`}
          style={{ height: `${(on ? h : 0.35) * 100}%`, animationDelay: `${i * 150}ms` }} />
      ))}
    </span>
  );
}

export default function ReadAloudPractice() {
  const { unitId } = useParams<{ unitId: string }>();
  const unit = Number(unitId);
  const goBack = useGoBack('/student/dashboard');
  const assignmentId = useMemo(() => currentHomeworkAssignmentId(), []);
  const { playAudio, stopAudio } = useAudio();
  const { markShown, isAccidentalTap } = useAccidentalTapGuard();

  const [round, setRound] = useState<ReadAloudRound | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [idx, setIdx] = useState(0);
  const [phase, setPhase] = useState<Phase>('ready');
  const [done, setDone] = useState(false);
  const [readIds, setReadIds] = useState<Set<number>>(() => new Set());
  const [minePlaying, setMinePlaying] = useState(false);
  const mineRef = useRef<HTMLAudioElement | null>(null);
  const mineUrlRef = useRef<string | null>(null);

  const cur = round?.items[idx];
  const rec = useSpeechRecorder(cur ? Math.max(5000, minSpeechMs(cur.sentence) * 4) : 5000);
  const blocker = useMemo(() => getRecorderBlocker(), []);
  const micBroken = !!blocker || !!rec.error;

  // 学习时长: 与其它学习页同口径(净活动时长,发呆/切屏不计)
  const { takeDelta } = useNetActiveTime();
  const reportRef = useRef(() => {});
  reportRef.current = () => {
    const d = takeDelta();
    if (d > 0) reportStudyTime(d).catch(() => {});
  };
  useEffect(() => () => reportRef.current(), []);

  const stopMine = () => {
    mineRef.current?.pause();
    mineRef.current = null;
    setMinePlaying(false);
  };
  const freeMine = () => {
    stopMine();
    if (mineUrlRef.current) URL.revokeObjectURL(mineUrlRef.current);
    mineUrlRef.current = null;
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const r = await getReadAloudRound(unit, assignmentId);
      setRound(r);
      setIdx(0);
      setPhase('ready');
      setDone(false);
      setReadIds(new Set());
    } catch (e) {
      setError(getErrorMessage(e, '跟读暂时没有加载出来'));
    } finally {
      setLoading(false);
    }
  }, [unit, assignmentId]);
  useEffect(() => { void load(); }, [load]);

  // 换句: 自动放一遍原声(先听再读)
  useEffect(() => {
    if (!cur) return;
    markShown();
    const t = setTimeout(() => playAudio(cur.sentence), 300);
    return () => clearTimeout(t);
  }, [cur, playAudio, markShown]);

  // 离开页面停录音、停声音、释放录音 blob。依赖不能写整个 rec(每次渲染都是新对象,见 SpeakStage);
  // 这里直接动 ref,不调 setState(组件已卸载)
  const stopRec = rec.stop;
  useEffect(() => () => {
    stopRec();
    stopAudio();
    mineRef.current?.pause();
    if (mineUrlRef.current) URL.revokeObjectURL(mineUrlRef.current);
  }, [stopRec, stopAudio]);

  /** 放孩子自己的录音;then 给了就接着放原声对比 */
  const playMine = (then?: string) => {
    const url = mineUrlRef.current;
    if (!url) return;
    stopAudio();
    stopMine();
    const a = new Audio(url);
    mineRef.current = a;
    setMinePlaying(true);
    a.onended = () => {
      if (mineRef.current !== a) return;
      mineRef.current = null;
      setMinePlaying(false);
      if (then) setTimeout(() => playAudio(then), 300);
    };
    a.play().catch(() => { setMinePlaying(false); if (then) playAudio(then); });
  };

  const playOriginal = () => {
    if (!cur) return;
    stopMine();
    playAudio(cur.sentence);
  };

  const start = async () => {
    if (!cur || isAccidentalTap()) return;
    stopAudio();     // 先掐掉原声,不然麦克风把它收进去(录到两遍)
    freeMine();
    setPhase('recording');
    const r = await rec.record();
    if (!r) { setPhase('ready'); return; }
    if (r.hadSpeech && r.speechMs >= minSpeechMs(cur.sentence)) {
      setPhase('heard');
      setReadIds((s) => new Set(s).add(cur.word_id));
      uploadReadAloud(unit, cur.word_id, r.blob, assignmentId).catch(() => {});
      mineUrlRef.current = URL.createObjectURL(r.blob);
      playMine(cur.sentence);
    } else {
      setPhase('tooShort');
    }
  };

  const next = () => {
    if (!round || isAccidentalTap()) return;
    stopAudio();
    freeMine();
    if (idx + 1 >= round.items.length) {
      setDone(true);
      reportRef.current();
    } else {
      setPhase('ready');
      setIdx(idx + 1);
    }
  };

  const shell = (body: React.ReactNode) => (
    <div className="flex min-h-[100dvh] flex-col bg-paper no-select">
      <nav className="sticky top-0 z-10 border-b border-black/[0.05] bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          <button type="button" onClick={() => goBack()} aria-label="返回"
            className="-ml-2 flex h-11 w-11 items-center justify-center rounded-xl text-ink-soft transition hover:bg-orange-50 hover:text-accent-warm">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-lg font-semibold text-ink">🎤 例句跟读</h1>
            {round && <p className="truncate text-xs text-ink-mute">{round.unit_name} · 一轮 {round.items.length} 句</p>}
          </div>
        </div>
      </nav>
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5 sm:pt-8">
        {body}
      </main>
    </div>
  );

  if (loading) {
    return shell(
      <div className="space-y-5" aria-busy="true" aria-label="正在加载跟读">
        <div className="h-2 animate-pulse rounded-full bg-black/[0.06]" />
        <div className="h-72 animate-pulse rounded-[28px] bg-white" />
        <div className="mx-auto h-24 w-24 animate-pulse rounded-full bg-white" />
      </div>,
    );
  }
  if (error || !round) {
    return shell(
      <div className="my-auto rounded-[28px] bg-white p-8 text-center shadow-[0_10px_40px_rgba(189,82,39,0.08)]" role="alert">
        <div className="mx-auto mb-4 grid h-16 w-16 place-items-center rounded-2xl bg-orange-50 text-accent-warm">
          <RefreshCw className="h-8 w-8" aria-hidden="true" />
        </div>
        <p className="font-display text-xl font-semibold text-ink">跟读没打开</p>
        <p className="mt-2 text-sm text-ink-soft">{error || '请稍后重试'}</p>
        <button type="button" onClick={() => void load()}
          className="mt-6 min-h-12 w-full rounded-2xl bg-accent-warm px-5 font-semibold text-white transition hover:opacity-90">重新加载</button>
      </div>,
    );
  }
  if (round.items.length === 0) {
    return shell(
      <div className="my-auto rounded-[28px] bg-white p-8 text-center shadow-[0_10px_40px_rgba(189,82,39,0.08)]" role="status">
        <div className="mx-auto mb-4 text-5xl" aria-hidden="true">📭</div>
        <p className="font-display text-xl font-semibold text-ink">这个单元还没有能跟读的例句</p>
        <p className="mt-2 text-sm text-ink-soft">先去练分类或听写吧。</p>
        <button type="button" onClick={() => goBack()}
          className="mt-6 min-h-12 w-full rounded-2xl bg-accent-warm px-5 font-semibold text-white transition hover:opacity-90">返回单元</button>
      </div>,
    );
  }

  const total = round.items.length;

  if (done) {
    const n = readIds.size;
    return shell(
      <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }}
        className="my-auto overflow-hidden rounded-[28px] bg-white shadow-[0_14px_50px_rgba(189,82,39,0.12)]" role="status">
        <div className="bg-gradient-to-br from-amber-300 via-orange-400 to-accent-warm px-6 pb-8 pt-9 text-center text-white">
          <motion.div initial={{ scale: 0.4, rotate: -12 }} animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 14, delay: 0.1 }}
            className="text-6xl" aria-hidden="true">🎉</motion.div>
          <h2 className="mt-3 font-display text-2xl font-bold sm:text-3xl">这一轮读完了!</h2>
          <p className="mt-1.5 text-white/90">
            {micBroken ? `跟着原声念了 ${total} 句` : `大声读了 ${n} 句`}
          </p>
        </div>
        <ul className="max-h-[40vh] divide-y divide-black/[0.05] overflow-y-auto px-5 py-2 sm:px-7">
          {round.items.map((it) => (
            <li key={it.word_id} className="flex items-start gap-3 py-3">
              <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full ${readIds.has(it.word_id) ? 'bg-green-100 text-green-600' : 'bg-black/[0.05] text-ink-mute'}`}>
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <span className="text-[15px] leading-6 text-ink"><SentenceWithWord sentence={it.sentence} word={it.word} /></span>
            </li>
          ))}
        </ul>
        <div className="space-y-3 border-t border-black/[0.05] px-5 pb-6 pt-4 sm:px-7">
          {!micBroken && n > 0 && (
            <p className="text-center text-xs text-ink-mute">老师会听你的录音,保留 {round.keep_days} 天后自动删除</p>
          )}
          <button type="button" onClick={() => void load()}
            className="min-h-14 w-full rounded-2xl bg-accent-warm text-lg font-bold text-white shadow-[0_8px_24px_rgba(192,83,42,0.3)] transition hover:opacity-90 active:scale-[0.98]">
            再读一轮
          </button>
          <button type="button" onClick={() => goBack()}
            className="min-h-12 w-full rounded-2xl bg-black/[0.04] font-medium text-ink-soft transition hover:bg-black/[0.07]">返回单元</button>
        </div>
      </motion.div>,
    );
  }

  const item = cur!;
  const last = idx + 1 >= total;
  const step = phase === 'heard' ? 2 : 1;

  return shell(
    <>
      {/* 分段进度: 读过的绿、正在读的橙 */}
      <div className="flex gap-1.5" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={idx}
        aria-label={`第 ${idx + 1} 句,共 ${total} 句`}>
        {round.items.map((it, i) => (
          <span key={it.word_id}
            className={`h-2 flex-1 rounded-full transition-colors ${i < idx ? 'bg-green-400' : i === idx ? 'bg-accent-warm' : 'bg-black/[0.07]'}`} />
        ))}
      </div>

      {/* 三步提示 */}
      <ol className="mt-4 flex items-center justify-center gap-1.5 text-xs sm:gap-2 sm:text-sm" aria-label="跟读三步">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-1.5 sm:gap-2">
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium transition-colors ${
              i < step ? 'bg-green-50 text-green-700' : i === step ? 'bg-orange-100 text-accent-warm' : 'bg-black/[0.04] text-ink-mute'}`}
              aria-current={i === step ? 'step' : undefined}>
              {i < step ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <span className="tabular-nums">{i + 1}</span>}
              {s}
            </span>
            {i < STEPS.length - 1 && <span className="text-ink-mute" aria-hidden="true">›</span>}
          </li>
        ))}
      </ol>

      {/* 例句卡 */}
      <motion.section key={item.word_id} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28 }}
        className="relative mt-5 overflow-hidden rounded-[28px] bg-white px-6 pb-6 pt-7 shadow-[0_10px_40px_rgba(189,82,39,0.09)] ring-1 ring-[#f0e2d6] sm:px-10 sm:pb-8 sm:pt-9"
        aria-label="这一句">
        <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-amber-300 via-orange-400 to-accent-warm" aria-hidden="true" />
        <div className="flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-3 py-1 text-sm font-semibold text-accent-warm">
            <span aria-hidden="true">📖</span>{item.word}
          </span>
          <span className="text-sm tabular-nums text-ink-mute">{idx + 1} / {total}</span>
        </div>

        <p className="mt-6 font-display text-[26px] leading-[1.55] text-ink sm:text-[34px]">
          <SentenceWithWord sentence={item.sentence} word={item.word} />
        </p>
        {item.translation && <p className="mt-3 text-base leading-7 text-ink-soft sm:text-lg">{item.translation}</p>}

        <div className="mt-6 flex flex-wrap gap-2">
          <button type="button" onClick={playOriginal}
            className="inline-flex min-h-11 items-center gap-2 rounded-full bg-sky-50 px-4 text-sm font-semibold text-sky-700 ring-1 ring-sky-200 transition hover:bg-sky-100 active:scale-95">
            <Volume2 className="h-4 w-4" aria-hidden="true" />听原声
          </button>
          {phase === 'heard' && (
            <motion.button type="button" onClick={() => (minePlaying ? stopMine() : playMine())}
              initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
              className="inline-flex min-h-11 items-center gap-2 rounded-full bg-orange-50 px-4 text-sm font-semibold text-accent-warm ring-1 ring-orange-200 transition hover:bg-orange-100 active:scale-95">
              <Bars on={minePlaying} />{minePlaying ? '正在放我读的' : '听我读的'}
            </motion.button>
          )}
        </div>
      </motion.section>

      {/* 底部操作 */}
      {/* 手机上贴底(拇指够得着);大屏上紧跟卡片,别隔出半屏空白 */}
      <div className="mt-auto flex flex-col items-center pt-8 md:mt-12 md:pt-0">
        {micBroken ? (
          <div className="w-full space-y-3">
            <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800" role="status">
              {blocker || rec.error}。先跟着原声念一遍,再往下。
            </p>
            <button type="button" onClick={next}
              className="inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-accent-warm text-lg font-bold text-white transition hover:opacity-90 active:scale-[0.98]">
              {last ? '读完这一轮' : '下一句'}<ArrowRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        ) : phase === 'heard' ? (
          <div className="w-full">
            <p className="mb-4 flex items-center justify-center gap-2 text-center text-sm font-medium text-green-700" role="status">
              <span className="grid h-6 w-6 place-items-center rounded-full bg-green-100"><Check className="h-4 w-4" aria-hidden="true" /></span>
              读完啦!听听你读的和原声哪里不一样
            </p>
            <div className="grid grid-cols-[auto_1fr] gap-3">
              <button type="button" onClick={start} aria-label="再读一遍"
                className="inline-flex min-h-14 items-center justify-center gap-1.5 rounded-2xl bg-white px-4 font-medium text-ink ring-1 ring-black/10 transition hover:bg-black/[0.02] active:scale-[0.98]">
                <RotateCcw className="h-4 w-4" aria-hidden="true" />再读
              </button>
              <button type="button" onClick={next}
                className="inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-accent-warm text-lg font-bold text-white shadow-[0_8px_24px_rgba(192,83,42,0.3)] transition hover:opacity-90 active:scale-[0.98]">
                {last ? '读完这一轮' : '下一句'}<ArrowRight className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
          </div>
        ) : phase === 'recording' ? (
          <>
            <button type="button" onClick={() => rec.stop()} aria-label="读完了,停止录音"
              className="relative grid h-24 w-24 place-items-center rounded-full bg-rose-500 text-white shadow-[0_12px_30px_rgba(244,63,94,0.35)] sm:h-28 sm:w-28">
              <span className="absolute inset-0 rounded-full bg-rose-400/40 transition-transform duration-75 motion-reduce:hidden"
                style={{ transform: `scale(${1 + rec.level * 0.9})` }} aria-hidden="true" />
              <span className="relative h-8 w-8 rounded-lg bg-white" aria-hidden="true" />
            </button>
            <p className="mt-4 text-base font-semibold text-ink" role="status">在听你读…</p>
            <p className="mt-1 text-xs text-ink-mute">读完会自动停,也可以点一下</p>
          </>
        ) : (
          <>
            <button type="button" onClick={start} aria-label={phase === 'tooShort' ? '再读一次' : '按一下,大声读'}
              className="relative grid h-24 w-24 place-items-center rounded-full bg-gradient-to-br from-orange-400 to-accent-warm text-white shadow-[0_12px_30px_rgba(192,83,42,0.35)] transition active:scale-95 sm:h-28 sm:w-28">
              <span className="absolute inset-0 animate-[ping_2.4s_cubic-bezier(0,0,0.2,1)_infinite] rounded-full bg-orange-400/25 motion-reduce:animate-none" aria-hidden="true" />
              <Mic className="relative h-10 w-10 sm:h-12 sm:w-12" aria-hidden="true" />
            </button>
            {phase === 'tooShort' ? (
              <>
                <p className="mt-4 text-base font-semibold text-ink">再读一次</p>
                <p className="mt-1 text-sm text-amber-700" role="status">没听清,声音大一点,把整句读完</p>
              </>
            ) : (
              <>
                <p className="mt-4 text-base font-semibold text-ink">按一下,大声读</p>
                {idx === 0 && <p className="mt-1 text-xs text-ink-mute">你的录音会给老师听,保留 {round.keep_days} 天后自动删除</p>}
              </>
            )}
          </>
        )}
      </div>
    </>,
  );
}
