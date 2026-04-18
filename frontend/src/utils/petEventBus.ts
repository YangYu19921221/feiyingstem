/**
 * 宠物事件总线 - 任意页面向悬浮宠物发信号
 * 用法: import { dispatchPetEvent } from '../utils/petEventBus';
 *       dispatchPetEvent('correct', { combo: 3 });
 */
export type PetEventType =
  | 'correct'    // 答对一题
  | 'wrong'      // 答错一题
  | 'combo'      // 连击
  | 'complete'   // 完成学习/单元
  | 'start'      // 开始学习

export interface PetEventDetail {
  type: PetEventType;
  combo?: number;
}

export function dispatchPetEvent(type: PetEventType, extra: Omit<PetEventDetail, 'type'> = {}) {
  window.dispatchEvent(
    new CustomEvent<PetEventDetail>('pet-event', { detail: { type, ...extra } })
  );
}

export function onPetEvent(handler: (detail: PetEventDetail) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<PetEventDetail>).detail);
  window.addEventListener('pet-event', listener);
  return () => window.removeEventListener('pet-event', listener);
}
