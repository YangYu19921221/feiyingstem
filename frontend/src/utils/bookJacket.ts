/**
 * 书封(components/book/BookJacket)的取色、封面大字和纸片画 —— 全部按书本资料现算,不出图。
 *
 * 学生书架、作业页、纸笔听写选书、老师「单词本」列表和建书 / 导入 / 编辑弹窗都用这一份,
 * 所以老师新建或导入一本书,封面当场就有,而且和学生看到的一模一样。
 *
 * 为什么不出图:
 * - 原来没封面的书用 public/book-cover-1..4.jpeg,图上印着假的英文书名(「ENGLISH VOYAGE」),
 *   生产 66 本书 0 本有 cover_url,所有孩子看到的都是那四张。
 * - 建书时调 AI 出图: 生产近 30 天 7 次全部超时;建书接口还同步等它 30 秒,而网页 10 秒就放弃 ——
 *   老师看到「创建失败」,书其实已经建了。出出来的图每张画风也不一样。2026-10-28 起不再出图。
 *
 * 规则:
 * - 输入是书名 + 年级 + 册次 + 版本(各页面能拿到的同一组字段,作业接口 10-28 起也带上了)。
 * - 颜色按年级: 同一年级上下册同色(像一套课本),年级之间换色;没有年级的按书名散列,刷新不变色。
 * - 画面按学段: 小学是圆山和太阳、初中是雪山、高中是云海和星星、其它(四六级 / 雅思 / 校本)是海浪。
 * - 封面大字是平时的叫法: 七年级上册 =「7上」、必修一 =「必修1」、CET4、3500 =「3500」、语法一 =「语法1」。
 *   认不出的取书名前两个汉字(去掉「人教版 / 飞鹰」这类前缀)。
 * - 左上角是品牌「飞鹰」(官网 logo 里那只鹰,public/brand/eagle-mark.png),后面跟版本(书名里已有就不重复)。
 */

export interface JacketBook {
  id: number;
  name: string;
  grade_level?: string | null;
  volume?: string | null;
  series?: string | null;
}

/**
 * cover 封面底色(天空)/ back 远处那层纸 / front 书名那层纸 / ink 书名和品牌字色 /
 * mark、markShadow 封面大字和它下面那层纸影 / glow 太阳月亮星星雪顶 / accent 书签带、进度条
 */
export interface JacketTone {
  cover: string;
  back: string;
  front: string;
  ink: string;
  mark: string;
  markShadow: string;
  glow: string;
  accent: string;
  /** 浅色封面(字是深色的) */
  light: boolean;
}

// 深色几套: 封面底色、书名那层对白字都 ≥ 4.5:1(左上角品牌和版本是小字,直接压在底色上)。
// 层次从天空往前一层比一层深。浅色两套(sun / mint)书名那层是浅纸条、深色字。
const dark = (cover: string, back: string, front: string): JacketTone => ({
  cover, back, front,
  ink: '#FFFFFF', mark: '#FFFFFF', markShadow: front, glow: '#FFD23F', accent: '#FFD23F', light: false,
});

const TONES = {
  sun: {
    cover: '#F4BC3C', back: '#E59A22', front: '#FFF3CF', ink: '#3B2604',
    mark: '#5A3A06', markShadow: '#D88912', glow: '#FFF6D8', accent: '#B4421A', light: true,
  },
  mint: {
    cover: '#86D0AE', back: '#5EB592', front: '#E6F7EE', ink: '#0E3A2A',
    mark: '#15523B', markShadow: '#4FA582', glow: '#FFF6D2', accent: '#B4421A', light: true,
  },
  tangerine: dark('#BA4A16', '#A23E12', '#7E2F0C'),
  tomato: dark('#C23B31', '#A82F27', '#84221C'),
  berry: dark('#B0315F', '#962752', '#741C40'),
  grass: dark('#2E7E48', '#24693B', '#19522D'),
  teal: dark('#0D7A70', '#0A665E', '#074F49'),
  sky: dark('#226FB3', '#1C5E99', '#154A7A'),
  navy: dark('#284A8E', '#213F7A', '#172E5D'),
  forest: dark('#1F5E4F', '#194F42', '#113C32'),
  brick: dark('#9A3B26', '#833120', '#672417'),
} satisfies Record<string, JacketTone>;

type ToneKey = keyof typeof TONES;

/** 一到九年级、高一到高三各一色,相邻年级不撞色 */
const GRADE_TONE: Record<number, ToneKey> = {
  1: 'sun', 2: 'mint', 3: 'tangerine', 4: 'sky', 5: 'tomato', 6: 'teal',
  7: 'grass', 8: 'navy', 9: 'berry', 10: 'forest', 11: 'sky', 12: 'brick',
};
const HASH_TONES = Object.keys(TONES) as ToneKey[];

const CN_DIGIT: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

/** 封面大字: prefix / suffix 是小号汉字(「必修」「上」),main 是大字 */
export interface JacketMark {
  prefix: string;
  main: string;
  suffix: string;
  /** main 是不是汉字(汉字走系统字体,数字字母走 Baloo 2) */
  cjk: boolean;
  /** 字号,单位是封面宽度的百分比 */
  size: number;
}

export type JacketStage = 'primary' | 'junior' | 'senior' | 'other';

/** 画面里的一块纸。fill 取当前配色里的哪一色;body = 太阳 / 月亮,学完的书换成「学完」章 */
type ShapeFill = 'glow' | 'cover' | 'back' | 'front';
export type JacketShape =
  | { kind: 'circle'; cx: number; cy: number; r: number; fill: ShapeFill; opacity?: number; body?: boolean }
  | { kind: 'path'; d: string; fill: ShapeFill; opacity?: number; body?: boolean };

export interface Jacket {
  tone: JacketTone;
  mark: JacketMark;
  stage: JacketStage;
  /** 品牌后面跟的版本(书名里已经有就不重复) */
  imprint: string | null;
  /** 天上的(太阳 / 月亮 / 星星 / 云),画在远处那层纸后面 */
  sky: JacketShape[];
  /** 远处那层纸、书名那层纸(viewBox 0 0 300 400,书名那层上沿在 y≈215–245) */
  backPath: string;
  frontPath: string;
  /** 贴在远处那层纸上的(雪顶 / 水面反光) */
  ridge: JacketShape[];
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 按书名定的小随机数(mulberry32): 同一本书每次画出来都一样 */
function seeded(seed: number): (lo: number, hi: number) => number {
  let a = seed >>> 0;
  return (lo, hi) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const u = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return lo + (hi - lo) * u;
  };
}

const n1 = (v: number) => Math.round(v * 10) / 10;

function gradeIn(text: string): number | null {
  // 「3-6年级总复习」是跨年级的书,不能当成六年级
  if (/\d\s*[-–~至到]\s*\d\s*年级/.test(text)) return null;
  const cn = text.match(/([一二三四五六七八九])年级/);
  if (cn) return CN_DIGIT[cn[1]];
  const ar = text.match(/([1-9])\s*年级/);
  if (ar) return Number(ar[1]);
  const senior = text.match(/高([一二三])/);
  if (senior) return 9 + CN_DIGIT[senior[1]];
  return null;
}

/** 一到九年级 → 1..9,高一到高三 → 10..12;先看年级字段,再看书名;认不出 null */
export function gradeOf(book: Pick<JacketBook, 'name' | 'grade_level'>): number | null {
  return gradeIn(book.grade_level ?? '') ?? gradeIn(book.name);
}

export function stageOf(book: Pick<JacketBook, 'name' | 'grade_level'>): JacketStage {
  const grade = gradeOf(book);
  if (grade) return grade <= 6 ? 'primary' : grade <= 9 ? 'junior' : 'senior';
  const text = `${book.grade_level ?? ''}${book.name}`;
  if (/小学/.test(text)) return 'primary';
  if (/初中|中考/.test(text)) return 'junior';
  if (/高中|高考/.test(text)) return 'senior';
  return 'other';
}

// Baloo 2 ExtraBold 的字宽(em,从字体文件量的)。按它算字号: 字多的缩小,别撞到右上角的书签带
const ADVANCE: Record<string, number> = {
  0: 0.606, 1: 0.393, 2: 0.522, 3: 0.518, 4: 0.602, 5: 0.522, 6: 0.558, 7: 0.482, 8: 0.56, 9: 0.558,
  A: 0.627, B: 0.619, C: 0.571, D: 0.666, E: 0.548, F: 0.531, G: 0.664, H: 0.672, I: 0.305, J: 0.412,
  K: 0.615, L: 0.513, M: 0.797, N: 0.679, O: 0.703, P: 0.581, Q: 0.705, R: 0.609, S: 0.551, T: 0.556,
  U: 0.664, V: 0.634, W: 0.863, X: 0.601, Y: 0.574, Z: 0.56, '-': 0.354,
};
export const SMALL_EM = 0.4; // prefix / suffix 是大字的 0.4 倍
export const SMALL_GAP_EM = 0.05;
const MARK_ROOM = 64; // 大字最多占封面宽度的 64%(左边书脊、右上角书签带之外)

function sized(prefix: string, main: string, suffix: string, cjk: boolean): JacketMark {
  const mainEm = cjk ? main.length : [...main].reduce((s, ch) => s + (ADVANCE[ch] ?? 0.6), 0);
  const smallEm = SMALL_EM * (prefix.length + suffix.length)
    + (prefix ? SMALL_GAP_EM : 0) + (suffix ? SMALL_GAP_EM : 0);
  const size = Math.min(cjk ? 30 : 56, MARK_ROOM / Math.max(mainEm + smallEm, 0.1));
  return { prefix, main, suffix, cjk, size: Math.round(size * 10) / 10 };
}

/** 去掉品牌 / 版别前缀后再取汉字 */
const NAME_PREFIX = /^(?:新人教版|旧人教版|人教版|飞鹰|清华沙沙|大学英语|大学|中国|英语|\d{4})+/;

export function markOf(book: Pick<JacketBook, 'name' | 'grade_level' | 'volume'>): JacketMark {
  const n = book.name.trim();

  const range = n.match(/(\d)\s*[-–~至到]\s*(\d)\s*年级/);
  if (range) return sized('', `${range[1]}-${range[2]}`, '', false);

  const required = n.match(/(必修|选修)([一二三四五六])/);
  if (required) return sized(required[1], String(CN_DIGIT[required[2]]), '', false);

  const grade = gradeOf(book);
  const vol = (book.volume ?? '').match(/[上下]/)?.[0] ?? n.match(/([上下])册/)?.[1] ?? '';
  if (grade && grade <= 9) return sized('', String(grade), vol, false);
  if (grade) return sized('高', String(grade - 9), vol, false);

  const acronym = n.match(/[A-Z]{2,}\d?/);
  if (acronym) return sized('', acronym[0], '', false);

  const level = n.match(/([一二三四五六七八九])级/);
  if (level) return sized('', String(CN_DIGIT[level[1]]), '级', false);

  const count = n.match(/\d{3,}/);
  if (count) return sized('', count[0], '', false);

  const rest = n.replace(NAME_PREFIX, '');
  // 「语法一」「语法二」: 词 + 序号,序号做大字
  const numbered = rest.match(/^([一-鿿]{2})([一二三四五六七八九])/);
  if (numbered) return sized(numbered[1], String(CN_DIGIT[numbered[2]]), '', false);

  const cjk = rest.match(/[一-鿿]/g);
  if (cjk && cjk.length) return sized('', cjk.slice(0, 2).join(''), '', true);

  const latin = n.match(/[A-Za-z0-9]/);
  return latin ? sized('', latin[0].toUpperCase(), '', false) : sized('', '书', '', true);
}

// ===== 四种画面(viewBox 0 0 300 400) =====
// 留给别的东西的地方: 左上角品牌(y<42)、左边封面大字(x 40–232,y 70–180)、
// 右上角书签带(x 232–258,y<74)、下面书名那层(y>215)。太阳月亮星星都放在右边。

type Rand = (lo: number, hi: number) => number;
type Scene = Pick<Jacket, 'sky' | 'backPath' | 'frontPath' | 'ridge'>;

const toFloor = (d: string) => `${d} L300 400 L0 400 Z`;

/** 一朵纸云: 三个圆 + 一条平底 */
function cloud(x: number, y: number, s: number, fill: ShapeFill, opacity: number): JacketShape[] {
  return [
    { kind: 'circle', cx: n1(x - 10 * s), cy: n1(y), r: n1(8 * s), fill, opacity },
    { kind: 'circle', cx: n1(x), cy: n1(y - 5 * s), r: n1(11 * s), fill, opacity },
    { kind: 'circle', cx: n1(x + 11 * s), cy: n1(y), r: n1(8 * s), fill, opacity },
    { kind: 'path', d: `M${n1(x - 10 * s)} ${n1(y)}h${n1(21 * s)}v${n1(8 * s)}h${n1(-21 * s)}z`, fill, opacity },
  ];
}

/** 四角星 */
function sparkle(x: number, y: number, s: number): JacketShape {
  return {
    kind: 'path',
    d: `M${x} ${n1(y - s)}Q${x} ${y} ${n1(x + s)} ${y}Q${x} ${y} ${x} ${n1(y + s)}Q${x} ${y} ${n1(x - s)} ${y}Q${x} ${y} ${x} ${n1(y - s)}Z`,
    fill: 'glow',
  };
}

/** 小学: 两座圆山 + 太阳 + 一朵云 */
function hills(r: Rand): Scene {
  const y0 = r(196, 210), p1 = r(166, 180), v = r(200, 212), p2 = r(176, 190), yE = r(200, 214);
  const a = r(230, 240), b = r(222, 232);
  return {
    sky: [
      { kind: 'circle', cx: n1(r(238, 262)), cy: n1(r(178, 190)), r: n1(r(26, 32)), fill: 'glow', body: true },
      ...cloud(r(244, 262), r(116, 128), r(0.9, 1.1), 'glow', 0.92),
    ],
    backPath: toFloor(`M0 ${n1(y0)} C 30 ${n1(p1)} 110 ${n1(p1)} 150 ${n1(v)} C 196 ${n1(p2)} 266 ${n1(p2)} 300 ${n1(yE)}`),
    ridge: [],
    frontPath: toFloor(`M0 ${n1(a)} C 100 ${n1(a - 22)} 190 ${n1(b + 18)} 300 ${n1(b - 4)}`),
  };
}

/** 初中: 一排雪山 + 太阳 */
function peaks(r: Rand): Scene {
  const xs = [0, 50 + r(-6, 6), 104 + r(-6, 6), 158 + r(-6, 6), 212 + r(-6, 6), 262 + r(-6, 6), 300];
  const ys = [r(196, 206), r(150, 166), r(186, 198), r(138, 156), r(184, 196), r(150, 168), r(194, 206)];
  const pts = xs.map((x, i) => [x, ys[i]] as const);
  const ridge: JacketShape[] = [];
  for (const i of [1, 3, 5]) {
    const [px, py] = pts[i];
    const [lx, ly] = pts[i - 1];
    const [rx, ry] = pts[i + 1];
    const t = 0.3;
    const L = [px + (lx - px) * t, py + (ly - py) * t];
    const R = [px + (rx - px) * t, py + (ry - py) * t];
    // 雪线往里收的两个点各按自己那一侧的坡算,两边坡度不一样时也不会戳出山外
    const dipL = py + (L[1] - py) * 0.62;
    const dipR = py + (R[1] - py) * 0.62;
    const mid = py + (Math.min(L[1], R[1]) - py) * 0.82;
    ridge.push({
      kind: 'path',
      d: `M${n1(px)} ${n1(py)}L${n1(R[0])} ${n1(R[1])}L${n1(px + (R[0] - px) * 0.42)} ${n1(dipR)}`
        + `L${n1(px)} ${n1(mid)}L${n1(px + (L[0] - px) * 0.42)} ${n1(dipL)}L${n1(L[0])} ${n1(L[1])}Z`,
      fill: 'glow',
      opacity: 0.88,
    });
  }
  const a = r(230, 238), b = r(226, 236);
  return {
    sky: [{ kind: 'circle', cx: n1(r(238, 262)), cy: n1(r(146, 160)), r: n1(r(22, 28)), fill: 'glow', body: true }],
    backPath: toFloor(`M${pts.map(([x, y]) => `${n1(x)} ${n1(y)}`).join(' L')}`),
    ridge,
    frontPath: toFloor(`M0 ${n1(a)} C 80 ${n1(a - 14)} 200 ${n1(b - 16)} 300 ${n1(b)}`),
  };
}

/** 一排圆弧云边: 从 x=0 到 300,每段宽 w 上下浮动 */
function scallops(r: Rand, y: number, w: number, flat: number): string {
  let x = 0;
  let d = `M0 ${n1(y + r(-3, 3))}`;
  while (x < 300) {
    const step = Math.min(300 - x, w * r(0.8, 1.2));
    x += step;
    const rad = step * flat * r(0.9, 1.15);
    d += ` A${n1(rad)} ${n1(rad)} 0 0 1 ${n1(x)} ${n1(y + r(-4, 4))}`;
  }
  return d;
}

/** 高中: 云海 + 月亮 + 星星 */
function clouds(r: Rand): Scene {
  const mx = r(242, 262), my = r(112, 126), mr = r(17, 21);
  const stars: Array<[number, number, number]> = [[288, 158, 6], [222, 190, 4], [276, 196, 4.5], [288, 72, 4]];
  const pick = stars.filter(() => r(0, 1) > 0.25).slice(0, 3);
  return {
    sky: [
      { kind: 'circle', cx: n1(mx), cy: n1(my), r: n1(mr), fill: 'glow', body: true },
      { kind: 'circle', cx: n1(mx + mr * 0.45), cy: n1(my - mr * 0.32), r: n1(mr * 0.86), fill: 'cover', body: true },
      ...(pick.length ? pick : stars.slice(0, 2)).map(([x, y, s]) => sparkle(x, y, s)),
    ],
    backPath: toFloor(scallops(r, r(200, 208), 62, 0.72)),
    ridge: [],
    frontPath: toFloor(scallops(r, r(232, 238), 52, 0.8)),
  };
}

/** 其它(四六级 / 雅思 / 校本 / 语法): 海浪 + 低低的太阳 + 水面反光 */
function waves(r: Rand): Scene {
  const y = r(198, 208), amp = r(10, 16), sign = r(0, 1) > 0.5 ? 1 : -1;
  const sx = r(232, 258);
  const glints: JacketShape[] = [0, 1, 2].map((i) => {
    const w = [26, 18, 10][i] * r(0.85, 1.15);
    const gx = sx - w / 2 + r(-4, 4);
    const gy = y + 10 + i * 6.5;
    return {
      kind: 'path' as const,
      d: `M${n1(gx)} ${n1(gy)}h${n1(w)}a1.3 1.3 0 0 1 0 2.6h${n1(-w)}a1.3 1.3 0 0 1 0-2.6z`,
      fill: 'glow' as const,
      opacity: 0.55 - i * 0.12,
    };
  });
  const a = r(230, 238), fa = r(6, 9) * -sign;
  return {
    sky: [{ kind: 'circle', cx: n1(sx), cy: n1(y - 4), r: n1(r(26, 32)), fill: 'glow', body: true }],
    backPath: toFloor(
      `M0 ${n1(y)} C 50 ${n1(y - amp * sign)} 100 ${n1(y - amp * sign)} 150 ${n1(y)}`
      + ` C 200 ${n1(y + amp * sign)} 250 ${n1(y + amp * sign)} 300 ${n1(y)}`,
    ),
    ridge: glints,
    frontPath: toFloor(
      `M0 ${n1(a)} C 60 ${n1(a + fa)} 120 ${n1(a + fa)} 170 ${n1(a)} C 220 ${n1(a - fa)} 260 ${n1(a - fa)} 300 ${n1(a)}`,
    ),
  };
}

const SCENES: Record<JacketStage, (r: Rand) => Scene> = { primary: hills, junior: peaks, senior: clouds, other: waves };

export function toneOf(book: Pick<JacketBook, 'name' | 'grade_level'>): JacketTone {
  const grade = gradeOf(book);
  if (grade) return TONES[GRADE_TONE[grade]];
  return TONES[HASH_TONES[hash(book.name) % HASH_TONES.length]];
}

/** 书架上每本书高矮略有不同(像真书架),按书名定: 4:3 / 97% / 94%,写成 padding-top 百分比 */
export function shelfRatioOf(name: string): string {
  return ['133.33%', '129.33%', '125.33%'][hash(`h:${name}`) % 3];
}

export function jacketOf(book: JacketBook): Jacket {
  const series = (book.series ?? '').trim();
  const stage = stageOf(book);
  return {
    tone: toneOf(book),
    mark: markOf(book),
    stage,
    imprint: series && !book.name.includes(series) ? series : null,
    ...SCENES[stage](seeded(hash(book.name))),
  };
}
