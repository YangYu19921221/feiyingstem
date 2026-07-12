/**
 * 空闲检测 hook
 * 一段时间无任何操作 或 标签页隐藏 → 返回 true（空闲）
 * 用于暂停学习计时，避免学生离开后仍在计时
 *
 * 活动信号除了点击/键盘,还包括鼠标移动/触摸滑动/滚轮:
 * 孩子看着屏幕思考时通常会晃鼠标/摸屏幕,之前不算这些导致
 * "人在认真想题却被判发呆" —— 全屏提醒突然弹出又秒消,像屏幕闪一下,
 * 还把误报计进了教师端的发呆次数。
 */
import { useState, useEffect, useRef } from 'react';

const DEFAULT_TIMEOUT = 60_000; // 60秒

export default function useIdleDetector(timeoutMs = DEFAULT_TIMEOUT): boolean {
  const [idle, setIdle] = useState(false);
  const idleRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const lastResetRef = useRef(0);

  useEffect(() => {
    const goIdle = () => {
      idleRef.current = true;
      setIdle(true);
    };

    const resetTimer = () => {
      const now = Date.now();
      // 高频事件(mousemove 每秒几十次)节流:非空闲状态下 800ms 内只重置一次定时器
      if (!idleRef.current && now - lastResetRef.current < 800) return;
      lastResetRef.current = now;
      if (idleRef.current) {
        idleRef.current = false;
        setIdle(false);
      }
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

    // keydown/mousedown/touchstart: 明确操作;mousemove/touchmove/wheel: 思考时的小动作也算"人在"
    const events = ['keydown', 'mousedown', 'touchstart', 'scroll', 'mousemove', 'touchmove', 'wheel', 'pointerdown'];
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
