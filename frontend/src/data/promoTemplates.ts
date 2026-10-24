/**
 * 体验卡卡面模板(50 套: 10-23 先出 20 套,10-24 加到 50 套)—— 图在 public/promo-card/tpl/{id}_front.jpg / _back.jpg / _thumb.jpg
 *
 * id 与后端 services/promo.TEMPLATE_IDS 同一组(tests/test_promo.py 解析本文件锁住两边一致)。
 * box = 背面底图里那个空白方框(原图 1536×1024 坐标),二维码、老师名字电话、卡号画在框里。
 * **框的位置是对每张底图逐像素扫出来的,换图必须重扫**,否则二维码会压到框外;
 * utils/promoPrint 画之前会检查框里是不是白的,不是就报错不出图。
 * group = 选模板时的风格筛选(几十套一屏翻不完)。strip = 正面底部名字条放哪边(不写 = 居中;
 * 居中会压到模板自己文字的那几套挪到 l / r,判据是 OCR 文字框与名字条求交)。
 *
 * **价格不在图里**(10-24 用户「设置里改了价格,卡片图上的价格可以实时改吗」): 正面底图 {id}_front_blank.jpg
 * 是把原图徽章里的「¥99」去掉后的版本,价格由 utils/promoPrint 按机构「设置」里的体验价现画在 price 框里。
 * price = 原来「¥99」的位置(原图 1536×1024 坐标,x/y 是中心,w 是能放下的最宽,h 是原来的字高)+ 原来的字色 / 描边色。
 * 去价格的做法: OCR 定位 → 图片编辑接口去字 → 只把徽章那一块合回原图(其余像素是原图,标题等不会被改)→ OCR 复查 50 张都没有残留。
 * 旧的 {id}_front.jpg / _thumb.jpg(印着 ¥99)还在 public 里,只为了已经打开的旧页面不裂图;新代码不再用。
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
  /** 正面价格画在哪、什么颜色(见文件头) */
  price: { x: number; y: number; w: number; h: number; fill: string; stroke?: string; sw?: number };
  box: { l: number; t: number; r: number; b: number };
}

export const PROMO_TEMPLATES: PromoTemplate[] = [
  { id: 't01', no: 1, name: '耳麦陪跑', group: '经典', price: { x: 288, y: 596, w: 269, h: 130, fill: '#fbf6ee' }, box: { l: 148, t: 156, r: 616, b: 620 } },
  { id: 't02', no: 2, name: '米白礼券', group: '经典', price: { x: 257, y: 602, w: 304, h: 168, fill: '#fdfdfd' }, box: { l: 132, t: 144, r: 652, b: 644 } },
  { id: 't03', no: 3, name: '橙色渐变', group: '经典', strip: 'r', price: { x: 295, y: 628, w: 291, h: 129, fill: '#fefefd', stroke: '#e15e1c', sw: 9 }, box: { l: 160, t: 148, r: 648, b: 628 } },
  { id: 't04', no: 4, name: '天空云朵', group: '清新', price: { x: 366, y: 634, w: 210, h: 119, fill: '#01bcf7' }, box: { l: 172, t: 160, r: 608, b: 600 } },
  { id: 't05', no: 5, name: '草绿春天', group: '四季', price: { x: 1083, y: 568, w: 220, h: 120, fill: '#fbf6d9' }, box: { l: 144, t: 160, r: 628, b: 624 } },
  { id: 't06', no: 6, name: '阳光奖杯', group: '经典', price: { x: 410, y: 632, w: 258, h: 124, fill: '#fdf0cb' }, box: { l: 192, t: 160, r: 672, b: 624 } },
  { id: 't07', no: 7, name: '星空夜蓝', group: '深色', price: { x: 244, y: 602, w: 218, h: 127, fill: '#01205b' }, box: { l: 184, t: 180, r: 636, b: 620 } },
  { id: 't08', no: 8, name: '珊瑚粉', group: '清新', price: { x: 1104, y: 594, w: 280, h: 171, fill: '#f7eee7' }, box: { l: 144, t: 132, r: 644, b: 620 } },
  { id: 't09', no: 9, name: '薄荷毕业帽', group: '清新', price: { x: 404, y: 597, w: 246, h: 129, fill: '#f8f4e4' }, box: { l: 164, t: 144, r: 640, b: 592 } },
  { id: 't10', no: 10, name: '喜庆红', group: '节日国风', price: { x: 473, y: 573, w: 242, h: 141, fill: '#b50304' }, box: { l: 196, t: 168, r: 652, b: 616 } },
  { id: 't11', no: 11, name: '极简白橙', group: '经典', price: { x: 230, y: 596, w: 239, h: 127, fill: '#fefefe' }, box: { l: 172, t: 168, r: 652, b: 628 } },
  { id: 't12', no: 12, name: '黑金尊享', group: '深色', price: { x: 1062, y: 626, w: 200, h: 97, fill: '#0a0a08' }, box: { l: 180, t: 144, r: 668, b: 616 } },
  { id: 't13', no: 13, name: '黑板粉笔', group: '学习', price: { x: 397, y: 627, w: 257, h: 157, fill: '#eeeee6' }, box: { l: 188, t: 176, r: 640, b: 628 } },
  { id: 't14', no: 14, name: '积木童趣', group: '学习', price: { x: 1134, y: 608, w: 196, h: 94, fill: '#fcfdfc', stroke: '#e16c54', sw: 3 }, box: { l: 188, t: 140, r: 676, b: 616 } },
  { id: 't15', no: 15, name: '太空火箭', group: '冒险', price: { x: 389, y: 628, w: 267, h: 164, fill: '#064696' }, box: { l: 168, t: 156, r: 620, b: 604 } },
  { id: 't16', no: 16, name: '七天打卡', group: '经典', price: { x: 233, y: 564, w: 233, h: 131, fill: '#f6f4ef' }, box: { l: 128, t: 124, r: 584, b: 576 } },
  { id: 't17', no: 17, name: '平板学习', group: '学习', price: { x: 1105, y: 607, w: 240, h: 157, fill: '#fefefe' }, box: { l: 116, t: 116, r: 588, b: 572 } },
  { id: 't18', no: 18, name: '秋叶暖棕', group: '四季', price: { x: 336, y: 566, w: 249, h: 121, fill: '#f5dbb2' }, box: { l: 160, t: 120, r: 672, b: 628 } },
  { id: 't19', no: 19, name: '马卡龙', group: '清新', price: { x: 1108, y: 644, w: 286, h: 153, fill: '#fef6b8' }, box: { l: 168, t: 156, r: 628, b: 624 } },
  { id: 't20', no: 20, name: '国潮祥云', group: '节日国风', price: { x: 415, y: 603, w: 193, h: 114, fill: '#f9d88e', stroke: '#a32a17', sw: 4 }, box: { l: 176, t: 180, r: 620, b: 620 } },
  { id: 't21', no: 21, name: '海洋', group: '冒险', price: { x: 380, y: 598, w: 224, h: 112, fill: '#005c7e' }, box: { l: 220, t: 180, r: 652, b: 616 } },
  { id: 't22', no: 22, name: '彩虹', group: '清新', price: { x: 1092, y: 616, w: 248, h: 132, fill: '#f7f7f7' }, box: { l: 204, t: 204, r: 628, b: 628 } },
  { id: 't23', no: 23, name: '冬日雪花', group: '四季', price: { x: 455, y: 632, w: 247, h: 147, fill: '#f4f9fe' }, box: { l: 192, t: 156, r: 672, b: 624 } },
  { id: 't24', no: 24, name: '樱花', group: '四季', price: { x: 1119, y: 636, w: 200, h: 110, fill: '#fefefe' }, box: { l: 192, t: 168, r: 676, b: 640 } },
  { id: 't25', no: 25, name: '夏日海滩', group: '四季', price: { x: 361, y: 585, w: 215, h: 113, fill: '#fef4db' }, box: { l: 224, t: 184, r: 668, b: 612 } },
  { id: 't26', no: 26, name: '森林露营', group: '冒险', price: { x: 1035, y: 546, w: 234, h: 141, fill: '#0f4f32' }, box: { l: 176, t: 144, r: 648, b: 604 } },
  { id: 't27', no: 27, name: '图书馆', group: '学习', price: { x: 468, y: 599, w: 234, h: 141, fill: '#fbf1e1' }, box: { l: 152, t: 128, r: 696, b: 656 } },
  { id: 't28', no: 28, name: '科学实验', group: '学习', price: { x: 1109, y: 596, w: 277, h: 154, fill: '#fdfef9' }, box: { l: 232, t: 180, r: 704, b: 632 } },
  { id: 't29', no: 29, name: '音乐', group: '经典', price: { x: 380, y: 594, w: 264, h: 151, fill: '#f8e8c7', stroke: '#da7739', sw: 4 }, box: { l: 152, t: 148, r: 640, b: 620 } },
  { id: 't30', no: 30, name: '运动会', group: '冒险', price: { x: 1104, y: 632, w: 261, h: 161, fill: '#fefefe', stroke: '#df7046', sw: 4 }, box: { l: 188, t: 168, r: 668, b: 628 } },
  { id: 't31', no: 31, name: '美术', group: '学习', price: { x: 432, y: 625, w: 293, h: 169, fill: '#fcf7f1' }, box: { l: 176, t: 132, r: 656, b: 604 } },
  { id: 't32', no: 32, name: '超级英雄', group: '冒险', strip: 'l', price: { x: 1136, y: 652, w: 255, h: 147, fill: '#de242b' }, box: { l: 152, t: 136, r: 656, b: 624 } },
  { id: 't33', no: 33, name: '像素游戏', group: '冒险', price: { x: 379, y: 637, w: 234, h: 130, fill: '#faf0d6' }, box: { l: 164, t: 160, r: 656, b: 640 } },
  { id: 't34', no: 34, name: '恐龙乐园', group: '冒险', price: { x: 1140, y: 611, w: 215, h: 116, fill: '#fdf8ed' }, box: { l: 236, t: 200, r: 700, b: 660 } },
  { id: 't35', no: 35, name: '童话城堡', group: '冒险', price: { x: 466, y: 617, w: 238, h: 137, fill: '#fcedd5' }, box: { l: 152, t: 172, r: 600, b: 620 } },
  { id: 't36', no: 36, name: '小火车', group: '冒险', price: { x: 1111, y: 603, w: 250, h: 133, fill: '#fbfbf9' }, box: { l: 152, t: 136, r: 628, b: 584 } },
  { id: 't37', no: 37, name: '热气球', group: '冒险', strip: 'r', price: { x: 488, y: 704, w: 317, h: 160, fill: '#fcf9f4' }, box: { l: 212, t: 164, r: 680, b: 624 } },
  { id: 't38', no: 38, name: '海盗寻宝', group: '冒险', price: { x: 1093, y: 616, w: 265, h: 160, fill: '#fdeac5', stroke: '#b62e17', sw: 6 }, box: { l: 188, t: 148, r: 652, b: 612 } },
  { id: 't39', no: 39, name: '机器人', group: '学习', price: { x: 289, y: 597, w: 261, h: 140, fill: '#fefefe' }, box: { l: 168, t: 168, r: 644, b: 628 } },
  { id: 't40', no: 40, name: '田园农场', group: '四季', price: { x: 1096, y: 617, w: 258, h: 139, fill: '#fafbfb' }, box: { l: 124, t: 156, r: 592, b: 620 } },
  { id: 't41', no: 41, name: '城市日落', group: '冒险', price: { x: 224, y: 532, w: 185, h: 100, fill: '#fce1af', stroke: '#c73e17', sw: 3 }, box: { l: 172, t: 160, r: 660, b: 616 } },
  { id: 't42', no: 42, name: '中秋月圆', group: '节日国风', price: { x: 1096, y: 621, w: 211, h: 119, fill: '#d53d0c' }, box: { l: 236, t: 176, r: 672, b: 596 } },
  { id: 't43', no: 43, name: '新春剪纸', group: '节日国风', price: { x: 255, y: 659, w: 191, h: 102, fill: '#fbda9a', stroke: '#861205', sw: 4 }, box: { l: 184, t: 188, r: 636, b: 636 } },
  { id: 't44', no: 44, name: '水墨山水', group: '节日国风', price: { x: 1050, y: 619, w: 199, h: 115, fill: '#f3e6d1' }, box: { l: 212, t: 224, r: 632, b: 636 } },
  { id: 't45', no: 45, name: '可爱贴纸', group: '经典', strip: 'r', price: { x: 385, y: 624, w: 273, h: 166, fill: '#fefefe' }, box: { l: 156, t: 112, r: 680, b: 636 } },
  { id: 't46', no: 46, name: '水彩', group: '清新', price: { x: 1060, y: 629, w: 284, h: 180, fill: '#fdf6e4', stroke: '#fb710f', sw: 6 }, box: { l: 140, t: 160, r: 616, b: 632 } },
  { id: 't47', no: 47, name: '霓虹', group: '深色', price: { x: 415, y: 647, w: 281, h: 164, fill: '#fdfdfd', stroke: '#bb4404', sw: 12 }, box: { l: 160, t: 144, r: 664, b: 628 } },
  { id: 't48', no: 48, name: '笔记本', group: '学习', price: { x: 1084, y: 624, w: 280, h: 177, fill: '#fdf7ed' }, box: { l: 200, t: 172, r: 668, b: 632 } },
  { id: 't49', no: 49, name: '珊瑚渐变', group: '经典', price: { x: 408, y: 627, w: 272, h: 151, fill: '#fefefe' }, box: { l: 192, t: 176, r: 620, b: 600 } },
  { id: 't50', no: 50, name: '金色荣誉', group: '深色', price: { x: 1057, y: 605, w: 200, h: 113, fill: '#ebbb51', stroke: '#362e14', sw: 6 }, box: { l: 200, t: 172, r: 644, b: 616 } },
];

export const DEFAULT_TEMPLATE_ID = 't01';

export const templateOf = (id: string | null | undefined): PromoTemplate =>
  PROMO_TEMPLATES.find((t) => t.id === id) ?? PROMO_TEMPLATES[0];

/** front / thumb 是去掉价格的版本(价格现画);名字换了是因为 /promo-card 下的图按 1 年 immutable 缓存,同名替换会一直看到旧图 */
export const templateImg = (id: string, side: 'front' | 'back' | 'thumb') =>
  side === 'back' ? `/promo-card/tpl/${id}_back.jpg` : `/promo-card/tpl/${id}_${side}_blank.jpg`;
