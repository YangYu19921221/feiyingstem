/**
 * 阶段1：分类（循环模式）
 * 每轮过完所有词后，夹生+陌生的词再来一轮
 * 直到全部标为熟悉才结束
 * 每连续标记3个熟悉，插入快速回顾卡确认
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, CheckCircle2, Clock3, HelpCircle, Lightbulb, Volume2 } from 'lucide-react';
import type { WordData } from '../../api/progress';
import client from '../../api/client';
import ColoredWord from '../ColoredWord';
import ColoredPhonetic from '../ColoredPhonetic';
import AutoFitText from '../AutoFitText';

export type WordCategory = 'familiar' | 'semi' | 'unknown';

interface ClassificationPhaseProps {
  words: WordData[];
  onComplete: (results: Map<number, WordCategory>) => void;
  onRoundMistakes?: (wordIds: number[]) => void;
  /** 每轮结束时上报本轮标"熟悉"的词(实时落正确记录,教师端监控才有中间数据) */
  onRoundFamiliar?: (wordIds: number[]) => void;
  playAudio: (word: string, rate?: number, wordId?: number) => void;
  /** 循环播放(每遍播完 ended 再等间隔):长词组/句子不会被固定间隔拦腰掐断 */
  playAudioLoop?: (word: string, times?: number, gapMs?: number, rate?: number, wordId?: number) => Promise<void>;
  stopAudio?: () => void;
  /** 走神/切屏时置 true:暂停倒计时和循环发音。
   *  否则孩子人不在,单词还在被倒计时一个个自动判"陌生"(幽灵错题+数据污染) */
  paused?: boolean;
  // PK mode: shows just the current word with classify buttons; single-word controlled mode.
  mode?: 'solo' | 'pk';
  pkCurrentWord?: { id: number; word: string; translation: string };
  pkOnAnswer?: (category: WordCategory, timeSpentMs: number) => void;
  pkDisabled?: boolean;
}

const CLASSIFY_TIME_SHORT = 10;       // 单词
const CLASSIFY_TIME_PHRASE = 14;      // 短语（2-3 个单词）
const CLASSIFY_TIME_SENTENCE = 20;    // 句子（4+ 个单词或带标点）
const PLAY_INTERVAL = 1800;
const PLAY_GAP = 1000; // 循环播放模式:每遍播完(ended)后到下一遍的间隔
const FAMILIAR_REVIEW_EVERY = 3; // 每N个熟悉词触发一次回顾

/**
 * 根据文本长度动态决定每项的倒计时时长。
 * 长句子 TTS 音频本身就可能 1.5-2s，学生需要至少听两遍再反应，
 * 写死 10s 会在句子场景下被自动判 unknown。
 */
function getClassifyTime(text: string | undefined): number {
  if (!text) return CLASSIFY_TIME_SHORT;
  const wordCount = text.trim().split(/\s+/).length;
  const hasSentencePunct = /[.!?,]/.test(text);
  if (wordCount >= 4 || hasSentencePunct) return CLASSIFY_TIME_SENTENCE;
  if (wordCount >= 2) return CLASSIFY_TIME_PHRASE;
  return CLASSIFY_TIME_SHORT;
}

export default function ClassificationPhase({
  words,
  onComplete,
  onRoundMistakes,
  onRoundFamiliar,
  playAudio,
  playAudioLoop,
  stopAudio,
  paused = false,
  mode,
  pkCurrentWord,
  pkOnAnswer,
  pkDisabled,
}: ClassificationPhaseProps) {
  // PK mode: render a controlled single-word card; skip solo loop entirely.
  if (mode === 'pk' && pkCurrentWord && pkOnAnswer) {
    return (
      <PkClassifySingle
        word={pkCurrentWord}
        onAnswer={pkOnAnswer}
        disabled={!!pkDisabled}
        playAudio={playAudio}
      />
    );
  }

  const [roundWords, setRoundWords] = useState<WordData[]>(words);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [round, setRound] = useState(1);
  const [timeLeft, setTimeLeft] = useState(() => getClassifyTime(words[0]?.word));
  // 倒计时的权威值放 ref(interval 里读写),state 仅驱动进度条渲染;
  // 外部 setTimeLeft 重置时由下方 effect 同步回 ref
  const timeLeftRef = useRef(timeLeft);
  const [results, setResults] = useState<Map<number, WordCategory>>(new Map());
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [showRoundSummary, setShowRoundSummary] = useState(false);
  const [roundErrors, setRoundErrors] = useState(0);
  const [showTutorial, setShowTutorial] = useState(() => {
    return !localStorage.getItem('classify_tutorial_done');
  });

  // 熟悉词回顾相关状态
  const [familiarBuffer, setFamiliarBuffer] = useState<WordData[]>([]); // 待回顾的熟悉词
  const [showFamiliarReview, setShowFamiliarReview] = useState(false);   // 显示回顾卡
  const [reviewWords, setReviewWords] = useState<WordData[]>([]);        // 本次回顾的词
  // 回顾卡类型: familiar=熟悉词确认(绿) / struggle=连错消化卡(橙,先记一记再继续)
  const [reviewKind, setReviewKind] = useState<'familiar' | 'struggle'>('familiar');
  // 连错缩组: 连续标"陌生"的词,攒到3个立即弹消化卡——防止状态差时硬灌,后面全是无效曝光
  const unknownStreakRef = useRef<WordData[]>([]);
  // AI记忆妙招: 带 wordId 存储——响应飞行中若倒计时切了词,渲染时按词校验,
  // 晚到的响应不会把上一个词的妙招挂到新词上(也因此无需"切词清空"的effect)
  const [memoryHook, setMemoryHook] = useState<{ wordId: number; text: string } | null>(null);
  const [hookLoading, setHookLoading] = useState(false);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const audioTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const classifyRef = useRef<(category: WordCategory) => void>(() => {});
  // 同步重入锁: isTransitioning state 是渲染快照,定时器/事件在 commit 前读到旧值
  // 会绕过防抖(同词双分类)。ref 同步生效,state 只留给 UI 禁用态。
  const lockRef = useRef(false);
  // 轮结束防重入: 双触发会导致错题重复提交(batch_id 每次新生成,后端幂等挡不住)
  const roundEndedRef = useRef(false);
  // 200ms 过渡 setTimeout 存引用,卸载时清理
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const currentWord = roundWords[currentIndex];

  // 循环播放发音(走神/切屏暂停时停播,人回来自动续上;
  // 回顾/消化卡打开时也停——弹卡前 index 已+1,不停会循环播孩子还没见过的下一词)
  // 进页即自动循环发第一个词(不再要求先交互)。纯刷新无用户手势时浏览器可能拦截
  // audio.play(),useAudio 已 catch 该拒绝(不报错、不留坏状态),用户一交互即可正常出声。
  useEffect(() => {
    if (!currentWord || showRoundSummary || showTutorial || showFamiliarReview || paused) return;

    // 优先用"播完一遍(ended)再等间隔"的循环:固定 setInterval 会在长词组/句子
    // (TTS 音频常 2-3s,超过 1.8s 间隔)播到一半时被下一次 playAudio 的全局互斥
    // 拦腰掐断,家长/学生反馈"发音读不完整"即此因
    const t = setTimeout(() => {
      if (playAudioLoop) {
        playAudioLoop(currentWord.word, Infinity, PLAY_GAP, 1, currentWord.id);
      } else {
        playAudio(currentWord.word, 1, currentWord.id);
      }
    }, 300);

    // 兼容未传 playAudioLoop 的调用方:维持旧的固定间隔重播
    let t2: ReturnType<typeof setTimeout> | null = null;
    if (!playAudioLoop) {
      t2 = setTimeout(() => {
        audioTimerRef.current = setInterval(() => {
          playAudio(currentWord.word, 1, currentWord.id);
        }, PLAY_INTERVAL);
      }, 300 + PLAY_INTERVAL);
    }

    return () => {
      clearTimeout(t);
      if (t2) clearTimeout(t2);
      if (audioTimerRef.current) {
        clearInterval(audioTimerRef.current);
        audioTimerRef.current = null;
      }
      // 切词/卸载时立刻打断旧词发音(含飞行中的请求)：否则切词后的 300ms 空档里,
      // 上一个词还没被 token 作废、fetch 返回后会照样播出来,造成与新词重叠/听到旧词。
      stopAudio?.();
    };
    // showTutorial 必须在依赖里:教程打开(含中途重看)要停发音,关闭要自动开播——
    // 缺它时"关掉教程后第一个词不自动发音"且重看教程时旧词还在循环朗读
  }, [currentIndex, currentWord, playAudio, playAudioLoop, stopAudio, showRoundSummary, showTutorial, showFamiliarReview, paused]);

  // 一轮结束时的处理
  const handleRoundEnd = useCallback((newResults: Map<number, WordCategory>) => {
    // 防重入: 定时器归零与手点竞态下可能被同一轮触发两次,
    // 第二次会把错题再提交一遍(统计翻倍),这里同步拦掉
    if (roundEndedRef.current) return;
    roundEndedRef.current = true;

    // 收集本轮中不是熟悉的词
    const errorWords = roundWords.filter(w => newResults.get(w.id) !== 'familiar');
    // 本轮标熟悉的词立即上报正确记录:否则全对的学生整组(5-15分钟)
    // 零落库,教师端实时课堂的"今日单词数"一直不动
    const familiarWords = roundWords.filter(w => newResults.get(w.id) === 'familiar');
    if (familiarWords.length > 0) {
      onRoundFamiliar?.(familiarWords.map(w => w.id));
    }

    if (errorWords.length === 0) {
      // 全部熟悉，分类结束
      onComplete(newResults);
    } else {
      // 实时通知错题
      onRoundMistakes?.(errorWords.map(w => w.id));

      // 还有错误词，显示轮次总结后进入下一轮
      setRoundErrors(errorWords.length);
      setShowRoundSummary(true);

      setTimeout(() => {
        setRound(prev => prev + 1);
        setRoundWords(errorWords);
        setCurrentIndex(0);
        setTimeLeft(getClassifyTime(errorWords[0]?.word));
        setShowRoundSummary(false);
        setFamiliarBuffer([]); // 新一轮清空熟悉词缓冲
        unknownStreakRef.current = []; // 连错计数不跨轮:残留会让下一轮首个陌生词就误弹消化卡
        roundEndedRef.current = false; // 新一轮解锁
      }, 2000);
    }
  }, [roundWords, onComplete, onRoundMistakes, onRoundFamiliar]);

  const handleClassify = useCallback((category: WordCategory) => {
    // lockRef 同步生效: 定时器归零瞬间的手点、渲染 commit 前的连点都会被拦,
    // 不依赖 state 闭包快照(isTransitioning 仅驱动按钮禁用态 UI)
    if (lockRef.current || !currentWord) return;
    lockRef.current = true;
    setIsTransitioning(true);

    if (timerRef.current) clearInterval(timerRef.current);
    if (audioTimerRef.current) clearInterval(audioTimerRef.current);

    const newResults = new Map(results);
    newResults.set(currentWord.id, category);
    setResults(newResults);

    // 如果标记为熟悉，加入缓冲区
    const newBuffer = category === 'familiar'
      ? [...familiarBuffer, currentWord]
      : familiarBuffer;

    transitionTimeoutRef.current = setTimeout(() => {
      const isLastInRound = currentIndex + 1 >= roundWords.length;

      // 打断卡通用推进: 切到下一词并弹回顾/消化卡(两种卡同一套推进样板,别再抄第三份)
      const advanceWithReviewCard = (kind: 'familiar' | 'struggle', words: WordData[]) => {
        setReviewWords(words);
        setReviewKind(kind);
        setCurrentIndex(currentIndex + 1);
        setTimeLeft(getClassifyTime(roundWords[currentIndex + 1]?.word));
        setIsTransitioning(false);
        lockRef.current = false;
        setShowFamiliarReview(true);
      };

      // 连错消化: 连续3个"陌生"先停一停,把这3个词摆出来记一记再继续
      // (状态差时继续硬灌只是无效曝光)
      if (category === 'unknown') {
        unknownStreakRef.current = [...unknownStreakRef.current, currentWord];
      } else {
        unknownStreakRef.current = [];
      }
      if (category === 'unknown' && unknownStreakRef.current.length >= 3 && !isLastInRound) {
        const streak = [...unknownStreakRef.current];
        unknownStreakRef.current = [];
        advanceWithReviewCard('struggle', streak);
        return;
      }

      // 只有当前词标为熟悉才检查是否触发回顾
      if (category === 'familiar' && newBuffer.length >= FAMILIAR_REVIEW_EVERY && !isLastInRound) {
        setFamiliarBuffer([]);
        advanceWithReviewCard('familiar', [...newBuffer]);
        return;
      }

      setFamiliarBuffer(newBuffer);

      if (isLastInRound) {
        handleRoundEnd(newResults);
      } else {
        setCurrentIndex(currentIndex + 1);
        setTimeLeft(getClassifyTime(roundWords[currentIndex + 1]?.word));
      }
      setIsTransitioning(false);
      lockRef.current = false;
    }, 200);
  }, [currentWord, currentIndex, roundWords.length, results, handleRoundEnd, familiarBuffer]);

  // 卸载时清理飞行中的过渡 timeout
  useEffect(() => () => {
    if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
  }, []);

  useEffect(() => {
    classifyRef.current = handleClassify;
  }, [handleClassify]);

  // setTimeLeft 重置(切词/新一轮)时同步权威 ref
  useEffect(() => {
    timeLeftRef.current = timeLeft;
  }, [timeLeft]);

  const fetchMemoryHook = useCallback(async () => {
    if (!currentWord || hookLoading) return;
    const wordId = currentWord.id;
    setHookLoading(true);
    try {
      const r = await client.post<{ hook: string }>(`/ai/memory-hook/${wordId}`);
      setMemoryHook({ wordId, text: r.hook });
    } catch (e: any) {
      setMemoryHook({ wordId, text: e?.response?.data?.detail || '妙招获取失败,先靠自己记~' });
    } finally {
      setHookLoading(false);
    }
  }, [currentWord, hookLoading]);

  // 键盘快捷键: 1=熟悉, 2=夹生, 3=陌生, 空格=播放发音
  useEffect(() => {
    if (showTutorial || showRoundSummary || showFamiliarReview) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      switch (e.key) {
        case '1': classifyRef.current('familiar'); break;
        case '2': classifyRef.current('semi'); break;
        case '3': classifyRef.current('unknown'); break;
        case ' ':
          e.preventDefault();
          if (currentWord) {
            playAudio(currentWord.word, 1, currentWord.id);
          }
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [showTutorial, showRoundSummary, showFamiliarReview, currentWord, playAudio]);

  // 倒计时（回顾时暂停;走神/切屏 paused 时也暂停,人不在不烧词）
  useEffect(() => {
    if (isTransitioning || showRoundSummary || showTutorial || showFamiliarReview || paused) return;

    timerRef.current = setInterval(() => {
      // 副作用(自动判陌生)必须在 interval 回调顶层做,不能写进 setTimeLeft 的
      // updater 里: updater 要求纯函数,StrictMode/并发渲染下会双调用或重放,
      // 曾导致同词双分类、下一词被"幽灵判陌生"(快速点击压测的跳词/状态错乱)。
      if (timeLeftRef.current <= 0.1) {
        if (timerRef.current) clearInterval(timerRef.current);
        classifyRef.current('unknown');
        return;
      }
      timeLeftRef.current -= 0.1;
      setTimeLeft(timeLeftRef.current);
    }, 100);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // 依赖必须含所有 guard 条件:否则回顾卡/教程关闭(showFamiliarReview/showTutorial
    // 变 false)后 effect 不重跑,倒计时不会恢复,当前词卡死不再自动判定
  }, [currentIndex, isTransitioning, showRoundSummary, showFamiliarReview, showTutorial, paused]);

  // 关闭教程
  const dismissTutorial = () => {
    setShowTutorial(false);
    localStorage.setItem('classify_tutorial_done', '1');
  };

  // ── 熟悉词快速回顾卡 ──────────────────────────────────────
  if (showFamiliarReview) {
    const isStruggle = reviewKind === 'struggle';
    return (
      <div className="flex flex-col min-h-[calc(100vh-64px)] items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="classify-learning-card bg-white rounded-3xl shadow-lg p-6 w-full max-w-md"
        >
          <div className="text-center mb-4">
            <div className="text-4xl mb-2">{isStruggle ? '🍵' : '👀'}</div>
            <h3 className="text-lg font-bold text-gray-800">{isStruggle ? '别急,先记一记' : '快速回顾一下'}</h3>
            <p className="text-sm text-gray-400 mt-1">
              {isStruggle
                ? `这 ${reviewWords.length} 个词有点难,看一眼意思再继续`
                : `你标记了 ${reviewWords.length} 个熟悉的词，确认都认识吗？`}
            </p>
          </div>

          <div className="space-y-3 mb-6">
            {reviewWords.map(w => (
              <div key={w.id} className={`flex items-center justify-between rounded-xl px-4 py-3 ${isStruggle ? 'bg-orange-50' : 'bg-green-50'}`}>
                <span className="font-bold text-gray-800 text-lg">{w.word}</span>
                <span className="text-gray-500 text-sm">{w.meaning}</span>
              </div>
            ))}
          </div>

          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => setShowFamiliarReview(false)}
            className="w-full py-3 bg-primary text-white rounded-2xl font-bold text-lg shadow-lg"
          >
            {isStruggle ? '记住了,继续 →' : '认识，继续 →'}
          </motion.button>
        </motion.div>
      </div>
    );
  }

  // 使用教程
  if (showTutorial) {
    return (
      <div className="flex flex-col min-h-[calc(100vh-64px)] items-center justify-start px-4 py-8 pb-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="classify-learning-card bg-white rounded-3xl shadow-lg p-5 md:p-7 w-full max-w-3xl"
        >
          <h3 className="text-2xl font-bold text-gray-800 mb-5">
            🧠 分类记忆法
          </h3>

          <div className="grid gap-5 md:grid-cols-[1.08fr_0.92fr]">
            <div className="min-w-0">
              <img
                src="/classify-memory-v2.png"
                alt="分类记忆法学习路径"
                className="h-48 md:h-64 w-full rounded-2xl border border-orange-100 object-cover shadow-sm"
              />

              <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 mt-4">
                <h4 className="font-bold text-gray-700 text-sm mb-2">学习流程</h4>
                <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                  {['分类', '语音', '听写', '过关', '总结'].map((step, index) => (
                    <span key={step} className="contents">
                      <span className="px-2 py-1 bg-white border border-gray-100 rounded-lg">{step}</span>
                      {index < 4 && <span className="text-gray-300">→</span>}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">未标熟悉的词会反复出现，直到全部掌握</p>
              </div>
            </div>

            <div className="flex min-w-0 flex-col">
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 bg-green-50 rounded-xl">
                  <span className="text-2xl">😊</span>
                  <div>
                    <div className="font-bold text-green-700">熟悉
                      <kbd className="ml-2 px-2 py-0.5 bg-green-100 text-green-600 rounded text-xs font-mono">1</kbd>
                    </div>
                    <p className="text-sm text-gray-500">看到就知道意思，直接过</p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-orange-50 rounded-xl">
                  <span className="text-2xl">🤔</span>
                  <div>
                    <div className="font-bold text-orange-700">夹生
                      <kbd className="ml-2 px-2 py-0.5 bg-orange-100 text-orange-600 rounded text-xs font-mono">2</kbd>
                    </div>
                    <p className="text-sm text-gray-500">有点印象但不确定，需要再记一记</p>
                  </div>
                </div>

                <div className="flex items-start gap-3 p-3 bg-red-50 rounded-xl">
                  <span className="text-2xl">😰</span>
                  <div>
                    <div className="font-bold text-red-700">陌生
                      <kbd className="ml-2 px-2 py-0.5 bg-red-100 text-red-600 rounded text-xs font-mono">3</kbd>
                    </div>
                    <p className="text-sm text-gray-500">完全不认识，需要重点学习</p>
                  </div>
                </div>
              </div>

              <div className="mt-auto pt-4 text-xs text-gray-400">
                <kbd className="px-1.5 py-0.5 bg-gray-100 rounded font-mono">空格</kbd> 播放发音
                <span className="mx-2">·</span>
                <span>{CLASSIFY_TIME_SHORT}-{CLASSIFY_TIME_SENTENCE} 秒自动计时</span>
              </div>

              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                onClick={dismissTutorial}
                className="mt-4 w-full py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-2xl font-bold text-lg shadow-md transition"
              >
                开始学习
              </motion.button>
            </div>
          </div>
        </motion.div>
      </div>
    );
  }

  // 轮次间过渡画面
  if (showRoundSummary) {
    const familiarCount = roundWords.length - roundErrors;
    return (
      <div className="flex flex-col min-h-[calc(100vh-64px)] items-center justify-center px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="classify-learning-card bg-white rounded-3xl shadow-lg p-8 w-full max-w-md text-center"
        >
          <div className="text-5xl mb-4">🔄</div>
          <h3 className="text-xl font-bold text-gray-800 mb-2">
            {round === 1 ? '第一遍完成' : `第 ${round - 1} 次补遍完成`}
          </h3>
          <div className="flex justify-center gap-6 mb-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-500">{familiarCount}</div>
              <div className="text-xs text-gray-400">😊 已掌握</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-500">{roundErrors}</div>
              <div className="text-xs text-gray-400">需复习</div>
            </div>
          </div>
          <p className="text-gray-500 text-sm">
            还有 <span className="font-bold text-red-500">{roundErrors}</span> 个词需要再过一遍...
          </p>
        </motion.div>
      </div>
    );
  }

  if (!currentWord) return null;

  const currentMaxTime = getClassifyTime(currentWord.word);
  const progress = timeLeft / currentMaxTime;
  const timerColor = timeLeft > currentMaxTime * 0.7 ? '#5FD35F' : timeLeft > currentMaxTime * 0.3 ? '#FFD23F' : '#FF5757';

  const classifyChoices = [
    {
      category: 'familiar' as WordCategory,
      label: '熟悉',
      hint: '看到就懂',
      key: '1',
      icon: CheckCircle2,
      tone: 'classify-choice-familiar',
    },
    {
      category: 'semi' as WordCategory,
      label: '夹生',
      hint: '有印象但不稳',
      key: '2',
      icon: HelpCircle,
      tone: 'classify-choice-semi',
    },
    {
      category: 'unknown' as WordCategory,
      label: '陌生',
      hint: '需要重点学习',
      key: '3',
      icon: AlertCircle,
      tone: 'classify-choice-unknown',
    },
  ];

  return (
    <div className="classify-study-flow flex flex-col gap-3 px-3 pb-4 sm:px-4">
      <div className="classify-study-grid">
        {/* 单词卡片：将进度、词汇信息和操作收在同一个稳定工作区内 */}
        <motion.section
          key={`${round}-${currentWord.id}`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="classify-word-card mx-auto flex w-full max-w-2xl flex-col overflow-hidden rounded-lg bg-white"
        >
        <div className="h-1.5 w-full bg-slate-100">
          <motion.div
            className="h-full rounded-r-full"
            style={{ backgroundColor: timerColor }}
            animate={{ width: `${progress * 100}%` }}
            transition={{ duration: 0.1 }}
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-2.5 sm:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="classify-stage-label">分类识别</span>
            <span className="text-xs text-slate-400">{currentIndex + 1}/{roundWords.length}</span>
            {round > 1 && <span className="classify-round-badge">补遍 {round - 1}</span>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="classify-timer-chip" style={{ color: timerColor }}>
              <Clock3 className="h-3.5 w-3.5" />
              {Math.ceil(timeLeft)}s
            </span>
            <button
              onClick={() => setShowTutorial(true)}
              className="classify-help-chip inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs transition"
              title="重看分类记忆法玩法说明"
            >
              <HelpCircle className="h-3.5 w-3.5" />玩法
            </button>
          </div>
        </div>

        <div className="flex flex-col items-center px-4 py-4 text-center sm:px-8 sm:py-5">
          <p className="mb-2 text-[11px] font-semibold tracking-[0.12em] text-slate-400">先想意思，再看提示</p>
          <AutoFitText maxPx={44} minPx={22} fitKey={currentWord.word} className="mb-2 w-full">
            <ColoredWord
              word={currentWord.word}
              syllables={currentWord.syllables}
              className="classify-word-title font-bold"
            />
          </AutoFitText>

          {currentWord.phonetic && (
            <div className="mb-3 flex items-center justify-center gap-2">
              <ColoredPhonetic phonetic={currentWord.phonetic} size="sm" />
              <button
                onClick={() => {
                  playAudio(currentWord.word, 1, currentWord.id);
                }}
                className="classify-audio-button inline-flex h-8 w-8 items-center justify-center rounded-md transition active:scale-95"
                title="播放发音"
              >
                <Volume2 className="h-4 w-4" />
              </button>
            </div>
          )}

          {currentWord.meaning && (
            <div className="classify-meaning-panel mb-3 w-full max-w-lg px-3.5 py-2.5 text-left">
              <p className="text-base font-semibold text-slate-700 sm:text-lg">
                {currentWord.part_of_speech && <span className="mr-2 text-sm font-medium text-slate-400">{currentWord.part_of_speech}</span>}
                {currentWord.meaning}
              </p>
            </div>
          )}

          <div className="flex min-h-8 items-center justify-center">
            {memoryHook?.wordId === currentWord.id ? (
              <div className="classify-memory-tip flex max-w-lg items-start gap-2 px-3 py-2 text-left text-xs sm:text-sm">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{memoryHook.text}</span>
              </div>
            ) : (
              <button
                onClick={fetchMemoryHook}
                disabled={hookLoading}
                className="classify-memory-button inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition disabled:opacity-60"
              >
                <Lightbulb className="h-3.5 w-3.5" />
                {hookLoading ? '妙招生成中…' : '记忆妙招'}
              </button>
            )}
          </div>

          {currentWord.example_sentence && (
            <div className="classify-example-panel mt-3 w-full max-w-lg px-3.5 py-2.5 text-left">
              <p className="text-sm leading-relaxed text-slate-600">{currentWord.example_sentence}</p>
              {currentWord.example_translation && <p className="mt-1 text-xs text-slate-400">{currentWord.example_translation}</p>}
            </div>
          )}
        </div>
        </motion.section>

        {/* 三个分类卡：不再用大块高饱色，让学生依靠图标、文案和边框做快速判断 */}
        <section className="classify-decision-panel mx-auto w-full max-w-2xl">
        <div className="mb-2 flex items-end justify-between gap-3 px-1">
          <div>
            <h2 className="text-base font-bold text-slate-800">选择熟悉程度</h2>
            <p className="mt-0.5 text-xs text-slate-400">凭第一反应判断</p>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
          {classifyChoices.map((choice) => {
            const Icon = choice.icon;
            return (
              <motion.button
                key={choice.category}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => handleClassify(choice.category)}
                disabled={isTransitioning}
                className={`classify-decision-card ${choice.tone} group relative flex min-h-[4.5rem] flex-col items-start justify-between rounded-lg p-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-55 sm:min-h-[4.5rem] sm:p-3`}
              >
                <span className="flex w-full items-center justify-between">
                  <span className="classify-choice-icon inline-flex h-7 w-7 items-center justify-center rounded-md">
                    <Icon className="h-4 w-4" />
                  </span>
                  <kbd className="classify-choice-key rounded px-1.5 py-0.5 text-[10px] font-semibold">{choice.key}</kbd>
                </span>
                <span className="mt-1.5 block text-sm font-bold sm:text-base">{choice.label}</span>
                <span className="mt-0.5 hidden truncate text-[11px] opacity-75 sm:block sm:text-xs">{choice.hint}</span>
              </motion.button>
            );
          })}
        </div>
        </section>
      </div>
    </div>
  );
}

function PkClassifySingle({
  word,
  onAnswer,
  disabled,
  playAudio,
}: {
  word: { id: number; word: string; translation: string };
  onAnswer: (category: WordCategory, timeSpentMs: number) => void;
  disabled: boolean;
  playAudio: (word: string, rate?: number, wordId?: number) => void;
}) {
  const startRef = useRef<number>(Date.now());

  useEffect(() => {
    startRef.current = Date.now();
    if (word.word) playAudio(word.word, 1, word.id);
  }, [word.id, word.word, playAudio]);

  const handle = (cat: WordCategory) => {
    if (disabled) return;
    onAnswer(cat, Date.now() - startRef.current);
  };

  return (
    <div className="flex flex-col items-center justify-center p-8 bg-white rounded-2xl shadow-md min-h-[300px]">
      <AutoFitText maxPx={40} minPx={20} fitKey={word.word} className="mb-2 text-center">
        <ColoredWord word={word.word} className="font-bold" />
      </AutoFitText>
      <p className="text-base text-gray-500 mb-8">{word.translation}</p>
      <div className="flex gap-3">
        <button
          onClick={() => handle('familiar')}
          disabled={disabled}
          className="px-5 py-2.5 bg-green-500 text-white rounded-lg font-medium disabled:opacity-50"
        >
          熟悉
        </button>
        <button
          onClick={() => handle('semi')}
          disabled={disabled}
          className="px-5 py-2.5 bg-yellow-500 text-white rounded-lg font-medium disabled:opacity-50"
        >
          学过
        </button>
        <button
          onClick={() => handle('unknown')}
          disabled={disabled}
          className="px-5 py-2.5 bg-red-500 text-white rounded-lg font-medium disabled:opacity-50"
        >
          陌生
        </button>
      </div>
    </div>
  );
}
