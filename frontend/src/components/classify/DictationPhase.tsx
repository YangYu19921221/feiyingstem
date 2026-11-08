/**
 * 听写阶段（循环模式）
 * 拼错显示正确答案，一轮结束后错词再来
 * 只有首次拼对才算通过，用于错题集记录
 *
 * 「卡住了吗」(2026-10-31): 第一次听写这个词,STUCK_MS 还没交、且 QUIET_MS 没打过字
 * → 卡片上问一句,给「再听一遍 / 不会,看答案」。发呆提醒只看有没有操作,
 * 孩子隔一会儿动下鼠标就一直算「在学」;这里看的是「有没有进展」。
 * 每个词第一次作答的真实用时(切出页面的时间不算)随结果带出去,卡住过的词经 onStuck 上报。
 *
 * 界面(2026-11-08 重做): 配图 + 喇叭按钮章 + 字母格。
 * 配图里画着单词(下面三成),听写时只露出上面 62%(全库量过单词最高在 70% 往下,见 index.css「分类记忆 · 听写」);
 * 交卷后图往上滑,露出画着的词。图只在分类模式下发,单独的听写练习没有图,就是一个大喇叭。
 */
import { Fragment, useState, useEffect, useRef, useCallback } from 'react';
import { posMeaning } from '../../utils/wordMeaning';
import { motion, AnimatePresence } from 'framer-motion';
import type { WordData } from '../../api/progress';
import ColoredPhonetic from '../ColoredPhonetic';
import ColoredWord from '../ColoredWord';
import { normalizeAnswer } from '../../utils/normalizeAnswer';
import { imeSafeInputProps } from '../../utils/noSuggestInput';
import SpeakerButton, { SpeakerGlyph } from './SpeakerButton';
import { isDictationArtSafe } from '../../data/dictationArtUnsafe';


export interface DictationResult {
  wordId: number;
  word: string;
  userInput: string;
  isCorrect: boolean;  // 首次是否拼对
  /** 首次作答用时(毫秒,不含切出页面的时间);没作答过(断点恢复前的旧结果)为空 */
  ms?: number;
  /** 首次作答前问过「卡住了吗」 */
  stuck?: boolean;
}

export type StuckOutcome = 'correct' | 'wrong' | 'gave_up';

/** 多久没交算卡住 / 最近多久没打字(还在打字说明在想,不打断) */
export const STUCK_MS = 40_000;
export const QUIET_MS = 15_000;

interface DictationPhaseProps {
  words: WordData[];
  onComplete: (results: DictationResult[]) => void;
  playAudioSlow: (word: string, wordId?: number) => void;
  /** 拼错后订正需连续正确几遍才放行。默认 3(正常学习强化记忆);
   *  复习模式传 1,拼错订正 1 遍即过,不再重复抄。 */
  copyRequired?: number;
  /** 卡住过的词第一次作答后调一次(单元复习里的二次听写不传,不记) */
  onStuck?: (info: { wordId: number; ms: number; outcome: StuckOutcome }) => void;
}

export default function DictationPhase({
  words,
  onComplete,
  playAudioSlow,
  copyRequired = 3,
  onStuck,
}: DictationPhaseProps) {
  const [roundWords, setRoundWords] = useState<WordData[]>(words);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [round, setRound] = useState(1);
  const [userInput, setUserInput] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [isCorrect, setIsCorrect] = useState(false);
  // 错误后需要重新输入正确答案 - 连续 copyRequired 遍正确才放行(默认3强化记忆,复习模式传1)
  const [retryMode, setRetryMode] = useState(false);
  const [retryInput, setRetryInput] = useState('');
  const [retryPassed, setRetryPassed] = useState(false);
  const [copyDoneCount, setCopyDoneCount] = useState(0);
  const COPY_REQUIRED = copyRequired;
  // 只记录首次尝试结果
  const [firstAttemptResults, setFirstAttemptResults] = useState<Map<number, boolean>>(new Map());
  // 首次答错时的真实输入(拼写错误模式诊断的数据源——之前结果里 userInput 写死成
  // 正确拼写,整条诊断链对真实用户是死的)
  const firstWrongInputsRef = useRef<Map<number, string>>(new Map());
  const [roundErrorWords, setRoundErrorWords] = useState<WordData[]>([]);
  const [showRoundSummary, setShowRoundSummary] = useState(false);
  const [roundCorrectCount, setRoundCorrectCount] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  // 这个词第一次作答的计时: 出现时刻、切出页面累计的时间、最近一次打字
  const shownAtRef = useRef(Date.now());
  const hiddenMsRef = useRef(0);
  const hiddenSinceRef = useRef<number | null>(null);
  const lastTypeAtRef = useRef(Date.now());
  const firstMsRef = useRef<Map<number, number>>(new Map());
  const stuckIdsRef = useRef<Set<number>>(new Set());
  const [stuckAsk, setStuckAsk] = useState(false);
  const onStuckRef = useRef(onStuck);
  onStuckRef.current = onStuck;
  const elapsedMs = () => {
    const now = Date.now();
    const hiddenNow = hiddenSinceRef.current !== null ? now - hiddenSinceRef.current : 0;
    return Math.max(0, now - shownAtRef.current - hiddenMsRef.current - hiddenNow);
  };

  const currentWord = roundWords[currentIndex];
  const wordLengthWithSpaces = currentWord?.word.length || 0;

  // 配图: 只有分类模式下发(单独的听写练习拿不到)。图里画着单词的少数几张(单词画在了上半截)不用,
  // 名单见 data/dictationArtUnsafe;背景图没有 onError,先用 Image 试着取一下,取不到就不显示
  const [brokenArt, setBrokenArt] = useState<Set<string>>(() => new Set());
  const candidateArt = currentWord?.image_url && isDictationArtSafe(currentWord.image_url) ? currentWord.image_url : null;
  const [loadedArt, setLoadedArt] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (!candidateArt || loadedArt.has(candidateArt) || brokenArt.has(candidateArt)) return;
    const im = new Image();
    im.onload = () => setLoadedArt(prev => new Set(prev).add(candidateArt));
    im.onerror = () => setBrokenArt(prev => new Set(prev).add(candidateArt));
    im.src = candidateArt;
  }, [candidateArt, loadedArt, brokenArt]);
  // 没取回来之前先按有图排版(占位底色),免得取回来时整张卡往下一跳;取失败才退回声音台
  const artUrl = candidateArt && !brokenArt.has(candidateArt) ? candidateArt : null;
  const nextArt = roundWords[currentIndex + 1]?.image_url;
  useEffect(() => {
    if (!nextArt) return;
    const im = new Image();
    im.src = nextArt;
  }, [nextArt]);

  // 自动播放发音 (含 retry 抄写阶段每次状态变化都重新播一次, 让学生听不止 1 遍)
  useEffect(() => {
    if (!currentWord || showRoundSummary) return;
    // 已经抄完 3 遍, 准备进入下一题, 不再播
    if (retryMode && retryPassed) return;
    const t = setTimeout(() => {
      playAudioSlow(currentWord.word, currentWord.id);
    }, 500);
    setTimeout(() => inputRef.current?.focus(), 600);
    return () => clearTimeout(t);
  }, [currentIndex, currentWord, playAudioSlow, round, showRoundSummary, retryMode, copyDoneCount, retryPassed]);

  // 换词重新计时
  useEffect(() => {
    const now = Date.now();
    shownAtRef.current = now;
    lastTypeAtRef.current = now;
    hiddenMsRef.current = 0;
    hiddenSinceRef.current = document.hidden ? now : null;
    setStuckAsk(false);
  }, [currentIndex, round]);

  // 切出页面的时间不算进用时(那段由切屏提醒管)
  useEffect(() => {
    const onVis = () => {
      const now = Date.now();
      if (document.hidden) {
        if (hiddenSinceRef.current === null) hiddenSinceRef.current = now;
      } else if (hiddenSinceRef.current !== null) {
        hiddenMsRef.current += now - hiddenSinceRef.current;
        hiddenSinceRef.current = null;
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // 第一次听写这个词: 想了很久还没交、最近也没在打字 → 问一句「卡住了吗」(每个词只问一次)
  const firstTry = !!currentWord && !firstAttemptResults.has(currentWord.id);
  useEffect(() => {
    if (!currentWord || submitted || showRoundSummary || !firstTry || stuckAsk) return;
    if (stuckIdsRef.current.has(currentWord.id)) return;
    const id = currentWord.id;
    const timer = setInterval(() => {
      if (document.hidden) return;
      if (elapsedMs() >= STUCK_MS && Date.now() - lastTypeAtRef.current >= QUIET_MS) {
        stuckIdsRef.current.add(id);
        setStuckAsk(true);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [currentWord, submitted, showRoundSummary, firstTry, stuckAsk]);

  /** 第一次作答落定: 记用时;问过「卡住了吗」的词上报一次 */
  const settleFirstAttempt = (wordId: number, outcome: StuckOutcome) => {
    if (firstMsRef.current.has(wordId)) return;
    const ms = elapsedMs();
    firstMsRef.current.set(wordId, ms);
    if (stuckIdsRef.current.has(wordId)) onStuckRef.current?.({ wordId, ms, outcome });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (retryMode) {
      setRetryInput(e.target.value.slice(0, wordLengthWithSpaces));
      return;
    }
    if (submitted) return;
    lastTypeAtRef.current = Date.now();
    setStuckAsk(false);  // 开始写了就不挡着
    setUserInput(e.target.value.slice(0, wordLengthWithSpaces));
  };

  const handleSubmit = useCallback(() => {
    if (submitted || !currentWord || userInput.length === 0) return;

    // 校验：完全一致（包括空格位置和数量）。短语 "many kinds of" 必须原样输入，
    // 不能去除中间空格；也不容忍首尾空格误输入。
    const correct = normalizeAnswer(userInput) === normalizeAnswer(currentWord.word);
    setIsCorrect(correct);
    setSubmitted(true);

    // 记录首次结果（只记一次）
    setFirstAttemptResults(prev => {
      if (prev.has(currentWord.id)) return prev;
      const next = new Map(prev);
      next.set(currentWord.id, correct);
      return next;
    });
    // 首次答错的实际输入(只记一次,与首次结果同口径)
    if (!correct && !firstWrongInputsRef.current.has(currentWord.id)) {
      firstWrongInputsRef.current.set(currentWord.id, userInput.trim());
    }
    settleFirstAttempt(currentWord.id, correct ? 'correct' : 'wrong');
    setStuckAsk(false);

    if (!correct) {
      setRoundErrorWords(prev => {
        if (prev.some(w => w.id === currentWord.id)) return prev;
        return [...prev, currentWord];
      });
      setRetryMode(true);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [submitted, currentWord, userInput]);

  const handleRoundEnd = useCallback(() => {
    if (roundErrorWords.length === 0) {
      // 全部通过，构建结果（用首次记录;答错过的词带首次真实输入,供拼写诊断)
      const results: DictationResult[] = words.map(w => ({
        wordId: w.id,
        word: w.word,
        userInput: firstWrongInputsRef.current.get(w.id) ?? w.word,
        isCorrect: firstAttemptResults.get(w.id) ?? true,
        ms: firstMsRef.current.get(w.id),
        stuck: stuckIdsRef.current.has(w.id) || undefined,
      }));
      onComplete(results);
    } else {
      setRoundCorrectCount(roundWords.length - roundErrorWords.length);
      setShowRoundSummary(true);
      setTimeout(() => {
        setRound(prev => prev + 1);
        setRoundWords([...roundErrorWords]);
        setRoundErrorWords([]);
        setCurrentIndex(0);
        setUserInput('');
        setSubmitted(false);
        setIsCorrect(false);
        setRetryMode(false);
        setRetryInput('');
        setRetryPassed(false);
        setCopyDoneCount(0);
        setShowRoundSummary(false);
      }, 2500);
    }
  }, [roundErrorWords, roundWords.length, words, firstAttemptResults, onComplete]);

  const handleNext = useCallback(() => {
    if (currentIndex + 1 >= roundWords.length) {
      setTimeout(() => handleRoundEnd(), 50);
    } else {
      setCurrentIndex(currentIndex + 1);
      setUserInput('');
      setSubmitted(false);
      setIsCorrect(false);
      setRetryMode(false);
      setRetryInput('');
      setRetryPassed(false);
      setCopyDoneCount(0);
    }
  }, [currentIndex, roundWords.length, handleRoundEnd]);

  const handleRetrySubmit = useCallback(() => {
    if (!currentWord || retryInput.length === 0) return;
    if (normalizeAnswer(retryInput) === normalizeAnswer(currentWord.word)) {
      const next = copyDoneCount + 1;
      if (next >= COPY_REQUIRED) {
        setCopyDoneCount(next);
        setRetryPassed(true);
      } else {
        setCopyDoneCount(next);
        setRetryInput('');
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    } else {
      setRetryInput('');
      inputRef.current?.focus();
      // 抄错: copyDoneCount 不变, useEffect 不会重跑, 显式再播一次
      setTimeout(() => playAudioSlow(currentWord.word, currentWord.id), 200);
    }
  }, [currentWord, retryInput, copyDoneCount, playAudioSlow]);

  // 跳过 / 卡住时点「不会,看答案」= 交空答案、算没拼对、进抄写
  const giveUp = () => {
    if (!currentWord || submitted) return;
    settleFirstAttempt(currentWord.id, 'gave_up');
    setStuckAsk(false);
    setUserInput('');
    setIsCorrect(false);
    setSubmitted(true);
    setRetryMode(true);
    setFirstAttemptResults(prev => {
      if (prev.has(currentWord.id)) return prev;
      const next = new Map(prev);
      next.set(currentWord.id, false);
      return next;
    });
    setRoundErrorWords(prev => {
      if (prev.some(w => w.id === currentWord.id)) return prev;
      return [...prev, currentWord];
    });
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  // 换状态后 350ms 内的点击 / 回车不算: 「提交」和「下一个」在同一个位置,连按两下会把答案一闪就跳走
  const settledAtRef = useRef(0);
  useEffect(() => { settledAtRef.current = Date.now(); }, [submitted, retryPassed, currentIndex, round]);
  const tooSoon = () => Date.now() - settledAtRef.current < 350;

  // 输入框里的回车只管第一次交卷;交卷之后的回车由下面挂在 window 上的那个处理
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || e.repeat || e.nativeEvent.isComposing) return;
    if (!submitted && userInput.length > 0 && !tooSoon()) handleSubmit();
  };

  useEffect(() => {
    if (!submitted) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !e.repeat && !e.isComposing && Date.now() - settledAtRef.current >= 350) {
        if (retryMode && !retryPassed) {
          handleRetrySubmit();
        } else if (retryPassed || isCorrect) {
          handleNext();
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [submitted, isCorrect, retryMode, retryPassed, handleNext, handleRetrySubmit]);

  // 提交后逐字符直接对比
  const getCharInfo = (charIndex: number): { result: 'correct' | 'wrong' | 'missing'; displayChar: string } => {
    const correctChar = currentWord.word[charIndex];
    const userChar = userInput[charIndex];
    if (!userChar) return { result: 'missing', displayChar: correctChar };
    if (userChar === correctChar) return { result: 'correct', displayChar: userChar };
    return { result: 'wrong', displayChar: userChar };
  };

  if (showRoundSummary) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="dict-card w-full max-w-md px-8 py-9 text-center"
        >
          <h3 className="font-display text-2xl font-bold text-ink">第 {round} 轮听写写完了</h3>
          <div className="mt-6 flex justify-center gap-10">
            <div>
              <div className="font-numeric text-4xl font-bold text-green-600">{roundCorrectCount}</div>
              <div className="mt-1 text-sm text-ink-soft">一次拼对</div>
            </div>
            <div>
              <div className="font-numeric text-4xl font-bold text-accent-warm">{roundErrorWords.length}</div>
              <div className="mt-1 text-sm text-ink-soft">还要再写</div>
            </div>
          </div>
          <p className="mt-6 text-[15px] text-ink-soft">拼错的 {roundErrorWords.length} 个词马上再听写一遍</p>
        </motion.div>
      </div>
    );
  }

  if (!currentWord) return null;

  const word = currentWord.word;
  const isPhrase = word.includes(' ');
  const groups = word.split(' ');
  const letters = word.replace(/\s+/g, '').length;
  // 格子大小: 11 格以内整个放一行;再长按最长那个词算(一个词不拆行,词和词之间换行),手机上格子不至于太小
  const longest = Math.max(...groups.map(g => g.length));
  const total = letters + groups.length - 1;
  const tileN = total <= 11 ? Math.max(5, total) : Math.max(8, longest);
  const typing = !submitted || (retryMode && !retryPassed);
  const typedValue = retryMode ? retryInput : userInput;
  const showResult = submitted && !retryMode;      // 拼对了: 格子按对错上色
  const art = artUrl;

  /** 一排字母格。mode=type 显示正在打的字,mode=result 显示第一次写的和对错 */
  const renderSlots = (mode: 'type' | 'result') => {
    let idx = 0;
    const nextAt = typedValue.length;
    return (
      <div
        className={`dict-slots${mode === 'result' && isCorrect ? ' is-correct' : ''}`}
        style={{ ['--n' as string]: tileN }}
        aria-hidden="true"
      >
        {groups.map((g, gi) => {
          const start = idx;
          idx += g.length + 1;
          // 词和词之间的空格也占一位: 孩子没打空格时,打的那个字母显示在这里,不会「消失」
          const sp = start - 1;
          const spCh = mode === 'type' ? typedValue[sp] : undefined;
          return (
            <Fragment key={gi}>
            {gi > 0 && (
              <span className={`dict-space${spCh !== undefined ? (spCh === ' ' ? ' is-filled' : ' is-bad') : ''}${mode === 'type' && sp === nextAt ? ' is-next' : ''}`}>
                {spCh !== undefined && spCh !== ' ' && <span>{spCh}</span>}
              </span>
            )}
            <span className="dict-group">
              {Array.from(g).map((ch, ci) => {
                const at = start + ci;
                if (mode === 'result') {
                  const { result, displayChar } = getCharInfo(at);
                  const cls = result === 'correct' ? 'is-right' : result === 'wrong' ? 'is-wrong' : 'is-missing';
                  return (
                    <span key={ci} className={`dict-tile ${cls}`} style={{ ['--i' as string]: at }}>
                      <span>{displayChar}</span>
                    </span>
                  );
                }
                const typedCh = typedValue[at];
                const filled = typedCh !== undefined;
                const done = retryPassed && filled;
                return (
                  <span key={ci} className={`dict-tile${done ? ' is-right' : filled ? ' is-filled' : ''}${!done && at === nextAt ? ' is-next' : ''}`}>
                    {filled && <span>{typedCh === ' ' ? ' ' : typedCh}</span>}
                  </span>
                );
              })}
            </span>
            </Fragment>
          );
        })}
      </div>
    );
  };

  return (
    <div className="flex min-h-[70vh] flex-col items-center px-3 pb-6 pt-2 sm:px-6 md:justify-center">
      {/* 进度 */}
      <div className="mb-4 w-full max-w-2xl sm:mb-5">
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium text-ink-soft">
            听写 <span className="font-numeric">{currentIndex + 1} / {roundWords.length}</span>
          </span>
          {round > 1 && (
            <span className="rounded-full bg-orange-50 px-2.5 py-0.5 text-xs font-semibold text-accent-warm">第 {round} 轮 · 错的再写</span>
          )}
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-[#f1e6dc]">
          <motion.div
            className="h-full rounded-full bg-[#e8743a]"
            animate={{ width: `${((currentIndex + (submitted ? 1 : 0)) / roundWords.length) * 100}%` }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          />
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={`${round}-${currentWord.id}`}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
          className="dict-card w-full max-w-2xl px-5 pb-6 pt-5 text-center sm:px-10 sm:pb-8 sm:pt-7"
        >
          {/* 配图(只露上半截)+ 喇叭;没有图就是一个声音台 */}
          {art ? (
            <div className={`dict-art${retryMode ? ' is-compact' : ''}`}>
              <div
                className={`dict-art-window${submitted ? ' is-revealed' : ''}`}
                style={{ backgroundImage: `url("${art}")` }}
                role="img"
                aria-label={submitted ? `配图:${word}` : '这个词的配图'}
              />
              <div className="dict-medal-dock">
                <SpeakerButton keepFocus onClick={() => playAudioSlow(word, currentWord.id)} />
              </div>
            </div>
          ) : (
            <div className="dict-stage">
              <SpeakerButton keepFocus size="xl" onClick={() => playAudioSlow(word, currentWord.id)} />
            </div>
          )}

          <p className={`font-display text-xl text-ink sm:text-2xl ${art ? 'mt-12 sm:mt-14' : 'mt-5'}`}>
            {posMeaning(currentWord)}
          </p>

          {/* 卡住了吗: 想了很久、最近也没打字。开始打字就收起 */}
          <AnimatePresence>
            {stuckAsk && !submitted && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                role="status"
                className="mx-auto mt-4 max-w-md rounded-2xl bg-amber-50 px-4 py-3 text-left ring-1 ring-amber-200"
              >
                <p className="text-[15px] font-semibold text-amber-900">这个词想了好一会儿了,卡住了吗?</p>
                <p className="mt-0.5 text-sm text-amber-800">再听一遍,或者看答案照着写,都比一直空着强。</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      lastTypeAtRef.current = Date.now();
                      setStuckAsk(false);
                      playAudioSlow(word, currentWord.id);
                      setTimeout(() => inputRef.current?.focus(), 50);
                    }}
                    className="inline-flex min-h-11 items-center gap-1.5 rounded-xl bg-white px-4 text-sm font-semibold text-amber-900 ring-1 ring-amber-300 transition hover:bg-amber-100"
                  >
                    <SpeakerGlyph className="h-[18px] w-[18px]" /> 再听一遍
                  </button>
                  <button
                    type="button"
                    onClick={giveUp}
                    className="min-h-11 rounded-xl bg-amber-500 px-4 text-sm font-semibold text-white transition hover:bg-amber-600"
                  >
                    不会,看答案
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 拼错了: 正确写法 + 照着写几遍 */}
          {submitted && !isCorrect && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
              className="mx-auto mt-4 max-w-md rounded-2xl bg-[#fff6ef] px-4 py-3"
            >
              <div className="text-sm text-ink-soft">
                {userInput ? <>你写的 <span className="font-mono text-[#cf3f32] line-through decoration-2">{userInput}</span>,正确写法</> : '正确写法'}
              </div>
              <div className="mt-1 flex justify-center">
                <ColoredWord word={word} syllables={currentWord.syllables} className="font-display text-3xl font-bold sm:text-4xl" />
              </div>
              {currentWord.phonetic && (
                <div className="mt-1 flex justify-center">
                  <ColoredPhonetic phonetic={currentWord.phonetic} size="sm" />
                </div>
              )}
            </motion.div>
          )}

          {/* 字母格: 透明输入框盖在上面,点哪里都能打字;读屏读输入框 */}
          <div className={`dict-type-area mx-auto ${submitted && !isCorrect ? 'mt-4' : 'mt-5 sm:mt-6'}`}>
            {typing ? renderSlots('type') : showResult ? renderSlots('result') : renderSlots('type')}
            {typing && (
              <input
                {...imeSafeInputProps()}
                ref={inputRef}
                value={typedValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                maxLength={wordLengthWithSpaces}
                aria-label={retryMode ? `照着正确写法再写一遍,第 ${copyDoneCount + 1} 遍` : `听写:${posMeaning(currentWord)},${letters} 个字母`}
                className="dict-type-input"
                autoFocus
              />
            )}
          </div>

          {/* 格子下面的一行小字 */}
          {!submitted && (
            <p className="mt-3 text-sm text-ink-mute">
              {letters} 个字母{isPhrase ? ' · 词和词之间要打空格' : ''}
            </p>
          )}
          {retryMode && !retryPassed && (
            <div className="mt-3 flex items-center justify-center gap-2 text-sm font-medium text-accent-warm">
              照着写 {COPY_REQUIRED} 遍
              <span className="dict-copy-dots" aria-label={`已写 ${copyDoneCount} 遍`}>
                {Array.from({ length: COPY_REQUIRED }, (_, k) => <span key={k} className={k < copyDoneCount ? 'is-done' : ''} />)}
              </span>
            </div>
          )}

          {/* 按钮 */}
          <div className="mt-5 flex flex-col items-center gap-2 sm:mt-6">
            {!submitted && (
              <>
                <button
                  type="button"
                  onClick={() => { if (!tooSoon()) handleSubmit(); }}
                  disabled={userInput.length === 0}
                  className="btn-glow h-14 w-full rounded-2xl px-10 text-lg font-bold text-white sm:w-auto sm:min-w-[220px]"
                >
                  写好了 <span className="ml-1 hidden text-sm font-medium opacity-75 sm:inline">Enter</span>
                </button>
                <button
                  type="button"
                  onClick={giveUp}
                  className="min-h-11 px-4 text-[15px] font-medium text-ink-mute underline-offset-4 transition hover:text-ink-soft hover:underline"
                >
                  不会，看答案（算没拼对）
                </button>
              </>
            )}
            {retryMode && !retryPassed && (
              <button
                type="button"
                onClick={() => { if (!tooSoon()) handleRetrySubmit(); }}
                disabled={retryInput.length === 0}
                className="btn-glow h-14 w-full rounded-2xl px-10 text-lg font-bold text-white sm:w-auto sm:min-w-[220px]"
              >
                写好第 {copyDoneCount + 1} 遍
              </button>
            )}
            {(retryPassed || (submitted && isCorrect)) && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="flex w-full flex-col items-center gap-3"
              >
                <div className={`font-display text-lg font-semibold ${isCorrect ? 'text-green-700' : 'text-accent-warm'}`} role="status">
                  {isCorrect ? '拼对了！' : `照着写了 ${COPY_REQUIRED} 遍，记住它`}
                </div>
                <button
                  type="button"
                  onClick={() => { if (!tooSoon()) handleNext(); }}
                  className="btn-glow h-14 w-full rounded-2xl px-10 text-lg font-bold text-white sm:w-auto sm:min-w-[220px]"
                >
                  下一个 <span className="ml-1 hidden text-sm font-medium opacity-75 sm:inline">Enter</span>
                </button>
              </motion.div>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
