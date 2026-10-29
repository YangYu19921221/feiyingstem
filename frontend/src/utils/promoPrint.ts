/**
 * 体验卡印刷文件(浏览器里 canvas 现画,不经服务器)
 *
 * 成品 90×60mm,四边各 2mm 出血 → 94×64mm,300dpi = 1110×756 像素。
 * 20 套模板(data/promoTemplates.ts): 正面/背面底图都是 AI 出的 1536×1024,背面中间留了一块纯白方框。
 * 程序往上画三样「每版卡不一样」的东西 —— 生图模型画不准二维码,也写不准每个老师的名字和电话:
 * ① 背面白框里: 二维码 + 老师名字电话 + 卡号  ② 正面底部一条: 老师名字电话(一眼分得清是谁的卡)
 *   + 校区地址(10-29 起,机构「设置」里填,全机构的卡一样;换了地址重新下载就是新地址)
 *
 * 白框位置是对每张底图逐像素扫出来的(模板的 box),**换底图要重扫**;画之前检查框里是不是白的,
 * 不是就报错不出图 —— 宁可报错,也别印出一批二维码压到花纹上的卡。
 * ③ 正面徽章里的价格: 按机构「设置」里的体验价现画(底图已去掉原来的 ¥99),排版与缩略图共用 utils/promoPrice。
 */
import QRCode from 'qrcode';
import { templateImg, templateOf, type PromoTemplate } from '../data/promoTemplates';
import { PRICE_FONT, priceLayout } from './promoPrice';

const DPI = 300;
const MM = DPI / 25.4;
export const PRINT_W = Math.round(94 * MM);   // 1110
export const PRINT_H = Math.round(64 * MM);   // 756
export const BLEED_PX = Math.round(2 * MM);
/** 安全区: 裁切误差约 1mm,字和二维码离成品边至少 3mm */
const SAFE_PX = BLEED_PX + Math.round(3 * MM);

const SRC_W = 1536;
const SRC_H = 1024;
const FONT = '"PingFang SC","Microsoft YaHei","Hiragino Sans GB","Noto Sans SC",sans-serif';

export interface CardPrintOptions {
  templateId: string;
  url: string;            // 二维码内容(卡上印的固定网址)
  code: string;           // 卡码,印在二维码下面,电话里能念给家长
  name: string;           // 卡上印的老师名字(空 = 不印)
  phone: string;          // 卡上印的电话(空 = 不印)
  price: number;          // 正面徽章里的体验价(机构「设置」里的,元)
  address: string;        // 正面底部名字电话下面印的地址(机构「设置」里的,空 = 不印)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`图片加载失败: ${src}`));
    img.src = src;
  });
}

function newCanvas() {
  const c = document.createElement('canvas');
  c.width = PRINT_W;
  c.height = PRINT_H;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('浏览器不支持画图');
  return { c, ctx };
}

/** 按出血尺寸铺满(cover)居中裁,返回把底图坐标换算到画布的函数 */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement) {
  if (img.width !== SRC_W || img.height !== SRC_H) {
    throw new Error('模板底图尺寸不对,需要重新标定二维码位置');
  }
  const s = Math.max(PRINT_W / img.width, PRINT_H / img.height);
  const ox = (img.width * s - PRINT_W) / 2;
  const oy = (img.height * s - PRINT_H) / 2;
  ctx.drawImage(img, -ox, -oy, img.width * s, img.height * s);
  return (x: number, y: number) => [x * s - ox, y * s - oy] as const;
}

/** 把文字缩到放得下(长名字、带区号的电话) */
function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: number, max: number, min: number, width: number) {
  let size = max;
  for (; size > min; size -= 1) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    if (ctx.measureText(text).width <= width) break;
  }
  ctx.font = `${weight} ${size}px ${FONT}`;
  return size;
}

/** 正面价格: 先描边(有的模板原来的字带描边)再填色。字体先等加载完,否则 canvas 会用兜底字体画 */
async function drawPrice(ctx: CanvasRenderingContext2D, tpl: PromoTemplate, price: number,
  map: (x: number, y: number) => readonly [number, number]) {
  const p = tpl.price;
  const L = priceLayout(p, price);
  const k = map(1, 0)[0] - map(0, 0)[0];
  try {
    await document.fonts?.load(`800 ${Math.round(L.size * k)}px "PromoPrice"`, '¥0123456789.');
  } catch { /* 字体没加载上就用兜底的圆体,照样能印 */ }
  const [yenX, base] = map(L.yenLeft, L.baseline);
  const [digX] = map(L.digitsLeft, 0);
  const parts: Array<[string, number, number]> = [['¥', yenX, L.yenSize * k], [L.digits, digX, L.size * k]];
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  if (p.stroke && p.sw) {
    ctx.strokeStyle = p.stroke;
    ctx.lineJoin = 'round';
    ctx.lineWidth = p.sw * 2 * k;
    for (const [t, x, sz] of parts) { ctx.font = `800 ${sz}px ${PRICE_FONT}`; ctx.strokeText(t, x, base); }
  }
  ctx.fillStyle = p.fill;
  for (const [t, x, sz] of parts) { ctx.font = `800 ${sz}px ${PRICE_FONT}`; ctx.fillText(t, x, base); }
}

function contactLine(name: string, phone: string) {
  return [name.trim(), phone.trim()].filter(Boolean).join('  ');
}

/** 地址前面的定位小图标(画的,不用 emoji —— 印刷机那边字体里不一定有,会印成方框) */
function drawPin(ctx: CanvasRenderingContext2D, left: number, midY: number, size: number) {
  const r = size * 0.28;
  const cx = left + r;
  const cy = midY - size * 0.12;
  ctx.beginPath();
  ctx.moveTo(cx, midY + size * 0.42);
  ctx.arc(cx, cy, r, Math.PI * 0.8, Math.PI * 2.2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.42, 0, Math.PI * 2);
  ctx.fill();
}

/** 正面底部那条的大小和位置(drawCardFront 用;单独导出是为了能拿 OCR 核对它压不压模板自己的字)。
 * 只有名字电话 = 原来那一条(一行,最宽 60% 卡宽);加了地址 = 两行,最宽 TWO_LINE_TEXT_W ——
 * 两行高了一截,50 套里有 10 套居中会压到底部的「扫码进群 预约体验」,这些换到 strip2 那边;
 * 宽度再大第 50 套哪边都放不下(10-29 按 OCR 文字框逐套量过,最宽 504 = 460 + 两边留白)。
 * 地址最多 22 个字(后端 CARD_ADDRESS_MAX),最小 20px(印出来约 1.7mm 高,再小家长看不清)正好放得下;
 * 名字电话特别长时缩到最小字号还放不下,就横向压一点(fillText 的 maxWidth),不让白条变宽压到模板的字 */
const TWO_LINE_TEXT_W = 460;
export function frontStripLayout(ctx: CanvasRenderingContext2D, o: Pick<CardPrintOptions, 'templateId' | 'name' | 'phone' | 'address'>) {
  const top = contactLine(o.name, o.phone);
  const addr = o.address.trim();
  if (!top && !addr) return null;
  // 印了地址就按两行那套宽度和位置算(只有地址没有名字电话时也是: 一行地址放宽了照样压第 37 套的字)
  const two = !!(top && addr);
  const maxText = addr ? TWO_LINE_TEXT_W : PRINT_W * 0.6;
  const padX = 22;
  const padY = 9;
  const lineGap = two ? 5 : 0;
  const pinGap = 6;
  let s1 = 0;
  let w1 = 0;
  if (top) {
    s1 = fitFont(ctx, top, 600, 30, two ? 18 : 20, maxText);
    w1 = Math.min(ctx.measureText(top).width, maxText);
  }
  let s2 = 0;
  let w2 = 0;
  if (addr) {
    // 地址比名字电话小一号: 主角是「谁的卡」,地址给想上门看看的家长。图标宽度按最大字号预留
    s2 = fitFont(ctx, addr, 500, 24, 20, maxText - 24 * 0.56 - pinGap);
    w2 = Math.min(s2 * 0.56 + pinGap + ctx.measureText(addr).width, maxText);
  }
  const w = Math.max(w1, w2) + padX * 2;
  const h = padY * 2 + s1 + s2 + lineGap;
  const tpl = templateOf(o.templateId);
  const side = addr ? (tpl.strip2 ?? tpl.strip) : tpl.strip;
  const x = side === 'l' ? SAFE_PX : side === 'r' ? PRINT_W - SAFE_PX - w : (PRINT_W - w) / 2;
  const y = PRINT_H - SAFE_PX - h + 6;
  return { x, y, w, h, top, addr, s1, s2, padY, padX, lineGap, pinGap };
}

export async function drawCardFront(o: CardPrintOptions): Promise<HTMLCanvasElement> {
  const { c, ctx } = newCanvas();
  const tpl = templateOf(o.templateId);
  const map = drawCover(ctx, await loadImage(templateImg(tpl.id, 'front')));
  await drawPrice(ctx, tpl, o.price, map);
  const L = frontStripLayout(ctx, o);
  if (L) {
    // 底部一条半透明白底: 不管模板什么配色都看得清。默认居中;个别模板居中会压到它自己底部的字
    // (strip 字段,OCR 测出来的),挪到左 / 右下角。两行(名字电话 + 地址)时圆角收小,不然两头的字贴着弧线
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.beginPath();
    ctx.roundRect(L.x, L.y, L.w, L.h, L.lineGap ? 20 : L.h / 2);
    ctx.fill();
    const cx = L.x + L.w / 2;
    let y = L.y + L.padY;
    ctx.textBaseline = 'middle';
    if (L.top) {
      ctx.fillStyle = '#3D2B1F';
      ctx.font = `600 ${L.s1}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(L.top, cx, y + L.s1 / 2 + 1, L.w - L.padX * 2);
      y += L.s1 + L.lineGap;
    }
    if (L.addr) {
      ctx.font = `500 ${L.s2}px ${FONT}`;
      const pinW = L.s2 * 0.56;
      const room = L.w - L.padX * 2 - pinW - L.pinGap;
      const tw = Math.min(ctx.measureText(L.addr).width, room);
      const left = cx - (pinW + L.pinGap + tw) / 2;
      const mid = y + L.s2 / 2;
      ctx.fillStyle = '#FF6B35';
      drawPin(ctx, left, mid, L.s2);
      ctx.fillStyle = '#6B5444';
      ctx.textAlign = 'left';
      ctx.fillText(L.addr, left + pinW + L.pinGap, mid + 1, room);
    }
  }
  return c;
}

export async function drawCardBack(o: CardPrintOptions): Promise<HTMLCanvasElement> {
  const { c, ctx } = newCanvas();
  const tpl = templateOf(o.templateId);
  const map = drawCover(ctx, await loadImage(templateImg(tpl.id, 'back')));
  const [l, t] = map(tpl.box.l, tpl.box.t);
  const [r, b] = map(tpl.box.r, tpl.box.b);

  // 框里抽几个点,确认是白的(换了底图没重扫框的位置,这里会拦住)
  const probe = ctx.getImageData(Math.round(l + 12), Math.round(t + 12), Math.round(r - l - 24), Math.round(b - t - 24)).data;
  let dark = 0;
  for (let i = 0; i < probe.length; i += 4 * 97) {
    if (Math.min(probe[i], probe[i + 1], probe[i + 2]) < 225) dark++;
  }
  if (dark > 3) throw new Error('二维码框里不是空白的,模板需要重新标定');

  const inner = 14;
  const line = contactLine(o.name, o.phone);
  const lineH = line ? 26 : 0;
  const noH = 24;   // 网址那一行(20px ≈ 1.7mm,家长要照着输入,不能再小)
  const gap = 6;
  const side = Math.floor(Math.min(r - l - 2 * inner, b - t - 2 * inner - noH - lineH - gap * 2));
  // 纠错等级 M: 卡片会被揉、被茶水溅,比 L 稳;码再密就要更大的印刷尺寸
  const qr = await loadImage(await QRCode.toDataURL(o.url, {
    errorCorrectionLevel: 'M', margin: 0, width: side * 2, color: { dark: '#3D2B1F', light: '#FFFFFF' },
  }));
  const cx = (l + r) / 2;
  const qy = t + inner;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(qr, cx - side / 2, qy, side, side);
  ctx.imageSmoothingEnabled = true;

  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  let y = qy + side + gap;
  if (line) {
    ctx.fillStyle = '#3D2B1F';
    fitFont(ctx, line, 600, 22, 15, r - l - 2 * inner);
    ctx.fillText(line, cx, y);
    y += lineH;
  }
  // 二维码下面印网址(不印「NO. 卡号」): 家长扫不了码时照着输入也能打开留电话页,线索照样归这张卡的销售;
  // 卡号就在网址末尾,电话里也念得出来。不写 https:// —— 印出来太长,浏览器输入 http 会被 301 到 https
  const host = o.url.replace(/^https?:\/\//, '');
  ctx.fillStyle = '#6B5444';
  fitFont(ctx, host, 600, 20, 14, r - l - 2 * inner);
  ctx.fillText(host, cx, y);
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
  return out.toDataURL('image/jpeg', 0.9);
}
