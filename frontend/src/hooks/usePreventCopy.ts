/**
 * 答题页「防划走答案」闸(防君子款)
 *
 * 背景:学生做题时可右键/长按选中页面上的题干或提示,复制去查,相当于作弊。
 * 本 hook 在挂载期间拦截:右键菜单、复制、剪切、拖拽、选中开始。
 *
 * 边界:
 * - 答题输入框(input/textarea/contentEditable)内一律放行——学生要能选中、
 *   退格重打、右键改自己的输入,不能误伤正常编辑。
 * - 这是「防君子不防小人」:挡住顺手划词复制,挡不住 F12/开发者工具。
 *   真防作弊需答案不下发前端+后端校验(见方案 B),本 hook 不涉及。
 *
 * 用法:在学生答题页组件顶部调用 usePreventCopy();
 */
import { useEffect } from 'react';

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

export function usePreventCopy(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const block = (e: Event) => {
      if (isEditable(e.target)) return; // 输入框内正常编辑,放行
      e.preventDefault();
    };
    const events = ['contextmenu', 'copy', 'cut', 'selectstart', 'dragstart'];
    events.forEach((ev) => document.addEventListener(ev, block));
    return () => events.forEach((ev) => document.removeEventListener(ev, block));
  }, [enabled]);
}
