/** 本机构的卡政策(legacy / pack)。老师端的学习卡规则入口与提醒条据此决定显示与否。 */
import { useEffect, useState } from 'react';
import { cardPackApi } from '../api/cardPack';

// 同一账号只查一次: 同一页面会挂好几个提醒条,别每个都打一遍接口。
// 按 token 缓存 —— 同一标签页退出换成别家机构的账号,不能沿用上一家的政策
let cached: { token: string | null; promise: Promise<string | null> } | null = null;
export function useCardPlan(): string | null {
  const [plan, setPlan] = useState<string | null>(null);
  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!cached || cached.token !== token) {
      cached = {
        token,
        promise: cardPackApi.rules()
          .then(r => (r as unknown as { card_plan: string }).card_plan)
          .catch(() => null),
      };
    }
    let alive = true;
    cached.promise.then(p => { if (alive) setPlan(p); });
    return () => { alive = false; };
  }, []);
  return plan;
}
