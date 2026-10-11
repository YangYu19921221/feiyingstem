import { useCallback, useEffect, useRef } from 'react';

/**
 * 防误触(与分类学习 GroupExamPhase / 音标卡片同口径,350ms):
 * - 换到新的一步后 350ms 内的点击忽略(上一步最后那一下点在同一个位置,会直接点穿下一步)
 * - 视口 resize(手机弹/收键盘)后 350ms 内的点击忽略(布局一跳,手指落在了别的按钮上)
 *
 * 用法: 每次换步调 markShown(),推进型按钮的 onClick 开头 if (isAccidentalTap()) return;
 */
export default function useAccidentalTapGuard(windowMs = 350) {
  const shownAt = useRef(0);
  const shiftAt = useRef(0);

  useEffect(() => {
    const onShift = () => { shiftAt.current = Date.now(); };
    const vv = window.visualViewport;
    vv?.addEventListener('resize', onShift);
    window.addEventListener('resize', onShift);
    return () => {
      vv?.removeEventListener('resize', onShift);
      window.removeEventListener('resize', onShift);
    };
  }, []);

  const markShown = useCallback(() => { shownAt.current = Date.now(); }, []);
  const isAccidentalTap = useCallback(
    () => Date.now() - shownAt.current < windowMs || Date.now() - shiftAt.current < windowMs,
    [windowMs],
  );
  return { markShown, isAccidentalTap };
}
