/**
 * 授课舞台的浮窗几何:自由悬停、各自改大小、**任何时刻都不重叠**
 *
 * 抽成纯函数(不碰 DOM、不依赖 React)是为了能穷举验算 —— 碰撞靠在浏览器里点是点不全的。
 * 第一版就是这么栽的:只推「被拖的那块」,另一块钉在中间时左右都塞不下,
 * 四个方向全被夹回舞台内、仍然压着(20000 次随机拖动里 2846 次没解开)。
 *
 * 现在的语义:**被拖的那块说话算数,另一块让位** ——
 *   ① 先把另一块沿穿透最浅的方向推开;
 *   ② 推不动(舞台里没它的位置)就把它**缩小**到旁边最大的空档;
 *   ③ 连最小宽度都放不下,才拒绝这次拖放(调用方保持原布局)。
 * 由此得到一个硬保证:settle() 要么给出不重叠的布局,要么返回 null,绝不返回重叠。
 *
 * 约定:高度**由宽度算出**(16:9 内容 + 抓手条),所以「改大小」只有一个自由度,
 * 碰撞与夹取都只跟宽度打交道。
 */

export interface Size { w: number; h: number }
export interface Box { x: number; y: number; w: number; h: number }
export interface Layout { video: Box; material: Box }

/** 再窄播放控件就点不动了 */
export const MIN_W = 200;
/** 抓手条高度(px),改它的 padding/图标尺寸要跟着改这里(浏览器里量过 30) */
export const CHROME_H = 30;
/**
 * 讲义块除抓手条外还有两条固定高的东西(**浏览器里量的实测值**):
 * 顶栏 56 + 翻页条 48 = 104。
 * ⚠️ 不把它们算进高度,会让「模型高度」比实际矮 —— 碰撞按模型判,
 * 于是模型说不重叠、屏幕上却压住了,而且底边会捅出舞台(实测超出 50px)。
 * 视频块没有这两条,所以两块的额外高度不同,必须分开算。
 * **改顶栏/翻页条的 padding 或字号就要回浏览器重新量**:取块内所有非 absolute
 * 子节点,把画面区之外的高度加起来(第一版按 108 写,改小顶栏后实测 104)。
 */
export const MATERIAL_EXTRA_H = 104;
/** 两块之间、以及和舞台边缘留的空隙 */
export const GAP = 8;

export type PaneKind = 'video' | 'material';

/** 某类块除 16:9 画面之外占掉的高度 */
export function chromeHeight(kind: PaneKind): number {
  return kind === 'material' ? CHROME_H + MATERIAL_EXTRA_H : CHROME_H;
}

/** 宽度 → 整块高度。**高度由宽度算出**,所以改大小只有一个自由度 */
export function paneHeight(w: number, kind: PaneKind = 'video'): number {
  return Math.round((w * 9) / 16) + chromeHeight(kind);
}

export function makeBox(x: number, y: number, w: number, kind: PaneKind = 'video'): Box {
  return { x, y, w, h: paneHeight(w, kind) };
}

/** 舞台装得下的最大宽度(高度也不能超) */
export function maxWidthIn(stage: Size, kind: PaneKind = 'video'): number {
  const byW = stage.w - GAP * 2;
  const byH = ((stage.h - GAP * 2 - chromeHeight(kind)) * 16) / 9;
  return Math.max(MIN_W, Math.floor(Math.min(byW, byH)));
}

/**
 * 舞台够不够摆两块**互不重叠**的浮窗(各按最小宽度算)。
 * 装不下就该退回上下堆叠 —— 硬摆只能靠重叠,而用户要的正是不重叠。
 * 真机最窄的横屏(iPhone SE 568×320)是够的,这里挡的是被拖得很小的桌面窗口。
 */
export function canHostFloating(stage: Size): boolean {
  // 讲义那块更高(多了顶栏和翻页条),按它算才不会「摆得下但实际压住」
  const minH = paneHeight(MIN_W, 'material');
  const minHV = paneHeight(MIN_W, 'video');
  const sideBySide = MIN_W * 2 + GAP * 3 <= stage.w && minH + GAP * 2 <= stage.h;
  const stacked = minH + minHV + GAP * 3 <= stage.h && MIN_W + GAP * 2 <= stage.w;
  return sideBySide || stacked;
}

/** 位置夹进舞台内(尺寸不动)。舞台比块还小时贴左上,别让它跑到负坐标去 */
export function clampBox(b: Box, stage: Size): Box {
  const maxX = Math.max(GAP, stage.w - b.w - GAP);
  const maxY = Math.max(GAP, stage.h - b.h - GAP);
  return {
    ...b,
    x: Math.round(Math.min(maxX, Math.max(GAP, b.x))),
    y: Math.round(Math.min(maxY, Math.max(GAP, b.y))),
  };
}

export function overlaps(a: Box, b: Box, gap = GAP): boolean {
  return (
    a.x < b.x + b.w + gap &&
    b.x < a.x + a.w + gap &&
    a.y < b.y + b.h + gap &&
    b.y < a.y + a.h + gap
  );
}

/**
 * 把 moving 推出 fixed —— 沿**穿透最浅**的方向挪,手感是「撞上去然后贴着滑」,
 * 而不是被弹到老远。夹回舞台后有可能又撞上,所以每个候选都要复查。
 * 推不开就返回 null,由 settle 去做「缩小让位」。
 */
export function pushOut(moving: Box, fixed: Box, stage: Size, gap = GAP): Box | null {
  const inside = clampBox(moving, stage);
  if (!overlaps(inside, fixed, gap)) return inside;
  const cands = [
    { x: fixed.x - gap - moving.w, y: moving.y },
    { x: fixed.x + fixed.w + gap, y: moving.y },
    { x: moving.x, y: fixed.y - gap - moving.h },
    { x: moving.x, y: fixed.y + fixed.h + gap },
  ]
    .map((c) => ({ ...c, d: Math.abs(c.x - moving.x) + Math.abs(c.y - moving.y) }))
    .sort((a, b) => a.d - b.d);
  for (const c of cands) {
    const cand = clampBox({ ...moving, x: c.x, y: c.y }, stage);
    if (!overlaps(cand, fixed, gap)) return cand;
  }
  return null;
}

/** anchor 四周的空白矩形(不含间隙),按面积从大到小 */
function freeSlots(anchor: Box, stage: Size, gap = GAP): Box[] {
  const slots: Box[] = [
    { x: gap, y: gap, w: anchor.x - gap - gap, h: stage.h - gap * 2 },                                  // 左
    { x: anchor.x + anchor.w + gap, y: gap, w: stage.w - (anchor.x + anchor.w) - gap * 2, h: stage.h - gap * 2 }, // 右
    { x: gap, y: gap, w: stage.w - gap * 2, h: anchor.y - gap - gap },                                  // 上
    { x: gap, y: anchor.y + anchor.h + gap, w: stage.w - gap * 2, h: stage.h - (anchor.y + anchor.h) - gap * 2 }, // 下
  ];
  return slots.filter((s) => s.w > 0 && s.h > 0).sort((a, b) => b.w * b.h - a.w * a.h);
}

/** 在 slot 里放一块宽度尽量大(不超 want)的块,居中;放不下返回 null */
function fitInSlot(slot: Box, want: number, stage: Size, kind: PaneKind): Box | null {
  const byW = slot.w;
  const byH = ((slot.h - chromeHeight(kind)) * 16) / 9;
  const w = Math.floor(Math.min(want, byW, byH, maxWidthIn(stage, kind)));
  if (w < MIN_W) return null;
  const box = makeBox(0, 0, w, kind);
  box.x = Math.round(slot.x + (slot.w - box.w) / 2);
  box.y = Math.round(slot.y + (slot.h - box.h) / 2);
  return clampBox(box, stage);
}

/**
 * 落定一次拖动/改大小:moved 是用户刚操作的那块,other 让位。
 * @param otherKind other 是哪一类 —— 缩小让位时要按它自己的高度公式算
 * @returns 不重叠的两块;实在放不下 other 时返回 null(调用方保持原布局)
 */
export function settle(
  moved: Box, other: Box, stage: Size, otherKind: PaneKind, gap = GAP,
): { moved: Box; other: Box } | null {
  const m = clampBox(moved, stage);
  if (!overlaps(m, other, gap)) return { moved: m, other };

  // ① 原样推开
  const pushed = pushOut(other, m, stage, gap);
  if (pushed) return { moved: m, other: pushed };

  // ② 缩小让位:挑 m 四周最大的空档,尽量保持原宽度
  for (const slot of freeSlots(m, stage, gap)) {
    const placed = fitInSlot(slot, other.w, stage, otherKind);
    if (placed && !overlaps(placed, m, gap)) return { moved: m, other: placed };
  }

  // ③ 放不下:拒绝这次拖放
  return null;
}

/**
 * 拖大时允许到的最大宽度:不超舞台、且不吃到另一块身上。
 * 只在**会撞上**时才卡住 —— 另一块在旁边但错开位置时照样能拖到满。
 */
export function widthCapAgainst(
  box: Box, fixed: Box, stage: Size, kind: PaneKind, gap = GAP,
): number {
  const hard = Math.min(maxWidthIn(stage, kind), stage.w - box.x - gap);
  let hi = Math.max(MIN_W, Math.floor(hard));
  if (!overlaps(makeBox(box.x, box.y, hi, kind), fixed, gap)) return hi;
  let lo = MIN_W;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (overlaps(makeBox(box.x, box.y, mid, kind), fixed, gap)) hi = mid - 1;
    else lo = mid;
  }
  return Math.max(MIN_W, lo);
}

/**
 * 默认铺位:讲义占左边大半,视频一列在右边,各自垂直居中。
 *
 * ⚠️ 一个不得不认的取舍:**不重叠 = 讲义拿不到整个舞台**。
 * 视频浮在讲义上面时讲义能有 1318px(1366 屏),分开摆之后约 990px。
 * 仍是「并排各占一半」那版(467px)的两倍多,但确实比铺满窄 —— 这是「不重叠」
 * 的直接代价,不是实现偷懒。想让讲义更大就把视频拖窄,或点「重排」。
 */
export function defaultLayout(stage: Size): Layout {
  const vHard = maxWidthIn(stage, 'video');
  const mHard = maxWidthIn(stage, 'material');
  const vw = Math.min(vHard, Math.round(Math.min(380, Math.max(MIN_W, stage.w * 0.24))));
  const mw = Math.min(mHard, Math.max(MIN_W, stage.w - vw - GAP * 3));
  const material = clampBox(
    { ...makeBox(GAP, 0, mw, 'material'),
      y: Math.max(GAP, Math.round((stage.h - paneHeight(mw, 'material')) / 2)) }, stage);
  const video = clampBox(
    { ...makeBox(stage.w - vw - GAP, 0, vw, 'video'),
      y: Math.max(GAP, Math.round((stage.h - paneHeight(vw, 'video')) / 2)) }, stage);
  const s = settle(material, video, stage, 'video');
  return s ? { material: s.moved, video: s.other } : { material, video };
}

/** 舞台尺寸变了(缩窗/转屏):夹回去并解开重叠,各自大小尽量不变 */
export function refit(layout: Layout, stage: Size): Layout {
  const material = clampBox(
    makeBox(layout.material.x, layout.material.y,
      Math.min(layout.material.w, maxWidthIn(stage, 'material')), 'material'), stage);
  const video = clampBox(
    makeBox(layout.video.x, layout.video.y,
      Math.min(layout.video.w, maxWidthIn(stage, 'video')), 'video'), stage);
  // 讲义是主角,让视频让位;实在放不下就整个回到默认铺位
  const s = settle(material, video, stage, 'video');
  return s ? { material: s.moved, video: s.other } : defaultLayout(stage);
}
