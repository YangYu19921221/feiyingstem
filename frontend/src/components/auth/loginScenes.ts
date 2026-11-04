/**
 * 登录页一周七个场景(2026-11-04): 按本地星期几换,小鹰每天在不同的地方学英语。
 * 背景 / 小鹰 / 周五的风筝是 AI 出的图(原图和出图提示词在本机 frontend/.impeccable/mocks/login-week/,这个目录不进 git),
 * 字、单词卡、动效都是网页现画的。周一沿用黑板那套分层(黑板面 + 粉笔槽),其余六天是「一张背景 + 小鹰」。
 *
 * 背景按 cover 铺满,但位置是 JS 算的(AuthShell 的 useStageBox),这样小鹰的脚能一直踩在图里的桌面 / 月面 / 沙地上:
 * ground = 脚踩的那条线离图片底边多远(占图片高度的比例,量过: 桌面 0.872 起、月面 0.885、沙地 0.868、草地 0.847、书架 0.813)。
 * focusDesk / focusBand = 图片比框宽时往哪边对齐(0 = 左边,1 = 右边),电脑上框是竖的、只看得到图的一半,要挑好看的那半。
 * 改了图要重新量 ground,不然小鹰会飘在空中或陷进地里
 */
export type SceneId = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';
export type CardStyle = 'chalk' | 'note' | 'orbit' | 'bubble' | 'cloud' | 'plank' | 'page';

export interface Scene {
  id: SceneId;
  /** Date.getDay() */
  weekday: number;
  /** 周几的简称,一周预览里用 */
  short: string;
  /** 场景名,读屏和预览按钮的说明里用 */
  name: string;
  /** 大字英文;null = 按时间说 Good morning / afternoon / evening */
  en: string | null;
  /** 中文那行,前面接「早上好，」这类时段问候 */
  zh: string;
  card: CardStyle;
  eagleAlt: string;
  /** 周一黑板是分层图,其余是一张背景 */
  bg?: { name: string; aspect: number; ground: number; focusDesk: number; focusBand: number };
  /** 小鹰图的宽高比(裁掉透明边之后) */
  eagleAspect: number;
  /** 小鹰轻轻漂浮(太空、海底) */
  floaty?: boolean;
}

export const SCENES: Scene[] = [
  {
    id: 'mon', weekday: 1, short: '一', name: '教室黑板',
    en: null, zh: '新的一周开始啦', card: 'chalk',
    eagleAlt: '戴眼镜的折纸小鹰站在黑板前', eagleAspect: 0.94,
  },
  {
    id: 'tue', weekday: 2, short: '二', name: '书桌笔记本',
    en: "Let's write!", zh: '拿起笔，写一写', card: 'note',
    eagleAlt: '折纸小鹰拿着一支大铅笔站在书桌上',
    bg: { name: 'tue', aspect: 1672 / 941, ground: 0.1, focusDesk: 0.95, focusBand: 0.9 },
    eagleAspect: 0.901,
  },
  {
    id: 'wed', weekday: 3, short: '三', name: '太空',
    en: 'To the stars!', zh: '今天飞去太空学单词', card: 'orbit',
    eagleAlt: '戴着宇航员头盔的折纸小鹰站在月球上',
    bg: { name: 'wed', aspect: 1672 / 941, ground: 0.085, focusDesk: 0.7, focusBand: 0.8 },
    eagleAspect: 0.9351, floaty: true,
  },
  {
    id: 'thu', weekday: 4, short: '四', name: '海底',
    en: 'Dive in!', zh: '一起潜到海底找单词', card: 'bubble',
    eagleAlt: '戴着潜水镜的折纸小鹰拿着贝壳站在海底沙地上',
    bg: { name: 'thu', aspect: 1672 / 941, ground: 0.095, focusDesk: 0.86, focusBand: 0.8 },
    eagleAspect: 0.9172, floaty: true,
  },
  {
    id: 'fri', weekday: 5, short: '五', name: '蓝天放风筝',
    en: 'Fly high!', zh: '周五啦，让单词飞起来', card: 'cloud',
    eagleAlt: '折纸小鹰站在草地上放风筝',
    bg: { name: 'fri', aspect: 1672 / 941, ground: 0.1, focusDesk: 0.78, focusBand: 0.75 },
    eagleAspect: 0.9234,
  },
  {
    id: 'sat', weekday: 6, short: '六', name: '花园',
    en: 'Hello, sunshine!', zh: '周末来花园浇浇单词', card: 'plank',
    eagleAlt: '戴草帽的折纸小鹰拿着洒水壶站在花园里',
    bg: { name: 'sat', aspect: 1672 / 941, ground: 0.135, focusDesk: 0.8, focusBand: 0.8 },
    eagleAspect: 0.9303,
  },
  {
    id: 'sun', weekday: 0, short: '日', name: '夜晚书房',
    en: 'Story time!', zh: '读一会儿，明天更棒', card: 'page',
    eagleAlt: '围着围巾的折纸小鹰捧着故事书站在书架上',
    bg: { name: 'sun', aspect: 1672 / 941, ground: 0.13, focusDesk: 0.97, focusBand: 0.9 },
    eagleAspect: 0.9003,
  },
];

/** 一周从周一排到周日(预览那排按钮的顺序) */
export const WEEK_ORDER: SceneId[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

export function sceneById(id: SceneId): Scene {
  return SCENES.find((s) => s.id === id) ?? SCENES[0];
}

export function sceneForDate(now: Date): Scene {
  return SCENES.find((s) => s.weekday === now.getDay()) ?? SCENES[0];
}
