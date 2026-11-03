/**
 * 音标听力 —— 学生端(2026-11-03)
 *
 * 纸书《听力练习本》那一页搬进 App: 每题听一个词,按老师写的提示(「3—4 尾2」)写出**单词和音标**,
 * 两个都对才算这题对。用户 11-03 选的: App 里听音打字 / 默认系统读、老师可换录音 / 单词和音标都写。
 *
 * 流程一题一题来(听力要专心听一个,9 张卡并排会互相干扰):
 *   听 → 写单词 + 点音标键填格子 →「看看对不对」
 *   第一遍错: 告诉孩子单词对没对、音标哪几格错,**不给答案**;第二遍单词对了就锁住,音标只填元音
 *   做对 / 第二遍判完 / 点「看答案」→ 揭示答案再读一遍 →「下一题」
 * 答案只在服务端,这一页拿不到单词(读音按题目 id 拉,网址里没有单词)。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ArrowLeft, Check, ChevronRight, Eye, LoaderCircle, RotateCcw, Volume2 } from 'lucide-react';
import useGoBack from '../hooks/useGoBack';
import useStudyTimeReporter from '../hooks/useStudyTimeReporter';
import IpaKeyboard from '../components/phonetics/IpaKeyboard';
import AnswerSlots from '../components/phonetics/AnswerSlots';
import ColoredPhonetic from '../components/ColoredPhonetic';
import {
  checkListening, fetchAuthedAudio, getListeningSet, listeningAudioUrl,
  type ListeningCheckResult, type ListeningItemQ, type ListeningSetQ,
} from '../api/phoneticListening';
import { getErrorMessage } from '../utils/errorMessage';

type Phase = 'loading' | 'error' | 'answer' | 'judged' | 'done' | 'summary';

interface Outcome { id: number; firstTry: boolean; correct: boolean; word: string }

function blankSlots(it: ListeningItemQ) {
  const stress = new Set(it.stress_at ?? []);
  return {
    slots: Array.from({ length: it.slot_count }, (_, i) => (stress.has(i) ? 'ˈ' : null)) as (string | null)[],
    editable: Array.from({ length: it.slot_count }, (_, i) => i).filter(i => !stress.has(i)),
  };
}

export default function PhoneticListening() {
  const { setId } = useParams<{ setId: string }>();
  const goBack = useGoBack('/student/phonetics/textbook');

  const [data, setData] = useState<ListeningSetQ | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [idx, setIdx] = useState(0);
  const [round, setRound] = useState<ListeningItemQ[]>([]);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);

  const [word, setWord] = useState('');
  const [wordLocked, setWordLocked] = useState(false);
  const [pass, setPass] = useState(1);
  const [slots, setSlots] = useState<(string | null)[]>([]);
  const [editable, setEditable] = useState<number[]>([]);
  const [cursor, setCursor] = useState(0);
  const [result, setResult] = useState<ListeningCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [audioErr, setAudioErr] = useState('');
  const startTs = useRef(Date.now());

  useStudyTimeReporter(phase === 'summary');

  // ---- 读音: 带登录拉成 blob 缓存,一题只拉一次 ----
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cache = useRef(new Map<number, string>());
  useEffect(() => () => { cache.current.forEach(u => URL.revokeObjectURL(u)); }, []);

  const item = round[idx] ?? null;

  // 当前题放在 ref 里: play 依赖 item 的话,加载完题目 → item 变 → play 变 → mount 变 → 又去加载题目,
  // 一直循环,孩子打的字每次都被清空(本机浏览器实测踩到)
  const itemRef = useRef<ListeningItemQ | null>(null);
  itemRef.current = item;

  const play = useCallback(async (given?: ListeningItemQ | null) => {
    const it = given ?? itemRef.current;
    if (!it) return;
    setAudioErr('');
    try {
      let url = cache.current.get(it.id);
      if (!url) {
        url = await fetchAuthedAudio(listeningAudioUrl(it));
        cache.current.set(it.id, url);
      }
      const a = audioRef.current ?? new Audio();
      audioRef.current = a;
      a.pause();
      a.src = url;
      a.currentTime = 0;
      setPlaying(true);
      a.onended = () => setPlaying(false);
      await a.play();
    } catch (e) {
      setPlaying(false);
      const name = (e as Error)?.name;
      setAudioErr(name === 'NotAllowedError' ? '点一下「听」就能听到' : getErrorMessage(e, '读音放不出来,点一下再听'));
    }
  }, []);

  // 预先拉好下一题的读音
  useEffect(() => {
    const nx = round[idx + 1];
    if (nx && !cache.current.has(nx.id)) {
      fetchAuthedAudio(listeningAudioUrl(nx)).then(u => cache.current.set(nx.id, u)).catch(() => {});
    }
  }, [idx, round]);

  // ---- 防误跳(和卡片版同一口径): 主按钮同一个位置,判完那一下的余点不算 ----
  const stageAt = useRef(Date.now());
  const accidental = () => Date.now() - stageAt.current < 350;
  const mark = () => { stageAt.current = Date.now(); };

  const mount = useCallback((it: ListeningItemQ, autoplay: boolean) => {
    const b = blankSlots(it);
    setWord('');
    setWordLocked(false);
    setPass(1);
    setSlots(b.slots);
    setEditable(b.editable);
    setCursor(b.editable[0] ?? -1);
    setResult(null);
    setPhase('answer');
    mark();
    startTs.current = Date.now();
    if (autoplay) void play(it);
  }, [play]);

  useEffect(() => {
    if (!setId) return;
    let alive = true;
    getListeningSet(setId)
      .then(d => {
        if (!alive) return;
        if (!d.items.length) { setError('这套听力还没有题目。'); setPhase('error'); return; }
        setData(d);
        setRound(d.items);
        mount(d.items[0], false);   // 第一题不自动放: 刚进页面没有点击,浏览器会拦
      })
      .catch(e => { if (alive) { setError(getErrorMessage(e, '题目加载失败,请检查网络后重试。')); setPhase('error'); } });
    return () => { alive = false; };
  }, [setId, mount]);

  // ---- 填音标 ----
  const onKey = (p: string) => {
    if (phase !== 'answer' || cursor < 0) return;
    const next = slots.map((v, i) => (i === cursor ? p : v));
    setSlots(next);
    setCursor(editable.find(i => i > cursor && next[i] == null) ?? editable.find(i => next[i] == null) ?? -1);
  };
  const onBackspace = () => {
    if (phase !== 'answer') return;
    const t = cursor >= 0 && slots[cursor] != null ? cursor : [...editable].reverse().find(i => slots[i] != null);
    if (t == null) return;
    setSlots(slots.map((v, i) => (i === t ? null : v)));
    setCursor(t);
  };

  const slotsLeft = editable.filter(i => slots[i] == null).length;
  const wordMissing = !wordLocked && !word.trim();
  const ready = !wordMissing && slotsLeft === 0;

  const submit = async (giveUp = false) => {
    if (!item || checking || phase !== 'answer') return;
    if (!giveUp && !ready) return;
    if (accidental()) return;
    setChecking(true);
    try {
      const r = await checkListening({
        item_id: item.id, pass_number: pass, word, phonetic: slots, give_up: giveUp,
        duration_ms: Date.now() - startTs.current,
      });
      setResult(r);
      mark();
      if (r.finished) {
        setOutcomes(o => [...o, { id: item.id, firstTry: pass === 1 && r.all_correct, correct: r.all_correct,
          word: r.answer?.word ?? '' }]);
        setPhase('done');
        void play(item);
      } else {
        setPhase('judged');
      }
    } catch (e) {
      setError(getErrorMessage(e, '判分失败,请检查网络后重试。'));
      setPhase('error');
    } finally {
      setChecking(false);
    }
  };

  /** 第二遍: 单词对了锁住;音标辅音回填,只填元音 */
  const retry = () => {
    if (!result || phase !== 'judged' || accidental()) return;
    const blanks = result.next_blanks ?? [];
    setWordLocked(result.word_ok);
    if (!result.word_ok) setWord('');
    setSlots([...(result.prefill ?? slots)]);
    setEditable(blanks);
    setCursor(blanks[0] ?? -1);
    setPass(2);
    setResult(null);
    setPhase('answer');
    mark();
    startTs.current = Date.now();
  };

  const next = () => {
    if (accidental()) return;
    if (idx + 1 < round.length) {
      setIdx(idx + 1);
      mount(round[idx + 1], true);
    } else {
      setPhase('summary');
      mark();
    }
  };

  const restart = (items: ListeningItemQ[]) => {
    if (accidental()) return;
    setRound(items);
    setIdx(0);
    setOutcomes([]);
    mount(items[0], true);
  };

  // 回车 = 主按钮;在单词输入框里回车也一样(输入法组字时不算)
  const advanceRef = useRef<() => void>(() => {});
  advanceRef.current = () => {
    if (phase === 'answer' && ready) void submit();
    else if (phase === 'judged') retry();
    else if (phase === 'done') next();
  };
  const backRef = useRef(onBackspace);
  backRef.current = onBackspace;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.repeat || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      const inInput = (e.target as HTMLElement | null)?.tagName === 'INPUT';
      if (e.key === 'Enter') { e.preventDefault(); advanceRef.current(); return; }
      if (e.key === 'Backspace' && !inInput) { e.preventDefault(); backRef.current(); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // ---------------------------------------------------------------- 渲染

  if (phase === 'loading') {
    return <div className="flex min-h-screen items-center justify-center"><LoaderCircle className="h-8 w-8 animate-spin text-orange-400" /></div>;
  }
  if (phase === 'error') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6">
        <p className="text-center text-slate-600">{error}</p>
        <button onClick={goBack} className="rounded-lg bg-orange-500 px-5 py-2 text-white">返回</button>
      </div>
    );
  }
  if (phase === 'summary') {
    const wrong = outcomes.filter(o => !o.correct);
    const right = outcomes.length - wrong.length;
    return (
      <div className="min-h-screen bg-gradient-to-b from-sky-50/50 to-white px-5 py-8">
        <div className="mx-auto max-w-md">
          <p className="text-center text-5xl">{wrong.length ? '💪' : '🎉'}</p>
          <h1 className="mt-3 text-center text-xl font-bold text-slate-800">
            {wrong.length ? `对了 ${right} / ${outcomes.length} 题` : '全对了'}
          </h1>
          <p className="mt-1 text-center text-sm text-slate-500">
            一遍就对 {outcomes.filter(o => o.firstTry).length} 题 · 单词和音标都对才算对
          </p>
          {wrong.length > 0 && (
            <div className="mt-5 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
              <p className="mb-2 text-xs text-slate-500">这些还要再练</p>
              <div className="flex flex-wrap gap-2">
                {wrong.map(o => <span key={o.id} className="rounded-lg bg-rose-50 px-2.5 py-1 font-mono text-sm text-rose-600">{o.word}</span>)}
              </div>
            </div>
          )}
          <div className="mt-6 flex flex-col gap-3">
            {wrong.length > 0 && data && (
              <button onClick={() => restart(data.items.filter(i => wrong.some(w => w.id === i.id)))}
                className="flex items-center justify-center gap-2 rounded-xl bg-orange-500 py-3 text-white">
                <RotateCcw className="h-4 w-4" /> 只练错的 {wrong.length} 题
              </button>
            )}
            {data && <button onClick={() => restart(data.items)} className="rounded-xl bg-white py-3 text-slate-700 ring-1 ring-slate-200">整套再来一遍</button>}
            <button onClick={goBack} className="rounded-xl bg-slate-800 py-3 text-white">完成</button>
          </div>
        </div>
      </div>
    );
  }

  const answerPhonetic = result?.answer?.phonetic_tokens?.join('') ?? '';
  const primary = phase === 'done' ? (
    <button type="button" onClick={next} className="flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg bg-orange-500 px-3 text-sm font-semibold text-white">
      {idx + 1 < round.length ? <>下一题 <ChevronRight className="h-4 w-4" /></> : '看结果'}
    </button>
  ) : phase === 'judged' ? (
    <button type="button" onClick={retry} className="flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg bg-orange-500 px-3 text-sm font-semibold text-white">
      <RotateCcw className="h-4 w-4 shrink-0" /> <span className="truncate">改错的再交一次</span>
    </button>
  ) : (
    <button type="button" onClick={() => submit()} disabled={!ready || checking}
      className="flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg bg-orange-500 px-3 text-sm font-semibold text-white disabled:bg-slate-200 disabled:text-slate-500">
      {checking ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
      <span className="truncate">{wordMissing ? '先写单词' : slotsLeft ? `音标还有 ${slotsLeft} 格` : '看看对不对'}</span>
    </button>
  );

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-gradient-to-b from-sky-50/50 to-white">
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-100 bg-white/90 px-3 py-2 backdrop-blur sm:px-4">
        <button onClick={goBack} aria-label="返回" className="rounded-lg p-2 hover:bg-slate-100">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-700">{data?.title} · 音标听力</p>
          <p className="text-xs text-slate-500">第 {idx + 1} / {round.length} 题{pass === 2 && phase === 'answer' ? ' · 第二遍' : ''}</p>
        </div>
        <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-slate-100 sm:w-28">
          <div className="h-full rounded-full bg-orange-400 transition-all" style={{ width: `${(outcomes.length / Math.max(1, round.length)) * 100}%` }} />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div className="mx-auto flex w-full max-w-md flex-col items-center gap-3">
          <button type="button" onClick={() => void play()} aria-label="听这个词"
            className={`flex h-20 w-20 items-center justify-center rounded-full bg-sky-500 text-white shadow-lg transition active:scale-95 md:h-24 md:w-24 ${playing ? 'ring-4 ring-sky-200' : ''}`}>
            <Volume2 className={`h-9 w-9 ${playing ? 'animate-pulse' : ''}`} />
          </button>
          <p className="text-xs text-slate-500">{audioErr || '点一下听,想听几遍都行'}</p>

          {item?.hint && (
            <p className="rounded-full bg-amber-50 px-4 py-1.5 text-base font-semibold text-amber-800 ring-1 ring-amber-200">
              提示: {item.hint}
            </p>
          )}

          {phase === 'done' && result?.answer ? (
            <div className={`w-full rounded-2xl p-4 text-center text-white shadow-md ${result.all_correct ? 'bg-gradient-to-br from-emerald-400 to-emerald-600' : 'bg-gradient-to-br from-orange-400 to-rose-500'}`}>
              <p className="text-sm text-white/90">{result.all_correct ? (pass === 1 ? '🎉 一遍就对' : '👍 第二遍对了') : '📖 正确答案'}</p>
              <p className="mt-1 font-mono text-3xl font-bold">{result.answer.word}</p>
              <span className="mt-2 inline-flex rounded-xl bg-white/95 px-3 py-1.5">
                <ColoredPhonetic phonetic={`[${answerPhonetic}]`} size="md" delimiter="bracket" />
              </span>
              {result.answer.meaning && <p className="mt-2 text-sm text-white/90">{result.answer.meaning}</p>}
              {!result.all_correct && (
                <p className="mt-2 text-xs text-white/90">
                  你写的: {word || '(没写)'} · 单词{result.word_ok ? '对' : '错'}、音标{result.phonetic_ok ? '对' : '错'}
                </p>
              )}
            </div>
          ) : (
            <>
              <label className="w-full">
                <span className="mb-1 block text-sm font-medium text-slate-700">① 写单词</span>
                <input
                  value={word}
                  onChange={e => setWord(e.target.value)}
                  disabled={wordLocked || phase !== 'answer'}
                  autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off"
                  placeholder={wordLocked ? '单词对了,不用再写' : '听到的单词'}
                  className={`h-12 w-full rounded-xl border-2 px-4 text-center font-mono text-xl outline-none transition
                    ${phase === 'judged' ? (result?.word_ok ? 'border-emerald-400 bg-emerald-50' : 'border-rose-300 bg-rose-50')
                      : wordLocked ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-200 focus:border-orange-400'}`}
                />
              </label>
              <div className="w-full">
                <span className="mb-1 block text-sm font-medium text-slate-700">② 写音标(点下面的键)</span>
                <div className="flex justify-center overflow-x-auto rounded-xl bg-white py-2 ring-1 ring-slate-200">
                  <AnswerSlots slots={slots} editable={editable} cursor={phase === 'answer' ? cursor : -1}
                    correct={phase === 'judged' ? result?.per_slot : undefined}
                    size={slots.length <= 5 ? 'md' : 'compact'} onSlotClick={i => phase === 'answer' && setCursor(i)} />
                </div>
              </div>
              {phase === 'judged' && result && (
                <p className="text-center text-sm text-rose-600">
                  {!result.word_ok && '单词不对'}{!result.word_ok && !result.phonetic_ok && ' · '}
                  {!result.phonetic_ok && `音标错 ${result.wrong_indexes.length} 格`}
                  <span className="block text-xs text-slate-500">再听一遍,改错的那部分{result.word_ok ? '(单词已经对了)' : ''}</span>
                </p>
              )}
            </>
          )}
        </div>
      </div>

      <div className="shrink-0 border-t border-slate-100 bg-white/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur sm:px-4">
        <div className="mx-auto w-full max-w-3xl">
          <IpaKeyboard
            onKey={onKey} onBackspace={onBackspace} onClear={() => {}}
            full={cursor < 0} disabled={phase !== 'answer'} dense
            gridClassName="grid-cols-7 md:grid-cols-[repeat(14,minmax(0,1fr))]"
            action={<>
              <button type="button" onClick={() => submit(true)} disabled={phase !== 'answer' || checking}
                className="flex h-10 shrink-0 items-center gap-1 rounded-lg bg-white px-2.5 text-sm text-slate-700 ring-1 ring-slate-300 disabled:opacity-40">
                <Eye className="h-4 w-4" aria-hidden /><span className="hidden min-[400px]:inline">不会,</span>看答案
              </button>
              {primary}
            </>}
          />
        </div>
      </div>
    </div>
  );
}
