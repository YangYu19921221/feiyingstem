/**
 * 音标听力 —— 学生端(2026-11-03)
 *
 * 纸书《听力练习本》那一页搬进 App: 每题听一个词,按老师写的提示(「3—4 尾2」)写出**单词和音标**,
 * 两个都对才算这题对。用户 11-03 选的: App 里听音打字 / 默认系统读、老师可换录音 / 单词和音标都写。
 *
 * 两种模式(用户「听力可以一页 9 个单词或者 20 个单词吗 你设计下两种模式」),顶上切换,按账号记住:
 *   卡片 · 一页 9 个: 三列三行,点哪张就读哪张、往哪张里填;填好一张判一张,判完当场翻出答案再读一遍,
 *     光标跳到下一张没做的 —— 和「卡片写音标」同一种做法
 *   整页 · 一页 20 个: 像练习本那一页,一行一题(电脑上两列);写完整页一起交,错的再改一次再交。
 *     「连着读」像老师报听写: 按顺序每个词读两遍、停几秒给孩子写
 * 判分两种模式同一套(服务端 /check 和 /check-page 共用 _grade_and_record): 单词和音标都对才算对,
 * 第一遍错只说哪里错、**不给答案**;第二遍单词对了就锁住,音标辅音回填只填元音;做对 / 第二遍判完 / 看答案才给答案。
 * 答案只在服务端,这一页拿不到单词(读音按题目 id 拉,网址里没有单词)。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  ArrowLeft, Check, ChevronRight, Eye, LayoutGrid, List, LoaderCircle, Play, RotateCcw, Square, Volume2,
} from 'lucide-react';
import useGoBack from '../hooks/useGoBack';
import useStudyTimeReporter from '../hooks/useStudyTimeReporter';
import IpaKeyboard from '../components/phonetics/IpaKeyboard';
import AnswerSlots from '../components/phonetics/AnswerSlots';
import ColoredPhonetic from '../components/ColoredPhonetic';
import {
  checkListening, checkListeningPage, fetchAuthedAudio, getListeningSet, listeningAudioUrl,
  type ListeningCheckResult, type ListeningItemQ, type ListeningSetQ,
} from '../api/phoneticListening';
import { getErrorMessage } from '../utils/errorMessage';

type Mode = 'cards' | 'page';
/** 一页几题。改了要重新量: 卡片三列三行、整页 20 行,键盘和主按钮都要留在一屏里 */
const PAGE_SIZE: Record<Mode, number> = { cards: 9, page: 20 };
const MODE_LABEL: Record<Mode, string> = { cards: '一页 9 个', page: '一页 20 个' };

type Phase = 'loading' | 'error' | 'play' | 'summary';

/** 一题的作答状态。todo = 在填,judged = 第一遍错了等「改错的再交」,done = 结束(答案已揭示) */
interface ItemState {
  item: ListeningItemQ;
  /** 在整套里是第几题(1 起),和练习本上的 ①②③ 对得上 */
  no: number;
  pass: number;
  word: string;
  wordLocked: boolean;
  slots: (string | null)[];
  editable: number[];
  cursor: number;
  result: ListeningCheckResult | null;
  status: 'todo' | 'judged' | 'done';
  startTs: number;
}

interface Outcome { id: number; firstTry: boolean; correct: boolean; word: string }

function newState(it: ListeningItemQ, no: number): ItemState {
  const stress = new Set(it.stress_at ?? []);
  const editable = Array.from({ length: it.slot_count }, (_, i) => i).filter(i => !stress.has(i));
  return {
    item: it, no, pass: 1, word: '', wordLocked: false,
    slots: Array.from({ length: it.slot_count }, (_, i) => (stress.has(i) ? 'ˈ' : null)),
    editable, cursor: editable[0] ?? -1, result: null, status: 'todo', startTs: Date.now(),
  };
}

/** 第二遍: 单词对了锁住(写错的留着让孩子改,不清空);音标辅音回填,只填元音格 */
function retryState(st: ItemState): ItemState {
  const r = st.result;
  if (!r) return st;
  const blanks = r.next_blanks ?? [];
  return {
    ...st, pass: 2, wordLocked: r.word_ok, slots: [...(r.prefill ?? st.slots)], editable: blanks,
    cursor: blanks[0] ?? -1, result: null, status: 'todo', startTs: Date.now(),
  };
}

const slotsLeft = (st: ItemState) => st.editable.filter(i => st.slots[i] == null).length;
const wordMissing = (st: ItemState) => !st.wordLocked && !st.word.trim();
const isReady = (st: ItemState) => !wordMissing(st) && slotsLeft(st) === 0;

function perUserKey(name: string) {
  try {
    const u = JSON.parse(localStorage.getItem('user') || 'null');
    return `${name}_${u?.id ?? 'anon'}`;
  } catch {
    return `${name}_anon`;
  }
}

const sleep = (ms: number) => new Promise(r => window.setTimeout(r, ms));
const blurInput = () => { (document.activeElement as HTMLElement | null)?.blur?.(); };

export default function PhoneticListening() {
  const { setId } = useParams<{ setId: string }>();
  const goBack = useGoBack('/student/phonetics/textbook');

  const [data, setData] = useState<ListeningSetQ | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');
  const [mode, setMode] = useState<Mode>(() =>
    (localStorage.getItem(perUserKey('listening_mode')) === 'page' ? 'page' : 'cards'));
  const [round, setRound] = useState<ListeningItemQ[]>([]);
  const [page, setPage] = useState(0);
  const [states, setStates] = useState<ItemState[]>([]);
  const [active, setActive] = useState(0);
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [checking, setChecking] = useState(false);
  const [playingId, setPlayingId] = useState<number | null>(null);
  const [readingIdx, setReadingIdx] = useState<number | null>(null);
  const [audioErr, setAudioErr] = useState('');

  useStudyTimeReporter(phase === 'summary');

  const noOf = useMemo(() => new Map((data?.items ?? []).map((it, i) => [it.id, i + 1])), [data]);
  const N = PAGE_SIZE[mode];
  const pages = Math.max(1, Math.ceil(round.length / N));
  const st = states[active] ?? null;
  const statesRef = useRef(states);
  statesRef.current = states;

  // ---- 读音: 带登录拉成 blob 缓存,一题只拉一次 ----
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const cache = useRef(new Map<number, string>());
  const readToken = useRef(0);

  const urlOf = useCallback(async (it: ListeningItemQ) => {
    let url = cache.current.get(it.id);
    if (!url) {
      url = await fetchAuthedAudio(listeningAudioUrl(it));
      cache.current.set(it.id, url);
    }
    return url;
  }, []);

  /** 放一遍,放完(或 5 秒没放完)才 resolve。连着读和单放共用 */
  const playOnce = useCallback(async (it: ListeningItemQ) => {
    setAudioErr('');
    const url = await urlOf(it);
    const a = audioRef.current ?? new Audio();
    audioRef.current = a;
    a.pause();
    a.src = url;
    a.currentTime = 0;
    setPlayingId(it.id);
    try {
      await new Promise<void>((resolve, reject) => {
        const t = window.setTimeout(resolve, 5000);
        a.onended = () => { window.clearTimeout(t); resolve(); };
        a.onerror = () => { window.clearTimeout(t); resolve(); };
        a.play().catch(e => { window.clearTimeout(t); reject(e); });
      });
    } finally {
      setPlayingId(p => (p === it.id ? null : p));
    }
  }, [urlOf]);

  const stopReading = useCallback(() => {
    readToken.current++;
    setReadingIdx(null);
  }, []);

  /** 孩子自己点喇叭: 先停掉连着读 */
  const play = useCallback((it: ListeningItemQ | null | undefined) => {
    if (!it) return;
    stopReading();
    playOnce(it).catch(e => {
      setAudioErr((e as Error)?.name === 'NotAllowedError'
        ? '点一下喇叭就能听到' : getErrorMessage(e, '读音放不出来,点一下再听'));
    });
  }, [playOnce, stopReading]);

  /** 连着读(整页): 没做完的按顺序每个读两遍,读完停 3.5 秒给孩子写 */
  const startReading = async () => {
    const token = ++readToken.current;
    const list = statesRef.current.map((s, i) => ({ s, i })).filter(x => x.s.status !== 'done');
    try {
      for (const { s, i } of list) {
        if (readToken.current !== token) return;
        setReadingIdx(i);
        rowRefs.current[i]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        for (let r = 0; r < 2; r++) {
          await playOnce(s.item);
          if (readToken.current !== token) return;
          await sleep(r === 0 ? 900 : 3500);
          if (readToken.current !== token) return;
        }
      }
    } catch (e) {
      setAudioErr(getErrorMessage(e, '读音放不出来,点一下再听'));
    } finally {
      if (readToken.current === token) setReadingIdx(null);
    }
  };

  useEffect(() => () => {
    readToken.current++;
    audioRef.current?.pause();
    cache.current.forEach(u => URL.revokeObjectURL(u));
  }, []);

  // ---- 防误跳(和卡片写音标同一口径): 主按钮同一个位置,判完那一下的余点不算 ----
  const stageAt = useRef(Date.now());
  const accidental = () => Date.now() - stageAt.current < 350;
  const mark = () => { stageAt.current = Date.now(); };

  const mountPage = useCallback((items: ListeningItemQ[], p: number, m: Mode) => {
    const size = PAGE_SIZE[m];
    const list = items.slice(p * size, (p + 1) * size);
    readToken.current++;
    setReadingIdx(null);
    setPage(p);
    setStates(list.map(it => newState(it, noOf.get(it.id) ?? 0)));
    setActive(0);
    setPhase('play');
    stageAt.current = Date.now();
    // 这一页的读音先拉下来(一个词约 6KB),点喇叭不用等
    list.forEach(it => { urlOf(it).catch(() => {}); });
  }, [noOf, urlOf]);

  useEffect(() => {
    if (!setId) return;
    let alive = true;
    getListeningSet(setId)
      .then(d => {
        if (!alive) return;
        if (!d.items.length) { setError('这套听力还没有题目。'); setPhase('error'); return; }
        setData(d);
        setRound(d.items);
      })
      .catch(e => { if (alive) { setError(getErrorMessage(e, '题目加载失败,请检查网络后重试。')); setPhase('error'); } });
    return () => { alive = false; };
  }, [setId]);

  // 题目到了(noOf 也跟着有了)再排第一页 —— 分开两步,mountPage 才拿得到题号
  const mounted = useRef(false);
  useEffect(() => {
    if (data && round.length && !mounted.current) {
      mounted.current = true;
      mountPage(round, 0, mode);
    }
  }, [data, round, mode, mountPage]);

  const update = (i: number, patch: Partial<ItemState>) =>
    setStates(prev => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  /** 换一张 / 一行。卡片模式点到别的卡就读它(点就是一次手势,浏览器放行) */
  const select = (i: number) => {
    if (i === active) return;
    setActive(i);
    if (mode === 'cards' && states[i]?.status !== 'done') play(states[i]?.item);
  };

  // 换卡 / 换行时滚进屏幕(矮屏上卡片区要滚)
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    if (readingIdx == null) rowRefs.current[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, page, readingIdx]);

  // ---- 填音标(打进当前这一题)----
  const onKey = (p: string) => {
    blurInput();   // 手机上系统键盘还开着会盖住音标键盘
    if (!st || st.status !== 'todo' || st.cursor < 0) return;
    const slots = st.slots.map((v, i) => (i === st.cursor ? p : v));
    const cursor = st.editable.find(i => i > st.cursor && slots[i] == null)
      ?? st.editable.find(i => slots[i] == null) ?? -1;
    update(active, { slots, cursor });
  };
  const onBackspace = () => {
    if (!st || st.status !== 'todo') return;
    const t = st.cursor >= 0 && st.slots[st.cursor] != null
      ? st.cursor : [...st.editable].reverse().find(i => st.slots[i] != null);
    if (t == null) return;
    update(active, { slots: st.slots.map((v, i) => (i === t ? null : v)), cursor: t });
  };

  const nextOpen = (list: ItemState[], from: number) => {
    for (let k = 1; k <= list.length; k++) {
      const j = (from + k) % list.length;
      if (list[j].status !== 'done') return j;
    }
    return -1;
  };

  const record = (s: ItemState, r: ListeningCheckResult) =>
    setOutcomes(o => [...o, { id: s.item.id, firstTry: s.pass === 1 && r.all_correct,
      correct: r.all_correct, word: r.answer?.word ?? '' }]);

  // ---- 卡片模式: 一张一张判 ----
  const submitCard = async (giveUp = false) => {
    if (!st || checking || st.status !== 'todo') return;
    if (!giveUp && !isReady(st)) return;
    if (accidental()) return;
    const i = active;
    const s = st;
    setChecking(true);
    try {
      const r = await checkListening({
        item_id: s.item.id, pass_number: s.pass, word: s.word, phonetic: s.slots, give_up: giveUp,
        duration_ms: Date.now() - s.startTs,
      });
      mark();
      if (r.finished) {
        const list = states.map((x, j) => (j === i ? { ...x, status: 'done' as const, result: r, cursor: -1 } : x));
        setStates(list);
        record(s, r);
        play(s.item);
        const nx = nextOpen(list, i);
        if (nx >= 0) setActive(nx);
      } else {
        update(i, { status: 'judged', result: r, cursor: -1 });
      }
    } catch (e) {
      setError(getErrorMessage(e, '判分失败,请检查网络后重试。'));
      setPhase('error');
    } finally {
      setChecking(false);
    }
  };

  const retryCard = () => {
    if (!st || st.status !== 'judged' || accidental()) return;
    update(active, retryState(st));
    mark();
  };

  const goNextOpen = () => {
    if (accidental()) return;
    const nx = nextOpen(states, active);
    if (nx >= 0) { setActive(nx); play(states[nx].item); mark(); }
  };

  // ---- 整页模式: 整页一起交 ----
  const todoRows = states.filter(s => s.status === 'todo');
  const judgedRows = states.filter(s => s.status === 'judged');
  const notFilled = todoRows.filter(s => !isReady(s)).length;

  const submitPage = async () => {
    if (checking || !todoRows.length || accidental()) return;
    if (notFilled && !window.confirm(
      `还有 ${notFilled} 题没写完,没写完的算错${todoRows[0].pass === 1 ? '(错了还能再改一次)' : ''}。现在交吗?`)) return;
    stopReading();
    const pass = todoRows[0].pass;
    const startTs = Math.min(...todoRows.map(s => s.startTs));
    setChecking(true);
    try {
      const r = await checkListeningPage({
        set_id: Number(setId), pass_number: pass, duration_ms: Date.now() - startTs,
        answers: todoRows.map(s => ({ item_id: s.item.id, word: s.word, phonetic: s.slots })),
      });
      mark();
      const byId = new Map(r.results.map(x => [x.item_id, x]));
      // 先算好新状态再记成绩: 记成绩放进 setStates 的更新函数里,React 开发模式会跑两遍 → 每题算两次
      // (本机浏览器实测「对了 4 / 40 题」)
      const list = statesRef.current.map(s => {
        const res = byId.get(s.item.id);
        if (!res) return s;
        return { ...s, result: res, cursor: -1, status: res.finished ? 'done' as const : 'judged' as const };
      });
      list.forEach(s => { if (s.status === 'done' && byId.get(s.item.id)?.finished) record(s, s.result!); });
      setStates(list);
      setActive(0);
    } catch (e) {
      setError(getErrorMessage(e, '交卷失败,请检查网络后重试。'));
      setPhase('error');
    } finally {
      setChecking(false);
    }
  };

  const retryPage = () => {
    if (!judgedRows.length || accidental()) return;
    const list = states.map(s => (s.status === 'judged' ? retryState(s) : s));
    setStates(list);
    setActive(Math.max(0, list.findIndex(s => s.status === 'todo')));
    mark();
  };

  // ---- 翻页 / 换模式 / 再来一轮 ----
  const allDone = states.length > 0 && states.every(s => s.status === 'done');

  const nextPage = () => {
    if (accidental()) return;
    if (page + 1 < pages) mountPage(round, page + 1, mode);
    else { stopReading(); setPhase('summary'); mark(); }
  };

  const switchMode = (m: Mode) => {
    if (m === mode) return;
    const started = outcomes.length > 0 || states.some(s => s.status !== 'todo' || s.word || s.slots.some(Boolean));
    if (started && !window.confirm('换模式要从这一套第一题重新开始(做过的记录都留着)。换吗?')) return;
    localStorage.setItem(perUserKey('listening_mode'), m);
    setMode(m);
    setOutcomes([]);
    mountPage(round, 0, m);
  };

  const restart = (items: ListeningItemQ[]) => {
    if (accidental()) return;
    setRound(items);
    setOutcomes([]);
    mountPage(items, 0, mode);
  };

  // ---- 主按钮(回车同一个动作)----
  const primaryAction = () => {
    if (allDone) return nextPage();
    if (mode === 'cards') {
      if (st?.status === 'judged') return retryCard();
      if (st?.status === 'done') return goNextOpen();
      if (st && isReady(st)) void submitCard();
      return;
    }
    if (judgedRows.length) return retryPage();
    void submitPage();
  };
  const primaryRef = useRef(primaryAction);
  primaryRef.current = primaryAction;
  const backRef = useRef(onBackspace);
  backRef.current = onBackspace;
  const moveRef = useRef((d: number) => { void d; });
  moveRef.current = (d: number) => { if (states.length) select((active + d + states.length) % states.length); };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.repeat || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const inInput = t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA';
      if (e.key === 'Enter') {
        e.preventDefault();
        // 单词框里回车 = 写完单词,收起系统键盘去点音标(不交卷)
        if (inInput) { t?.blur(); return; }
        primaryRef.current();
        return;
      }
      if (inInput) return;
      if (e.key === 'Backspace') { e.preventDefault(); backRef.current(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); moveRef.current(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); moveRef.current(-1); }
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

  const doneHere = states.filter(s => s.status === 'done').length;
  const btn = 'flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition active:scale-[0.98]';
  const orange = `${btn} bg-orange-500 text-white disabled:bg-slate-200 disabled:text-slate-500`;
  const nextLabel = page + 1 < pages ? <>{mode === 'cards' ? '下一组' : '下一页'} <ChevronRight className="h-4 w-4" /></> : '看结果';

  let primary: React.ReactNode;
  if (allDone) {
    primary = <button type="button" onClick={nextPage} className={orange}>{nextLabel}</button>;
  } else if (mode === 'cards') {
    if (st?.status === 'judged') {
      primary = <button type="button" onClick={retryCard} className={orange}><RotateCcw className="h-4 w-4 shrink-0" /><span className="truncate">改错的再交</span></button>;
    } else if (st?.status === 'done') {
      primary = <button type="button" onClick={goNextOpen} className={orange}>下一个 <ChevronRight className="h-4 w-4" /></button>;
    } else {
      const label = !st ? '' : wordMissing(st) ? '先写单词' : slotsLeft(st) ? `音标还有 ${slotsLeft(st)} 格` : '看看对不对';
      primary = (
        <button type="button" onClick={() => submitCard()} disabled={!st || !isReady(st) || checking} className={orange}>
          {checking ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" /> : <Check className="h-4 w-4 shrink-0" />}
          <span className="truncate">{label}</span>
        </button>
      );
    }
  } else if (judgedRows.length) {
    primary = <button type="button" onClick={retryPage} className={orange}><RotateCcw className="h-4 w-4 shrink-0" /><span className="truncate">改错的 {judgedRows.length} 题</span></button>;
  } else {
    const second = todoRows[0]?.pass === 2;
    primary = (
      <button type="button" onClick={submitPage} disabled={checking || !todoRows.length} className={orange}>
        {checking ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" /> : <Check className="h-4 w-4 shrink-0" />}
        <span className="truncate">{second ? '改好了,再交一次' : '交卷'}{notFilled ? `(${notFilled} 题没写完)` : ''}</span>
      </button>
    );
  }

  const secondary = mode === 'cards' ? (
    <button type="button" onClick={() => submitCard(true)} disabled={!st || st.status !== 'todo' || checking}
      className="flex h-10 shrink-0 items-center gap-1 rounded-lg bg-white px-2.5 text-sm text-slate-700 ring-1 ring-slate-300 disabled:opacity-40">
      <Eye className="h-4 w-4" aria-hidden /><span className="hidden min-[400px]:inline">不会,</span>看答案
    </button>
  ) : readingIdx != null ? (
    <button type="button" onClick={stopReading}
      className="flex h-10 shrink-0 items-center gap-1 rounded-lg bg-sky-500 px-3 text-sm font-semibold text-white">
      <Square className="h-3.5 w-3.5" aria-hidden /> 停
    </button>
  ) : (
    <button type="button" onClick={() => void startReading()} disabled={allDone || !!judgedRows.length}
      title="像老师报听写: 按顺序每个词读两遍,停几秒给你写"
      className="flex h-10 shrink-0 items-center gap-1 rounded-lg bg-sky-50 px-3 text-sm font-semibold text-sky-700 ring-1 ring-sky-200 disabled:opacity-40">
      <Play className="h-4 w-4" aria-hidden /> 连着读
    </button>
  );

  const rowProps = (s: ItemState, i: number) => ({
    st: s, active: i === active, reading: i === readingIdx, playing: playingId === s.item.id,
    onSelect: () => select(i),
    onPlay: () => { setActive(i); play(s.item); },
    onWord: (w: string) => update(i, { word: w }),
    onSlot: (k: number) => { blurInput(); setActive(i); if (s.status === 'todo') update(i, { cursor: k }); },
  });
  // 外面套一层 div 挂 ref(滚进屏幕用),不把 ref 回调当 prop 传进卡片 —— 和别的 prop 混在一起 lint 会判成渲染时读 ref
  const holder = (i: number) => (el: HTMLDivElement | null) => { rowRefs.current[i] = el; };

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-gradient-to-b from-sky-50/50 to-white">
      <header className="relative shrink-0 border-b border-slate-100 bg-white/90 px-2 py-2 backdrop-blur sm:px-4">
        <div className="mx-auto flex max-w-6xl items-center gap-2">
          <button onClick={goBack} aria-label="返回" className="rounded-lg p-2 hover:bg-slate-100">
            <ArrowLeft className="h-5 w-5 text-slate-600" />
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-700">{data?.title} · 音标听力</p>
            <p className="truncate text-xs text-slate-500">
              第 {page + 1} / {pages} {mode === 'cards' ? '组' : '页'} · 这{mode === 'cards' ? '组' : '页'}做完 {doneHere} / {states.length}
              {audioErr && <span className="ml-1 text-rose-600">· {audioErr}</span>}
            </p>
          </div>
          <div role="group" aria-label="一页几个" className="flex shrink-0 rounded-lg bg-slate-100 p-0.5">
            {(['cards', 'page'] as Mode[]).map(m => (
              <button key={m} type="button" onClick={() => switchMode(m)} aria-pressed={mode === m}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition ${
                  mode === m ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}>
                {m === 'cards' ? <LayoutGrid className="h-3.5 w-3.5" aria-hidden /> : <List className="h-3.5 w-3.5" aria-hidden />}
                <span>{MODE_LABEL[m].replace('一页 ', '')}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="absolute inset-x-0 bottom-0 h-1 bg-slate-100">
          <div className="h-full bg-orange-400 transition-all" style={{ width: `${(outcomes.length / Math.max(1, round.length)) * 100}%` }} />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 sm:px-4">
        {mode === 'cards' ? (
          <div className="mx-auto grid w-full max-w-3xl grid-cols-3 gap-1.5 sm:gap-2">
            {states.map((s, i) => (
              <div key={`${page}-${s.item.id}`} ref={holder(i)}><ListenCard {...rowProps(s, i)} /></div>
            ))}
          </div>
        ) : (
          <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-1.5 lg:grid-cols-2 lg:gap-x-4">
            {states.map((s, i) => (
              <div key={`${page}-${s.item.id}`} ref={holder(i)}><ListenRow {...rowProps(s, i)} /></div>
            ))}
          </div>
        )}
      </div>

      <div className="shrink-0 border-t border-slate-100 bg-white/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur sm:px-4">
        <div className="mx-auto w-full max-w-3xl">
          <IpaKeyboard
            onKey={onKey} onBackspace={onBackspace} onClear={() => {}}
            full={!st || st.cursor < 0} disabled={!st || st.status !== 'todo'} dense
            gridClassName="grid-cols-7 md:grid-cols-[repeat(14,minmax(0,1fr))]"
            action={<>{secondary}{primary}</>}
          />
        </div>
      </div>
    </div>
  );
}

interface RowProps {
  st: ItemState;
  active: boolean;
  reading: boolean;
  playing: boolean;
  onSelect: () => void;
  onPlay: () => void;
  onWord: (w: string) => void;
  onSlot: (i: number) => void;
}

/** 第几题 + 喇叭 */
function NoAndSpeaker({ st, playing, onPlay, size = 'sm' }: Pick<RowProps, 'st' | 'playing' | 'onPlay'> & { size?: 'sm' | 'md' }) {
  return (
    <>
      <span className={`flex shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 ${
        size === 'md' ? 'h-6 w-6' : 'h-5 w-5'}`}>{st.no}</span>
      <button type="button" onClick={e => { e.stopPropagation(); onPlay(); }} aria-label={`听第 ${st.no} 题`}
        className={`flex shrink-0 items-center justify-center rounded-full bg-sky-500 text-white transition active:scale-95 ${
          size === 'md' ? 'h-8 w-8' : 'h-7 w-7'} ${playing ? 'ring-4 ring-sky-200' : ''}`}>
        <Volume2 className={`h-4 w-4 ${playing ? 'animate-pulse' : ''}`} />
      </button>
    </>
  );
}

function WordInput({ st, onWord, onSelect, className }: Pick<RowProps, 'st' | 'onWord' | 'onSelect'> & { className: string }) {
  const judged = st.status === 'judged';
  return (
    <input
      value={st.word}
      onChange={e => onWord(e.target.value)}
      onFocus={onSelect}
      disabled={st.wordLocked || st.status !== 'todo'}
      autoCapitalize="none" autoCorrect="off" spellCheck={false} autoComplete="off" enterKeyHint="done"
      placeholder={st.wordLocked ? '单词对了' : '写单词'}
      aria-label={`第 ${st.no} 题单词`}
      className={`min-w-0 rounded-lg border px-2 text-center font-mono outline-none transition ${className} ${
        judged ? (st.result?.word_ok ? 'border-emerald-400 bg-emerald-50' : 'border-rose-300 bg-rose-50')
          : st.wordLocked ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-slate-300 focus:border-orange-400'}`}
    />
  );
}

function JudgedNote({ st }: { st: ItemState }) {
  const r = st.result;
  if (st.status !== 'judged' || !r) return st.pass === 2 && st.status === 'todo'
    ? <p className="text-[11px] leading-tight text-orange-700">第二遍,音标只改元音</p> : null;
  return (
    <p className="text-[11px] leading-tight text-rose-600">
      {!r.word_ok && '单词错'}{!r.word_ok && !r.phonetic_ok && ' · '}{!r.phonetic_ok && `音标错 ${r.wrong_indexes.length} 格`}
    </p>
  );
}

function AnswerShown({ st, big }: { st: ItemState; big?: boolean }) {
  const a = st.result?.answer;
  if (!a) return null;
  return (
    <>
      <p className={`max-w-full break-all text-center font-mono font-bold leading-tight text-slate-800 ${big ? 'text-lg md:text-2xl' : 'text-base'}`}>{a.word}</p>
      <span className="flex max-w-full shrink-0 justify-center overflow-x-auto">
        <ColoredPhonetic phonetic={`[${a.phonetic_tokens.join('')}]`} size="sm" delimiter="bracket" />
      </span>
      {!st.result?.all_correct && (
        <p className="max-w-full truncate text-[11px] text-rose-600">写的: {st.word || '(没写)'}</p>
      )}
    </>
  );
}

/** 卡片模式的一张卡(一页 9 张,三列) */
function ListenCard(p: RowProps) {
  const { st, active } = p;
  const done = st.status === 'done';
  const right = !!st.result?.all_correct;
  return (
    <div onClick={p.onSelect}
      className={[
        // 三行要和键盘一起放进一屏(390×844 卡片区约 370px、1366×768 约 380px),所以不设最小高度,按内容来
        'flex h-full cursor-pointer flex-col items-stretch gap-1 rounded-xl p-1.5 transition',
        done ? (right ? 'bg-emerald-50 ring-1 ring-emerald-300' : 'bg-rose-50 ring-1 ring-rose-300') : 'bg-white ring-1 ring-slate-200',
        active ? '!ring-2 !ring-[#FF6B35] shadow-md' : '',
      ].join(' ')}>
      {/* 题号 + 喇叭 + 提示挤一行: 单独一行提示会让三行卡片放不进一屏 */}
      <div className="flex min-w-0 items-center gap-1">
        <NoAndSpeaker st={st} playing={p.playing} onPlay={p.onPlay} />
        <p className="min-w-0 flex-1 truncate text-[11px] font-semibold leading-tight text-amber-800 md:text-sm"
           title={st.item.hint ?? ''}>{st.item.hint}</p>
        {done && <span className="shrink-0 text-xs">{right ? (st.pass === 1 ? '🎉' : '👍') : '📖'}</span>}
      </div>
      {done ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-0.5"><AnswerShown st={st} /></div>
      ) : (
        <>
          <WordInput st={st} onWord={p.onWord} onSelect={p.onSelect} className="h-8 w-full text-sm md:text-base" />
          <div className="flex max-w-full justify-center overflow-x-auto">
            <AnswerSlots slots={st.slots} editable={st.editable} cursor={active && st.status === 'todo' ? st.cursor : -1}
              correct={st.status === 'judged' ? st.result?.per_slot : undefined}
              size={st.slots.length <= 3 ? 'xs' : 'xxs'} onSlotClick={p.onSlot} />
          </div>
          <JudgedNote st={st} />
        </>
      )}
    </div>
  );
}

/** 整页模式的一行(一页 20 行,像练习本) */
function ListenRow(p: RowProps) {
  const { st, active, reading } = p;
  const done = st.status === 'done';
  const right = !!st.result?.all_correct;
  return (
    <div onClick={p.onSelect}
      className={[
        'grid cursor-pointer grid-cols-[1.5rem_2rem_minmax(0,1fr)] items-center gap-x-2 gap-y-1.5 rounded-xl p-2 transition',
        'md:grid-cols-[1.5rem_2rem_minmax(0,8rem)_minmax(0,1fr)]',
        done ? (right ? 'bg-emerald-50 ring-1 ring-emerald-200' : 'bg-rose-50 ring-1 ring-rose-200')
          : reading ? 'bg-sky-50 ring-2 ring-sky-300' : 'bg-white ring-1 ring-slate-200',
        active && !done ? '!ring-2 !ring-[#FF6B35]' : '',
      ].join(' ')}>
      <NoAndSpeaker st={st} playing={p.playing} onPlay={p.onPlay} size="md" />
      <p className="min-w-0 truncate text-sm font-semibold text-amber-800" title={st.item.hint ?? ''}>
        {st.item.hint || <span className="font-normal text-slate-400">(没有提示)</span>}
      </p>
      <div className="col-span-3 flex min-w-0 items-center gap-2 md:col-span-1">
        {done ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5"><AnswerShown st={st} /></div>
        ) : (
          <>
            <WordInput st={st} onWord={p.onWord} onSelect={p.onSelect} className="h-9 w-28 shrink-0 text-base md:w-32" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="max-w-full overflow-x-auto">
                <AnswerSlots slots={st.slots} editable={st.editable} cursor={active && st.status === 'todo' ? st.cursor : -1}
                  correct={st.status === 'judged' ? st.result?.per_slot : undefined}
                  size="compact" onSlotClick={p.onSlot} />
              </div>
              <JudgedNote st={st} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
