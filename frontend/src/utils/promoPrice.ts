/**
 * 体验卡正面价格的排版 —— 缩略图(SVG,components/promo/PromoCardThumb)和印刷文件(canvas,utils/promoPrint)
 * 共用这一份数字,两边画出来的位置、大小一样(预览里看到什么,印出来就是什么)。
 *
 * 价格来自机构「设置」里的体验价(10-24 用户「设置里改了价格,卡片图上的价格可以实时改吗」),
 * 模板底图里原来的「¥99」已经去掉,画在模板的 price 框里(见 data/promoTemplates 文件头)。
 * 字体是 Baloo 2 ExtraBold(圆体粗数字,和原图的价格字接近;OFL 许可,public/promo-card/fonts),
 * index.css 里以 PromoPrice 注册、只覆盖 ¥ 和数字,不影响页面别的字。
 */
import type { PromoTemplate } from '../data/promoTemplates';

export const PRICE_FONT = '"PromoPrice","Arial Rounded MT Bold","PingFang SC","Microsoft YaHei",sans-serif';

/** Baloo 2 ExtraBold 的字宽(1000 单位/em,fontTools 从字体文件读的) */
const ADV: Record<string, number> = {
  '¥': 597, '0': 606, '1': 393, '2': 522, '3': 518, '4': 602, '5': 522, '6': 558, '7': 482, '8': 560, '9': 558, '.': 238,
};
/** 数字高约 0.63em,中心在基线上方约 0.30em */
const DIGIT_H = 0.63;
const DIGIT_MID = 0.30;
/** ¥ 画得比数字小(原来 50 套都是小 ¥ 大数字) */
const YEN = 0.62;
const GAP = 0.03;

/** 价格写成卡上的样子: 最多两位小数,末尾的 0 不写(99 → "99",9.9 → "9.9",19.90 → "19.9") */
export function formatPrice(v: number): string {
  const x = Math.round(Math.max(0, Number(v) || 0) * 100) / 100;
  return Number.isInteger(x) ? String(x) : x.toFixed(2).replace(/0$/, '');
}

export interface PriceLayout {
  digits: string;
  /** 数字字号 / ¥ 字号(原图 1536×1024 坐标) */
  size: number;
  yenSize: number;
  /** ¥ 左边、数字左边、共同基线 */
  yenLeft: number;
  digitsLeft: number;
  baseline: number;
}

export function priceLayout(p: PromoTemplate['price'], price: number): PriceLayout {
  const digits = formatPrice(price);
  const digitsEm = [...digits].reduce((a, ch) => a + (ADV[ch] ?? 560), 0) / 1000;
  const yenEm = (YEN * ADV['¥']) / 1000;
  const widthEm = yenEm + GAP + digitsEm;
  // 两位数时按原来的字高;位数多了按框宽缩小(¥1980 也放得进徽章)
  const size = Math.min(p.h / DIGIT_H, p.w / widthEm);
  const yenLeft = p.x - (widthEm * size) / 2;
  return {
    digits,
    size,
    yenSize: size * YEN,
    yenLeft,
    digitsLeft: yenLeft + (yenEm + GAP) * size,
    baseline: p.y + size * DIGIT_MID,
  };
}
