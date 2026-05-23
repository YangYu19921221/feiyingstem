/**
 * 英雄角色池 + meta + 抽取工具
 *
 * 8 个原创角色按通关档位分 3 池：
 *   - perfect (100 分)：烈焰 / 雷霆 / 星河
 *   - great   (80-99) ：晴空 / 潮汐 / 微风
 *   - retry   (<80)   ：凤凰 / 黎明
 *
 * 角色与档位的关系是"哪一档抽哪个池"；学生自己的 hero_id 是注册时分配的，
 * 用于光荣榜 / CompletionScreen / RewardReveal 立绘背景。
 */

export type HeroTier = 'perfect' | 'great' | 'retry';

export interface HeroMeta {
  id: string;
  name: string;            // 中文代号，UI 显示
  tier: HeroTier;
  imageUrl: string;        // /heroes/<id>.png
  accentColor: string;     // 主色（光环 / 按钮渐变锚点）
  taglineWin?: string;     // 满分/优秀档登场台词
  taglineEncourage?: string; // retry 池角色 / 排行榜尾段鼓励台词
}

export const HERO_META: Record<string, HeroMeta> = {
  hero_blaze:   { id: 'hero_blaze',   name: '烈焰', tier: 'perfect', imageUrl: '/heroes/hero_blaze.png',   accentColor: '#FF6B35', taglineWin: '炎之拳，所向披靡！' },
  hero_thunder: { id: 'hero_thunder', name: '雷霆', tier: 'perfect', imageUrl: '/heroes/hero_thunder.png', accentColor: '#00D9FF', taglineWin: '雷霆万钧，无人能挡！' },
  hero_galaxy:  { id: 'hero_galaxy',  name: '星河', tier: 'perfect', imageUrl: '/heroes/hero_galaxy.png',  accentColor: '#9B5DE5', taglineWin: '星河璀璨，胜负已定！' },
  hero_sunny:   { id: 'hero_sunny',   name: '晴空', tier: 'great',   imageUrl: '/heroes/hero_sunny.png',   accentColor: '#FFD23F', taglineWin: '今天的你，闪闪发光！' },
  hero_wave:    { id: 'hero_wave',    name: '潮汐', tier: 'great',   imageUrl: '/heroes/hero_wave.png',    accentColor: '#5FD3D3', taglineWin: '势不可挡，再接再厉！' },
  hero_breeze:  { id: 'hero_breeze',  name: '微风', tier: 'great',   imageUrl: '/heroes/hero_breeze.png',  accentColor: '#FF9EC7', taglineWin: '稳稳的进步，最美！' },
  hero_phoenix: { id: 'hero_phoenix', name: '凤凰', tier: 'retry',   imageUrl: '/heroes/hero_phoenix.png', accentColor: '#FF8A65', taglineEncourage: '凤凰浴火重生，你也可以！' },
  hero_dawn:    { id: 'hero_dawn',    name: '黎明', tier: 'retry',   imageUrl: '/heroes/hero_dawn.png',    accentColor: '#FFB088', taglineEncourage: '每个黎明都是新的开始。' },
};

export const PERFECT_POOL = ['hero_blaze', 'hero_thunder', 'hero_galaxy'] as const;
export const GREAT_POOL   = ['hero_sunny', 'hero_wave', 'hero_breeze'] as const;
export const RETRY_POOL   = ['hero_phoenix', 'hero_dawn'] as const;

const FALLBACK_HERO_ID = 'hero_sunny';

/** 按档位从对应池随机抽一个 */
export function pickHeroByScore(score: number): HeroMeta {
  const pool: readonly string[] =
    score >= 100 ? PERFECT_POOL :
    score >= 80  ? GREAT_POOL   :
    RETRY_POOL;
  const id = pool[Math.floor(Math.random() * pool.length)];
  return HERO_META[id];
}

/** 按 id 取 meta；null/未知 id 时返回 fallback */
export function getHeroById(id: string | null | undefined): HeroMeta {
  if (!id) return HERO_META[FALLBACK_HERO_ID];
  return HERO_META[id] ?? HERO_META[FALLBACK_HERO_ID];
}

/** 排行榜尾段鼓励位用：retry 池随机一个 */
export function pickEncourageHero(): HeroMeta {
  const id = RETRY_POOL[Math.floor(Math.random() * RETRY_POOL.length)];
  return HERO_META[id];
}

/** 通关档位到表情/标题的映射（保留 emoji 作为图片加载失败 fallback） */
export const TIER_FALLBACK_EMOJI: Record<HeroTier, string> = {
  perfect: '🏆',
  great:   '🌟',
  retry:   '💪',
};
