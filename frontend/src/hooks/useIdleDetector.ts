/**
 * 空闲检测 hook
 * 60秒无键盘/鼠标/触摸操作 或 标签页隐藏 → 返回 true（空闲）
 * 用于暂停学习计时，避免学生离开后仍在计时
 */
import { useState, useEffect, useRef } from 'react';

const DEFAULT_TIMEOUT = 60_000; // 60秒

export default function useIdleDetector(timeoutMs = DEFAULT_TIMEOUT): boolean {
  const [idle, setIdle] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const goIdle = () => setIdle(true);

    const resetTimer = () => {
      setIdle(false);
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(goIdle, timeoutMs);
    };

    const onVisibility = () => {
      if (document.hidden) {
        clearTimeout(timerRef.current);
        goIdle();
      } else {
        resetTimer();
      }
    };

    // 启动初始计时
    timerRef.current = setTimeout(goIdle, timeoutMs);

    const events = ['keydown', 'mousedown', 'touchstart', 'scroll'];
    events.forEach(e => document.addEventListener(e, resetTimer, { passive: true }));
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      clearTimeout(timerRef.current);
      events.forEach(e => document.removeEventListener(e, resetTimer));
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [timeoutMs]);

  return idle;
}
