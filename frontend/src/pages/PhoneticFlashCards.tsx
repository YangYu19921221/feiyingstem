/**
 * 看单词写音标 —— 卡片版
 *
 * 与整页版(PhoneticFillBlank)是两种练法,不是替换:
 *   整页版 = 纸书那一页,20 个词铺开,同韵词排在一起让规律浮出来,填完一次交卷
 *   卡片版 = 一次只对一个词,填完当场判、当场揭示答案 + 发音,错了立刻重来
 * 卡片版适合手机、适合零散时间、适合刚学完一节想过一遍;整页版适合当作业和考核。
 *
 * 两遍机制沿用整页版的教学口径(服务端 _grade_one 同一份判分):
 * 第一遍全空;错了第二遍只挖元音格,辅音由服务端回填 —— 元音是拼读教学点,辅音送分。
 *
 * ⚠️ 答案不在前端。判分走 POST /check,完整答案只在「这张卡已结束」时由服务端下发。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
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
  fetchPhoneticLesson, checkPhoneticItem,
  type PhoneticLesson, type PhoneticItem, type CheckResult,
} from '../api/phoneticPractice';

type Phase = 'loading' | 'error' | 'front' | 'judged' | 'back' | 'summary';

/** 一张卡的最终结果。firstTry 用来算"一遍就对"的比例,是这页真正的学习指标 */
interface CardOutcome {
  item: PhoneticItem;
  firstTry: boolean;
  correct: boolean;
}

/** 答案格档位:8 个音素用 lg 会在手机上撑出横向滚动 */
const slotSize = (n: number): 'compact' | 'md' | 'lg' =>
  n <= 4 ? 'lg' : n <= 6 ? 'md' : 'compact';

export default function PhoneticFlashCards() {
  const { lessonId } = useParams<{ lessonId: string }>();
  const goBack = useGoBack('/student/phonetics/textbook');
  const { playAudio } = useAudio();

  const [lesson, setLesson] = useState<PhoneticLesson | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [error, setError] = useState('');

  /** 本轮要过的卡(第二轮只放上一轮错的词),不洗牌:同韵词相邻本身就是教学设计 */
  const [deck, setDeck] = useState<PhoneticItem[]>([]);
  const [idx, setIdx] = useState(0);
  const [round, setRound] = useState(1);
  const [outcomes, setOutcomes] = useState<CardOutcome[]>([]);

  // 当前卡的作答态
  const [pass, setPass] = useState(1);
  const [slots, setSlots] = useState<(string | null)[]>([]);
  const [editable, setEditable] = useState<number[]>([]);
  const [cursor, setCursor] = useState(0);
  const [result, setResult] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [flipped, setFlipped] = useState(false);

  const startTsRef = useRef(0);
  // 音标闯关此前一秒都不进学习日历;卡片版走完一轮结算,中途退出靠卸载补尾巴
  useStudyTimeReporter(phase === 'summary');

  // ---- 防误跳(口径与 classify/GroupExamPhase 的 isAccidentalTap 一致)----
  // 卡片版比分类更容易踩:「看看对不对」和「下一张」**是同一个屏幕位置**(底栏),
  // 判完卡片一翻,孩子习惯性的第二下正落在「下一张」上 —— 答案一闪而过就跳走了,
  // 而"当场看见答案"正是这个模式的全部价值。
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

  /** 落在换阶段余点/布局位移窗口内的点击不算 —— 被吃掉再点一下就行,比跳掉答案伤害小 */
  const isAccidentalTap = () =>
    Date.now() - stageShownAt.current < 350 ||
    Date.now() - lastViewportShiftAt.current < 350;

  /** 每次换阶段(正面↔判完↔背面)都要重置余点窗口 */
  const enterPhase = useCallback((p: Phase) => {
    stageShownAt.current = Date.now();
    setPhase(p);
  }, []);

  const card = deck[idx] ?? null;

  /** 装载一张卡:回到第一遍全空 */
  const mountCard = useCallback((it: PhoneticItem) => {
    setPass(1);
    setSlots(Array(it.slot_count).fill(null));
    setEditable(Array.from({ length: it.slot_count }, (_, i) => i));
    setCursor(0);
    setResult(null);
    setFlipped(false);
    enterPhase('front');
    startTsRef.current = Date.now();
  }, [enterPhase]);

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
        mountCard(d.items[0]);
      })
      .catch(() => {
        if (!alive) return;
        setError('题目加载失败,请检查网络后重试。');
        setPhase('error');
      });
    return () => { alive = false; };
  }, [lessonId, mountCard]);

  // ---- 键盘输入 ----

  const handleKey = (p: string) => {
    if (phase !== 'front' || cursor < 0) return;
    setSlots(prev => {
      const next = prev.map((v, i) => (i === cursor ? p : v));
      // 下一个空格:本卡内找,没有就把光标收起(-1 = 填满)
      const nx = editable.find(i => i > cursor && next[i] == null)
        ?? editable.find(i => next[i] == null) ?? -1;
      setCursor(nx);
      return next;
    });
  };

  const handleBackspace = useCallback(() => {
    if (phase !== 'front') return;
    setSlots(prev => {
      // 光标停在已填的格上就删它,否则删前一个已填的格(填满后退格的常见预期)
      const target = cursor >= 0 && prev[cursor] != null
        ? cursor
        : [...editable].reverse().find(i => prev[i] != null);
      if (target == null) return prev;
      setCursor(target);
      return prev.map((v, i) => (i === target ? null : v));
    });
  }, [phase, cursor, editable]);

  const handleClear = () => {
    if (phase !== 'front') return;
    setSlots(prev => prev.map((v, i) => (editable.includes(i) ? null : v)));
    setCursor(editable[0] ?? -1);
  };

  const remaining = useMemo(
    () => editable.filter(i => slots[i] == null).length,
    [editable, slots],
  );

  // ---- 判分 / 翻面 / 下一张 ----

  const say = useCallback((w: string) => { playAudio(w).catch(() => {}); }, [playAudio]);

  /** 收尾一张卡:记成绩、翻到背面揭示答案并读一遍 */
  const finish = useCallback((it: PhoneticItem, res: CheckResult, firstTry: boolean) => {
    setOutcomes(prev => [...prev, { item: it, firstTry, correct: res.all_correct }]);
    setResult(res);
    enterPhase('back');
    setFlipped(true);
    say(it.word);
  }, [say, enterPhase]);

  const submit = async (giveUp = false) => {
    if (!card || checking || phase !== 'front') return;
    if (!giveUp && remaining > 0) return;
    // 刚进正面/键盘刚收起时的余点不算交卷:第二遍那下「只填元音再来一遍」
    // 落点也在底栏同一处,不挡就会拿着空元音格直接交上去
    if (isAccidentalTap()) return;
    setChecking(true);
    try {
      // 「看答案」= 直接按第二遍交(服务端在 pass>=2 时下发完整答案),
      // 记一次做错的作答 —— 放弃就是放弃,不该在学情里显示成没做过
      const asPass = giveUp ? 2 : pass;
      const res = await checkPhoneticItem({
        item_id: card.id,
        pass_number: asPass,
        submitted: slots,
        duration_ms: Date.now() - startTsRef.current,
      });
      if (giveUp) {
        finish(card, { ...res, all_correct: false }, false);
      } else if (res.all_correct || asPass >= 2) {
        finish(card, res, asPass === 1 && res.all_correct);
      } else {
        // 第一遍错:先把红格给学生看,按钮变成「只填元音再来一遍」
        setResult(res);
        enterPhase('judged');
      }
    } catch {
      setError('判分失败,请检查网络后重试。');
      setPhase('error');
    } finally {
      setChecking(false);
    }
  };

  /** 第二遍:辅音已由服务端回填,只补元音格 */
  const retry = useCallback(() => {
    if (!result?.prefill || isAccidentalTap()) return;
    const blanks = result.next_blanks;
    setSlots([...result.prefill]);
    setEditable(blanks);
    setCursor(blanks[0] ?? -1);
    setResult(null);
    setPass(2);
    enterPhase('front');
    startTsRef.current = Date.now();
  }, [result, enterPhase]);

  const next = useCallback(() => {
    // ⚠️ 这里是最关键的一道拦:「下一张」和「看看对不对」同一个屏幕位置,
    // 判完一翻,孩子的第二下正落在这儿 —— 挡住 350ms,答案才看得见
    if (isAccidentalTap()) return;
    if (idx + 1 < deck.length) {
      setIdx(idx + 1);
      mountCard(deck[idx + 1]);
    } else {
      enterPhase('summary');
    }
  }, [idx, deck, mountCard, enterPhase]);

  /** 开新一轮:传 items 就只练这些词(错词重练) */
  const startRound = (items: PhoneticItem[]) => {
    // 小结页的三个按钮同样落在「看结果」原处,余点会直接把孩子甩进新一轮
    if (isAccidentalTap()) return;
    setDeck(items);
    setIdx(0);
    setOutcomes([]);
    setRound(r => r + 1);
    mountCard(items[0]);
  };

  const wrongItems = useMemo(
    () => outcomes.filter(o => !o.correct).map(o => o.item),
    [outcomes],
  );
  const firstTryCount = outcomes.filter(o => o.firstTry).length;

  // 物理键盘:回车推进(交卷/再来一遍/下一张),退格删格。桌面上手不用离开键盘。
  // 走 ref 拿最新闭包(与 classify 的 handleSelectRef 同套路):把 phase/remaining
  // 列进依赖会每渲染重挂监听,不列又会读到旧值 —— 判完那下回车会拿旧 phase 再交一遍
  const advanceRef = useRef<() => void>(() => {});
  advanceRef.current = () => {
    if (phase === 'front' && remaining === 0) submit();
    else if (phase === 'judged') retry();
    else if (phase === 'back') next();
  };
  const backspaceRef = useRef(handleBackspace);
  backspaceRef.current = handleBackspace;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // e.repeat: 按住回车不放会一路 交卷→背面→下一张→…… 连翻好几张,
      // 答案全部一闪而过(与 isAccidentalTap 挡的是同一类"不是本意"的输入)
      if (e.repeat || e.isComposing || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'Backspace') { e.preventDefault(); backspaceRef.current(); return; }
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
  const size = slotSize(card?.slot_count ?? 4);
  const answerText = result?.answer_tokens
    ? `[${result.answer_tokens.join('')}]`
    : result?.answer_display ?? '';

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gradient-to-b
                    from-orange-50/40 to-white">
      <header className="flex shrink-0 items-center gap-3 border-b border-slate-100
                         bg-white/90 px-4 py-3 backdrop-blur">
        <button onClick={goBack} aria-label="返回" className="rounded-lg p-2 hover:bg-slate-100">
          <ArrowLeft className="h-5 w-5 text-slate-600" />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-slate-700">
            {lesson?.title} · 卡片写音标
          </p>
          <p className="text-xs text-slate-400">
            第 {idx + 1} / {deck.length} 张
            {pass === 2 && phase === 'front' && ' · 第二遍,只填元音'}
            {round > 1 && ` · 第 ${round} 轮`}
          </p>
        </div>
        {/* 进度条:一眼看出还剩多少,比只给数字更有推进感。
            量的是「判完几张」(outcomes)不是「第几张」(idx) —— 用 idx 的话
            最后一张判完了进度条还停在 19/20,永远走不满 */}
        <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-slate-100 sm:w-28">
          <div
            className="h-full rounded-full bg-orange-400 transition-all"
            style={{ width: `${(outcomes.length / Math.max(1, deck.length)) * 100}%` }}
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3">
        {/* 3D 翻转卡:正面写音标,背面揭示答案 + 发音 */}
        <div className="mx-auto w-full max-w-md" style={{ perspective: 1000 }}>
          {/* 卡片高度按视口收缩:固定 19rem 时 1366×768 的笔记本上「看看对不对」
              会被挤到折叠线以下(卡 304px + 键盘 340px + 按钮已经超过一屏),
              孩子看不见交卷按钮。clamp 让矮屏缩到 13rem、高屏仍是 19rem */}
          <motion.div
            className="relative h-[clamp(15rem,31vh,20rem)] w-full"
            animate={{ rotateY: flipped ? 180 : 0 }}
            transition={{ duration: 0.5, type: 'spring', bounce: 0.18 }}
            style={{ transformStyle: 'preserve-3d' }}
          >
            {/* 正面 */}
            <div
              className="absolute flex h-full w-full flex-col items-center justify-center gap-4
                         rounded-3xl border-2 border-orange-200 bg-white p-5 shadow-lg"
              aria-hidden={flipped}
              style={{ backfaceVisibility: 'hidden' }}
            >
              <div className="text-center">
                <h1
                  className="break-all font-mono font-bold leading-tight text-slate-800"
                  style={{ fontSize: 'clamp(1.75rem, 9vw, 3rem)' }}
                >
                  {card?.word}
                </h1>
                {card?.meaning && (
                  <p className="mt-1.5 text-sm text-slate-500">{card.meaning}</p>
                )}
              </div>

              <div className="max-w-full overflow-x-auto px-1">
                <AnswerSlots
                  slots={slots}
                  editable={editable}
                  cursor={phase === 'front' ? cursor : -1}
                  correct={result?.per_slot}
                  size={size}
                  onSlotClick={i => setCursor(i)}
                />
              </div>

              {phase === 'judged' ? (
                <p className="text-center text-sm text-rose-500">
                  错 {result?.wrong_indexes.length} 个音
                  <span className="mt-0.5 block text-xs text-slate-400">
                    再来一遍 · 这次只填元音
                  </span>
                </p>
              ) : (
                <p className="text-center text-xs text-slate-400">
                  {remaining > 0 ? `点下面的音标键填空,还剩 ${remaining} 格` : '填好了,看看对不对'}
                </p>
              )}
            </div>

            {/* 背面。⚠️ 没翻过来时**不渲染内容**:背面在 DOM 里一直存在,
                只是被 backface-visibility 藏住 —— 屏幕阅读器照读,
                学生还在写就先被念出「正确答案是…」。aria-hidden 也一并加上 */}
            <div
              className="absolute flex h-full w-full flex-col items-center justify-center gap-3
                         rounded-3xl p-5 text-white shadow-lg"
              aria-hidden={!flipped}
              style={{
                backfaceVisibility: 'hidden',
                transform: 'rotateY(180deg)',
                background: result?.all_correct
                  ? 'linear-gradient(135deg,#34d399,#059669)'
                  : 'linear-gradient(135deg,#fb923c,#f43f5e)',
              }}
            >
              {flipped && (
                <>
                  {/* emoji 与文案并成一行:彩色音标板比原来那行纯文字高,
                      背面五行挤不进卡片固定高度,省下的这 48px 给音标 */}
                  <p className="text-sm text-white/90">
                    <span className="mr-1.5 text-xl align-middle">
                      {result?.all_correct ? (pass === 1 ? '🎉' : '👍') : '📖'}
                    </span>
                    {result?.all_correct
                      ? (pass === 1 ? '一遍就写对了' : '第二遍写对了')
                      : '正确答案是'}
                  </p>
                  <p className="break-all text-center font-mono text-2xl font-bold">
                    {card?.word}
                  </p>
                  {/* 彩色音标(与单词卡/分类各阶段同一个 ColoredPhonetic:一个音节一种底色、
                      元音大而深、辅音小而浅、重音标在音节左上)。
                      ⚠️ 那套配色是 bg-*-50 + text-*-600 的浅底浅字,直接放在饱和渐变上
                      会糊成一片 —— 必须垫一层白底板;定界符用方括号跟纸书一致 */}
                  {/* ⚠️ 白底板必须自己是 flex 容器: ColoredPhonetic 的根是 inline-flex,
                      当成行内盒放进来时行高只算它基线以下那截 —— 实测板子塌成 16px
                      而内容有 54px,音标被压成一条白缝 */}
                  {/* shrink-0 是必须的: overflow-x-auto 会把这一项的自动最小尺寸算成 0
                      (CSS 规定 min-height:auto 只在 overflow 为 visible 时生效),
                      背面内容一超高,它就是唯一被压扁的那个 —— 实测塌成 16px 只剩一条白缝 */}
                  <span className="flex max-w-full shrink-0 items-center justify-center
                                   overflow-x-auto rounded-2xl bg-white/95 px-3 py-1.5 shadow-sm">
                    <ColoredPhonetic
                      phonetic={answerText}
                      size={(card?.slot_count ?? 3) <= 3 ? 'lg' : 'md'}
                      delimiter="bracket"
                    />
                  </span>
                  <button
                    onClick={() => card && say(card.word)}
                    className="flex items-center gap-2 rounded-full bg-white/25 px-4 py-2
                               text-sm backdrop-blur transition active:scale-95 hover:bg-white/35"
                  >
                    <Volume2 className="h-4 w-4" /> 再听一遍
                  </button>
                </>
              )}
            </div>
          </motion.div>
        </div>

        {/* 键盘只在正面出现 */}
        {(phase === 'front' || phase === 'judged') && (
          <div className="mx-auto mt-3 w-full max-w-md">
            <IpaKeyboard
              onKey={handleKey}
              onBackspace={handleBackspace}
              onClear={handleClear}
              full={cursor < 0}
              disabled={phase === 'judged'}
              highlight={lesson?.highlight}
              clearLabel="清空"
              action={
                <button
                  type="button"
                  onClick={() => submit(true)}
                  disabled={phase === 'judged' || checking}
                  className="flex items-center gap-1 rounded-md bg-white px-3 py-1.5 text-xs
                             text-slate-400 ring-1 ring-slate-200 transition active:scale-95
                             hover:bg-slate-100 disabled:opacity-40"
                >
                  <Eye className="h-3.5 w-3.5" /> 不会,看答案
                </button>
              }
            />
          </div>
        )}
      </div>

      {/* 主操作固定在底部:手机上键盘比一屏高,按钮跟在键盘后面就要滑一下才点得到 ——
          填满了却找不到「看看对不对」是最容易卡住孩子的地方。三个阶段共用这一个位置 */}
      <div className="shrink-0 border-t border-slate-100 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto w-full max-w-md">
          <AnimatePresence mode="wait">
            {phase === 'back' ? (
              <motion.button
                key="next"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={next}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500
                           py-3.5 text-white transition active:scale-[0.99]"
              >
                {idx + 1 < deck.length ? <>下一张 <ChevronRight className="h-4 w-4" /></> : '看结果'}
              </motion.button>
            ) : phase === 'judged' ? (
              <motion.button
                key="retry"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={retry}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-orange-500
                           py-3.5 text-white transition active:scale-[0.99]"
              >
                <RotateCcw className="h-4 w-4" /> 只填元音再来一遍
              </motion.button>
            ) : (
              <motion.button
                key="submit"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                onClick={() => submit()}
                disabled={remaining > 0 || checking}
                className="flex w-full items-center justify-center gap-2 rounded-xl
                           bg-orange-500 py-3.5 text-white transition active:scale-[0.99]
                           disabled:bg-slate-200 disabled:text-slate-400"
              >
                {checking
                  ? <LoaderCircle className="h-4 w-4 animate-spin" />
                  : <Check className="h-4 w-4" />}
                {remaining > 0 ? `还有 ${remaining} 格没填` : '看看对不对'}
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
