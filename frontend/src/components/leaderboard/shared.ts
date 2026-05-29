import { useEffect, useRef, useState } from 'react';
import type {
  LeaderboardEntry,
  LeaderboardKind,
  LeaderboardResponse,
} from '../../api/leaderboard';

export type Tier = 'gold' | 'silver' | 'bronze';

/** 金 / 银 / 铜 视觉系统 — OKLCH 暖色系，兼容温暖米白底 */
export const TIER_THEME: Record<Tier, {
  label: string;
  crown: string;       // 头部 emoji
  frame: string;       // 外框边色
  glow: string;        // 光晕色
  ribbon: string;      // 段位条渐变
  text: string;        // 段位文字色
  badge: string;       // 数值徽章背景
  badgeText: string;
  pedestal: string;    // 领奖台柱体渐变
  pedestalEdge: string;
}> = {
  gold: {
    label: '冠 军', crown: '👑',
    frame: 'oklch(0.78 0.15 80)',
    glow: 'oklch(0.85 0.18 75 / 0.5)',
    ribbon: 'linear-gradient(135deg, oklch(0.88 0.16 78), oklch(0.72 0.17 60))',
    text: 'oklch(0.55 0.16 65)',
    badge: 'oklch(0.93 0.07 80)',
    badgeText: 'oklch(0.45 0.16 60)',
    pedestal: 'linear-gradient(180deg, oklch(0.9 0.13 82), oklch(0.78 0.15 75))',
    pedestalEdge: 'oklch(0.7 0.16 70)',
  },
  silver: {
    label: '亚 军', crown: '🥈',
    frame: 'oklch(0.80 0.02 250)',
    glow: 'oklch(0.85 0.03 250 / 0.42)',
    ribbon: 'linear-gradient(135deg, oklch(0.90 0.02 240), oklch(0.72 0.03 240))',
    text: 'oklch(0.50 0.03 240)',
    badge: 'oklch(0.94 0.01 240)',
    badgeText: 'oklch(0.45 0.04 240)',
    pedestal: 'linear-gradient(180deg, oklch(0.92 0.02 250), oklch(0.82 0.03 250))',
    pedestalEdge: 'oklch(0.74 0.03 250)',
  },
  bronze: {
    label: '季 军', crown: '🥉',
    frame: 'oklch(0.65 0.13 45)',
    glow: 'oklch(0.75 0.14 40 / 0.42)',
    ribbon: 'linear-gradient(135deg, oklch(0.74 0.14 45), oklch(0.55 0.14 35))',
    text: 'oklch(0.45 0.13 35)',
    badge: 'oklch(0.92 0.06 45)',
    badgeText: 'oklch(0.42 0.13 35)',
    pedestal: 'linear-gradient(180deg, oklch(0.8 0.12 48), oklch(0.66 0.13 42))',
    pedestalEdge: 'oklch(0.58 0.13 40)',
  },
};

export const RANK_TIER: Record<number, Tier> = { 1: 'gold', 2: 'silver', 3: 'bronze' };

export const KIND_TABS: {
  id: LeaderboardKind; label: string; unit: string; emoji: string; sub: string;
}[] = [
  { id: 'vocabulary', label: '词汇王', unit: '词',   emoji: '📚', sub: '本期累计学会多少个新词' },
  { id: 'diligence',  label: '勤奋王', unit: '分钟', emoji: '🔥', sub: '本期累计学习时长' },
  { id: 'accuracy',   label: '精准王', unit: '%',    emoji: '🎯', sub: '本期答题正确率（≥20 题）' },
];

export const PERIOD_TABS: { id: 'this_week' | 'last_week' | 'this_month'; label: string }[] = [
  { id: 'this_week',  label: '本周' },
  { id: 'last_week',  label: '上周' },
  { id: 'this_month', label: '本月' },
];

export const formatValue = (kind: LeaderboardKind, v: number) =>
  kind === 'accuracy' ? `${v}%` : v.toLocaleString();

export const unitOf = (kind: LeaderboardKind) =>
  kind === 'accuracy' ? '' : KIND_TABS.find(t => t.id === kind)!.unit;

/**
 * 鼓励文案核心：把任何名次翻译成「我能赢的下一步」，绝不出现垫底 / 倒数字眼。
 * 返回首页横幅与「我的位置」卡共用的一句话钩子。
 */
export function encourage(data: LeaderboardResponse): {
  headline: string;
  hook: string | null;   // 追赶前一名的具体目标
  beat: number;          // 已超过多少人
} {
  const { kind, my_rank, my_value, total_participants, neighbors } = data;
  const unit = unitOf(kind);
  const beat = my_rank ? Math.max(0, total_participants - my_rank) : 0;

  // 找到我前面紧挨着的一名，算出追上 ta 需要的差值
  let hook: string | null = null;
  if (my_rank && my_rank > 1) {
    const ahead = neighbors.find(n => n.rank === my_rank - 1);
    if (ahead) {
      const gap = ahead.value - my_value;
      const name = ahead.full_name || ahead.username;
      if (kind === 'accuracy') {
        hook = gap > 0 ? `正确率再高 ${gap} 个点就追上 ${name}` : `稳住，紧咬 ${name}`;
      } else if (gap > 0) {
        hook = `再 ${gap} ${unit}就追上 ${name}`;
      } else {
        hook = `紧咬 ${name}，别让 ta 跑了`;
      }
    }
  }

  let headline: string;
  if (!my_rank) {
    headline = kind === 'accuracy' ? '答够 20 题就能入榜' : '学起来，今天就能上榜';
  } else if (my_rank === 1) {
    headline = '榜首是你！守住这个王座';
  } else if (my_rank <= 3) {
    headline = `你已经站上领奖台，第 ${my_rank} 名`;
  } else if (my_rank <= 10) {
    headline = `冲进前十啦，第 ${my_rank} 名`;
  } else if (beat > 0) {
    headline = `你已经超过了 ${beat} 位同学`;
  } else {
    headline = '迈出第一步，你已经在榜上了';
  }

  return { headline, hook, beat };
}

/** 数字滚动到目标值，ease-out-expo，尊重 reduced-motion */
export function useCountUp(target: number, durationMs = 900): number {
  const [val, setVal] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const from = fromRef.current;
    if (reduce || from === target) { setVal(target); fromRef.current = target; return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / durationMs);
      const eased = 1 - Math.pow(1 - p, 4);
      setVal(Math.round(from + (target - from) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);
  return val;
}

export type { LeaderboardEntry };
