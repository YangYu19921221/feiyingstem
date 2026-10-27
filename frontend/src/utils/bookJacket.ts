/**
 * 书架书封(components/book/BookJacket)的取色、封面大字和纸片层形状 —— 全部按书名现算,不出图。
 *
 * 为什么不用图: 原来没有封面的书用 public/book-cover-1..4.jpeg,四张图上印着假的英文书名
 * (「ENGLISH VOYAGE」「SPACE EXPLORATION Grades 7–9」),人教版七年级上册顶着别人的书名,
 * 真书名只能写在图下面。生产 66 本书 0 本有 cover_url,所有孩子看到的都是那四张。
 *
 * 规则:
 * - **只看书名**(版别 series 只用于左上角小字): 作业页的接口只给 book_id + 书名,
 *   要让同一本书在书架和作业页长得一样,就不能用书名以外的字段决定颜色和大字。
 * - 颜色按年级: 同一年级上下册同色(像一套课本),年级之间换色;书名里没有年级的按书名散列,刷新不变色。
 * - 封面大字是老师孩子平时的叫法: 七年级上册 =「7上」、必修一 =「必修1」、CET4、3500 词 =「3500」。
 *   认不出的取书名前两个汉字(去掉「人教版 / 飞鹰」这类前缀)。
 */

export interface JacketBook {
  id: number;
  name: string;
  series?: string | null;
  cover_url?: string | null;
}

/**
 * cover 封面底色(天空)/ back 远处那层纸 / front 书名那层纸 / ink 书名字色 /
 * mark、markShadow 封面大字和它下面那层纸影 / glow 纸太阳 / accent 书签带、进度条
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

// 深色几套: 封面底色、书名那层对白字都 ≥ 4.5:1(左上角版别是小字,直接压在底色上)。
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

export interface Jacket {
  tone: JacketTone;
  mark: JacketMark;
  /** 左上角版别(书名里已经有就不重复) */
  imprint: string | null;
  /** 远处那层纸、书名那层纸的 SVG path 和纸太阳(viewBox 0 0 300 400) */
  backPath: string;
  frontPath: string;
  sun: { cx: number; cy: number; r: number };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** 一到九年级 → 1..9,高一到高三 → 10..12;认不出 null */
export function gradeOf(name: string): number | null {
  // 「3-6年级总复习」是跨年级的书,不能当成六年级
  if (/\d\s*[-–~至到]\s*\d\s*年级/.test(name)) return null;
  const cn = name.match(/([一二三四五六七八九])年级/);
  if (cn) return CN_DIGIT[cn[1]];
  const ar = name.match(/([1-9])\s*年级/);
  if (ar) return Number(ar[1]);
  const senior = name.match(/高([一二三])/);
  if (senior) return 9 + CN_DIGIT[senior[1]];
  return null;
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
  const size = Math.min(cjk ? 32 : 60, MARK_ROOM / Math.max(mainEm + smallEm, 0.1));
  return { prefix, main, suffix, cjk, size: Math.round(size * 10) / 10 };
}

/** 去掉品牌 / 版别前缀后再取汉字 */
const NAME_PREFIX = /^(?:新人教版|旧人教版|人教版|飞鹰|清华沙沙|大学英语|大学|中国|英语|\d{4})+/;

export function markOf(name: string): JacketMark {
  const n = name.trim();

  const range = n.match(/(\d)\s*[-–~至到]\s*(\d)\s*年级/);
  if (range) return sized('', `${range[1]}-${range[2]}`, '', false);

  const required = n.match(/(必修|选修)([一二三四五六])/);
  if (required) return sized(required[1], String(CN_DIGIT[required[2]]), '', false);

  const grade = gradeOf(n);
  const vol = n.match(/([上下])册/)?.[1] ?? '';
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

/**
 * 远处那层纸 + 书名那层纸 + 纸太阳。按书名散列定起伏,同一本书每次都一样。
 * 书名那层的上沿在 y≈210–240(53–60%),书名最多两行,排在这层纸里面。
 */
function scenery(seed: number): Pick<Jacket, 'backPath' | 'frontPath' | 'sun'> {
  const r = (shift: number, span: number) => (((seed >>> shift) & 0xff) / 255) * span;
  const b0 = 198 + r(0, 16);
  const b1 = 206 + r(8, 16);
  const f0 = 228 + r(16, 12);
  const f1 = 222 + r(24, 10);
  const flip = seed & 1;
  const backPath = flip
    ? `M0 ${b1} C 110 ${b1 - 44} 210 ${b0 - 30} 300 ${b0 - 8} L300 400 L0 400 Z`
    : `M0 ${b0 - 8} C 90 ${b0 - 30} 190 ${b1 - 44} 300 ${b1} L300 400 L0 400 Z`;
  const frontPath = flip
    ? `M0 ${f1 - 4} C 110 ${f1 + 18} 200 ${f0 - 22} 300 ${f0} L300 400 L0 400 Z`
    : `M0 ${f0} C 100 ${f0 - 22} 190 ${f1 + 18} 300 ${f1 - 4} L300 400 L0 400 Z`;
  // 太阳贴着右边、半落在远山后面: 左边是封面大字(最宽到 x≈232),右上角是书签带
  const cx = 238 + r(4, 26);
  return { backPath, frontPath, sun: { cx, cy: 186 + r(12, 10), r: 24 + r(20, 8) } };
}

export function toneOf(name: string): JacketTone {
  const grade = gradeOf(name);
  if (grade) return TONES[GRADE_TONE[grade]];
  return TONES[HASH_TONES[hash(name) % HASH_TONES.length]];
}

/** 书架上每本书高矮略有不同(像真书架),按书名定: 4:3 / 97% / 94%,写成 padding-top 百分比 */
export function shelfRatioOf(name: string): string {
  return ['133.33%', '129.33%', '125.33%'][hash(`h:${name}`) % 3];
}

export function jacketOf(book: JacketBook): Jacket {
  const series = (book.series ?? '').trim();
  return {
    tone: toneOf(book.name),
    mark: markOf(book.name),
    imprint: series && !book.name.includes(series) ? series : null,
    ...scenery(hash(book.name)),
  };
}
