/**
 * 对战场数的两个小工具(规则真源 backend/app/services/battle_tickets.py)。
 * 单独放一个文件: 组件文件里只能导出组件(否则开发时热更新失效)。
 */
import type { BattleTickets } from '../api/petBattle';

export const BATTLE_TICKETS_QUERY_KEY = ['petBattleTickets'] as const;

/** 没场数时按钮旁边那句话: 到上限了说明天再来,否则说还能怎么拿。有场数 / 不限场数返回 null */
export function ticketBlockReason(t: BattleTickets | undefined): string | null {
  if (!t || !t.enabled || (t.left ?? 1) > 0) return null;
  if (t.capped) return `今天的 ${t.cap} 场都打完了,明天再来`;
  const ways = t.sources.filter((s) => s.more).map((s) => s.label);
  return ways.length ? `今天的场数用完了。${ways[0].replace(' +', ',加 ')}` : '今天的场数用完了,明天再来';
}
