/**
 * 体验卡卡面模板(36 套: 10-23 先出 20 套,10-24 加到 36 套)—— 图在 public/promo-card/tpl/{id}_front.jpg / _back.jpg / _thumb.jpg
 *
 * id 与后端 services/promo.TEMPLATE_IDS 同一组(tests/test_promo.py 解析本文件锁住两边一致)。
 * box = 背面底图里那个空白方框(原图 1536×1024 坐标),二维码、老师名字电话、卡号画在框里。
 * **框的位置是对每张底图逐像素扫出来的,换图必须重扫**,否则二维码会压到框外;
 * utils/promoPrint 画之前会检查框里是不是白的,不是就报错不出图。
 * group = 选模板时的风格筛选(几十套一屏翻不完)。strip = 正面底部名字条放哪边(不写 = 居中;
 * 居中会压到模板自己文字的那几套挪到 l / r,判据是 OCR 文字框与名字条求交)。
 */
export const TEMPLATE_GROUPS = ['经典', '清新', '学习', '冒险', '四季', '节日国风', '深色'] as const;
export type TemplateGroup = (typeof TEMPLATE_GROUPS)[number];

export interface PromoTemplate {
  id: string;
  /** 给人看的编号,跟印刷厂、跟销售说「用第几套」 */
  no: number;
  name: string;
  group: TemplateGroup;
  strip?: 'l' | 'r';
  box: { l: number; t: number; r: number; b: number };
}

export const PROMO_TEMPLATES: PromoTemplate[] = [
  { id: 't01', no: 1, name: '耳麦陪跑', group: '经典', box: { l: 148, t: 156, r: 616, b: 620 } },
  { id: 't02', no: 2, name: '米白礼券', group: '经典', box: { l: 132, t: 144, r: 652, b: 644 } },
  { id: 't03', no: 3, name: '橙色渐变', group: '经典', strip: 'r', box: { l: 160, t: 148, r: 648, b: 628 } },
  { id: 't04', no: 4, name: '天空云朵', group: '清新', box: { l: 172, t: 160, r: 608, b: 600 } },
  { id: 't05', no: 5, name: '草绿春天', group: '四季', box: { l: 144, t: 160, r: 628, b: 624 } },
  { id: 't06', no: 6, name: '阳光奖杯', group: '经典', box: { l: 192, t: 160, r: 672, b: 624 } },
  { id: 't07', no: 7, name: '星空夜蓝', group: '深色', box: { l: 184, t: 180, r: 636, b: 620 } },
  { id: 't08', no: 8, name: '珊瑚粉', group: '清新', box: { l: 144, t: 132, r: 644, b: 620 } },
  { id: 't09', no: 9, name: '薄荷毕业帽', group: '清新', box: { l: 164, t: 144, r: 640, b: 592 } },
  { id: 't10', no: 10, name: '喜庆红', group: '节日国风', box: { l: 196, t: 168, r: 652, b: 616 } },
  { id: 't11', no: 11, name: '极简白橙', group: '经典', box: { l: 172, t: 168, r: 652, b: 628 } },
  { id: 't12', no: 12, name: '黑金尊享', group: '深色', box: { l: 180, t: 144, r: 668, b: 616 } },
  { id: 't13', no: 13, name: '黑板粉笔', group: '学习', box: { l: 188, t: 176, r: 640, b: 628 } },
  { id: 't14', no: 14, name: '积木童趣', group: '学习', box: { l: 188, t: 140, r: 676, b: 616 } },
  { id: 't15', no: 15, name: '太空火箭', group: '冒险', box: { l: 168, t: 156, r: 620, b: 604 } },
  { id: 't16', no: 16, name: '七天打卡', group: '经典', box: { l: 128, t: 124, r: 584, b: 576 } },
  { id: 't17', no: 17, name: '平板学习', group: '学习', box: { l: 116, t: 116, r: 588, b: 572 } },
  { id: 't18', no: 18, name: '秋叶暖棕', group: '四季', box: { l: 160, t: 120, r: 672, b: 628 } },
  { id: 't19', no: 19, name: '马卡龙', group: '清新', box: { l: 168, t: 156, r: 628, b: 624 } },
  { id: 't20', no: 20, name: '国潮祥云', group: '节日国风', box: { l: 176, t: 180, r: 620, b: 620 } },
  { id: 't21', no: 21, name: '海洋', group: '冒险', box: { l: 220, t: 180, r: 652, b: 616 } },
  { id: 't22', no: 22, name: '彩虹', group: '清新', box: { l: 204, t: 204, r: 628, b: 628 } },
  { id: 't23', no: 23, name: '冬日雪花', group: '四季', box: { l: 192, t: 156, r: 672, b: 624 } },
  { id: 't24', no: 24, name: '樱花', group: '四季', box: { l: 192, t: 168, r: 676, b: 640 } },
  { id: 't25', no: 25, name: '夏日海滩', group: '四季', box: { l: 224, t: 184, r: 668, b: 612 } },
  { id: 't26', no: 26, name: '森林露营', group: '冒险', box: { l: 176, t: 144, r: 648, b: 604 } },
  { id: 't27', no: 27, name: '图书馆', group: '学习', box: { l: 152, t: 128, r: 696, b: 656 } },
  { id: 't28', no: 28, name: '科学实验', group: '学习', box: { l: 232, t: 180, r: 704, b: 632 } },
  { id: 't29', no: 29, name: '音乐', group: '经典', box: { l: 152, t: 148, r: 640, b: 620 } },
  { id: 't30', no: 30, name: '运动会', group: '冒险', box: { l: 188, t: 168, r: 668, b: 628 } },
  { id: 't31', no: 31, name: '美术', group: '学习', box: { l: 176, t: 132, r: 656, b: 604 } },
  { id: 't32', no: 32, name: '超级英雄', group: '冒险', strip: 'l', box: { l: 152, t: 136, r: 656, b: 624 } },
  { id: 't33', no: 33, name: '像素游戏', group: '冒险', box: { l: 164, t: 160, r: 656, b: 640 } },
  { id: 't34', no: 34, name: '恐龙乐园', group: '冒险', box: { l: 236, t: 200, r: 700, b: 660 } },
  { id: 't35', no: 35, name: '童话城堡', group: '冒险', box: { l: 152, t: 172, r: 600, b: 620 } },
  { id: 't36', no: 36, name: '小火车', group: '冒险', box: { l: 152, t: 136, r: 628, b: 584 } },
];

export const DEFAULT_TEMPLATE_ID = 't01';

export const templateOf = (id: string | null | undefined): PromoTemplate =>
  PROMO_TEMPLATES.find((t) => t.id === id) ?? PROMO_TEMPLATES[0];

export const templateImg = (id: string, side: 'front' | 'back' | 'thumb') => `/promo-card/tpl/${id}_${side}.jpg`;
