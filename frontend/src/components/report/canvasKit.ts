/**
 * 家长分享图(学习报告 / 今日学习报告)共用的 canvas 画法
 *
 * 为什么 canvas 现画、不让 AI 出整张图: 生图模型画不准中文和单词表(会编字母),每张 15–60 秒还按张计费。
 * AI 只出了三张不带字的吉祥物插画(public/report-card/*.jpg,脚本 backend/scripts/gen_report_card_art.py),
 * 字、分数、单词全部来自孩子的真实作答。
 */
import type { ReportTier } from '../../utils/learningReport';

export const W = 750;                 // 逻辑宽度,布局都按它算
const SCALE = 1.5;                    // 输出 1125 像素宽: 发到群里点开放大,字不糊
/** 画布像素总量上限。iOS Safari 超过约 1678 万像素直接画不出(toDataURL 返回空图),留余量 */
const MAX_PIXELS = 12_000_000;
export const PAD = 40;
export const CONTENT_W = W - PAD * 2;
const FAMILY = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif';
export const font = (size: number, weight = 400) => `${weight} ${size}px ${FAMILY}`;

export const HEADER_H = 340;
export const CARD_Y = 300;            // 成绩卡压在橙色头图下沿
export const TITLE_H = 56;
export const SECTION_GAP = 36;
export const FOOTER_H = 120;

export const TIER_COLOR: Record<ReportTier, { main: string; soft: string }> = {
  excellent: { main: '#FF6B35', soft: '#FFE8DD' },
  good: { main: '#F59E0B', soft: '#FEF3C7' },
  // 低分不用红色: 图要发到群里,红字分数等于当众难堪,蓝色是「还在路上」
  keep: { main: '#0EA5E9', soft: '#E0F2FE' },
};

/** canvas 的 roundRect 要 iOS 16+ / Chrome 99+,老 iPhone 的微信里没有,退成直角矩形 */
export function fillRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
  ctx.fill();
}

/** 放不下就截断加省略号(按字符而非 UTF-16 码元截,不会切坏生僻字) */
export function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  const chars = Array.from(text);
  while (chars.length > 0 && ctx.measureText(`${chars.join('')}…`).width > maxW) chars.pop();
  return `${chars.join('')}…`;
}

/** 折行。英文单词整体不拆(建议里常有「apple 写成了 aple」),中文逐字可断;超出行数末行加省略号 */
export function breakLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const tokens = text.match(/[A-Za-z0-9'’-]+|[\s\S]/gu) ?? [];
  const lines: string[] = [];
  let line = '';
  for (let i = 0; i < tokens.length; i += 1) {
    const test = line + tokens[i];
    // 标点不放行首(「。」单独掉到下一行很难看),宁可这一行略超一点
    if (line && /^[，。、；：！？）」』”,.;:!?)]$/.test(tokens[i])) {
      line = test;
      continue;
    }
    if (line && ctx.measureText(test).width > maxW) {
      if (lines.length === maxLines - 1) {
        lines.push(fitText(ctx, line + tokens.slice(i).join(''), maxW));
        return lines;
      }
      lines.push(line.trimEnd());
      line = tokens[i].trimStart();
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function sectionTitle(ctx: CanvasRenderingContext2D, y: number, title: string, bar: string, extra?: string) {
  ctx.textAlign = 'left';
  ctx.fillStyle = bar;
  fillRoundRect(ctx, PAD, y + 8, 8, 30, 4);
  ctx.fillStyle = '#1F2937';
  ctx.font = font(32, 800);
  ctx.fillText(title, PAD + 20, y + 34);
  if (extra) {
    ctx.fillStyle = '#9CA3AF';
    ctx.font = font(24, 500);
    ctx.textAlign = 'right';
    ctx.fillText(extra, W - PAD, y + 34);
    ctx.textAlign = 'left';
  }
}

export function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);   // 插画丢了照样出报告,只是少一只鹰
    img.src = src;
  });
}

export function tierArt(tier: ReportTier): Promise<HTMLImageElement | null> {
  return loadImage(`${import.meta.env.BASE_URL}report-card/${tier}.jpg`);
}

/** 量字用的离屏 context(排版先算总高,再按总高建画布 —— canvas 改尺寸会清空内容,不能边画边长) */
export function measureContext(): CanvasRenderingContext2D {
  const m = document.createElement('canvas').getContext('2d');
  if (!m) throw new Error('canvas unavailable');
  return m;
}

/** 按总高建画布。图特别长时超出像素上限就降清晰度,不让整张图画不出来 */
export function prepareCanvas(canvas: HTMLCanvasElement, height: number): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  const scale = Math.min(SCALE, Math.sqrt(MAX_PIXELS / (W * height)));
  canvas.width = Math.round(W * scale);
  canvas.height = Math.round(height * scale);
  ctx.scale(scale, scale);
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#FFF8F0';
  ctx.fillRect(0, 0, W, height);
  return ctx;
}

/** 橙色头图 + 右上吉祥物徽章 + 左侧 机构名/标题/几行说明/日期 */
export function drawHeader(
  ctx: CanvasRenderingContext2D,
  opts: { orgName: string | null; title: string; lines: string[]; meta: string; art: HTMLImageElement | null },
) {
  const g = ctx.createLinearGradient(0, 0, W, HEADER_H);
  g.addColorStop(0, '#FF6B35');
  g.addColorStop(1, '#FF9A5C');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, HEADER_H);

  // 插画是白底图,放进白色圆里就没有抠图毛边
  const cx = W - PAD - 120;
  const cy = 160;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(cx, cy, 124, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#FFD23F';
  ctx.lineWidth = 6;
  ctx.stroke();
  if (opts.art) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 116, 0, Math.PI * 2);
    ctx.clip();
    ctx.drawImage(opts.art, cx - 116, cy - 116, 232, 232);
    ctx.restore();
  }

  // 文字在左侧,让出徽章的位置
  const textMax = cx - 124 - 20 - PAD;
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = font(26, 600);
  ctx.fillText(fitText(ctx, opts.orgName || '学习报告', textMax), PAD, 68);

  let size = 50;
  ctx.font = font(size, 900);
  while (size > 36 && ctx.measureText(opts.title).width > textMax) {
    size -= 2;
    ctx.font = font(size, 900);
  }
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(fitText(ctx, opts.title, textMax), PAD, 138);

  let ly = 188;
  ctx.font = font(26, 500);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  for (const ln of opts.lines) {
    ctx.fillText(fitText(ctx, ln, textMax), PAD, ly);
    ly += 38;
  }
  ctx.font = font(22, 500);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(fitText(ctx, opts.meta, textMax), PAD, ly);
}

/** 白色卡片(带阴影) */
export function drawCard(ctx: CanvasRenderingContext2D, y: number, h: number) {
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.08)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 8;
  ctx.fillStyle = '#FFFFFF';
  fillRoundRect(ctx, PAD, y, CONTENT_W, h, 28);
  ctx.restore();
}

/** 成绩卡下方三栏小数字(数值 + 单位 + 说明) */
export function drawStats(ctx: CanvasRenderingContext2D, baseline: number, stats: Array<[string, string, string]>) {
  const colW = CONTENT_W / stats.length;
  stats.forEach(([value, unit, caption], i) => {
    const center = PAD + colW * i + colW / 2;
    ctx.font = font(40, 800);
    const vw = ctx.measureText(value).width;
    ctx.font = font(22, 500);
    const uw = unit ? ctx.measureText(unit).width : 0;
    const left = center - (vw + uw) / 2;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#1F2937';
    ctx.font = font(40, 800);
    ctx.fillText(value, left, baseline);
    if (unit) {
      ctx.fillStyle = '#6B7280';
      ctx.font = font(22, 500);
      ctx.fillText(unit, left + vw, baseline);
    }
    ctx.textAlign = 'center';
    ctx.fillStyle = '#9CA3AF';
    ctx.font = font(22);
    ctx.fillText(caption, center, baseline + 32);
  });
  ctx.textAlign = 'left';
}

// ---- 「还要多练」行: 正确拼写 + 中文 + 孩子当时写成什么(划掉) ----
export const ROW_H = 80;
export const ROW_GAP = 12;
export const EMPTY_H = 84;
export const MORE_H = 44;

export interface WeakRow {
  word: string;
  meaning: string | null;
  wrote: string | null;
}

/** 多练区高度(不含标题) */
export function weakBlockHeight(shown: number, more: number): number {
  let h = shown === 0 ? EMPTY_H : shown * (ROW_H + ROW_GAP) - ROW_GAP;
  if (more > 0) h += MORE_H;
  return h;
}

export function drawWeakRows(
  ctx: CanvasRenderingContext2D, top: number, rows: WeakRow[], more: number,
  texts: { empty: string; more: string },
) {
  let y = top;
  if (rows.length === 0) {
    ctx.fillStyle = '#ECFDF3';
    fillRoundRect(ctx, PAD, y, CONTENT_W, EMPTY_H, 18);
    ctx.fillStyle = '#15803D';
    ctx.font = font(26, 700);
    ctx.fillText(fitText(ctx, texts.empty, CONTENT_W - 48), PAD + 24, y + 52);
    return;
  }
  for (const w of rows) {
    ctx.fillStyle = '#FFF4ED';
    fillRoundRect(ctx, PAD, y, CONTENT_W, ROW_H, 18);
    const base = y + 50;
    const right = W - PAD - 24;
    let rightW = 0;
    if (w.wrote) {
      ctx.font = font(26, 600);
      const wrote = fitText(ctx, w.wrote, 200);
      const ww = ctx.measureText(wrote).width;
      ctx.fillStyle = '#EF4444';
      ctx.textAlign = 'right';
      ctx.fillText(wrote, right, base);
      ctx.fillRect(right - ww, base - 9, ww, 2.5);   // 删除线
      ctx.fillStyle = '#9CA3AF';
      ctx.font = font(20, 500);
      ctx.fillText('写成', right - ww - 10, base);
      rightW = ww + 10 + ctx.measureText('写成').width + 24;
      ctx.textAlign = 'left';
    }
    const leftMax = CONTENT_W - 48 - rightW;
    ctx.fillStyle = '#1F2937';
    ctx.font = font(30, 800);
    const word = fitText(ctx, w.word, leftMax);
    ctx.fillText(word, PAD + 24, base);
    const wordW = ctx.measureText(word).width;
    if (w.meaning) {
      ctx.font = font(22);
      ctx.fillStyle = '#6B7280';
      const room = leftMax - wordW - 14;
      if (room > 40) ctx.fillText(fitText(ctx, w.meaning, room), PAD + 24 + wordW + 14, base);
    }
    y += ROW_H + ROW_GAP;
  }
  y -= ROW_GAP;
  if (more > 0) {
    ctx.fillStyle = '#9CA3AF';
    ctx.font = font(22);
    ctx.fillText(texts.more, PAD + 4, y + 32);
  }
}

// ---- 「给家长的建议」卡片 ----
const TIP_PAD = 24;
const TIP_INDENT = 44;
const TIP_SIZE = 26;
const TIP_LINE_H = 40;
const TIP_GAP = 14;

export function layoutTips(m: CanvasRenderingContext2D, suggestions: string[]): { lines: string[][]; cardH: number } {
  m.font = font(TIP_SIZE);
  const lines = suggestions.map(s => breakLines(m, s, CONTENT_W - TIP_PAD * 2 - TIP_INDENT, 3));
  const body = lines.reduce((sum, l) => sum + l.length * TIP_LINE_H, 0) + Math.max(0, lines.length - 1) * TIP_GAP;
  return { lines, cardH: body + TIP_PAD * 2 };
}

export function drawTips(ctx: CanvasRenderingContext2D, top: number, tips: { lines: string[][]; cardH: number }) {
  ctx.fillStyle = '#FFF7E0';
  fillRoundRect(ctx, PAD, top, CONTENT_W, tips.cardH, 20);
  let ty = top + TIP_PAD;
  tips.lines.forEach((tipLines, i) => {
    const nx = PAD + TIP_PAD + 16;
    ctx.fillStyle = '#FF6B35';
    ctx.beginPath();
    ctx.arc(nx, ty + 18, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = font(20, 800);
    ctx.textAlign = 'center';
    ctx.fillText(String(i + 1), nx, ty + 25);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#374151';
    ctx.font = font(TIP_SIZE);
    tipLines.forEach((ln, j) => ctx.fillText(ln, PAD + TIP_PAD + TIP_INDENT, ty + 28 + j * TIP_LINE_H));
    ty += tipLines.length * TIP_LINE_H + TIP_GAP;
  });
}

/** 落款: 加盟机构的家长看到的是本机构的名字(调用方传「机构名 || 兜底文字」) */
export function drawFooter(ctx: CanvasRenderingContext2D, top: number, signature: string, note: string) {
  ctx.fillStyle = '#E5E7EB';
  ctx.fillRect(PAD, top, CONTENT_W, 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#FF6B35';
  ctx.font = font(26, 800);
  ctx.fillText(fitText(ctx, signature, CONTENT_W), W / 2, top + 52);
  ctx.fillStyle = '#9CA3AF';
  ctx.font = font(20);
  ctx.fillText(note, W / 2, top + 86);
  ctx.textAlign = 'left';
}
