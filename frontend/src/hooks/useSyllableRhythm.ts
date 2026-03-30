/**
 * 音节加速度节奏控制 hook
 * 核心：按照加速-减速的时间间隔依次高亮每个音节
 * 时间间隔曲线：先慢后快再慢
 */
import { useState, useCallback, useRef, useEffect } from 'react';

// 加速-减速时间间隔曲线（毫秒）
const RHYTHM_INTERVALS = [800, 600, 400, 250, 200, 250, 400, 600];

interface UseSyllableRhythmOptions {
  syllables: string[];       // 音节数组，如 ['coun', 'try']
  totalRounds: number;       // 循环轮数
  onRoundStart?: () => void; // 每轮开始时回调（播放发音）
  onComplete?: () => void;   // 全部完成回调
}

interface UseSyllableRhythmReturn {
  currentSyllableIndex: number; // 当前高亮的音节索引，-1表示未开始
  currentRound: number;         // 当前轮次（从1开始）
  isRunning: boolean;
  isComplete: boolean;
  start: () => void;
  stop: () => void;
}

export function useSyllableRhythm({
  syllables,
  totalRounds,
  onRoundStart,
  onComplete,
}: UseSyllableRhythmOptions): UseSyllableRhythmReturn {
  const [currentSyllableIndex, setCurrentSyllableIndex] = useState(-1);
  const [currentRound, setCurrentRound] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [isComplete, setIsComplete] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);
  const onRoundStartRef = useRef(onRoundStart);
  const onCompleteRef = useRef(onComplete);

  // 保持回调引用最新
  useEffect(() => {
    onRoundStartRef.current = onRoundStart;
    onCompleteRef.current = onComplete;
  }, [onRoundStart, onComplete]);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    runningRef.current = false;
    clearTimer();
    setIsRunning(false);
    setCurrentSyllableIndex(-1);
  }, [clearTimer]);

  const start = useCallback(() => {
    if (syllables.length === 0) return;

    clearTimer();
    runningRef.current = true;
    setIsRunning(true);
    setIsComplete(false);
    setCurrentRound(1);
    setCurrentSyllableIndex(0);

    // 每轮开始回调
    onRoundStartRef.current?.();

    let round = 1;
    let step = 0; // 全局步骤计数
    const syllableCount = syllables.length;

    const scheduleNext = () => {
      if (!runningRef.current) return;

      // 计算当前步骤对应的时间间隔
      const intervalIndex = step % RHYTHM_INTERVALS.length;
      const delay = RHYTHM_INTERVALS[intervalIndex];

      timerRef.current = setTimeout(() => {
        if (!runningRef.current) return;

        step++;
        const syllableIdx = step % syllableCount;

        // 检查是否进入新一轮
        if (syllableIdx === 0 && step > 0) {
          round++;
          if (round > totalRounds) {
            // 全部完成
            runningRef.current = false;
            setIsRunning(false);
            setIsComplete(true);
            setCurrentSyllableIndex(-1);
            onCompleteRef.current?.();
            return;
          }
          setCurrentRound(round);
          onRoundStartRef.current?.();
        }

        setCurrentSyllableIndex(syllableIdx);
        scheduleNext();
      }, delay);
    };

    scheduleNext();
  }, [syllables, totalRounds, clearTimer]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      runningRef.current = false;
      clearTimer();
    };
  }, [clearTimer]);

  return {
    currentSyllableIndex,
    currentRound,
    isRunning,
    isComplete,
    start,
    stop,
  };
}
