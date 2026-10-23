/**
 * 体验卡印刷文件(浏览器里 canvas 现画,不经服务器)
 *
 * 成品 90×60mm,四边各 2mm 出血 → 94×64mm,300dpi = 1110×756 像素。
 * 背面底图 public/promo-card/back.png 是 AI 出的(1536×1024,中间留了一块纯白方框放二维码),
 * 二维码、卡号、小字由这里画上去 —— 生图模型画不准二维码,也画不准每张不同的卡号。
 * 正面 public/promo-card/front.jpg 每张一样,同样按出血尺寸铺满导出。
 *
 * 白框位置是对底图逐像素扫出来的(BACK_BOX),**换底图要重扫**,否则二维码会压到框外。
 */
import QRCode from 'qrcode';

const DPI = 300;
const MM = DPI / 25.4;
export const PRINT_W = Math.round(94 * MM);   // 1110
export const PRINT_H = Math.round(64 * MM);   // 756
export const BLEED_PX = Math.round(2 * MM);

const SRC_W = 1536;
const SRC_H = 1024;
/** 底图里白色方框(原图坐标 左,上,右,下) */
const BACK_BOX = { l: 148, t: 154, r: 612, b: 618 };
/** 「微信扫码 预约体验」下面那条纯米色带(印刷画布坐标,扫描所得) */
const SMALL_PRINT_Y = 527;

const FONT = '"PingFang SC","Microsoft YaHei","Hiragino Sans GB","Noto Sans SC",sans-serif';

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`图片加载失败: ${src}`));
    img.src = src;
  });
}

/** 按出血尺寸铺满(cover)居中裁,返回缩放比例与偏移,用来把底图坐标换算到画布 */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement) {
  const s = Math.max(PRINT_W / img.width, PRINT_H / img.height);
  const w = img.width * s;
  const h = img.height * s;
  const ox = (w - PRINT_W) / 2;
  const oy = (h - PRINT_H) / 2;
  ctx.drawImage(img, -ox, -oy, w, h);
  return { s, ox, oy };
}

function newCanvas() {
  const c = document.createElement('canvas');
  c.width = PRINT_W;
  c.height = PRINT_H;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持画图');
  return { c, ctx };
}

export async function drawCardFront(): Promise<HTMLCanvasElement> {
  const { c, ctx } = newCanvas();
  drawCover(ctx, await loadImage('/promo-card/front.jpg'));
  return c;
}

export interface BackOptions {
  url: string;          // 二维码内容(卡上印的固定网址)
  code: string;         // 卡码,印在二维码下面,电话里能念给家长
  smallPrint?: string;  // 有效期 / 限领说明
}

export async function drawCardBack({ url, code, smallPrint }: BackOptions): Promise<HTMLCanvasElement> {
  const { c, ctx } = newCanvas();
  const bg = await loadImage('/promo-card/back.png');
  if (bg.width !== SRC_W || bg.height !== SRC_H) {
    // 底图换了尺寸,白框坐标就对不上了: 宁可报错也别印出一批二维码压到框外的卡
    throw new Error('背面底图尺寸变了,需要重新标定二维码位置');
  }
  const { s, ox, oy } = drawCover(ctx, bg);
  const l = BACK_BOX.l * s - ox;
  const t = BACK_BOX.t * s - oy;
  const r = BACK_BOX.r * s - ox;
  const b = BACK_BOX.b * s - oy;

  const no = `NO. ${code}`;
  ctx.font = `600 22px ${FONT}`;
  const noH = 24;
  const inner = 18;
  const side = Math.floor(Math.min(r - l - 2 * inner, b - t - 2 * inner - noH - 10));
  // 纠错等级 M: 卡片会被揉、被茶水溅,比 L 稳;码再密就要更大的印刷尺寸
  const qr = await loadImage(await QRCode.toDataURL(url, {
    errorCorrectionLevel: 'M', margin: 0, width: side * 2, color: { dark: '#3D2B1F', light: '#FFFFFF' },
  }));
  const qx = l + (r - l - side) / 2;
  const qy = t + inner;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(qr, qx, qy, side, side);
  ctx.imageSmoothingEnabled = true;

  ctx.fillStyle = '#3D2B1F';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText(no, (l + r) / 2, qy + side + 8);

  if (smallPrint) {
    ctx.font = `400 19px ${FONT}`;
    ctx.fillStyle = '#7D6250';
    ctx.fillText(smallPrint, (l + r) / 2, SMALL_PRINT_Y);
  }
  return c;
}

function toBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('导出失败'))), 'image/png'));
}

export async function downloadCanvas(c: HTMLCanvasElement, fileName: string): Promise<void> {
  const blob = await toBlob(c);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** 预览用: 裁掉出血,只看成品范围 */
export function trimmedDataUrl(c: HTMLCanvasElement): string {
  const out = document.createElement('canvas');
  out.width = PRINT_W - 2 * BLEED_PX;
  out.height = PRINT_H - 2 * BLEED_PX;
  out.getContext('2d')?.drawImage(c, -BLEED_PX, -BLEED_PX);
  return out.toDataURL('image/png');
}

export const DEFAULT_SMALL_PRINT = '2026.12.31 前有效 · 每个手机号限领 1 张';
