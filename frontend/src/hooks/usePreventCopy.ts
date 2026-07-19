/**
 * 答题页「防复制粘贴作弊」闸
 *
 * 背景:学生做题时的两条剪贴板作弊路径——
 *  ① 右键/长按选中页面题干或提示,复制去别处查;
 *  ② 把别处查到的答案「粘贴」进答题框,一键交卷。
 * 本 hook 在挂载期间同时封死这两条。
 *
 * 拦截策略:
 * - contextmenu / copy / cut / selectstart / dragstart:输入框内放行(学生要能
 *   选中、退格重打、右键改自己的输入),框外一律拦(挡划词复制题干)。
 * - paste / drop:**一律拦,连输入框内也拦**——答题框没有任何正当粘贴场景,
 *   粘贴=把外部答案塞进来,这是核心作弊动作,必须堵死。
 *
 * 边界:这是剪贴板层防护,挡不了输入法自身词库的联想(那是系统 IME 行为,
 * 网页碰不到),也挡不了 F12。但「粘贴答案」是最常见、最省事的作弊手法,堵它性价比最高。
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
    // 框外拦(选中/复制题干);框内放行,不误伤学生编辑自己的输入
    const blockOutsideEditable = (e: Event) => {
      if (isEditable(e.target)) return;
      e.preventDefault();
    };
    // 粘贴/拖入:一律拦,答题框无正当粘贴场景,粘贴=塞外部答案
    const blockAlways = (e: Event) => e.preventDefault();

    const outside = ['contextmenu', 'copy', 'cut', 'selectstart', 'dragstart'];
    const always = ['paste', 'drop'];
    outside.forEach((ev) => document.addEventListener(ev, blockOutsideEditable));
    always.forEach((ev) => document.addEventListener(ev, blockAlways));
    return () => {
      outside.forEach((ev) => document.removeEventListener(ev, blockOutsideEditable));
      always.forEach((ev) => document.removeEventListener(ev, blockAlways));
    };
  }, [enabled]);
}
