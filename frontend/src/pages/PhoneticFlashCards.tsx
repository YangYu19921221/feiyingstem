/**
 * 看单词写音标 —— 卡片版(一屏 6 张卡,一张一张判)
 *
 * 与整页版(PhoneticFillBlank)是两种练法,不是替换:
 *   整页版 = 纸书那一页,20 个词铺开,同韵词排在一起让规律浮出来,填完一次交卷
 *   卡片版 = 填完一张当场判一张、当场揭示答案 + 发音,错了立刻重来
 *
 * 11-03 用户要求「一个页面放够 6 个单词」,并选了「6 个都显示,但一个一个判」;同日又改成 9 个
 * (「9 个我看排的下」): 一组 9 张卡,手机和电脑都是三列三行,点哪张往哪张里填;
 * 填满点「看看对不对」只判这一张,判完这张翻过来露出答案、读一遍,光标自动跳到下一张没做的;
 * 9 张都做完点「下一组」。一节 20 个词分 3 组(9 + 9 + 2)。
 * 以前一屏只有一张卡,一节 20 个词要翻 20 次,也看不到旁边同韵的词。
 *
 * 两遍机制沿用整页版的教学口径(服务端 _grade_one 同一份判分):
 * 第一遍全空;错了第二遍只挖元音格,辅音由服务端回填 —— 元音是拼读教学点,辅音送分。
 *
 * ⚠️ 答案不在前端。判分走 POST /check(一次一张),完整答案只在「这张卡已结束」时由服务端下发:
 * 做对了(哪遍都算)或第二遍判完才给;第一遍做错不给 —— 否则随手填几格就白拿答案。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeft, LoaderCircle, Check, RotateCcw, Volume2, ChevronRight, Eye,
} from 'lucide-react';
import useGoBack from '../hooks/useGoBack';
import useStudyTimeReporter from '../hooks/useStudyTimeReporter';
import { useAudio } from '../hooks/useAudio';
import IpaKeyboard from '../components/phonetics/IpaKeyboard';
import AnswerSlots from '../components/phonetics/AnswerSlots';
import ColoredPhonetic from '../components/ColoredPhonetic';
import {
  fetchPhoneticLesson, checkPhoneticItem, initialSlots,
  type PhoneticLesson, type PhoneticItem, type CheckResult,
} from '../api/phoneticPractice';

/** 一组几张卡。改了要重新量: 三列三行,手机 390×844 上卡片区 + 键盘 + 交卷键要在一屏里 */
const PAGE_SIZE = 9;

type Phase = 'loading' | 'error' | 'play' | 'summary';

/** 一张卡的状态。todo = 在填(第一遍或第二遍),judged = 第一遍错了等「只填元音再来」,done = 结束 */
interface CardState {
  item: PhoneticItem;
  pass: number;
  slots: (string | null)[];
  editable: number[];
  cursor: number;
  result: CheckResult | null;
  status: 'todo' | 'judged' | 'done';
  startTs: number;
}

/** 一张卡的最终结果。firstTry 用来算"一遍就对"的比例,是这页真正的学习指标 */
interface CardOutcome {
  item: PhoneticItem;
  firstTry: boolean;
  correct: boolean;
}

function newCard(it: PhoneticItem): CardState {
  // 重音格印好、不可编辑(见 initialSlots),光标从第一个要填的格开始
  const init = initialSlots(it);
  return {
    item: it, pass: 1, slots: init.slots, editable: init.editable,
    cursor: init.editable[0] ?? -1, result: null, status: 'todo', startTs: Date.now(),
  };
}

/** 答案格档位: 三列时一张卡手机上约 115px 宽,4 个音以上要小一档才不出横向滚动 */
const slotSize = (n: number) => (n <= 3 ? 'xs' as const : 'xxs' as const);

export default function PhoneticFlashCards() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const goBack = useGoBack('/student/phonetics/textbook');
  const { playAudio } = useAudio();
  const reduce = useReducedMotion();

  const [lesson, setLesson] = useState<PhoneticLesson | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');

  /** 本轮要过的词(第二轮只放上一轮错的),不洗牌: 同韵词相邻本身就是教学设计 */
  const [deck, setDeck] = useState<PhoneticItem[]>([]);
  const [page, setPage] = useState(0);
  const [round, setRound] = useState(1);
  const [outcomes, setOutcomes] = useState<CardOutcome[]>([]);

  const [cards, setCards] = useState<CardState[]>([]);
  const [active, setActive] = useState(0);
  const [checking, setChecking] = useState(false);

  useStudyTimeReporter(phase === 'summary');

  // ---- 防误跳(口径与 classify/GroupExamPhase 的 isAccidentalTap 一致)----
  // 「看看对不对」「只填元音再来一遍」「下一组」是同一个按钮位置: 判完那一下的余点
  // 会直接落在下一个动作上(第二遍拿着空元音格交上去、答案没看清就翻组)
  const stageShownAt = useRef(Date.now());
  const lastViewportShiftAt = useRef(0);

  useEffect(() => {
    const onShift = () => { lastViewportShiftAt.current = Date.now(); };
    const vv = window.visualViewport;
    vv?.addEventListener('resize', onShift);
    window.addEventListener('resize', onShift);
    return () => {
      vv?.removeEventListener('resize', onShift);
      window.removeEventListener('resize', onShift);
    };
  }, []);

  const isAccidentalTap = () =>
    Date.now() - stageShownAt.current < 350 ||
    Date.now() - lastViewportShiftAt.current < 350;
  const markStage = () => { stageShownAt.current = Date.now(); };

  const pages = Math.max(1, Math.ceil(deck.length / PAGE_SIZE));

  const mountPage = useCallback((items: PhoneticItem[], p: number) => {
    setPage(p);
    setCards(items.slice(p * PAGE_SIZE, (p + 1) * PAGE_SIZE).map(newCard));
    setActive(0);
    stageShownAt.current = Date.now();
    setPhase('play');
  }, []);

  useEffect(() => {
    if (!lessonId) {
      setError('没有找到这一节,请返回重新进入。');
      setPhase('error');
      return;
    }
    let alive = true;
    fetchPhoneticLesson(lessonId)
      .then(d => {
        if (!alive) return;
        if (!d.items?.length) {
          setError('这一节还没有题目。');
          setPhase('error');
          return;
        }
        setLesson(d);
        setDeck(d.items);
        mountPage(d.items, 0);
      })
      .catch(() => {
        if (!alive) return;
        setError('题目加载失败,请检查网络后重试。');
        setPhase('error');
      });
    return () => { alive = false; };
  }, [lessonId, mountPage]);

  const card = cards[active] ?? null;
  const updateCard = (i: number, patch: Partial<CardState>) =>
    setCards(prev => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  // 手机矮屏(iPhone SE)上卡片区要滚动: 换到哪张就把哪张滚进来
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  useEffect(() => {
    cardRefs.current[active]?.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
  }, [active, page, reduce]);

  // ---- 键盘输入(都打进当前这张卡)----

  const handleKey = (p: string) => {
    if (!card || card.status !== 'todo' || card.cursor < 0) return;
    const next = card.slots.map((v, i) => (i === card.cursor ? p : v));
    // 下一个空格: 往后找,没有就从头找,都满了光标收起(-1)
    const nx = card.editable.find(i => i > card.cursor && next[i] == null)
      ?? card.editable.find(i => next[i] == null) ?? -1;
    updateCard(active, { slots: next, cursor: nx });
  };

  const handleBackspace = () => {
    if (!card || card.status !== 'todo') return;
    // 光标停在已填的格上就删它,否则删前一个已填的格(填满后退格的常见预期)
    const target = card.cursor >= 0 && card.slots[card.cursor] != null
      ? card.cursor
      : [...card.editable].reverse().find(i => card.slots[i] != null);
    if (target == null) return;
    updateCard(active, {
      slots: card.slots.map((v, i) => (i === target ? null : v)),
      cursor: target,
    });
  };

  const remaining = card ? card.editable.filter(i => card.slots[i] == null).length : 0;

  // ---- 判分 / 揭示 / 换卡 ----

  // 老师给这个词指定了发音(cede 读 seed)就逐字读它,否则按单词读。
  // 发音只在卡片结束后随判分结果下发(提前给等于提示答案)
  const say = useCallback((w: string, tts?: string | null) => {
    (tts ? playAudio(tts, 1, undefined, true) : playAudio(w)).catch(() => {});
  }, [playAudio]);

  /** 下一张还没做完的卡(从 from 往后找,找不到从头找);都做完了返回 -1 */
  const nextOpen = (list: CardState[], from: number) => {
    for (let k = 1; k <= list.length; k++) {
      const j = (from + k) % list.length;
      if (list[j].status !== 'done') return j;
    }
    return -1;
  };

  const submit = async (giveUp = false) => {
    if (!card || checking || card.status !== 'todo') return;
    if (!giveUp && remaining > 0) return;
    if (isAccidentalTap()) return;
    const idx = active;
    const c = card;
    setChecking(true);
    try {
      // 「看答案」= 直接按第二遍交(服务端在 pass>=2 时下发完整答案),
      // 记一次做错的作答 —— 放弃就是放弃,不该在学情里显示成没做过
      const asPass = giveUp ? 2 : c.pass;
      const res = await checkPhoneticItem({
        item_id: c.item.id,
        pass_number: asPass,
        submitted: c.slots,
        duration_ms: Date.now() - c.startTs,
      });
      markStage();
      if (giveUp || res.all_correct || asPass >= 2) {
        const correct = giveUp ? false : res.all_correct;
        const finished: CardState = {
          ...c, status: 'done', cursor: -1, result: giveUp ? { ...res, all_correct: false } : res,
        };
        const list = cards.map((x, j) => (j === idx ? finished : x));
        setCards(list);
        setOutcomes(prev => [...prev, { item: c.item, firstTry: asPass === 1 && correct, correct }]);
        say(c.item.word, res.tts_text);
        // 这张翻过来答案留在原地看得见,光标跳到下一张没做的
        const nx = nextOpen(list, idx);
        if (nx >= 0) setActive(nx);
      } else {
        // 第一遍错: 先把红格给学生看,按钮变成「只填元音再来一遍」
        updateCard(idx, { status: 'judged', result: res, cursor: -1 });
      }
    } catch {
      setError('判分失败,请检查网络后重试。');
      setPhase('error');
    } finally {
      setChecking(false);
    }
  };

  /** 第二遍: 辅音已由服务端回填,只补元音格 */
  const retry = () => {
    if (!card || card.status !== 'judged' || !card.result?.prefill || isAccidentalTap()) return;
    const blanks = card.result.next_blanks;
    updateCard(active, {
      slots: [...card.result.prefill], editable: blanks, cursor: blanks[0] ?? -1,
      result: null, pass: 2, status: 'todo', startTs: Date.now(),
    });
    markStage();
  };

  const allDone = cards.length > 0 && cards.every(c => c.status === 'done');

  const nextPage = () => {
    if (isAccidentalTap()) return;
    if (page + 1 < pages) mountPage(deck, page + 1);
    else { markStage(); setPhase('summary'); }
  };

  /** 当前卡已做完、本组还有没做的: 跳过去 */
  const goNextOpen = () => {
    if (isAccidentalTap()) return;
    const nx = nextOpen(cards, active);
    if (nx >= 0) { setActive(nx); markStage(); }
  };

  /** 开新一轮: 传 items 就只练这些词(错词重练) */
  const startRound = (items: PhoneticItem[]) => {
    // 小结页的按钮落在「看结果」原处,余点会直接把孩子甩进新一轮
    if (isAccidentalTap()) return;
    setDeck(items);
    setOutcomes([]);
    setRound(r => r + 1);
    mountPage(items, 0);
  };

  const selectCard = (i: number) => {
    if (i === active) return;
    setActive(i);
  };

  const wrongItems = useMemo(
    () => outcomes.filter(o => !o.correct).map(o => o.item),
    [outcomes],
  );
  const firstTryCount = outcomes.filter(o => o.firstTry).length;

  /** 底部主按钮这一下该做什么(回车同一个动作) */
  const advance = () => {
    if (allDone) nextPage();
    else if (card?.status === 'judged') retry();
    else if (card?.status === 'done') goNextOpen();
    else if (card?.status === 'todo' && remaining === 0) submit();
  };

  // 物理键盘: 回车 = 主按钮,退格删格,左右键换卡。走 ref 拿最新闭包(与 classify 的 handleSelectRef 同套路)
  const advanceRef = useRef(advance);
  advanceRef.current = advance;
  const backspaceRef = useRef(handleBackspace);
  backspaceRef.current = handleBackspace;
  const moveRef = useRef((d: number) => { void d; });
  moveRef.current = (d: number) => {
    if (cards.length) setActive(a => (a + d + cards.length) % cards.length);
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // e.repeat: 按住回车不放会一路 交卷→下一张→…… 连判好几张,答案一闪而过
      if (e.repeat || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'Backspace') { e.preventDefault(); backspaceRef.current(); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); moveRef.current(1); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); moveRef.current(-1); return; }
      if (e.key !== 'Enter') return;
      e.preventDefault();
      advanceRef.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // ---- 渲染 ----

  if (phase === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <LoaderCircle className="h-8 w-8 animate-spin text-orange-400" />
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6">
        <p className="text-center text-slate-600">{error}</p>
        <button onClick={goBack} className="rounded-lg bg-orange-500 px-5 py-2 text-white">
          返回
        </button>
      </div>
    );
  }

  if (phase === 'summary') {
    const total = outcomes.length;
    const right = outcomes.filter(o => o.correct).length;
    return (
      <div className="min-h-screen bg-gradient-to-b from-orange-50/40 to-white px-5 py-8">
        <div className="mx-auto max-w-md">
          <p className="text-center text-5xl">{wrongItems.length === 0 ? '🎉' : '💪'}</p>
          <h1 className="mt-3 text-center text-xl font-bold text-slate-800">
            {wrongItems.length === 0 ? '这一节全过了' : `过了 ${right} / ${total} 个`}
          </h1>
          <p className="mt-1 text-center text-sm text-slate-500">
            一遍就写对 {firstTryCount} 个{round > 1 ? ` · 第 ${round} 轮` : ''}
          </p>

          {wrongItems.length > 0 && (
            <div className="mt-5 rounded-2xl bg-white p-4 shadow-sm ring-1 ring-slate-100">
              <p className="mb-2 text-xs text-slate-400">这些词还要再练</p>
              <div className="flex flex-wrap gap-2">
                {outcomes.filter(o => !o.correct).map(o => (
                  <span
                    key={o.item.id}
                    className="rounded-lg bg-rose-50 px-2.5 py-1 font-mono text-sm text-rose-600"
                  >
                    {o.item.word}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="mt-6 flex flex-col gap-3">
            {wrongItems.length > 0 && (
              <button
                onClick={() => startRound(wrongItems)}
                className="flex items-center justify-center gap-2 rounded-xl bg-orange-500
                           py-3 text-white transition active:scale-[0.99]"
              >
                <RotateCcw className="h-4 w-4" /> 只练错的 {wrongItems.length} 个
              </button>
            )}
            <button
              onClick={() => lesson && startRound(lesson.items)}
              className="rounded-xl bg-white py-3 text-slate-700 ring-1 ring-slate-200
                         transition active:scale-[0.99]"
            >
              整节再来一遍
            </button>
            <button
              onClick={goBack}
              className="rounded-xl bg-slate-800 py-3 text-white transition active:scale-[0.99]"
            >
              完成
            </button>
          </div>
        </div>
      </div>
    );
  }

  const doneHere = cards.filter(c => c.status === 'done').length;

  // 主按钮(放在键盘最后一行,省出一整条底栏的高度给卡片)
  const primaryBase = `flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-3
                       text-sm font-semibold transition active:scale-[0.98]`;
  const primary = allDone ? (
    <button type="button" onClick={nextPage} className={`${primaryBase} bg-orange-500 text-white`}>
      {page + 1 < pages ? <>下一组 <ChevronRight className="h-4 w-4" /></> : '看结果'}
    </button>
  ) : card?.status === 'judged' ? (
    <button type="button" onClick={retry} className={`${primaryBase} bg-orange-500 text-white`}>
      <RotateCcw className="h-4 w-4 shrink-0" /> <span className="truncate">只填元音再来一遍</span>
    </button>
  ) : card?.status === 'done' ? (
    <button type="button" onClick={goNextOpen} className={`${primaryBase} bg-orange-500 text-white`}>
      下一个 <ChevronRight className="h-4 w-4" />
    </button>
  ) : (
    <button
      type="button"
      onClick={() => submit()}
      disabled={remaining > 0 || checking}
      className={`${primaryBase} bg-orange-500 text-white disabled:bg-slate-200 disabled:text-slate-500`}
    >
      {checking
        ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" />
        : <Check className="h-4 w-4 shrink-0" />}
      <span className="truncate">{remaining > 0 ? `还有 ${remaining} 格` : '看看对不对'}</span>
    </button>
  );

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-gradient-to-b from-orange-50/40 to-white">
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-100
                         bg-white/90 px-3 py-2 backdrop-blur sm:px-4">
        <button onClick={goBack} aria-label="返回" className="rounded-lg p-2 hover:bg-slate-100">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-700">
            {lesson?.title} · 卡片写音标
          </p>
          <p className="text-xs text-slate-500">
            第 {page + 1} / {pages} 组 · 这组做完 {doneHere} / {cards.length}
            {round > 1 && ` · 第 ${round} 轮`}
          </p>
        </div>
        {/* 进度条量的是「判完几张」不是「第几组」,最后一张判完正好走满 */}
        <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-slate-100 sm:w-28">
          <div
            className="h-full rounded-full bg-orange-400 transition-all"
            style={{ width: `${(outcomes.length / Math.max(1, deck.length)) * 100}%` }}
          />
        </div>
      </header>

      {/* 9 张卡: 三列三行。矮屏放不下时只有这块滚,键盘和交卷键一直在 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 sm:px-4 sm:py-3">
        <div className="mx-auto grid w-full max-w-3xl grid-cols-3 gap-1.5 sm:gap-2 md:gap-3">
          {cards.map((c, i) => (
            <div key={`${page}-${c.item.id}`} ref={el => { cardRefs.current[i] = el; }}>
              <FlashCard
                c={c}
                active={i === active}
                reduce={!!reduce}
                onSelect={() => selectCard(i)}
                onSlotClick={s => {
                  selectCard(i);
                  if (c.status === 'todo') updateCard(i, { cursor: s });
                }}
                onReplay={() => say(c.item.word, c.result?.tts_text)}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="shrink-0 border-t border-slate-100 bg-white/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]
                      pt-2 backdrop-blur sm:px-4">
        <div className="mx-auto w-full max-w-3xl">
          <IpaKeyboard
            onKey={handleKey}
            onBackspace={handleBackspace}
            onClear={() => {}}
            full={!card || card.cursor < 0}
            disabled={!card || card.status !== 'todo'}
            highlight={lesson?.highlight}
            dense
            // 电脑上一行 14 个键,省出高度给卡片
            gridClassName="grid-cols-7 md:grid-cols-[repeat(14,minmax(0,1fr))]"
            action={
              <>
                <button
                  type="button"
                  onClick={() => submit(true)}
                  disabled={!card || card.status !== 'todo' || checking}
                  className="flex h-10 shrink-0 items-center gap-1 rounded-lg bg-white px-2.5 text-sm
                             text-slate-700 ring-1 ring-slate-300 transition active:scale-95
                             hover:bg-slate-50 disabled:opacity-40"
                >
                  <Eye className="h-4 w-4" aria-hidden />
                  <span className="hidden min-[400px]:inline">不会,</span>看答案
                </button>
                {primary}
              </>
            }
          />
        </div>
      </div>
    </div>
  );
}

/** 一张卡: 在填 / 第一遍错了 / 结束(翻过来露出答案) */
function FlashCard({ c, active, reduce, onSelect, onSlotClick, onReplay }: {
  c: CardState;
  active: boolean;
  reduce: boolean;
  onSelect: () => void;
  onSlotClick: (i: number) => void;
  onReplay: () => void;
}) {
  // 手机上一张卡约 115px 宽、四五十像素高的空间要放单词 + 释义 + 格子,所以字和间距都收一档
  const shell = 'relative flex h-full min-h-[5.25rem] w-full flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 md:min-h-[7.25rem] md:gap-1.5 md:rounded-2xl md:px-1.5 md:py-2';

  if (c.status === 'done') {
    const right = !!c.result?.all_correct;
    const answer = c.result?.answer_tokens
      ? `[${c.result.answer_tokens.join('')}]`
      : c.result?.answer_display ?? '';
    return (
      // 翻面: 只在结束那一下转一次,减少动态效果时不转
      <motion.div
        initial={reduce ? false : { rotateY: 90, opacity: 0.6 }}
        animate={{ rotateY: 0, opacity: 1 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
        onClick={onSelect}
        className={`${shell} cursor-pointer text-white shadow-md ${active ? 'ring-2 ring-offset-2 ring-[#FF6B35]' : ''}`}
        style={{
          background: right
            ? 'linear-gradient(135deg,#34d399,#059669)'
            : 'linear-gradient(135deg,#fb923c,#f43f5e)',
        }}
      >
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onReplay(); }}
          aria-label={`再听一遍 ${c.item.word}`}
          className="absolute right-0.5 top-0.5 rounded-full bg-white/25 p-1 transition hover:bg-white/35 active:scale-95 md:right-1.5 md:top-1.5 md:p-1.5"
        >
          <Volume2 className="h-3.5 w-3.5 md:h-4 md:w-4" />
        </button>
        <p className="text-[11px] leading-none text-white/90 md:text-xs">
          {right ? (c.pass === 1 ? '🎉 一遍对' : '👍 第二遍对') : '📖 答案'}
        </p>
        <p className="max-w-full break-all px-4 text-center font-mono text-base font-bold leading-tight md:px-6 md:text-xl">
          {c.item.word}
        </p>
        {/* 彩色音标是浅底浅字,放在饱和渐变上必须垫白底板;板子自己是 flex + shrink-0,
            否则 overflow-x-auto 会把它压成一条白缝(10-04 卡片版踩过) */}
        <span className="flex max-w-full shrink-0 items-center justify-center overflow-x-auto rounded-lg bg-white/95 px-1 py-0.5 md:rounded-xl md:px-2 md:py-1">
          <ColoredPhonetic phonetic={answer} size="sm" delimiter="none" />
        </span>
      </motion.div>
    );
  }

  const judged = c.status === 'judged';
  return (
    <div
      onClick={onSelect}
      className={[
        shell, 'cursor-pointer bg-white transition',
        active
          ? 'shadow-md ring-2 ring-[#FF6B35]'
          : judged ? 'ring-1 ring-rose-300' : 'ring-1 ring-slate-200 hover:ring-orange-300',
      ].join(' ')}
    >
      <p className="max-w-full break-all text-center font-mono text-lg font-bold leading-tight text-slate-800 md:text-2xl">
        {c.item.word}
      </p>
      {c.item.meaning && (
        <p className="max-w-full truncate px-0.5 text-[11px] leading-none text-slate-500 md:text-xs">{c.item.meaning}</p>
      )}
      <div className="max-w-full overflow-x-auto">
        <AnswerSlots
          slots={c.slots}
          editable={c.editable}
          cursor={active && c.status === 'todo' ? c.cursor : -1}
          correct={c.result?.per_slot}
          size={slotSize(c.slots.length)}
          onSlotClick={onSlotClick}
        />
      </div>
      {judged ? (
        <p className="text-center text-[11px] leading-tight text-rose-600 md:text-xs">
          错 {c.result?.wrong_indexes.length} 个音<span className="hidden md:inline"> · 再来一遍只填元音</span>
        </p>
      ) : c.pass === 2 ? (
        <p className="text-center text-[11px] leading-tight text-orange-700 md:text-xs">只填元音</p>
      ) : null}
    </div>
  );
}
