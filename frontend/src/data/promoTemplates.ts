/**
 * 体验卡卡面模板(20 套,2026-10-23)—— 图在 public/promo-card/tpl/{id}_front.jpg / _back.jpg / _thumb.jpg
 *
 * id 与后端 services/promo.TEMPLATE_IDS 同一组(tests/test_promo.py 解析本文件锁住两边一致)。
 * box = 背面底图里那个空白方框(原图 1536×1024 坐标),二维码、老师名字电话、卡号画在框里。
 * **框的位置是对每张底图逐像素扫出来的,换图必须重扫**,否则二维码会压到框外;
 * utils/promoPrint 画之前会检查框里是不是白的,不是就报错不出图。
 */
export interface PromoTemplate {
  id: string;
  name: string;
  box: { l: number; t: number; r: number; b: number };
}

export const PROMO_TEMPLATES: PromoTemplate[] = [
  { id: 't01', name: '耳麦陪跑', box: { l: 148, t: 156, r: 616, b: 620 } },
  { id: 't02', name: '米白礼券', box: { l: 132, t: 144, r: 652, b: 644 } },
  { id: 't03', name: '橙色渐变', box: { l: 160, t: 148, r: 648, b: 628 } },
  { id: 't04', name: '天空云朵', box: { l: 172, t: 160, r: 608, b: 600 } },
  { id: 't05', name: '草绿春天', box: { l: 144, t: 160, r: 628, b: 624 } },
  { id: 't06', name: '阳光奖杯', box: { l: 192, t: 160, r: 672, b: 624 } },
  { id: 't07', name: '星空夜蓝', box: { l: 184, t: 180, r: 636, b: 620 } },
  { id: 't08', name: '珊瑚粉', box: { l: 144, t: 132, r: 644, b: 620 } },
  { id: 't09', name: '薄荷毕业帽', box: { l: 164, t: 144, r: 640, b: 592 } },
  { id: 't10', name: '喜庆红', box: { l: 196, t: 168, r: 652, b: 616 } },
  { id: 't11', name: '极简白橙', box: { l: 172, t: 168, r: 652, b: 628 } },
  { id: 't12', name: '黑金尊享', box: { l: 180, t: 144, r: 668, b: 616 } },
  { id: 't13', name: '黑板粉笔', box: { l: 188, t: 176, r: 640, b: 628 } },
  { id: 't14', name: '积木童趣', box: { l: 188, t: 140, r: 676, b: 616 } },
  { id: 't15', name: '太空火箭', box: { l: 168, t: 156, r: 620, b: 604 } },
  { id: 't16', name: '七天打卡', box: { l: 128, t: 124, r: 584, b: 576 } },
  { id: 't17', name: '平板学习', box: { l: 116, t: 116, r: 588, b: 572 } },
  { id: 't18', name: '秋叶暖棕', box: { l: 160, t: 120, r: 672, b: 628 } },
  { id: 't19', name: '马卡龙', box: { l: 168, t: 156, r: 628, b: 624 } },
  { id: 't20', name: '国潮祥云', box: { l: 176, t: 180, r: 620, b: 620 } },
];

export const DEFAULT_TEMPLATE_ID = 't01';

export const templateOf = (id: string | null | undefined): PromoTemplate =>
  PROMO_TEMPLATES.find((t) => t.id === id) ?? PROMO_TEMPLATES[0];

export const templateImg = (id: string, side: 'front' | 'back' | 'thumb') => `/promo-card/tpl/${id}_${side}.jpg`;
